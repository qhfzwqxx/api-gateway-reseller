import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@gateway/db";
import { sanitizeJsonForPostgres } from "../lib/db-sanitize.js";
import { sendApiError } from "../lib/errors.js";
import { createRequestTraceCode } from "../lib/crypto.js";
import { usageFromOpenAIResponse } from "../lib/usage.js";
import {
  chargeForRequest,
  ensureWalletCanStart,
  markRequestFailed,
  releaseWalletReservedAmount,
  reserveWalletBalance,
} from "../services/billing.js";
import { requireApiKey } from "../services/auth.js";
import {
  createManualTerminateUsage,
  isManualTerminateError,
  manualTerminateMessage,
  manualTerminateStatusCode,
  registerActiveApiRequest,
  unregisterActiveApiRequest,
} from "../services/active-api-requests.js";
import { disableApiKeyIfTotalLimitReached } from "../services/api-key-limits.js";
import {
  buildUpstreamUrl,
  scopeModelPoolCallerIdentity,
} from "../services/upstream.js";
import { resolveAccessRoutePolicy } from "../services/access-routing.js";
import {
  getActiveSubscriptionWithPlan,
  hasAvailableSubscriptionQuota,
  syncUserSubscriptionState,
} from "../services/subscriptions.js";
import { recordRoutingFeedback } from "../services/routing/feedback.js";
import {
  getLoggedUpstreamProviderKeyId,
  routeUpstreamRequest,
} from "../services/routing/router.js";
import {
  findIpBanRule,
  ipBanErrorUsageSource,
  ipBanNoticeUsageSource,
  type IpBanRule,
} from "../services/ip-ban-rules.js";
import {
  findTemporaryIpNoticeBan,
  type TemporaryIpNoticeBan,
} from "../services/temporary-ip-notice-ban.js";
import {
  applyReasoningEffortTransform,
  getReasoningEffortFromBody,
} from "../services/reasoning-effort-transform-settings.js";
import {
  createUpstreamOutputStreamFilter,
  filterUpstreamOutputBody,
  readUpstreamOutputFilterSettings,
  type UpstreamOutputFilterSettings,
} from "../services/upstream-output-filter-settings.js";
import { readCharityAnnouncementSettings } from "../services/charity-announcement-settings.js";
import { readGatewayNoticeSettings } from "../services/gateway-notice-settings.js";
import {
  canBypassGlobalCircuitBreaker,
  readGlobalCircuitBreakerSettings,
} from "../services/global-circuit-breaker-settings.js";
import {
  buildUpstreamBody,
  getClientIp,
  getUpstreamResponseMaxBytes,
  inferModelFromEndpoint,
  isAllowedMethod,
  isBillableEndpoint,
  isNoticeStreamEndpoint,
  isPlainObject,
  isResponsesEndpoint,
  isSupportedEndpoint,
  normalizeEndpoint,
  normalizeRequestUrl,
  redactBodyForLog,
  resolveUpstreamEndpoint,
  resolveUpstreamRequestUrl,
  safeReadUpstreamBody,
  shouldCheckNewRequestLimits,
  shouldReturnApiKeyNotice,
  shouldStreamResponse,
  transformProxyResponseBody,
  type ProxyBody,
} from "../services/proxy-request-utils.js";
import {
  buildNoticeStream,
  buildStreamErrorEvent,
  sendApiKeyNotice,
} from "../services/gateway-notice-response.js";
import {
  createGatewayRejectedRequest,
  sendCharityServiceDisabledResponse,
  sendIpBanResponse,
  sendModelUnavailableResponse,
  sendTemporaryIpNoticeBanResponse,
} from "../services/gateway-rejection-response.js";
import {
  createUnmeteredMissingUsage,
  estimateUsageFromResponse,
  estimateUsageFromStream,
  hasEncryptedContent,
  parseSseJsonPayloads,
  parseUsageFromSseBuffer,
  sseBufferHasCompletedResponse,
  sseBufferHasOutputToken,
} from "../services/proxy-usage.js";
import {
  checkNewRequestLimits,
  createNoopConcurrencyLock,
} from "../services/gateway-request-limits.js";
import {
  assertBillableUsage,
  clientStreamClosedMessage,
  clientStreamClosedStatusCode,
  createClientStreamClosedError,
  isClientStreamClosedError,
  isClosedControllerError,
  isMissingUsageError,
  isRetryableProxyError,
  isRetryableUpstreamFailure,
  isUpstreamBalanceInsufficientError,
  missingUsageMessage,
} from "../services/proxy-errors.js";
import {
  apiKeyIpAllowed,
  getGatewaySessionIdentity,
} from "../services/proxy-auth-context.js";
import { createSafeStreamController } from "../services/proxy-stream-controller.js";
import {
  collectEncryptedContents,
  createCompactChannelFingerprint,
  extractEncryptedItems,
  findCachedCompactForBody,
  hashEncryptedContent,
  readTargetCompactItems,
  replaceCompactionItemsByEncryptedContentHashes,
  saveCompactCache,
  saveTargetCompactItems,
} from "../services/compact-cache.js";
import type { ApiRequestWithUser, Usage } from "../types.js";
import type { UpstreamAttemptRoute } from "../services/routing/types.js";

type UpstreamAttemptResult =
  | { kind: "sent" }
  | {
      kind: "failed";
      statusCode: number;
      message: string;
      retryableFailure: boolean;
      responseBody?: string;
      responseContentType?: string;
    };

type CompactItemType = "compaction" | "compaction_summary";

const proxyRoutePatterns = [
  "/v1/*",
  "/response",
  "/response/*",
  "/responses",
  "/responses/*",
  "/chat/completions",
  "/embeddings",
  "/completions",
  "/images/generations",
];
const recoveryNoticeUsageSource = "gateway_recovery_notice";

type CompactFallbackTrace = {
  gatewayCompactFallback: true;
  fallbackAttempted: boolean;
  fallbackSucceeded: boolean;
  replacements?: number;
  compactCacheId?: string;
  encryptedContentHash?: string;
  sourceFingerprint?: string;
  targetFingerprint?: string;
  targetCacheHit?: boolean;
  error?: string;
};

type CompactFallbackContext = {
  attempted: boolean;
  trace?: CompactFallbackTrace;
};

export async function proxyRoutes(app: FastifyInstance) {
  for (const pattern of proxyRoutePatterns) {
    app.all(pattern, async (request: ApiRequestWithUser, reply) => {
      const rawEndpoint = request.url.split("?")[0] ?? request.url;
      const endpoint = normalizeEndpoint(rawEndpoint);
      const upstreamRequestUrl = normalizeRequestUrl(request.url);

      if (!isSupportedEndpoint(endpoint)) {
        return sendApiError(
          reply,
          404,
          "Endpoint not supported by this gateway",
        );
      }

      await requireApiKey(app, request, reply);
      if (reply.sent || !request.apiAuth) {
        return;
      }

      let body = (request.body ?? {}) as ProxyBody;
      const { apiKey, user } = request.apiAuth;
      await prisma.$transaction((tx) => syncUserSubscriptionState(tx, user.id));
      const activeSubscription = await prisma.$transaction((tx) =>
        getActiveSubscriptionWithPlan(tx, user.id),
      );
      const refreshedUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { tierId: true },
      });
      let model = body.model;
      const clientIp = getClientIp(request);
      const accessRoutePolicy = await resolveAccessRoutePolicy({
        userId: user.id,
        apiKeyId: apiKey.id,
        userTierId: refreshedUser?.tierId ?? user.tierId,
        apiKeyTierId: apiKey.tierId,
        clientIp,
      });
      const gatewayNoticeSettings = await readGatewayNoticeSettings();
      const globalCircuitBreakerSettings =
        await readGlobalCircuitBreakerSettings();
      if (
        !canBypassGlobalCircuitBreaker(globalCircuitBreakerSettings, {
          userId: user.id,
          userRole: user.role,
        })
      ) {
        await createGatewayRejectedRequest({
          body,
          endpoint,
          method: request.method,
          userId: user.id,
          apiKeyId: apiKey.id,
          clientIp,
          userAgent: request.headers["user-agent"],
          httpStatus: shouldReturnApiKeyNotice(endpoint, request.method)
            ? 200
            : 503,
          resultType: shouldReturnApiKeyNotice(endpoint, request.method)
            ? "GATEWAY_NOTICE"
            : "GATEWAY_ERROR",
          errorMessage: globalCircuitBreakerSettings.message,
          responseUsage: {
            source: "gateway_global_circuit_breaker",
            returnedToUser: shouldReturnApiKeyNotice(endpoint, request.method),
            reason: "global_circuit_breaker",
          },
          accessTierId: accessRoutePolicy.tierId,
        });

        if (shouldReturnApiKeyNotice(endpoint, request.method)) {
          return sendApiKeyNotice(
            reply,
            endpoint,
            body,
            upstreamRequestUrl,
            globalCircuitBreakerSettings.message,
            request.headers.accept,
          );
        }

        return sendApiError(
          reply,
          503,
          globalCircuitBreakerSettings.message,
          "server_error",
        );
      }
      if (!apiKeyIpAllowed(apiKey.ipWhitelist, clientIp)) {
        await createGatewayRejectedRequest({
          body,
          endpoint,
          method: request.method,
          userId: user.id,
          apiKeyId: apiKey.id,
          clientIp,
          userAgent: request.headers["user-agent"],
          httpStatus: 403,
          resultType: "GATEWAY_ERROR",
          errorMessage: "API key IP whitelist rejected this request",
          responseUsage: {
            source: "gateway_api_key_ip_whitelist",
            reason: "api_key_ip_whitelist",
            clientIp,
          },
          accessTierId: accessRoutePolicy.tierId,
        });
        return sendApiError(reply, 403, "IP not allowed for this API key");
      }
      if (user.charityEnabled) {
        const charitySettings = await readCharityAnnouncementSettings();
        if (!charitySettings.serviceEnabled) {
          return sendCharityServiceDisabledResponse({
            reply,
            endpoint,
            body,
            upstreamRequestUrl,
            noticeText: charitySettings.serviceDisabledMessage,
            clientIp,
            userId: user.id,
            apiKeyId: apiKey.id,
            method: request.method,
            userAgent: request.headers["user-agent"],
            acceptHeader: request.headers.accept,
          });
        }
      }
      const temporaryIpNoticeBan = await findTemporaryIpNoticeBan(
        app.redis,
        clientIp,
      );
      if (temporaryIpNoticeBan) {
        return sendTemporaryIpNoticeBanResponse({
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          temporaryIpNoticeBan,
          clientIp,
          userId: user.id,
          apiKeyId: apiKey.id,
          method: request.method,
          userAgent: request.headers["user-agent"],
          acceptHeader: request.headers.accept,
        });
      }

      const ipBanRule = await findIpBanRule(clientIp);
      if (ipBanRule) {
        return sendIpBanResponse({
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          ipBanRule,
          clientIp,
          userId: user.id,
          apiKeyId: apiKey.id,
          method: request.method,
          userAgent: request.headers["user-agent"],
          acceptHeader: request.headers.accept,
        });
      }

      if (
        apiKey.noticeEnabled &&
        apiKey.noticeText?.trim() &&
        shouldReturnApiKeyNotice(endpoint, request.method)
      ) {
        return sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          apiKey.noticeText,
          request.headers.accept,
        );
      }

      if (await disableApiKeyIfTotalLimitReached(apiKey)) {
        return sendApiError(
          reply,
          429,
          "API key total quota exceeded and has been disabled",
          "insufficient_quota",
        );
      }

      if (!isAllowedMethod(endpoint, request.method)) {
        return sendApiError(reply, 405, "Method not allowed");
      }

      const billable = isBillableEndpoint(endpoint, request.method);

      if (billable && !model) {
        return sendApiError(reply, 400, "Missing model");
      }

      if (
        model &&
        apiKey.allowedModels.length > 0 &&
        !apiKey.allowedModels.includes(model)
      ) {
        return sendApiError(
          reply,
          403,
          "Model is not allowed for this API key",
        );
      }

      if (
        model &&
        user.allowedModels.length > 0 &&
        !user.allowedModels.includes(model)
      ) {
        return sendApiError(reply, 403, "Model is not allowed for this user");
      }

      if (model) {
        const mappedModel = await resolveUserModelMapping(user.id, model);
        if (mappedModel && mappedModel !== model) {
          body = { ...body, model: mappedModel };
          model = mappedModel;
        }
      }

      if (billable && accessRoutePolicy.walletRequired) {
        const subscriptionCanStart =
          activeSubscription && hasAvailableSubscriptionQuota(activeSubscription);
        const walletCheck =
          subscriptionCanStart
            ? { ok: true as const, balance: new Decimal(0) }
            : await ensureWalletCanStart(user.id);
        if (!walletCheck.ok) {
          await createGatewayRejectedRequest({
            body,
            endpoint,
            method: request.method,
            userId: user.id,
            apiKeyId: apiKey.id,
            clientIp,
            userAgent: request.headers["user-agent"],
            httpStatus: 402,
            resultType: "INSUFFICIENT_BALANCE",
            errorMessage: walletCheck.reason,
            responseUsage: {
              source: "gateway_balance_check",
              reason: "insufficient_balance",
            },
            accessTierId: accessRoutePolicy.tierId,
          });
          return sendApiError(
            reply,
            402,
            walletCheck.reason,
            "insufficient_quota",
          );
        }
      }

      const runtimeLimitLock = shouldCheckNewRequestLimits(
        endpoint,
        request.method,
      )
        ? await checkNewRequestLimits(app, {
            userId: user.id,
            userConcurrencyLimit: user.concurrencyLimit,
            userRateLimitPerMinute: user.rateLimitPerMinute,
            apiKeyId: apiKey.id,
            apiKeyConcurrencyLimit: apiKey.concurrencyLimit,
            apiKeyRateLimitPerMinute: apiKey.rateLimitPerMinute,
            charityIpRateLimitEnabled:
              user.charityEnabled && user.charityIpRateLimitEnabled,
            charityIpRateLimitPerMinute: user.charityIpRateLimitPerMinute,
            clientIp,
            userRole: user.role,
            noticeSettings: gatewayNoticeSettings,
          })
        : createNoopConcurrencyLock();

      if (!runtimeLimitLock.ok) {
        await createGatewayRejectedRequest({
          body,
          endpoint,
          method: request.method,
          userId: user.id,
          apiKeyId: apiKey.id,
          clientIp,
          userAgent: request.headers["user-agent"],
          httpStatus: shouldReturnApiKeyNotice(endpoint, request.method)
            ? 200
            : 429,
          resultType: shouldReturnApiKeyNotice(endpoint, request.method)
            ? "GATEWAY_NOTICE"
            : "RATE_LIMITED",
          errorMessage: runtimeLimitLock.noticeText,
          responseUsage: {
            source: "gateway_runtime_limit",
            returnedToUser: shouldReturnApiKeyNotice(endpoint, request.method),
            reason: "runtime_limit",
          },
          accessTierId: accessRoutePolicy.tierId,
        });
        if (!shouldReturnApiKeyNotice(endpoint, request.method)) {
          return sendApiError(
            reply,
            429,
            runtimeLimitLock.noticeText,
            "rate_limit_exceeded",
          );
        }

        return sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          runtimeLimitLock.noticeText,
          request.headers.accept,
        );
      }

      const stickyIdentity =
        clientIp || getGatewaySessionIdentity(request, body, apiKey.id);
      const scopedStickyIdentity = scopeModelPoolCallerIdentity(
        stickyIdentity,
        accessRoutePolicy.tierId,
      );
      let initialRoute: UpstreamAttemptRoute;
      try {
        initialRoute = await routeUpstreamRequest({
          billable,
          model,
          callerIdentity: stickyIdentity,
          accessRoutePolicy,
        });
      } catch (error) {
        await runtimeLimitLock.release();
        throw error;
      }
      const billableModel = billable ? model : undefined;

      if (billable && (!initialRoute.price || !initialRoute.price.enabled)) {
        await runtimeLimitLock.release();
        await initialRoute.release?.();
        return sendModelUnavailableResponse({
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          model,
          clientIp,
          userId: user.id,
          apiKeyId: apiKey.id,
          method: request.method,
          userAgent: request.headers["user-agent"],
          acceptHeader: request.headers.accept,
          noticeText: gatewayNoticeSettings.modelUnavailableMessage,
        });
      }

      const walletReservation = billable
        ? !accessRoutePolicy.walletRequired ||
          (activeSubscription && hasAvailableSubscriptionQuota(activeSubscription))
          ? { ok: true as const, amount: new Decimal(0) }
          : await reserveWalletBalance({ userId: user.id })
        : { ok: true as const, amount: new Decimal(0) };
      if (!walletReservation.ok) {
        await runtimeLimitLock.release();
        await initialRoute.release?.();
        await createGatewayRejectedRequest({
          body,
          endpoint,
          method: request.method,
          userId: user.id,
          apiKeyId: apiKey.id,
          clientIp,
          userAgent: request.headers["user-agent"],
          httpStatus: 402,
          resultType: "INSUFFICIENT_BALANCE",
          errorMessage: walletReservation.reason,
          responseUsage: {
            source: "gateway_balance_reservation",
            reason: "insufficient_available_balance",
          },
          accessTierId: accessRoutePolicy.tierId,
        });
        return sendApiError(
          reply,
          402,
          walletReservation.reason,
          "insufficient_quota",
        );
      }

      const start = performance.now();
      let apiRequest;
      try {
        apiRequest = await prisma.apiRequest.create({
          data: {
            traceCode: createRequestTraceCode(),
            userId: user.id,
            apiKeyId: apiKey.id,
            upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(initialRoute),
            upstreamProvider: initialRoute.provider.name,
            model: model ?? inferModelFromEndpoint(endpoint),
            accessTierId: accessRoutePolicy.tierId,
            reasoningEffort: getReasoningEffortFromBody(body),
            endpoint,
            method: request.method,
            status: "PENDING",
            reservedAmountUsd: walletReservation.amount.toFixed(8),
            clientIp,
            userAgent: request.headers["user-agent"],
            requestBody: redactBodyForLog(body) as Prisma.InputJsonValue,
            ...(endpoint === "/v1/responses/compact"
              ? {
                  responseUsage: createNormalCompactResponseUsage(
                    "compact_request_in_progress",
                  ) as Prisma.InputJsonValue,
                }
              : {}),
          },
        });
      } catch (error) {
        await releaseWalletReservedAmount({
          userId: user.id,
          amountUsd: walletReservation.amount,
        });
        await runtimeLimitLock.release();
        await initialRoute.release?.();
        throw error;
      }

      bindConcurrencyRelease(reply, runtimeLimitLock.release);
      const routeRelease = createMutableLifecycleRelease(reply);
      routeRelease.set(initialRoute.release);

      let activeRoute = initialRoute;
      const skippedChannelIds = new Set<string>();
      const compactFallbackContext: CompactFallbackContext = {
        attempted: false,
      };

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = await runUpstreamAttempt({
          app,
          request,
          reply,
          body,
          endpoint,
          upstreamRequestUrl,
          apiRequestId: apiRequest.id,
          userId: user.id,
          apiKeyId: apiKey.id,
          callerIdentity: scopedStickyIdentity,
          route: activeRoute,
          billable,
          model,
          billableModel,
          accessTierId: accessRoutePolicy.tierId,
          startedAt: start,
          attempt,
          compactFallbackContext,
        });

        if (result.kind === "sent") {
          return;
        }

        if (
          attempt >= 2 ||
          !billable ||
          !model ||
          !activeRoute.channelId ||
          reply.sent ||
          !result.retryableFailure
        ) {
          return sendFinalAttemptFailure(
            reply,
            apiRequest.id,
            result,
            start,
            compactFallbackContext,
          );
        }

        skippedChannelIds.add(activeRoute.channelId);
        const nextRoute = await routeUpstreamRequest({
          billable,
          model,
          callerIdentity: stickyIdentity,
          accessRoutePolicy,
          excludeChannelIds: [...skippedChannelIds],
          bypassSticky: true,
          skipStickyUpdate: true,
        });

        if (
          !nextRoute.channelId ||
          nextRoute.channelId === activeRoute.channelId ||
          !nextRoute.price?.enabled
        ) {
          await nextRoute.release?.();
          return sendFinalAttemptFailure(
            reply,
            apiRequest.id,
            result,
            start,
            compactFallbackContext,
          );
        }

        app.log.info(
          {
            model,
            requestId: apiRequest.id,
            fromChannelId: activeRoute.channelId,
            fromProvider: activeRoute.provider.name,
            toChannelId: nextRoute.channelId,
            toProvider: nextRoute.provider.name,
            status: result.statusCode,
          },
          "Retrying upstream request on another model pool channel",
        );
        await activeRoute.release?.();
        activeRoute = nextRoute;
        routeRelease.set(nextRoute.release);
        await updateApiRequestRoute(
          apiRequest.id,
          nextRoute,
          result.statusCode,
        );
      }
    });
  }
}

function bindConcurrencyRelease(
  reply: FastifyReply,
  release: () => Promise<void>,
) {
  bindLifecycleRelease(reply, release);
}

function bindLifecycleRelease(
  reply: FastifyReply,
  release: () => Promise<void>,
) {
  let released = false;
  const releaseOnce = () => {
    if (released) {
      return;
    }
    released = true;
    void release();
  };

  reply.raw.once("finish", releaseOnce);
  reply.raw.once("close", releaseOnce);
  reply.raw.once("error", releaseOnce);
}

function createMutableLifecycleRelease(reply: FastifyReply) {
  let release: (() => Promise<void>) | undefined;

  bindLifecycleRelease(reply, async () => {
    await release?.();
  });

  return {
    set(nextRelease: (() => Promise<void>) | undefined) {
      release = nextRelease;
    },
  };
}

async function resolveUserModelMapping(userId: string, fromModel: string) {
  const mapping = await prisma.userModelMapping.findUnique({
    where: {
      userId_fromModel: {
        userId,
        fromModel,
      },
    },
    select: { toModel: true },
  });

  return mapping?.toModel;
}

function getCompactChannelFingerprint(route: UpstreamAttemptRoute) {
  return createCompactChannelFingerprint({
    channelId: route.channelId,
    upstreamProviderKeyId:
      route.upstreamProviderKeyId ?? getLoggedUpstreamProviderKeyId(route),
    providerId: route.provider.id,
    providerName: route.provider.name,
    providerApiKey: route.provider.apiKey,
  });
}

async function applyCompactFallback(params: {
  app: FastifyInstance;
  endpoint: string;
  method: string;
  body: ProxyBody;
  route: UpstreamAttemptRoute;
  apiRequestId: string;
  userId: string;
  apiKeyId: string;
  model?: string;
  compactFallbackContext: CompactFallbackContext;
}): Promise<ProxyBody> {
  const {
    app,
    endpoint,
    method,
    body,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  } = params;
  if (
    endpoint !== "/v1/responses" ||
    method !== "POST" ||
    compactFallbackContext.attempted
  ) {
    return body;
  }

  let cachedCompact: Awaited<ReturnType<typeof findCachedCompactForBody>>;
  try {
    cachedCompact = await findCachedCompactForBody(body);
  } catch (error) {
    app.log.warn(
      { error },
      "Responses compact cache lookup failed; continuing original request",
    );
    return body;
  }

  if (!cachedCompact) {
    return body;
  }

  if (
    cachedCompact.cache.userId !== userId ||
    cachedCompact.cache.apiKeyId !== apiKeyId ||
    cachedCompact.cache.model !== model
  ) {
    app.log.warn(
      {
        compactCacheId: cachedCompact.compactCacheId,
        encryptedContentHash: cachedCompact.encryptedContentHash,
      },
      "Responses compact cache ownership mismatch; continuing original request",
    );
    return body;
  }

  const targetFingerprint = getCompactChannelFingerprint(route);
  if (cachedCompact.cache.sourceFingerprint === targetFingerprint) {
    return body;
  }

  if (isCompactFallbackDisabledForUser(userId)) {
    app.log.info(
      {
        compactCacheId: cachedCompact.compactCacheId,
        userId,
      },
      "Responses compact fallback disabled for user; continuing original request",
    );
    return body;
  }

  const targetCacheHit = await readTargetCompactItems({
    compactCacheId: cachedCompact.compactCacheId,
    targetFingerprint,
  });
  if (targetCacheHit) {
    const replacementsByHash = buildCompactFallbackReplacements(
      cachedCompact.cache.encryptedContentHashes,
      targetCacheHit,
      getTargetCompactItemType(route),
    );
    const replaced = replaceCompactionItemsByEncryptedContentHashes(
      body,
      replacementsByHash,
    );
    if (replaced.replacements > 0) {
      compactFallbackContext.attempted = true;
      compactFallbackContext.trace = {
        gatewayCompactFallback: true,
        fallbackAttempted: false,
        fallbackSucceeded: true,
        replacements: replaced.replacements,
        compactCacheId: cachedCompact.compactCacheId,
        encryptedContentHash: cachedCompact.encryptedContentHash,
        sourceFingerprint: cachedCompact.cache.sourceFingerprint,
        targetFingerprint,
        targetCacheHit: true,
      };
      return replaced.value;
    }
  }

  compactFallbackContext.attempted = true;
  const trace: CompactFallbackTrace = {
    gatewayCompactFallback: true,
    fallbackAttempted: true,
    fallbackSucceeded: false,
    compactCacheId: cachedCompact.compactCacheId,
    encryptedContentHash: cachedCompact.encryptedContentHash,
    sourceFingerprint: cachedCompact.cache.sourceFingerprint,
    targetFingerprint,
  };
  compactFallbackContext.trace = trace;
  await prisma.apiRequest.updateMany({
    where: {
      id: apiRequestId,
      status: "PENDING",
    },
    data: {
      responseUsage: createCompactFallbackResponseUsage(
        trace,
        "compact_fallback_in_progress",
      ) as Prisma.InputJsonValue,
    },
  });

  try {
    const targetCompactItems = await requestTargetCompact({
      route,
      requestBody: cachedCompact.cache.requestBody,
    });
    await saveTargetCompactItems({
      compactCacheId: cachedCompact.compactCacheId,
      targetFingerprint,
      targetItems: targetCompactItems,
    });
    const replacementsByHash = buildCompactFallbackReplacements(
      cachedCompact.cache.encryptedContentHashes,
      targetCompactItems,
      getTargetCompactItemType(route),
    );
    const replaced = replaceCompactionItemsByEncryptedContentHashes(
      body,
      replacementsByHash,
    );
    trace.replacements = replaced.replacements;
    trace.fallbackSucceeded = replaced.replacements > 0;

    return replaced.replacements > 0 ? replaced.value : body;
  } catch (error) {
    trace.error =
      error instanceof Error ? error.message : "compact fallback failed";
    compactFallbackContext.trace = undefined;
    app.log.warn(
      {
        error,
        compactCacheId: cachedCompact.compactCacheId,
        targetFingerprint,
      },
      "Responses compact fallback failed; continuing original request",
    );
    return body;
  }

  function isCompactFallbackDisabledForUser(userId: string) {
    const disabledUserIds = (
      process.env.GATEWAY_COMPACT_FALLBACK_DISABLED_USER_IDS ?? ""
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return disabledUserIds.includes(userId);
  }
}

async function recoverInvalidEncryptedContentWithCompact(params: {
  app: FastifyInstance;
  body: ProxyBody;
  route: UpstreamAttemptRoute;
  apiRequestId: string;
  userId: string;
  apiKeyId: string;
  model?: string;
  compactFallbackContext: CompactFallbackContext;
}): Promise<ProxyBody | null> {
  const {
    app,
    body,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  } = params;

  let cachedCompact: Awaited<ReturnType<typeof findCachedCompactForBody>>;
  try {
    cachedCompact = await findCachedCompactForBody(body);
  } catch (error) {
    app.log.warn(
      { error },
      "Responses compact cache lookup failed during invalid encrypted content recovery",
    );
    return null;
  }

  if (!cachedCompact) {
    return null;
  }

  if (
    cachedCompact.cache.userId !== userId ||
    cachedCompact.cache.apiKeyId !== apiKeyId ||
    cachedCompact.cache.model !== model
  ) {
    app.log.warn(
      {
        compactCacheId: cachedCompact.compactCacheId,
        encryptedContentHash: cachedCompact.encryptedContentHash,
      },
      "Responses compact cache ownership mismatch during invalid encrypted content recovery",
    );
    return null;
  }

  const targetFingerprint = getCompactChannelFingerprint(route);
  compactFallbackContext.attempted = true;
  const trace: CompactFallbackTrace = {
    gatewayCompactFallback: true,
    fallbackAttempted: true,
    fallbackSucceeded: false,
    compactCacheId: cachedCompact.compactCacheId,
    encryptedContentHash: cachedCompact.encryptedContentHash,
    sourceFingerprint: cachedCompact.cache.sourceFingerprint,
    targetFingerprint,
  };
  compactFallbackContext.trace = trace;
  await prisma.apiRequest.updateMany({
    where: {
      id: apiRequestId,
      status: "PENDING",
    },
    data: {
      responseUsage: createCompactFallbackResponseUsage(
        trace,
        "invalid_encrypted_content_recovery_in_progress",
      ) as Prisma.InputJsonValue,
    },
  });

  try {
    const targetCompactItems = await requestTargetCompact({
      route,
      requestBody: cachedCompact.cache.requestBody,
    });
    await saveTargetCompactItems({
      compactCacheId: cachedCompact.compactCacheId,
      targetFingerprint,
      targetItems: targetCompactItems,
    });
    const replacementsByHash = buildCompactFallbackReplacements(
      cachedCompact.cache.encryptedContentHashes,
      targetCompactItems,
      getTargetCompactItemType(route),
    );
    const replaced = replaceCompactionItemsByEncryptedContentHashes(
      body,
      replacementsByHash,
    );
    trace.replacements = replaced.replacements;
    trace.fallbackSucceeded = replaced.replacements > 0;

    return replaced.replacements > 0 ? replaced.value : null;
  } catch (error) {
    trace.error =
      error instanceof Error
        ? error.message
        : "invalid encrypted content recovery compact failed";
    app.log.warn(
      {
        error,
        compactCacheId: cachedCompact.compactCacheId,
        targetFingerprint,
      },
      "Responses compact recovery failed; continuing original invalid encrypted content handling",
    );
    return null;
  }
}

function buildCompactFallbackReplacements(
  sourceEncryptedContentHashes: string[],
  targetItems: Array<{ encryptedContent: string; item: unknown }>,
  targetItemType: CompactItemType,
) {
  const replacements = new Map<string, unknown>();
  const maxLength = Math.min(
    sourceEncryptedContentHashes.length,
    targetItems.length,
  );
  for (let index = 0; index < maxLength; index += 1) {
    const sourceHash = sourceEncryptedContentHashes[index];
    const targetItem = targetItems[index];
    if (sourceHash && targetItem) {
      replacements.set(
        sourceHash,
        normalizeCompactItemForTarget(targetItem.item, targetItemType),
      );
    }
  }
  return replacements;
}

function getTargetCompactItemType(
  route: UpstreamAttemptRoute,
): CompactItemType {
  const value =
    "compactItemType" in route.provider
      ? route.provider.compactItemType
      : undefined;
  return value === "compaction" ? "compaction" : "compaction_summary";
}

function normalizeCompactItemForTarget(
  item: unknown,
  targetItemType: CompactItemType,
) {
  if (!isPlainObject(item)) {
    return item;
  }

  const encryptedContent = item.encrypted_content;
  if (typeof encryptedContent !== "string" || !encryptedContent) {
    return item;
  }

  if (targetItemType === "compaction") {
    const { id: _id, object: _object, ...rest } = item;
    return {
      ...rest,
      type: "compaction",
      encrypted_content: encryptedContent,
    };
  }

  return {
    ...item,
    id:
      typeof item.id === "string" && item.id
        ? item.id
        : `compact_${hashEncryptedContent(encryptedContent).slice(0, 24)}`,
    type: "compaction_summary",
    encrypted_content: encryptedContent,
  };
}

async function requestTargetCompact(params: {
  route: UpstreamAttemptRoute;
  requestBody: unknown;
}): Promise<Array<{ encryptedContent: string; item: unknown }>> {
  const { route, requestBody } = params;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    route.provider.timeoutMs,
  );
  try {
    const response = await fetch(
      buildUpstreamUrl(route.provider.baseUrl, "/v1/responses/compact"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${route.provider.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildInternalCompactRequestBody(requestBody)),
        signal: controller.signal,
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        typeof responseBody === "string"
          ? responseBody.slice(0, 1000)
          : JSON.stringify(responseBody).slice(0, 1000);
      throw new Error(
        `compact fallback upstream failed with ${response.status}: ${message}`,
      );
    }

    const parsedResponseBody =
      typeof responseBody === "string" &&
      contentType.includes("text/event-stream")
        ? parseSseJsonPayloads(responseBody)
        : responseBody;
    const encryptedItems = extractEncryptedItems(parsedResponseBody);
    if (encryptedItems.length === 0) {
      throw new Error("compact fallback response missing encrypted_content");
    }

    return encryptedItems;
  } finally {
    clearTimeout(timeout);
  }
}

function buildInternalCompactRequestBody(requestBody: unknown) {
  if (!isPlainObject(requestBody)) {
    return requestBody;
  }

  const compactBody = { ...requestBody };
  delete compactBody.stream;
  delete compactBody.stream_options;
  return compactBody;
}

async function updateApiRequestRoute(
  requestId: string,
  route: UpstreamAttemptRoute,
  previousStatusCode?: number,
) {
  await prisma.apiRequest.update({
    where: { id: requestId },
    data: {
      upstreamProvider: route.provider.name,
      upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(route),
      httpStatus: previousStatusCode,
    },
  });
}

async function sendFinalAttemptFailure(
  reply: FastifyReply,
  requestId: string,
  result: Extract<UpstreamAttemptResult, { kind: "failed" }>,
  startedAt: number,
  compactFallbackContext?: CompactFallbackContext,
) {
  await markRequestFailed(
    { id: requestId },
    result.message,
    result.statusCode,
    Math.round(performance.now() - startedAt),
    compactFallbackContext?.trace
      ? createCompactFallbackResponseUsage(
          compactFallbackContext.trace,
          "final_attempt_failure",
        )
      : undefined,
    "UPSTREAM_ERROR",
  );

  if (result.responseBody !== undefined) {
    reply.status(result.statusCode);
    reply.header(
      "content-type",
      result.responseContentType ?? "application/json",
    );
    return reply.send(result.responseBody);
  }

  return sendApiError(
    reply,
    result.statusCode,
    result.message,
    result.statusCode === 504 ? "timeout_error" : "upstream_error",
  );
}

async function runUpstreamAttempt(params: {
  app: FastifyInstance;
  request: ApiRequestWithUser;
  reply: FastifyReply;
  body: ProxyBody;
  endpoint: string;
  upstreamRequestUrl: string;
  apiRequestId: string;
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  route: UpstreamAttemptRoute;
  billable: boolean;
  model?: string;
  billableModel?: string;
  accessTierId?: string | null;
  startedAt: number;
  attempt: number;
  compactFallbackContext: CompactFallbackContext;
  invalidCompactRetryAttempted?: boolean;
}): Promise<UpstreamAttemptResult> {
  const {
    app,
    request,
    reply,
    body,
    endpoint,
    upstreamRequestUrl,
    apiRequestId,
    userId,
    apiKeyId,
    callerIdentity,
    route,
    billable,
    model,
    billableModel,
    accessTierId,
    startedAt,
    compactFallbackContext,
    invalidCompactRetryAttempted,
  } = params;
  const { provider, price, channelId } = route;
  const upstreamProviderKeyId = getLoggedUpstreamProviderKeyId(route);
  const resolvedUpstreamRequestUrl = resolveUpstreamRequestUrl(
    endpoint,
    upstreamRequestUrl,
    price,
  );
  const resolvedUpstreamEndpoint = resolveUpstreamEndpoint(
    resolvedUpstreamRequestUrl,
  );
  const fallbackBody = await applyCompactFallback({
    app,
    endpoint,
    method: request.method,
    body,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  });
  const upstreamBody = await applyReasoningEffortTransform(
    buildUpstreamBody(
      endpoint,
      fallbackBody,
      provider,
      resolvedUpstreamEndpoint,
    ),
  );
  const actualReasoningEffort = getReasoningEffortFromBody(upstreamBody);
  if (actualReasoningEffort) {
    await prisma.apiRequest.update({
      where: { id: apiRequestId },
      data: { reasoningEffortActual: actualReasoningEffort },
    });
  }
  let activeController: AbortController | undefined;
  let activeControllerHandedOff = false;

  try {
    const controller = new AbortController();
    activeController = controller;
    registerActiveApiRequest(apiRequestId, controller);
    const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);

    const upstreamRequestStartedAt = performance.now();
    const upstreamResponse = await fetch(
      buildUpstreamUrl(provider.baseUrl, resolvedUpstreamRequestUrl),
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
          Accept: body.stream ? "text/event-stream" : "application/json",
        },
        body:
          request.method === "GET" || request.method === "DELETE"
            ? undefined
            : JSON.stringify(upstreamBody),
        signal: controller.signal,
      },
    ).finally(() => {
      clearTimeout(timeout);
    });
    const upstreamFirstChunkLatencyMs = Math.round(
      performance.now() - upstreamRequestStartedAt,
    );

    await prisma.apiRequest.update({
      where: { id: apiRequestId },
      data: {
        upstreamProvider: provider.name,
        upstreamProviderKeyId,
        httpStatus: upstreamResponse.status,
        upstreamRequestId: upstreamResponse.headers.get("x-request-id"),
        upstreamFirstChunkLatencyMs,
      },
    });

    if (!upstreamResponse.ok) {
      const text = await upstreamResponse.text();
      const statusCode = upstreamResponse.status;
      const retryableFailure = isRetryableUpstreamFailure(statusCode, text);

      if (
        endpoint === "/v1/responses" &&
        request.method === "POST" &&
        !invalidCompactRetryAttempted &&
        isInvalidEncryptedContentError(text)
      ) {
        const recoveredBody = await recoverInvalidEncryptedContentWithCompact({
          app,
          body: fallbackBody,
          route,
          apiRequestId,
          userId,
          apiKeyId,
          model,
          compactFallbackContext,
        });

        if (recoveredBody) {
          return runUpstreamAttempt({
            ...params,
            body: recoveredBody,
            invalidCompactRetryAttempted: true,
          });
        }
      }

      if (
        retryableFailure &&
        params.attempt < 2 &&
        billable &&
        model &&
        channelId
      ) {
        await recordFailedChannelAttempt({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          retryableFailure,
          startedAt,
          logger: app.log,
        });
        return {
          kind: "failed",
          statusCode,
          message: text.slice(0, 2000),
          retryableFailure,
          responseBody: text,
          responseContentType:
            upstreamResponse.headers.get("content-type") ?? "application/json",
        };
      }

      const recoveryNotice = await getGatewayRecoveryNotice(text);
      await markRequestFailed(
        { id: apiRequestId },
        text.slice(0, 2000),
        statusCode,
        Math.round(performance.now() - startedAt),
        compactFallbackContext.trace
          ? createCompactFallbackResponseUsage(
              compactFallbackContext.trace,
              "upstream_non_ok",
            )
          : undefined,
        "UPSTREAM_ERROR",
      );
      if (
        recoveryNotice &&
        shouldReturnApiKeyNotice(endpoint, request.method)
      ) {
        await markRecoveryNoticeReturned(
          apiRequestId,
          recoveryNotice,
          "upstream_non_ok",
          compactFallbackContext.trace,
          endpoint === "/v1/responses/compact"
            ? createNormalCompactResponseUsage("compact_request_failed")
            : undefined,
        );
        sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          recoveryNotice,
          request.headers.accept,
        );
        return { kind: "sent" };
      }
      if (billable && model) {
        await recordFailedChannelAttempt({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          retryableFailure,
          startedAt,
          logger: app.log,
        });
      }
      reply.status(statusCode);
      reply.header(
        "content-type",
        upstreamResponse.headers.get("content-type") ?? "application/json",
      );
      reply.send(text);
      return { kind: "sent" };
    }

    const shouldStream = shouldStreamResponse(
      upstreamResponse,
      body,
      upstreamRequestUrl,
      endpoint,
    );
    const upstreamOutputFilterSettings =
      await readUpstreamOutputFilterSettings();

    if (shouldStream && billable && price) {
      activeControllerHandedOff = true;
      await proxyStream({
        reply,
        upstreamResponse,
        activeController: controller,
        apiRequestId,
        endpoint,
        requestBody: upstreamBody,
        userId,
        callerIdentity,
        apiKeyId,
        priceId: price.id,
        accessTierId,
        model: billableModel ?? price.model,
        channelId,
        upstreamProviderKeyId,
        startedAt,
        upstreamRequestStartedAt,
        logger: app.log,
        compactFallbackTrace: compactFallbackContext.trace,
        compactCacheRequestBody:
          endpoint === "/v1/responses/compact" ? body : undefined,
        compactCacheSourceFingerprint:
          endpoint === "/v1/responses/compact"
            ? getCompactChannelFingerprint(route)
            : undefined,
        upstreamOutputFilterSettings,
      });
      return { kind: "sent" };
    }

    if (shouldStream) {
      activeControllerHandedOff = true;
      await proxyPassthroughStream({
        reply,
        upstreamResponse,
        activeController: controller,
        apiRequestId,
        startedAt,
        upstreamRequestStartedAt,
        upstreamOutputFilterSettings,
      });
      return { kind: "sent" };
    }

    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    const rawBody = await safeReadUpstreamBody(upstreamResponse, {
      logger: app.log,
      maxBytes: getUpstreamResponseMaxBytes(endpoint),
    });
    if ("error" in rawBody) {
      await markRequestFailed(
        { id: apiRequestId },
        rawBody.error.message,
        rawBody.error.statusCode,
        Math.round(performance.now() - startedAt),
        undefined,
        "UPSTREAM_ERROR",
      );
      reply.status(rawBody.error.statusCode);
      reply.header("content-type", "application/json");
      reply.send({ error: rawBody.error.message });
      return { kind: "sent" };
    }
    const upstreamResponseBody = contentType.includes("application/json")
      ? rawBody.json
      : contentType.includes("text/event-stream")
        ? parseSseJsonPayloads(rawBody.text)
        : rawBody.text;
    const responseBody = transformProxyResponseBody(
      endpoint,
      resolvedUpstreamEndpoint,
      upstreamResponseBody,
    );
    const filteredResponseBody = filterUpstreamOutputBody(
      responseBody,
      upstreamOutputFilterSettings,
    );

    let normalCompactUsageMetadata:
      | ReturnType<typeof createNormalCompactResponseUsage>
      | undefined;
    if (endpoint === "/v1/responses/compact") {
      const compactCacheResult = await cacheCompactResponse({
        logger: app.log,
        requestBody: body,
        responseBody: upstreamResponseBody,
        userId,
        apiKeyId,
        model,
        route,
      });
      if (compactCacheResult?.saved) {
        normalCompactUsageMetadata = createNormalCompactResponseUsage(
          "compact_request_completed",
          {
            compactCacheId: compactCacheResult.compactCacheId,
            encryptedContentHashes: compactCacheResult.encryptedContentHashes,
            sourceFingerprint: getCompactChannelFingerprint(route),
          },
        );
      }
    }

    if (!billable || !price) {
      await prisma.apiRequest.update({
        where: { id: apiRequestId },
        data: {
          status: "SUCCESS",
          resultType: "PROXIED_SUCCESS",
          latencyMs: Math.round(performance.now() - startedAt),
        },
      });

      reply.status(upstreamResponse.status);
      reply.header("content-type", contentType || "application/json");
      reply.send(filteredResponseBody);
      return { kind: "sent" };
    }

    let usage = usageFromOpenAIResponse(upstreamResponseBody);
    if (usage.totalTokens <= 0) {
      const estimatedUsage = estimateUsageFromResponse(
        endpoint,
        upstreamBody,
        upstreamResponseBody,
      );
      if (estimatedUsage) {
        usage = estimatedUsage;
        app.log.warn(
          { apiRequestId, model: billableModel ?? price.model, channelId },
          "Upstream response did not include usage; using estimated billable usage",
        );
      }
    }
    if (usage.totalTokens <= 0) {
      usage = createUnmeteredMissingUsage("missing_response_usage_unmetered");
      app.log.warn(
        { apiRequestId, model: billableModel ?? price.model, channelId },
        "Upstream response did not include usage; passing through without billing",
      );
    }
    if (normalCompactUsageMetadata) {
      usage.raw = isPlainObject(usage.raw)
        ? { ...usage.raw, ...normalCompactUsageMetadata }
        : normalCompactUsageMetadata;
    }
    usage = withCompactFallbackUsage(usage, compactFallbackContext.trace);
    try {
      await chargeForRequest({
        requestId: apiRequestId,
        userId,
        price,
        usage,
        accessTierId,
        startedAt,
      });
    } catch (error) {
      await markRequestFailed(
        { id: apiRequestId },
        error instanceof Error ? error.message : "Billing failed",
        500,
        Math.round(performance.now() - startedAt),
        undefined,
        "BILLING_ERROR",
      );
      throw error;
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    await recordRoutingFeedback({
      userId,
      apiKeyId,
      callerIdentity,
      model: billableModel ?? price.model,
      channelId,
      upstreamProviderKeyId,
      streamed: false,
      firstTokenLatencyMs: null,
      latencyMs,
      ignoreSlowPenalty:
        endpoint === "/v1/responses/compact" ||
        compactFallbackContext.trace?.gatewayCompactFallback === true,
      failed: false,
      logger: app.log,
    });

    reply.status(upstreamResponse.status);
    reply.header("content-type", contentType || "application/json");
    reply.send(filteredResponseBody);
    return { kind: "sent" };
  } catch (error) {
    const manualTerminated = isManualTerminateError(error);
    const message = manualTerminated
      ? manualTerminateMessage
      : error instanceof Error
        ? error.message
        : "Upstream request failed";
    const statusCode = manualTerminated ? manualTerminateStatusCode : 502;
    const retryableFailure = isRetryableProxyError(error, endpoint);

    if (
      !manualTerminated &&
      retryableFailure &&
      params.attempt < 2 &&
      billable &&
      model &&
      channelId
    ) {
      await recordFailedChannelAttempt({
        userId,
        apiKeyId,
        callerIdentity,
        model,
        channelId,
        upstreamProviderKeyId,
        retryableFailure,
        startedAt,
        ignoreSlowPenalty:
          endpoint === "/v1/responses/compact" ||
          compactFallbackContext.trace?.gatewayCompactFallback === true,
        logger: app.log,
      });
      return {
        kind: "failed",
        statusCode,
        message,
        retryableFailure,
      };
    }

    const recoveryNotice = await getGatewayRecoveryNotice(error);
    await markRequestFailed(
      { id: apiRequestId },
      message,
      statusCode,
      Math.round(performance.now() - startedAt),
      createFailureResponseUsage({
        manualTerminated,
        compactFallbackTrace: compactFallbackContext.trace,
        reason: "proxy_catch",
      }),
      manualTerminated ? "MANUAL_TERMINATED" : "UPSTREAM_ERROR",
    );
    if (recoveryNotice && shouldReturnApiKeyNotice(endpoint, request.method)) {
      await markRecoveryNoticeReturned(
        apiRequestId,
        recoveryNotice,
        "proxy_catch",
        compactFallbackContext.trace,
        endpoint === "/v1/responses/compact"
          ? createNormalCompactResponseUsage("compact_request_failed")
          : undefined,
      );
      sendApiKeyNotice(
        reply,
        endpoint,
        body,
        upstreamRequestUrl,
        recoveryNotice,
        request.headers.accept,
      );
      return { kind: "sent" };
    }
    if (billable && model && !manualTerminated) {
      await recordFailedChannelAttempt({
        userId,
        apiKeyId,
        callerIdentity,
        model,
        channelId,
        upstreamProviderKeyId,
        retryableFailure,
        startedAt,
        ignoreSlowPenalty:
          endpoint === "/v1/responses/compact" ||
          compactFallbackContext.trace?.gatewayCompactFallback === true,
        logger: app.log,
      });
    }
    return {
      kind: "failed",
      statusCode,
      message,
      retryableFailure,
    };
  } finally {
    if (activeController && !activeControllerHandedOff) {
      unregisterActiveApiRequest(apiRequestId, activeController);
    }
  }
}

async function recordFailedChannelAttempt(params: {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  retryableFailure: boolean;
  startedAt: number;
  ignoreSlowPenalty?: boolean;
  logger?: {
    warn: (value: unknown, message?: string) => void;
    info?: (value: unknown, message?: string) => void;
  };
}) {
  if (!params.retryableFailure) {
    return;
  }

  const latencyMs = Math.round(performance.now() - params.startedAt);
  await recordRoutingFeedback({
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    callerIdentity: params.callerIdentity,
    model: params.model,
    channelId: params.channelId,
    upstreamProviderKeyId: params.upstreamProviderKeyId,
    failed: params.retryableFailure,
    streamed: false,
    latencyMs,
    ignoreSlowPenalty: params.ignoreSlowPenalty,
    retryableFailure: params.retryableFailure,
    logger: params.logger,
  });
}

async function getGatewayRecoveryNotice(error: unknown) {
  const settings = await readGatewayNoticeSettings();
  if (isMissingUsageError(error)) {
    return settings.missingUsageMessage;
  }

  if (isUpstreamBalanceInsufficientError(error)) {
    return settings.upstreamBalanceInsufficientMessage;
  }

  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";

  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  if (isUpstreamBalanceInsufficientError(text)) {
    return settings.upstreamBalanceInsufficientMessage;
  }

  const isStoreFalseItemError =
    normalized.includes("items are not persisted when store is set to false") ||
    (normalized.includes("item with id") &&
      normalized.includes("not found") &&
      normalized.includes("rs_")) ||
    (normalized.includes("previous_response_id") &&
      normalized.includes("not found"));

  if (isStoreFalseItemError) {
    return settings.staleResponsesContextMessage;
  }

  if (isInvalidEncryptedContentError(normalized)) {
    return settings.invalidEncryptedContentMessage;
  }

  if (normalized.includes(missingUsageMessage.toLowerCase())) {
    return settings.missingUsageMessage;
  }

  return null;
}

function isInvalidEncryptedContentError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  return (
    normalized.includes("invalid_encrypted_content") ||
    normalized.includes("encrypted content could not be decrypted or parsed")
  );
}

async function markRecoveryNoticeReturned(
  requestId: string,
  noticeText: string,
  reason: string,
  compactFallbackTrace?: CompactFallbackTrace,
  extraUsage?: Record<string, unknown>,
) {
  await prisma.apiRequest.update({
    where: { id: requestId },
    data: {
      resultType: "GATEWAY_NOTICE",
      responseUsage: {
        source: recoveryNoticeUsageSource,
        returnedToUser: true,
        reason,
        noticeText,
        ...extraUsage,
        ...compactFallbackUsageFields(compactFallbackTrace),
      },
    },
  });
}

function withCompactFallbackUsage(
  usage: Usage,
  compactFallbackTrace?: CompactFallbackTrace,
): Usage {
  if (!compactFallbackTrace) {
    return usage;
  }

  return {
    ...usage,
    raw: {
      ...(isPlainObject(usage.raw) ? usage.raw : { upstreamUsage: usage.raw }),
      ...compactFallbackUsageFields(compactFallbackTrace),
    },
  };
}

function createFailureResponseUsage(params: {
  manualTerminated: boolean;
  compactFallbackTrace?: CompactFallbackTrace;
  reason: string;
}) {
  const manualUsage = params.manualTerminated
    ? createManualTerminateUsage(true)
    : undefined;
  if (!params.compactFallbackTrace) {
    return manualUsage;
  }

  return {
    ...(isPlainObject(manualUsage)
      ? manualUsage
      : { source: "gateway_compact_fallback" }),
    reason: params.reason,
    ...compactFallbackUsageFields(params.compactFallbackTrace),
  };
}

function createCompactFallbackResponseUsage(
  compactFallbackTrace: CompactFallbackTrace,
  reason: string,
) {
  return {
    source: "gateway_compact_fallback",
    reason,
    gatewayCompactKind: "fallback",
    ...compactFallbackUsageFields(compactFallbackTrace),
  };
}

function createNormalCompactResponseUsage(
  reason: string,
  compact?: {
    compactCacheId: string;
    encryptedContentHashes: string[];
    sourceFingerprint: string;
  },
) {
  return {
    source: "gateway_compact",
    reason,
    gatewayCompactKind: "normal",
    ...(compact
      ? {
          compactCacheId: compact.compactCacheId,
          encryptedContentHashes: compact.encryptedContentHashes,
          sourceFingerprint: compact.sourceFingerprint,
        }
      : {}),
  };
}

function compactFallbackUsageFields(
  compactFallbackTrace?: CompactFallbackTrace,
) {
  if (!compactFallbackTrace) {
    return {};
  }

  return {
    gatewayCompactFallback: true,
    fallbackAttempted: compactFallbackTrace.fallbackAttempted,
    fallbackSucceeded: compactFallbackTrace.fallbackSucceeded,
    compactFallback: compactFallbackTrace,
  };
}

async function cacheCompactResponse(params: {
  logger?: {
    warn: (value: unknown, message?: string) => void;
  };
  requestBody: unknown;
  responseBody: unknown;
  userId: string;
  apiKeyId: string;
  model?: string;
  route?: UpstreamAttemptRoute;
  sourceFingerprint?: string;
}) {
  const sourceFingerprint =
    params.sourceFingerprint ??
    (params.route ? getCompactChannelFingerprint(params.route) : undefined);
  if (!sourceFingerprint) {
    return;
  }

  try {
    const result = await saveCompactCache({
      requestBody: params.requestBody,
      responseBody: params.responseBody,
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      model: params.model ?? inferModelFromBody(params.requestBody),
      sourceFingerprint,
    });

    if (!result.saved && result.reason !== "no_encrypted_content") {
      params.logger?.warn(
        { reason: result.reason },
        "Responses compact result was not cached",
      );
    }

    return result;
  } catch (error) {
    params.logger?.warn({ error }, "Responses compact cache save failed");
    return { saved: false as const, reason: "cache_save_failed" };
  }
}

function inferModelFromBody(body: unknown) {
  return isPlainObject(body) && typeof body.model === "string"
    ? body.model
    : undefined;
}

async function proxyStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  activeController?: AbortController;
  apiRequestId: string;
  endpoint: string;
  requestBody: ProxyBody;
  userId: string;
  callerIdentity: string;
  apiKeyId: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  priceId: string;
  accessTierId?: string | null;
  startedAt: number;
  upstreamRequestStartedAt: number;
  logger?: {
    warn: (value: unknown, message?: string) => void;
    info?: (value: unknown, message?: string) => void;
  };
  compactFallbackTrace?: CompactFallbackTrace;
  compactCacheRequestBody?: ProxyBody;
  compactCacheSourceFingerprint?: string;
  upstreamOutputFilterSettings: UpstreamOutputFilterSettings;
}) {
  const {
    reply,
    upstreamResponse,
    activeController,
    apiRequestId,
    endpoint,
    requestBody,
    userId,
    callerIdentity,
    apiKeyId,
    model,
    channelId,
    upstreamProviderKeyId,
    priceId,
    accessTierId,
    startedAt,
    upstreamRequestStartedAt,
    logger,
    compactFallbackTrace,
    compactCacheRequestBody,
    compactCacheSourceFingerprint,
    upstreamOutputFilterSettings,
  } = params;
  const price = await prisma.modelPrice.findUniqueOrThrow({
    where: { id: priceId },
  });
  let streamUsage: Usage | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let rawStreamText = "";
  let firstTokenLatencyMs: number | null = null;
  let upstreamFirstChunkLatencyMs: number | null = null;
  const bufferedStreamChunks: string[] = [];
  let hasForwardedStream = false;
  const upstreamOutputFilter = createUpstreamOutputStreamFilter(
    upstreamOutputFilterSettings,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeController = createSafeStreamController(controller, reply);
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        const error = new Error("Stream body missing");
        await markRequestFailed(
          { id: apiRequestId },
          error.message,
          502,
          Math.round(performance.now() - startedAt),
          undefined,
          "UPSTREAM_ERROR",
        );
        await recordRoutingFeedback({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          failed: true,
          streamed: true,
          latencyMs: Math.round(performance.now() - startedAt),
          ignoreSlowPenalty: endpoint === "/v1/responses/compact",
          retryableFailure: true,
          logger,
        });
        safeController.enqueue(
          encoder.encode(buildStreamErrorEvent(error.message, 502)),
        );
        safeController.close();
        return;
      }
      const markFirstTokenSeen = () => {
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
      };
      const flushBufferedStreamChunks = () => {
        if (hasForwardedStream) {
          return;
        }

        hasForwardedStream = true;
        for (const chunk of bufferedStreamChunks) {
          if (!safeController.enqueue(encoder.encode(chunk))) {
            throw createClientStreamClosedError();
          }
        }
        bufferedStreamChunks.length = 0;
      };
      const forwardStreamText = (text: string) => {
        const filteredText = upstreamOutputFilter.push(text);
        if (!filteredText) {
          return;
        }
        if (hasForwardedStream || firstTokenLatencyMs !== null) {
          flushBufferedStreamChunks();
          if (!safeController.enqueue(encoder.encode(filteredText))) {
            throw createClientStreamClosedError();
          }
          return;
        }

        bufferedStreamChunks.push(filteredText);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            if (upstreamFirstChunkLatencyMs === null) {
              upstreamFirstChunkLatencyMs = Math.round(
                performance.now() - upstreamRequestStartedAt,
              );
            }
            const text = decoder.decode(value, { stream: true });
            rawStreamText += text;
            pending += text;
            if (
              firstTokenLatencyMs === null &&
              sseBufferHasOutputToken(pending)
            ) {
              markFirstTokenSeen();
            }
            streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
            const lastEventBoundary = pending.lastIndexOf("\n\n");
            if (lastEventBoundary >= 0) {
              pending = pending.slice(lastEventBoundary + 2);
            }
            forwardStreamText(text);
          }
        }

        const trailing = decoder.decode();
        if (trailing) {
          rawStreamText += trailing;
          pending += trailing;
          if (
            firstTokenLatencyMs === null &&
            sseBufferHasOutputToken(pending)
          ) {
            markFirstTokenSeen();
          }
          streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
          forwardStreamText(trailing);
        }

        if (!streamUsage) {
          streamUsage = estimateUsageFromStream(
            endpoint,
            requestBody,
            rawStreamText,
          );
          if (streamUsage) {
            logger?.warn(
              { apiRequestId, model, channelId },
              "Upstream stream did not include usage; using estimated billable usage",
            );
          } else {
            streamUsage = createUnmeteredMissingUsage(
              "missing_stream_usage_unmetered",
            );
            logger?.warn(
              { apiRequestId, model, channelId },
              "Upstream stream did not include usage; passing through without billing",
            );
          }
        }
        streamUsage = withCompactFallbackUsage(
          streamUsage,
          compactFallbackTrace,
        );
        const filteredTrailing = upstreamOutputFilter.flush();
        if (filteredTrailing) {
          if (hasForwardedStream || firstTokenLatencyMs !== null) {
            flushBufferedStreamChunks();
            if (!safeController.enqueue(encoder.encode(filteredTrailing))) {
              throw createClientStreamClosedError();
            }
          } else {
            bufferedStreamChunks.push(filteredTrailing);
          }
        }
        flushBufferedStreamChunks();

        if (
          endpoint === "/v1/responses/compact" &&
          compactCacheRequestBody &&
          compactCacheSourceFingerprint
        ) {
          const compactCacheResult = await cacheCompactResponse({
            logger,
            requestBody: compactCacheRequestBody,
            responseBody: parseSseJsonPayloads(rawStreamText),
            userId,
            apiKeyId,
            model,
            sourceFingerprint: compactCacheSourceFingerprint,
          });
          if (compactCacheResult?.saved) {
            const compactUsage = createNormalCompactResponseUsage(
              "compact_request_completed",
              {
                compactCacheId: compactCacheResult.compactCacheId,
                encryptedContentHashes:
                  compactCacheResult.encryptedContentHashes,
                sourceFingerprint: compactCacheSourceFingerprint,
              },
            );
            streamUsage.raw = isPlainObject(streamUsage.raw)
              ? { ...streamUsage.raw, ...compactUsage }
              : compactUsage;
          }
        }

        try {
          await chargeForRequest({
            requestId: apiRequestId,
            userId,
            price,
            usage: streamUsage,
            accessTierId,
            startedAt,
          });
        } catch (error) {
          await markRequestFailed(
            { id: apiRequestId },
            error instanceof Error ? error.message : "Billing failed",
            500,
            Math.round(performance.now() - startedAt),
            undefined,
            "BILLING_ERROR",
          );
          throw error;
        }

        await prisma.apiRequest.update({
          where: { id: apiRequestId },
          data: { firstTokenLatencyMs, upstreamFirstChunkLatencyMs },
        });
        await recordRoutingFeedback({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          streamed: true,
          firstTokenLatencyMs,
          latencyMs: Math.round(performance.now() - startedAt),
          ignoreSlowPenalty:
            endpoint === "/v1/responses/compact" ||
            compactFallbackTrace?.gatewayCompactFallback === true,
          failed: false,
          logger,
        });
      } catch (error) {
        const manualTerminated = isManualTerminateError(error);
        const message = manualTerminated
          ? manualTerminateMessage
          : error instanceof Error
            ? error.message
            : "Stream failed";
        if (isClientStreamClosedError(error)) {
          await markRequestFailed(
            { id: apiRequestId },
            clientStreamClosedMessage,
            clientStreamClosedStatusCode,
            Math.round(performance.now() - startedAt),
            createFailureResponseUsage({
              manualTerminated: false,
              compactFallbackTrace,
              reason: "client_stream_closed",
            }),
            "CLIENT_CLOSED",
          );
          logger?.info?.(
            { apiRequestId, model, channelId },
            "Client stream closed before gateway completed response",
          );
          return;
        }

        const recoveryNotice = hasForwardedStream
          ? null
          : ((await getGatewayRecoveryNotice(rawStreamText)) ??
            (await getGatewayRecoveryNotice(error)));
        await markRequestFailed(
          { id: apiRequestId },
          message,
          manualTerminated ? manualTerminateStatusCode : 502,
          Math.round(performance.now() - startedAt),
          createFailureResponseUsage({
            manualTerminated,
            compactFallbackTrace,
            reason: "stream_recovery_notice",
          }),
          manualTerminated ? "MANUAL_TERMINATED" : "UPSTREAM_ERROR",
        );
        if (recoveryNotice && isNoticeStreamEndpoint(endpoint)) {
          await markRecoveryNoticeReturned(
            apiRequestId,
            recoveryNotice,
            "stream_recovery_notice",
            compactFallbackTrace,
            undefined,
          );
          safeController.enqueue(
            encoder.encode(buildNoticeStream(endpoint, model, recoveryNotice)),
          );
          return;
        }
        if (!manualTerminated) {
          await recordRoutingFeedback({
            userId,
            apiKeyId,
            callerIdentity,
            model,
            channelId,
            upstreamProviderKeyId,
            failed: true,
            streamed: true,
            latencyMs: Math.round(performance.now() - startedAt),
            ignoreSlowPenalty:
              endpoint === "/v1/responses/compact" ||
              compactFallbackTrace?.gatewayCompactFallback === true,
            retryableFailure: isRetryableProxyError(error, endpoint),
            logger,
          });
          safeController.error(error);
          return;
        }
        safeController.close();
        return;
      } finally {
        unregisterActiveApiRequest(apiRequestId, activeController);
        safeController.close();
      }
    },
  });

  reply.status(upstreamResponse.status);
  reply.header(
    "content-type",
    upstreamResponse.headers.get("content-type") ?? "text/event-stream",
  );
  reply.header("cache-control", "no-cache");
  return reply.send(
    Readable.fromWeb(
      stream as unknown as import("node:stream/web").ReadableStream,
    ),
  );
}

async function proxyPassthroughStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  activeController?: AbortController;
  apiRequestId: string;
  startedAt: number;
  upstreamRequestStartedAt: number;
  upstreamOutputFilterSettings: UpstreamOutputFilterSettings;
}) {
  const {
    reply,
    upstreamResponse,
    activeController,
    apiRequestId,
    startedAt,
    upstreamRequestStartedAt,
    upstreamOutputFilterSettings,
  } = params;
  let firstTokenLatencyMs: number | null = null;
  let upstreamFirstChunkLatencyMs: number | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const upstreamOutputFilter = createUpstreamOutputStreamFilter(
    upstreamOutputFilterSettings,
  );
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeController = createSafeStreamController(controller, reply);
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        const error = new Error("Stream body missing");
        await markRequestFailed(
          { id: apiRequestId },
          error.message,
          502,
          Math.round(performance.now() - startedAt),
          undefined,
          "UPSTREAM_ERROR",
        );
        safeController.enqueue(
          new TextEncoder().encode(buildStreamErrorEvent(error.message, 502)),
        );
        safeController.close();
        return;
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            if (upstreamFirstChunkLatencyMs === null) {
              upstreamFirstChunkLatencyMs = Math.round(
                performance.now() - upstreamRequestStartedAt,
              );
            }
            if (firstTokenLatencyMs === null) {
              firstTokenLatencyMs = Math.round(performance.now() - startedAt);
            }
            const filteredText = upstreamOutputFilter.push(
              decoder.decode(value, { stream: true }),
            );
            if (
              filteredText &&
              !safeController.enqueue(encoder.encode(filteredText))
            ) {
              throw createClientStreamClosedError();
            }
          }
        }
        const filteredTrailing =
          upstreamOutputFilter.push(decoder.decode()) +
          upstreamOutputFilter.flush();
        if (
          filteredTrailing &&
          !safeController.enqueue(encoder.encode(filteredTrailing))
        ) {
          throw createClientStreamClosedError();
        }

        await prisma.apiRequest.update({
          where: { id: apiRequestId },
          data: {
            status: "SUCCESS",
            resultType: "PROXIED_SUCCESS",
            latencyMs: Math.round(performance.now() - startedAt),
            firstTokenLatencyMs,
            upstreamFirstChunkLatencyMs,
          },
        });
      } catch (error) {
        const manualTerminated = isManualTerminateError(error);
        const message = manualTerminated
          ? manualTerminateMessage
          : error instanceof Error
            ? error.message
            : "Stream failed";
        const clientStreamClosed = isClientStreamClosedError(error);
        await markRequestFailed(
          { id: apiRequestId },
          clientStreamClosed ? clientStreamClosedMessage : message,
          clientStreamClosed
            ? clientStreamClosedStatusCode
            : manualTerminated
              ? manualTerminateStatusCode
              : 502,
          Math.round(performance.now() - startedAt),
          manualTerminated ? createManualTerminateUsage(true) : undefined,
          clientStreamClosed
            ? "CLIENT_CLOSED"
            : manualTerminated
              ? "MANUAL_TERMINATED"
              : "UPSTREAM_ERROR",
        );
        if (!clientStreamClosed) {
          if (manualTerminated) {
            safeController.close();
            return;
          }
          safeController.enqueue(
            new TextEncoder().encode(buildStreamErrorEvent(message, 502)),
          );
        }
        return;
      } finally {
        unregisterActiveApiRequest(apiRequestId, activeController);
        safeController.close();
      }
    },
  });

  reply.status(upstreamResponse.status);
  reply.header(
    "content-type",
    upstreamResponse.headers.get("content-type") ?? "text/event-stream",
  );
  reply.header("cache-control", "no-cache");
  return reply.send(
    Readable.fromWeb(
      stream as unknown as import("node:stream/web").ReadableStream,
    ),
  );
}
