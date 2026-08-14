import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@gateway/db";
import { sanitizeJsonForPostgres } from "../lib/db-sanitize.js";
import { env } from "../env.js";
import { sendApiError } from "../lib/errors.js";
import { createRequestTraceCode } from "../lib/crypto.js";
import { usageFromOpenAIResponse } from "../lib/usage.js";
import {
  chargeForRequest,
  ensureWalletCanStart,
  markRequestFailed,
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
import { getStickyModelPoolRoute } from "../services/model-pool-stickiness.js";
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
import { readImageGenerationToolSettings } from "../services/image-generation-tool-settings.js";
import {
  readImageProxySettings,
  shouldProxyImageModelViaTencent,
} from "../services/image-proxy-settings.js";
import { readCharityAnnouncementSettings } from "../services/charity-announcement-settings.js";
import { readGatewayNoticeSettings } from "../services/gateway-notice-settings.js";
import {
  canBypassGlobalCircuitBreaker,
  readGlobalCircuitBreakerSettings,
} from "../services/global-circuit-breaker-settings.js";
import { readBannedUserNoticeSettings } from "../services/banned-user-notice-settings.js";
import {
  isWhitelistFilterUnlocked,
  readWhitelistFilterSettings,
} from "../services/whitelist-filter-settings.js";
import {
  buildUpstreamBody,
  createProxyTransformContext,
  getForwardableUpstreamResponseHeaders,
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
  parseMultipartProxyBody,
  redactBodyForLog,
  resolveUpstreamEndpoint,
  resolveUpstreamRequestUrl,
  safeReadUpstreamBody,
  shouldCheckNewRequestLimits,
  shouldReturnApiKeyNotice,
  shouldStreamResponse,
  transformProxyResponseBody,
  type ProxyBody,
  type ProxyTransformContext,
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
import { createProxyStreamTransformer } from "../services/proxy-stream-transform.js";
import {
  filterProxyResponseContent,
  loadProxyResponseContentFilterSettings,
} from "../services/proxy-response-content-filter.js";
import { readPolicyRecoverySettings } from "../services/policy-recovery-settings.js";
import {
  buildPolicyRecoveryBody,
  createPolicySseSanitizer,
  createPolicyRecoveryContext,
  detectPolicyBlock,
  formatPolicyRecoveryExhaustedMessage,
  policyRecoveryExhaustedStatusCode,
  probePolicyRecoveryStream,
  sanitizePolicyResponseBody,
  sanitizePolicyResponseHeaders,
  supportsPolicyRecovery,
  type PolicyBlockSignal,
  type PolicyRecoveryContext,
} from "../services/policy-recovery.js";
import {
  collectEncryptedContents,
  createCompactChannelFingerprint,
  extractEncryptedItems,
  findCachedCompactForBody,
  findCachedCompactsForBody,
  hashEncryptedContent,
  normalizeCrossChannelResponsesInput,
  readTargetCompactItems,
  removeMalformedEncryptedInputItems,
  removeReasoningInputItems,
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
      upstreamBalanceInsufficient?: boolean;
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
  "/images/edits",
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
  malformedItemsRemoved?: number;
  normalizedReasoningItems?: number;
  error?: string;
};

type CompactFallbackContext = {
  attempted: boolean;
  trace?: CompactFallbackTrace;
};

type ImageGenerationToolRoute = Awaited<
  ReturnType<typeof routeUpstreamRequest>
> & {
  imageToolBridge: true;
};

function buildTencentImageProxyPayload(params: {
  provider: UpstreamAttemptRoute["provider"];
  method: string;
  resolvedUpstreamRequestUrl: string;
  upstreamBody: unknown;
}) {
  return {
    upstream: {
      baseUrl: params.provider.baseUrl,
      apiKey: params.provider.apiKey,
      endpoint: params.resolvedUpstreamRequestUrl,
      method: params.method,
    },
    request: params.upstreamBody,
    storage: {
      ...(env.TENCENT_IMAGE_COS_PREFIX
        ? { prefix: env.TENCENT_IMAGE_COS_PREFIX }
        : {}),
      ...(env.TENCENT_IMAGE_PUBLIC_BASE_URL
        ? { publicBase: env.TENCENT_IMAGE_PUBLIC_BASE_URL }
        : {}),
    },
  };
}

async function shouldUseTencentImageProxy(params: {
  endpoint: string;
  method: string;
  model: unknown;
}) {
  if (
    params.method !== "POST" ||
    (params.endpoint !== "/v1/images/generations" &&
      params.endpoint !== "/v1/images/edits")
  ) {
    return false;
  }

  return shouldProxyImageModelViaTencent(
    await readImageProxySettings(),
    params.model,
  );
}

function hasImageGenerationTool(body: ProxyBody) {
  if (!Array.isArray(body.tools)) {
    return false;
  }

  return body.tools.some(
    (tool) => isPlainObject(tool) && tool.type === "image_generation",
  );
}

function extractImageGenerationPrompt(body: ProxyBody) {
  const input = body.input;
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }

  if (Array.isArray(input)) {
    const texts = input
      .map((item) => extractTextFromInputItem(item))
      .filter(Boolean);
    if (texts.length > 0) {
      return texts.join("\n").trim();
    }
  }

  if (typeof body.instructions === "string" && body.instructions.trim()) {
    return body.instructions.trim();
  }

  return "Generate an image from the user's request.";
}

function extractTextFromInputItem(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }

  if (!isPlainObject(item)) {
    return "";
  }

  const content = item.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!isPlainObject(part)) {
          return "";
        }
        return typeof part.text === "string"
          ? part.text
          : typeof part.input_text === "string"
            ? part.input_text
            : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function buildImageToolBridgeBody(body: ProxyBody, routingModel: string) {
  return {
    model: routingModel,
    prompt: extractImageGenerationPrompt(body),
    n: 1,
    size: typeof body.size === "string" ? body.size : "1024x1024",
    quality: typeof body.quality === "string" ? body.quality : "low",
    response_format: "b64_json",
  };
}

function responseId() {
  return `resp_${Date.now().toString(36)}`;
}

function callId() {
  return `call_${Date.now().toString(36)}`;
}

async function imageUrlToBase64(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch generated image URL: HTTP ${response.status}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

async function buildImageToolBridgeResponse(params: {
  requestModel?: string;
  routingModel: string;
  imageResponse: unknown;
}) {
  const id = responseId();
  const call = callId();
  const first = isPlainObject(params.imageResponse)
    ? Array.isArray(params.imageResponse.data)
      ? params.imageResponse.data.find(isPlainObject)
      : undefined
    : undefined;
  const b64 =
    typeof first?.b64_json === "string"
      ? first.b64_json
      : typeof first?.url === "string"
        ? await imageUrlToBase64(first.url)
        : "";
  const revisedPrompt =
    typeof first?.revised_prompt === "string"
      ? first.revised_prompt
      : undefined;
  const createdAt = Math.floor(Date.now() / 1000);

  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model: params.requestModel ?? params.routingModel,
    output: [
      {
        id: `${id}_image_generation`,
        type: "image_generation_call",
        status: "completed",
        call_id: call,
        result: b64,
        ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
      },
    ],
    output_text: "",
    usage: isPlainObject(params.imageResponse)
      ? params.imageResponse.usage
      : undefined,
  };
}

async function routeImageGenerationToolRequest(params: {
  route: UpstreamAttemptRoute;
  endpoint: string;
  body: ProxyBody;
  billable: boolean;
  model?: string;
}) {
  if (
    params.endpoint !== "/v1/responses" ||
    !params.billable ||
    !params.model ||
    !hasImageGenerationTool(params.body)
  ) {
    return params.route;
  }

  const settings = await readImageGenerationToolSettings();
  const imageRoute = await routeUpstreamRequest({
    billable: true,
    model: settings.routingModel,
    callerIdentity: `image-generation-tool:${params.model}`,
    accessRoutePolicy: undefined,
    bypassSticky: true,
    skipStickyUpdate: true,
  });

  if (
    !imageRoute.price?.enabled ||
    imageRoute.provider.name === params.route.provider.name
  ) {
    await imageRoute.release?.();
    return params.route;
  }

  await params.route.release?.();

  return {
    ...imageRoute,
    imageToolBridge: true,
    decisionTrace: params.route.decisionTrace,
  };
}

export async function proxyRoutes(app: FastifyInstance) {
  app.addHook("onRequest", loadProxyResponseContentFilterSettings);
  app.addHook("onSend", filterProxyResponseContent);

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

      const requestContentType = request.headers["content-type"];
      const multipartRawBody =
        endpoint === "/v1/images/edits" && Buffer.isBuffer(request.body)
          ? request.body
          : undefined;
      let body = multipartRawBody
        ? parseMultipartProxyBody(
            multipartRawBody,
            Array.isArray(requestContentType)
              ? requestContentType[0]
              : requestContentType,
          )
        : ((request.body ?? {}) as ProxyBody);

      await requireApiKey(app, request, reply, { allowBannedUser: true });
      if (reply.sent || !request.apiAuth) {
        return;
      }

      const { apiKey, user } = request.apiAuth;
      if (user.status === "BANNED") {
        const bannedUserNoticeSettings = await readBannedUserNoticeSettings();
        return sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          bannedUserNoticeSettings.noticeText,
          request.headers.accept,
        );
      }

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
      const whitelistFilterSettings = await readWhitelistFilterSettings();
      if (
        whitelistFilterSettings.enabled &&
        (whitelistFilterSettings.applyToAdmins || user.role !== "ADMIN") &&
        !(await isWhitelistFilterUnlocked(
          app,
          user.id,
          whitelistFilterSettings,
        ))
      ) {
        const noticeReturned = shouldReturnApiKeyNotice(
          endpoint,
          request.method,
        );
        await createGatewayRejectedRequest({
          body,
          endpoint,
          method: request.method,
          userId: user.id,
          apiKeyId: apiKey.id,
          clientIp,
          userAgent: request.headers["user-agent"],
          httpStatus: noticeReturned ? 200 : 403,
          resultType: noticeReturned ? "GATEWAY_NOTICE" : "GATEWAY_ERROR",
          errorMessage: "Whitelist filter locked account",
          responseUsage: {
            source: "gateway_whitelist_filter",
            returnedToUser: noticeReturned,
            reason: "whitelist_filter",
            secretVersion: whitelistFilterSettings.secretVersion,
            noticeText: whitelistFilterSettings.noticeText,
          },
          accessTierId: accessRoutePolicy.tierId,
        });

        if (noticeReturned) {
          return sendApiKeyNotice(
            reply,
            endpoint,
            body,
            upstreamRequestUrl,
            whitelistFilterSettings.noticeText,
            request.headers.accept,
          );
        }

        return sendApiError(
          reply,
          403,
          whitelistFilterSettings.noticeText,
          "access_denied",
        );
      }
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

      if (billable) {
        const subscriptionCanStart =
          activeSubscription &&
          hasAvailableSubscriptionQuota(activeSubscription);
        const walletCheck =
          subscriptionCanStart || !accessRoutePolicy.walletRequired
            ? { ok: true as const, balance: new Decimal(0) }
            : await ensureWalletCanStart(
                user.id,
                accessRoutePolicy.minimumWalletBalanceUsd,
              );
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
            accessTierId: accessRoutePolicy.tierId,
            tierConcurrencyLimit: accessRoutePolicy.concurrencyLimit,
            tierRateLimitPerMinute: accessRoutePolicy.rateLimitPerMinute,
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

      const stickyIdentity = getGatewaySessionIdentity(
        request,
        body,
        apiKey.id,
      );
      const scopedStickyIdentity = scopeModelPoolCallerIdentity(
        stickyIdentity,
        accessRoutePolicy.tierId,
      );
      const previousStickyRoute =
        billable && model
          ? await getStickyModelPoolRoute(scopedStickyIdentity, model)
          : null;
      let initialRoute: UpstreamAttemptRoute;
      try {
        initialRoute = await routeUpstreamRequest({
          billable,
          model,
          callerIdentity: stickyIdentity,
          accessRoutePolicy,
        });
        initialRoute = await routeImageGenerationToolRequest({
          route: initialRoute,
          endpoint,
          body,
          billable,
          model,
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
          accessTierId: accessRoutePolicy.tierId,
          acceptHeader: request.headers.accept,
          noticeText: gatewayNoticeSettings.modelUnavailableMessage,
        });
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
            reservedAmountUsd: "0",
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
      const policyRecoverySettings = activeRoute.policyRecoveryEnabled === true
        ? await readPolicyRecoverySettings()
        : undefined;
      const policyRecoveryContext =
        policyRecoverySettings?.masterEnabled === true &&
        supportsPolicyRecovery(endpoint, request.method, Boolean(multipartRawBody))
          ? createPolicyRecoveryContext(body, policyRecoverySettings)
          : undefined;

      if (policyRecoveryContext) {
        await prisma.apiRequest.update({
          where: { id: apiRequest.id },
          data: {
            policyRecoveryAudit: policyRecoveryContext.audit as Prisma.InputJsonValue,
          },
        });
      }

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
          foreignReasoningState:
            attempt > 1 ||
            hasModelPoolRouteChanged(previousStickyRoute, activeRoute),
          multipartRawBody,
          multipartContentType: Array.isArray(requestContentType)
            ? requestContentType[0]
            : requestContentType,
          policyRecoveryContext,
        });

        if (result.kind === "sent") {
          return reply;
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
        const routedNextRoute = await routeImageGenerationToolRequest({
          route: nextRoute,
          endpoint,
          body,
          billable,
          model,
        });

        if (
          !routedNextRoute.price?.enabled ||
          (routedNextRoute.channelId &&
            routedNextRoute.channelId === activeRoute.channelId)
        ) {
          await routedNextRoute.release?.();
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
            toChannelId: routedNextRoute.channelId,
            toProvider: routedNextRoute.provider.name,
            status: result.statusCode,
          },
          "Retrying upstream request on another model pool channel",
        );
        await activeRoute.release?.();
        activeRoute = routedNextRoute;
        routeRelease.set(routedNextRoute.release);
        await updateApiRequestRoute(
          apiRequest.id,
          routedNextRoute,
          result.statusCode,
        );
      }
    });
  }
}

function hasModelPoolRouteChanged(
  previousRoute: Awaited<ReturnType<typeof getStickyModelPoolRoute>>,
  route: UpstreamAttemptRoute,
) {
  if (!previousRoute || !route.channelId) {
    return false;
  }

  if (previousRoute.channelId !== route.channelId) {
    return true;
  }

  const routeKeyId = getLoggedUpstreamProviderKeyId(route);
  return Boolean(
    previousRoute.upstreamProviderKeyId &&
      routeKeyId &&
      previousRoute.upstreamProviderKeyId !== routeKeyId,
  );
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

  const targetFingerprint = getCompactChannelFingerprint(route);
  const isCrossChannel =
    cachedCompact?.matchedFingerprint !== undefined &&
    cachedCompact.matchedFingerprint !== targetFingerprint;
  const sanitized = isCrossChannel
    ? removeMalformedEncryptedInputItems(body)
    : { value: body, removed: 0 };
  const safeBody = sanitized.value;
  if (sanitized.removed > 0) {
    app.log.warn(
      { apiRequestId, removed: sanitized.removed, targetFingerprint },
      "Removed malformed encrypted Responses input items during cross-channel migration",
    );
  }

  if (!cachedCompact) {
    if (sanitized.removed > 0) {
      compactFallbackContext.trace = {
        gatewayCompactFallback: true,
        fallbackAttempted: false,
        fallbackSucceeded: true,
        malformedItemsRemoved: sanitized.removed,
        targetFingerprint: getCompactChannelFingerprint(route),
      };
    }
    return safeBody;
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
    return safeBody;
  }

  if (cachedCompact.matchedFingerprint === targetFingerprint) {
    return safeBody;
  }

  if (isCompactFallbackDisabledForUser(userId)) {
    app.log.info(
      {
        compactCacheId: cachedCompact.compactCacheId,
        userId,
      },
      "Responses compact fallback disabled for user; continuing original request",
    );
    return safeBody;
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
      safeBody,
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
        sourceFingerprint: cachedCompact.matchedFingerprint,
        targetFingerprint,
        targetCacheHit: true,
        malformedItemsRemoved: sanitized.removed || undefined,
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
    sourceFingerprint: cachedCompact.matchedFingerprint,
    targetFingerprint,
    malformedItemsRemoved: sanitized.removed || undefined,
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
      safeBody,
      replacementsByHash,
    );
    trace.replacements = replaced.replacements;
    trace.fallbackSucceeded = replaced.replacements > 0;

    return replaced.replacements > 0 ? replaced.value : safeBody;
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
    return safeBody;
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

async function applyAllCompactFallbacks(params: {
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
  if (endpoint !== "/v1/responses" || method !== "POST") {
    return body;
  }

  const malformedSanitized = removeMalformedEncryptedInputItems(body);
  let safeBody = malformedSanitized.value;
  if (malformedSanitized.removed > 0) {
    app.log.warn(
      {
        apiRequestId,
        removed: malformedSanitized.removed,
        targetFingerprint: getCompactChannelFingerprint(route),
      },
      "Removed malformed encrypted Responses input items before upstream streaming",
    );
  }

  let cachedCompacts: Awaited<ReturnType<typeof findCachedCompactsForBody>>;
  try {
    cachedCompacts = await findCachedCompactsForBody(safeBody);
  } catch (error) {
    app.log.warn(
      { error },
      "Responses compact cache batch lookup failed; continuing original request",
    );
    return safeBody;
  }

  const targetFingerprint = getCompactChannelFingerprint(route);
  const crossChannelCompacts = cachedCompacts.filter(
    (cachedCompact) =>
      cachedCompact.matchedFingerprint !== targetFingerprint &&
      cachedCompact.cache.userId === userId &&
      cachedCompact.cache.apiKeyId === apiKeyId &&
      cachedCompact.cache.model === model,
  );
  const sanitized =
    crossChannelCompacts.length > 0
      ? normalizeCrossChannelResponsesInput(safeBody)
      : { value: safeBody, removed: 0, normalizedReasoningItems: 0 };
  let migratedBody = sanitized.value;

  if (crossChannelCompacts.length === 0) {
    return migratedBody;
  }

  compactFallbackContext.attempted = true;
  const trace: CompactFallbackTrace = {
    gatewayCompactFallback: true,
    fallbackAttempted: false,
    fallbackSucceeded: true,
    replacements: 0,
    sourceFingerprint: crossChannelCompacts
      .map((item) => item.matchedFingerprint)
      .join(","),
    targetFingerprint,
    malformedItemsRemoved:
      malformedSanitized.removed + sanitized.removed || undefined,
    normalizedReasoningItems: sanitized.normalizedReasoningItems || undefined,
  };
  compactFallbackContext.trace = trace;

  for (const cachedCompact of crossChannelCompacts) {
    try {
      let targetItems = await readTargetCompactItems({
        compactCacheId: cachedCompact.compactCacheId,
        targetFingerprint,
      });
      if (!targetItems) {
        trace.fallbackAttempted = true;
        targetItems = await requestTargetCompact({
          route,
          requestBody: cachedCompact.cache.requestBody,
        });
        await saveTargetCompactItems({
          compactCacheId: cachedCompact.compactCacheId,
          targetFingerprint,
          targetItems,
        });
      }

      const replacementsByHash = buildCompactFallbackReplacements(
        cachedCompact.matchedEncryptedContentHashes,
        targetItems,
        getTargetCompactItemType(route),
      );
      const replaced = replaceCompactionItemsByEncryptedContentHashes(
        migratedBody,
        replacementsByHash,
      );
      migratedBody = replaced.value;
      trace.replacements = (trace.replacements ?? 0) + replaced.replacements;
    } catch (error) {
      trace.fallbackSucceeded = false;
      trace.error =
        error instanceof Error
          ? error.message
          : "compact batch migration failed";
      app.log.warn(
        {
          error,
          compactCacheId: cachedCompact.compactCacheId,
          sourceFingerprint: cachedCompact.matchedFingerprint,
          targetFingerprint,
        },
        "Responses compact generation migration failed",
      );
    }
  }

  trace.fallbackSucceeded =
    trace.fallbackSucceeded && (trace.replacements ?? 0) > 0;
  return migratedBody;
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
    sourceFingerprint: cachedCompact.matchedFingerprint,
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

function rewriteCompactionItemsForTargetType<T>(
  value: T,
  targetItemType: CompactItemType,
) {
  const rewrite = (
    current: unknown,
  ): { value: unknown; replacements: number } => {
    if (Array.isArray(current)) {
      let replacements = 0;
      const items = current.map((item) => {
        const rewritten = rewrite(item);
        replacements += rewritten.replacements;
        return rewritten.value;
      });
      return { value: replacements > 0 ? items : current, replacements };
    }

    if (!isPlainObject(current)) {
      return { value: current, replacements: 0 };
    }

    if (
      (current.type === "compaction" ||
        current.type === "compaction_summary" ||
        current.type === "response.compaction_summary") &&
      typeof current.encrypted_content === "string" &&
      current.encrypted_content
    ) {
      return {
        value: normalizeCompactItemForTarget(current, targetItemType),
        replacements: 1,
      };
    }

    let replacements = 0;
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      const rewritten = rewrite(item);
      replacements += rewritten.replacements;
      record[key] = rewritten.value;
    }
    return { value: replacements > 0 ? record : current, replacements };
  };

  const rewritten = rewrite(value);
  return {
    value: rewritten.value as T,
    replacements: rewritten.replacements,
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
          "Accept-Encoding": "identity",
        },
        body: JSON.stringify(buildInternalCompactRequestBody(requestBody)),
        signal: controller.signal,
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = await safeReadUpstreamBody(response, {
      maxBytes: getUpstreamResponseMaxBytes("/v1/responses/compact"),
    });
    if ("error" in rawBody) {
      throw new Error(rawBody.error.message);
    }
    const responseBody = contentType.includes("application/json")
      ? rawBody.json
      : rawBody.text;

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

  if (result.upstreamBalanceInsufficient) {
    return sendUpstreamBalanceUnavailableError(reply);
  }

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
  compactTypeRetryAttempted?: boolean;
  foreignReasoningState?: boolean;
  multipartRawBody?: Buffer;
  multipartContentType?: string;
  policyRecoveryContext?: PolicyRecoveryContext;
  policyRecoveryAttempt?: number;
  policyRecoverySignal?: PolicyBlockSignal | null;
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
    compactTypeRetryAttempted,
    foreignReasoningState,
    multipartRawBody,
    multipartContentType,
    policyRecoveryContext,
    policyRecoveryAttempt = 0,
    policyRecoverySignal,
  } = params;
  const { provider, price, channelId } = route;
  const imageToolBridge = "imageToolBridge" in route;
  const imageToolBridgeSettings = imageToolBridge
    ? await readImageGenerationToolSettings()
    : null;
  const upstreamProviderKeyId = getLoggedUpstreamProviderKeyId(route);
  const effectiveEndpoint = imageToolBridge
    ? "/v1/images/generations"
    : endpoint;
  const effectiveUpstreamRequestUrl = imageToolBridge
    ? "/v1/images/generations"
    : upstreamRequestUrl;
  const resolvedUpstreamRequestUrl = resolveUpstreamRequestUrl(
    effectiveEndpoint,
    effectiveUpstreamRequestUrl,
    price,
  );
  const resolvedUpstreamEndpoint = resolveUpstreamEndpoint(
    resolvedUpstreamRequestUrl,
  );
  const attemptBody = policyRecoveryContext
    ? buildPolicyRecoveryBody({
        context: policyRecoveryContext,
        endpoint,
        recoveryAttempt: policyRecoveryAttempt,
        signal: policyRecoverySignal,
        provider: provider.name,
        model: model ?? inferModelFromBody(body) ?? "unknown",
      })
    : body;
  const reasoningSanitized = foreignReasoningState
    ? removeReasoningInputItems(attemptBody)
    : { value: attemptBody, removed: 0 };
  if (reasoningSanitized.removed > 0) {
    app.log.warn(
      {
        apiRequestId,
        removed: reasoningSanitized.removed,
        channelId,
        upstreamProviderKeyId,
      },
      "Removed foreign reasoning input items before switched-channel request",
    );
  }
  const fallbackBody = await applyAllCompactFallbacks({
    app,
    endpoint,
    method: request.method,
    body: reasoningSanitized.value,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  });
  const transformContext = imageToolBridge
    ? undefined
    : createProxyTransformContext(
        endpoint,
        fallbackBody,
        resolvedUpstreamEndpoint,
      );
  const upstreamBody = imageToolBridge
    ? buildImageToolBridgeBody(
        fallbackBody,
        imageToolBridgeSettings?.routingModel ?? "gpt-image-2",
      )
    : multipartRawBody
      ? fallbackBody
      : await applyReasoningEffortTransform(
          applyApiKeyFastMode(
            buildUpstreamBody(
              endpoint,
              fallbackBody,
              provider,
              resolvedUpstreamEndpoint,
              transformContext,
            ),
            request.apiAuth?.apiKey.forceFastMode === true,
          ),
          { endpoint },
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
  let gatewayAbortReason: string | null = null;

  try {
    const controller = new AbortController();
    activeController = controller;
    registerActiveApiRequest(apiRequestId, controller);
    const timeout = setTimeout(() => {
      gatewayAbortReason = "upstream_headers_timeout";
      controller.abort();
    }, provider.timeoutMs);

    const upstreamRequestStartedAt = performance.now();
    const useTencentImageProxy = await shouldUseTencentImageProxy({
      endpoint,
      method: request.method,
      model: upstreamBody.model,
    });
    const upstreamUrl = buildUpstreamUrl(
      provider.baseUrl,
      resolvedUpstreamRequestUrl,
    );
    const upstreamHeaders = {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": multipartRawBody
        ? (multipartContentType ?? "multipart/form-data")
        : "application/json",
      Accept: body.stream ? "text/event-stream" : "application/json",
      "Accept-Encoding": "identity",
    };
    const upstreamRequestBody =
      request.method === "GET" || request.method === "DELETE"
        ? undefined
        : multipartRawBody
          ? new Uint8Array(multipartRawBody)
          : JSON.stringify(upstreamBody);
    const upstreamResponse = await fetch(
      useTencentImageProxy ? env.TENCENT_IMAGE_SCF_URL! : upstreamUrl,
      {
        method: request.method,
        headers: useTencentImageProxy
          ? {
              "Content-Type": "application/json",
              Accept: "application/json",
              "x-call-secret": env.TENCENT_IMAGE_SCF_CALL_SECRET!,
            }
          : upstreamHeaders,
        body: useTencentImageProxy
          ? JSON.stringify(
              buildTencentImageProxyPayload({
                provider,
                method: request.method,
                resolvedUpstreamRequestUrl,
                upstreamBody,
              }),
            )
          : upstreamRequestBody,
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

    const upstreamContentType = upstreamResponse.headers.get("content-type") ?? "";
    if (!upstreamResponse.ok) {
      const rawErrorBody = await safeReadUpstreamBody(upstreamResponse, {
        logger: app.log,
        maxBytes: policyRecoveryContext?.settings.maxInspectableResponseBytes
          ?? getUpstreamResponseMaxBytes(endpoint),
      });
      if ("error" in rawErrorBody) {
        await markRequestFailed(
          { id: apiRequestId },
          rawErrorBody.error.message,
          rawErrorBody.error.statusCode,
          Math.round(performance.now() - startedAt),
          undefined,
          "UPSTREAM_ERROR",
        );
        reply.status(rawErrorBody.error.statusCode);
        reply.header("content-type", "application/json");
        reply.send({ error: rawErrorBody.error.message });
        return { kind: "sent" };
      }
      const text = rawErrorBody.text;
      const statusCode = upstreamResponse.status;
      const parsedErrorBody = upstreamContentType.includes("application/json")
        ? rawErrorBody.json
        : rawErrorBody.text;
      const policySignal = policyRecoveryContext
        ? detectPolicyBlock({
            statusCode,
            headers: upstreamResponse.headers,
            body: upstreamContentType.includes("text/event-stream")
              ? rawErrorBody.text
              : parsedErrorBody,
            source: upstreamContentType.includes("text/event-stream") ? "sse" : "json",
          })
        : null;
      if (policyRecoveryContext && policySignal) {
        await recordPolicyRecoveryAttempt({
          apiRequestId,
          context: policyRecoveryContext,
          route,
          recoveryAttempt: policyRecoveryAttempt,
          signal: policySignal,
          statusCode,
          responseBody: parsedErrorBody,
          latencyMs: Math.round(performance.now() - upstreamRequestStartedAt),
        });
        if (policyRecoveryAttempt < policyRecoveryContext.settings.maxRecoveries) {
          policyRecoveryContext.audit.totalRecoveries += 1;
          return runUpstreamAttempt({
            ...params,
            policyRecoveryAttempt: policyRecoveryAttempt + 1,
            policyRecoverySignal: policySignal,
          });
        }
        policyRecoveryContext.audit.finalOutcome = "exhausted";
        await persistPolicyRecoveryAudit(apiRequestId, policyRecoveryContext);
        return {
          kind: "failed",
          statusCode: policyRecoveryExhaustedStatusCode,
          message: formatPolicyRecoveryExhaustedMessage(policySignal),
          retryableFailure: false,
        };
      }
      const upstreamBalanceInsufficient =
        isUpstreamBalanceInsufficientError(text);
      const retryableFailure = isRetryableUpstreamFailure(statusCode, text);

      if (
        endpoint === "/v1/responses" &&
        request.method === "POST" &&
        !compactTypeRetryAttempted &&
        isCompactItemTypeCompatibilityError(text)
      ) {
        const configuredType = getTargetCompactItemType(route);
        const alternateType: CompactItemType =
          configuredType === "compaction" ? "compaction_summary" : "compaction";
        const rewritten = rewriteCompactionItemsForTargetType(
          fallbackBody,
          alternateType,
        );
        if (rewritten.replacements > 0) {
          app.log.warn(
            {
              apiRequestId,
              configuredType,
              alternateType,
              replacements: rewritten.replacements,
            },
            "Retrying Responses request with alternate compact item type",
          );
          return runUpstreamAttempt({
            ...params,
            body: rewritten.value,
            compactTypeRetryAttempted: true,
          });
        }
      }

      if (
        endpoint === "/v1/responses" &&
        request.method === "POST" &&
        !invalidCompactRetryAttempted &&
        isInvalidEncryptedContentError(text)
      ) {
        const sanitized = removeMalformedEncryptedInputItems(fallbackBody);
        if (sanitized.removed > 0) {
          app.log.warn(
            {
              apiRequestId,
              removed: sanitized.removed,
              upstreamStatusCode: statusCode,
            },
            "Retrying Responses request without malformed encrypted input items",
          );
          return runUpstreamAttempt({
            ...params,
            body: sanitized.value,
            invalidCompactRetryAttempted: true,
          });
        }

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

        const withoutReasoning = removeReasoningInputItems(fallbackBody);
        if (withoutReasoning.removed > 0) {
          app.log.warn(
            {
              apiRequestId,
              removed: withoutReasoning.removed,
              upstreamStatusCode: statusCode,
            },
            "Retrying Responses request without incompatible reasoning input items",
          );
          return runUpstreamAttempt({
            ...params,
            body: withoutReasoning.value,
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
          immediatePenalty: upstreamBalanceInsufficient,
          penaltyReason: upstreamBalanceInsufficient
            ? "Upstream balance insufficient; immediate penalty after first failure"
            : undefined,
          startedAt,
          logger: app.log,
        });
        return {
          kind: "failed",
          statusCode,
          message: text.slice(0, 2000),
          retryableFailure,
          upstreamBalanceInsufficient,
          responseBody: text,
          responseContentType:
            upstreamResponse.headers.get("content-type") ?? "application/json",
        };
      }

      const recoveryNotice = upstreamBalanceInsufficient
        ? null
        : await getGatewayRecoveryNotice(text);
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
      if (billable && model) {
        await recordFailedChannelAttempt({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          retryableFailure,
          immediatePenalty: upstreamBalanceInsufficient,
          penaltyReason: upstreamBalanceInsufficient
            ? "Upstream balance insufficient; immediate penalty after first failure"
            : undefined,
          startedAt,
          logger: app.log,
        });
      }
      if (upstreamBalanceInsufficient) {
        await sendUpstreamBalanceUnavailableError(reply);
        return { kind: "sent" };
      }
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
      imageToolBridge ? { ...body, stream: false } : body,
      upstreamRequestUrl,
      endpoint,
    );
    let effectiveUpstreamResponse = upstreamResponse;
    if (shouldStream && policyRecoveryContext) {
      const probed = await probePolicyRecoveryStream(
        upstreamResponse,
        policyRecoveryContext.settings.sseProbeBytes,
      );
      if (probed.signal) {
        await recordPolicyRecoveryAttempt({
          apiRequestId,
          context: policyRecoveryContext,
          route,
          recoveryAttempt: policyRecoveryAttempt,
          signal: probed.signal,
          statusCode: upstreamResponse.status,
          responseBody: parseSseJsonPayloads(probed.text),
          latencyMs: Math.round(performance.now() - upstreamRequestStartedAt),
        });
        if (policyRecoveryAttempt < policyRecoveryContext.settings.maxRecoveries) {
          policyRecoveryContext.audit.totalRecoveries += 1;
          return runUpstreamAttempt({
            ...params,
            policyRecoveryAttempt: policyRecoveryAttempt + 1,
            policyRecoverySignal: probed.signal,
          });
        }
        policyRecoveryContext.audit.finalOutcome = "exhausted";
        await persistPolicyRecoveryAudit(apiRequestId, policyRecoveryContext);
        return {
          kind: "failed",
          statusCode: policyRecoveryExhaustedStatusCode,
          message: formatPolicyRecoveryExhaustedMessage(probed.signal),
          retryableFailure: false,
        };
      }
      effectiveUpstreamResponse = probed.response;
    }
    if (shouldStream && billable && price) {
      activeControllerHandedOff = true;
      await proxyStream({
        reply,
        upstreamResponse: effectiveUpstreamResponse,
        activeController: controller,
        apiRequestId,
        endpoint,
        upstreamEndpoint: resolvedUpstreamEndpoint,
        transformContext,
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
        gatewayAbortReason,
        policyRecoveryContext,
        policyRecoveryAttempt,
        providerName: provider.name,
      });
      return { kind: "sent" };
    }

    if (shouldStream) {
      activeControllerHandedOff = true;
      await proxyPassthroughStream({
        reply,
        upstreamResponse: effectiveUpstreamResponse,
        activeController: controller,
        apiRequestId,
        endpoint,
        upstreamEndpoint: resolvedUpstreamEndpoint,
        transformContext,
        startedAt,
        upstreamRequestStartedAt,
      });
      return { kind: "sent" };
    }

    const contentType = upstreamContentType;
    const rawBody = await safeReadUpstreamBody(upstreamResponse, {
      logger: app.log,
      maxBytes: policyRecoveryContext?.settings.maxInspectableResponseBytes
        ?? getUpstreamResponseMaxBytes(endpoint),
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
    const nonStreamPolicySignal = policyRecoveryContext
      ? detectPolicyBlock({
          statusCode: upstreamResponse.status,
          headers: upstreamResponse.headers,
          body: contentType.includes("text/event-stream")
            ? rawBody.text
            : upstreamResponseBody,
          source: contentType.includes("text/event-stream") ? "sse" : "json",
        })
      : null;
    if (policyRecoveryContext && nonStreamPolicySignal) {
      await recordPolicyRecoveryAttempt({
        apiRequestId,
        context: policyRecoveryContext,
        route,
        recoveryAttempt: policyRecoveryAttempt,
        signal: nonStreamPolicySignal,
        statusCode: upstreamResponse.status,
        responseBody: upstreamResponseBody,
        latencyMs: Math.round(performance.now() - upstreamRequestStartedAt),
      });
      if (policyRecoveryAttempt < policyRecoveryContext.settings.maxRecoveries) {
        policyRecoveryContext.audit.totalRecoveries += 1;
        return runUpstreamAttempt({
          ...params,
          policyRecoveryAttempt: policyRecoveryAttempt + 1,
          policyRecoverySignal: nonStreamPolicySignal,
        });
      }
      policyRecoveryContext.audit.finalOutcome = "exhausted";
      await persistPolicyRecoveryAudit(apiRequestId, policyRecoveryContext);
      return {
        kind: "failed",
        statusCode: policyRecoveryExhaustedStatusCode,
        message: formatPolicyRecoveryExhaustedMessage(nonStreamPolicySignal),
        retryableFailure: false,
      };
    }
    const responseBody = imageToolBridge
      ? await buildImageToolBridgeResponse({
          requestModel: model,
          routingModel: imageToolBridgeSettings?.routingModel ?? "gpt-image-2",
          imageResponse: upstreamResponseBody,
        })
      : transformProxyResponseBody(
          endpoint,
          resolvedUpstreamEndpoint,
          policyRecoveryContext
            ? sanitizePolicyResponseBody(upstreamResponseBody)
            : upstreamResponseBody,
          transformContext,
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
      reply.send(responseBody);
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
    usage = withPolicyRecoveryUsage(usage, policyRecoveryContext);
    if (policyRecoveryContext) {
      await recordPolicyRecoveryAttempt({
        apiRequestId,
        context: policyRecoveryContext,
        route,
        recoveryAttempt: policyRecoveryAttempt,
        signal: null,
        statusCode: upstreamResponse.status,
        responseBody: upstreamResponseBody,
        latencyMs: Math.round(performance.now() - upstreamRequestStartedAt),
      });
      policyRecoveryContext.audit.recovered = policyRecoveryContext.audit.totalRecoveries > 0;
      policyRecoveryContext.audit.finalOutcome = policyRecoveryContext.audit.recovered
        ? "recovered"
        : "not_triggered";
      await persistPolicyRecoveryAudit(apiRequestId, policyRecoveryContext);
    }
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
    for (const [name, value] of getForwardableUpstreamResponseHeaders(
      policyRecoveryContext
        ? sanitizePolicyResponseHeaders(upstreamResponse.headers)
        : upstreamResponse.headers,
    )) reply.header(name, value);
    reply.header("content-type", contentType || "application/json");
    reply.send(responseBody);
    return { kind: "sent" };
  } catch (error) {
    const manualTerminated = isManualTerminateError(error);
    const gatewayAborted = activeController?.signal.aborted === true;
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
        diagnostics:
          manualTerminated || !gatewayAborted
            ? undefined
            : createUpstreamFailureDiagnostics({
                phase: "upstream_fetch",
                error,
                gatewayAborted,
                gatewayAbortReason,
              }),
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
  immediatePenalty?: boolean;
  penaltyReason?: string;
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
    immediatePenalty: params.immediatePenalty,
    penaltyReason: params.penaltyReason,
    logger: params.logger,
  });
}

async function sendUpstreamBalanceUnavailableError(reply: FastifyReply) {
  const settings = await readGatewayNoticeSettings();
  return sendApiError(
    reply,
    503,
    settings.upstreamBalanceInsufficientMessage,
    "service_unavailable",
  );
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
    normalized.includes("encrypted content could not be decrypted or parsed") ||
    ((normalized.includes("missing_required_parameter") ||
      normalized.includes("missing required parameter")) &&
      normalized.includes("encrypted_content"))
  );
}

function isCompactItemTypeCompatibilityError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  const mentionsCompactType =
    normalized.includes("compaction_summary") ||
    normalized.includes("compaction");
  const rejectsType =
    normalized.includes("invalid_value") ||
    normalized.includes("invalid value") ||
    normalized.includes("unsupported") ||
    normalized.includes("unknown") ||
    normalized.includes("not allowed") ||
    normalized.includes("unexpected");
  return mentionsCompactType && rejectsType;
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
  diagnostics?: unknown;
}) {
  const manualUsage = params.manualTerminated
    ? createManualTerminateUsage(true)
    : undefined;
  if (!params.compactFallbackTrace && !params.diagnostics) {
    return manualUsage;
  }

  return {
    ...(isPlainObject(manualUsage)
      ? manualUsage
      : {
          source: params.diagnostics
            ? "gateway_upstream_failure_diagnostics"
            : "gateway_compact_fallback",
        }),
    reason: params.reason,
    ...(params.diagnostics && isPlainObject(params.diagnostics)
      ? { diagnostics: params.diagnostics }
      : {}),
    ...compactFallbackUsageFields(params.compactFallbackTrace),
  };
}

function createUpstreamFailureDiagnostics(params: {
  phase: string;
  error: unknown;
  gatewayAborted?: boolean;
  gatewayAbortReason?: string | null;
  stream?: {
    chunksRead: number;
    bytesRead: number;
    lastChunkAgeMs: number | null;
    hasForwardedStream: boolean;
    upstreamFirstChunkLatencyMs: number | null;
    firstTokenLatencyMs: number | null;
  };
}) {
  const error = normalizeErrorDiagnostics(params.error);
  return sanitizeJsonForPostgres({
    source: "gateway_upstream_failure_diagnostics",
    reason: params.phase,
    phase: params.phase,
    gatewayAborted: params.gatewayAborted === true,
    gatewayAbortReason: params.gatewayAbortReason ?? null,
    error,
    stream: params.stream,
  });
}

function normalizeErrorDiagnostics(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      type: typeof error,
      message: String(error),
    };
  }

  const cause = error.cause;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack?.split("\n").slice(0, 8).join("\n"),
    cause:
      cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            stack: cause.stack?.split("\n").slice(0, 6).join("\n"),
          }
        : cause
          ? String(cause)
          : null,
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

async function recordPolicyRecoveryAttempt(params: {
  apiRequestId: string;
  context: PolicyRecoveryContext;
  route: UpstreamAttemptRoute;
  recoveryAttempt: number;
  signal: PolicyBlockSignal | null;
  statusCode: number | null;
  responseBody: unknown;
  latencyMs: number;
}) {
  const usage = usageFromOpenAIResponse(params.responseBody);
  params.context.accumulatedInputTokens += usage.inputTokens;
  params.context.accumulatedCachedInputTokens += usage.cachedInputTokens;
  params.context.accumulatedOutputTokens += usage.outputTokens;
  params.context.audit.attempts.push({
    channelId: params.route.channelId ?? null,
    provider: params.route.provider.name,
    upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(params.route) ?? null,
    recoveryAttempt: params.recoveryAttempt,
    signal: params.signal,
    httpStatus: params.statusCode,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: params.latencyMs,
  });
  await persistPolicyRecoveryAudit(params.apiRequestId, params.context);
}

function withPolicyRecoveryUsage(
  usage: Usage,
  context?: PolicyRecoveryContext,
): Usage {
  if (!context) return usage;
  const result = {
    ...usage,
    inputTokens: usage.inputTokens + context.accumulatedInputTokens,
    cachedInputTokens:
      usage.cachedInputTokens + context.accumulatedCachedInputTokens,
    outputTokens: usage.outputTokens + context.accumulatedOutputTokens,
    billableRequestCount: context.audit.attempts.length + 1,
  };
  result.totalTokens =
    result.inputTokens + result.cachedInputTokens + result.outputTokens;
  result.raw = {
    ...(isPlainObject(usage.raw) ? usage.raw : { upstreamUsage: usage.raw }),
    policyRecovery: context.audit,
  };
  return result;
}

async function persistPolicyRecoveryAudit(
  apiRequestId: string,
  context: PolicyRecoveryContext,
) {
  await prisma.apiRequest.update({
    where: { id: apiRequestId },
    data: {
      policyRecoveryAudit: sanitizeJsonForPostgres(
        context.audit,
      ) as Prisma.InputJsonValue,
    },
  });
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

function applyApiKeyFastMode(body: ProxyBody, forceFastMode: boolean) {
  if (!forceFastMode || !isPlainObject(body)) {
    return body;
  }

  return {
    ...body,
    service_tier: "fast",
  };
}

async function proxyStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  activeController?: AbortController;
  apiRequestId: string;
  endpoint: string;
  upstreamEndpoint: string;
  transformContext?: ProxyTransformContext;
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
  gatewayAbortReason?: string | null;
  policyRecoveryContext?: PolicyRecoveryContext;
  policyRecoveryAttempt?: number;
  providerName: string;
}) {
  const {
    reply,
    upstreamResponse,
    activeController,
    apiRequestId,
    endpoint,
    upstreamEndpoint,
    transformContext,
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
    gatewayAbortReason,
    policyRecoveryContext,
    policyRecoveryAttempt = 0,
    providerName,
  } = params;
  const price = await prisma.modelPrice.findUniqueOrThrow({
    where: { id: priceId },
  });
  let streamUsage: Usage | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const streamTransformer = createProxyStreamTransformer(
    endpoint,
    upstreamEndpoint,
    transformContext,
  );
  const policySseSanitizer = policyRecoveryContext
    ? createPolicySseSanitizer()
    : null;
  let pending = "";
  let rawStreamText = "";
  let firstTokenLatencyMs: number | null = null;
  let upstreamFirstChunkLatencyMs: number | null = null;
  let chunksRead = 0;
  let bytesRead = 0;
  let lastChunkAt: number | null = null;
  const bufferedStreamChunks: string[] = [];
  let hasForwardedStream = false;
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
        const sanitizedText = policySseSanitizer
          ? policySseSanitizer.push(text)
          : text;
        const outputText = sanitizedText
          ? streamTransformer.transformText(sanitizedText)
          : "";
        if (!outputText) {
          return;
        }

        if (hasForwardedStream || firstTokenLatencyMs !== null) {
          flushBufferedStreamChunks();
          if (!safeController.enqueue(encoder.encode(outputText))) {
            throw createClientStreamClosedError();
          }
          return;
        }

        bufferedStreamChunks.push(outputText);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            chunksRead += 1;
            bytesRead += value.byteLength;
            lastChunkAt = performance.now();
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
        const sanitizedTrailing = policySseSanitizer?.flush() ?? "";
        const transformedTrailing =
          (sanitizedTrailing
            ? streamTransformer.transformText(sanitizedTrailing)
            : "") + streamTransformer.flush();
        if (transformedTrailing) {
          if (hasForwardedStream || firstTokenLatencyMs !== null) {
            flushBufferedStreamChunks();
            if (!safeController.enqueue(encoder.encode(transformedTrailing))) {
              throw createClientStreamClosedError();
            }
          } else {
            bufferedStreamChunks.push(transformedTrailing);
          }
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
        streamUsage = withPolicyRecoveryUsage(streamUsage, policyRecoveryContext);
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
          if (policyRecoveryContext) {
            await recordPolicyRecoveryAttempt({
              apiRequestId,
              context: policyRecoveryContext,
              route: {
                provider: { name: providerName } as UpstreamAttemptRoute["provider"],
                price,
                channelId,
                upstreamProviderKeyId: upstreamProviderKeyId ?? undefined,
              },
              recoveryAttempt: policyRecoveryAttempt,
              signal: null,
              statusCode: upstreamResponse.status,
              responseBody: parseSseJsonPayloads(rawStreamText),
              latencyMs: Math.round(performance.now() - upstreamRequestStartedAt),
            });
            policyRecoveryContext.audit.recovered = policyRecoveryContext.audit.totalRecoveries > 0;
            policyRecoveryContext.audit.finalOutcome = policyRecoveryContext.audit.recovered
              ? "recovered"
              : "not_triggered";
            await persistPolicyRecoveryAudit(apiRequestId, policyRecoveryContext);
          }
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
        if (policyRecoveryContext) {
          policyRecoveryContext.audit.finalOutcome = "aborted";
          await persistPolicyRecoveryAudit(apiRequestId, policyRecoveryContext).catch(() => undefined);
        }
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
            diagnostics: createUpstreamFailureDiagnostics({
              phase: "upstream_stream_read",
              error,
              gatewayAborted: activeController?.signal.aborted === true,
              gatewayAbortReason,
              stream: {
                chunksRead,
                bytesRead,
                lastChunkAgeMs:
                  lastChunkAt === null
                    ? null
                    : Math.round(performance.now() - lastChunkAt),
                hasForwardedStream,
                upstreamFirstChunkLatencyMs,
                firstTokenLatencyMs,
              },
            }),
          }),
          manualTerminated ? "MANUAL_TERMINATED" : "UPSTREAM_ERROR",
        );
        logger?.warn(
          {
            apiRequestId,
            model,
            channelId,
            upstreamProviderKeyId,
            diagnostics: createUpstreamFailureDiagnostics({
              phase: "upstream_stream_read",
              error,
              gatewayAborted: activeController?.signal.aborted === true,
              gatewayAbortReason,
              stream: {
                chunksRead,
                bytesRead,
                lastChunkAgeMs:
                  lastChunkAt === null
                    ? null
                    : Math.round(performance.now() - lastChunkAt),
                hasForwardedStream,
                upstreamFirstChunkLatencyMs,
                firstTokenLatencyMs,
              },
            }),
          },
          "Upstream stream read failed",
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
    streamTransformer.transforms
      ? "text/event-stream"
      : (upstreamResponse.headers.get("content-type") ?? "text/event-stream"),
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
  endpoint: string;
  upstreamEndpoint: string;
  transformContext?: ProxyTransformContext;
  startedAt: number;
  upstreamRequestStartedAt: number;
}) {
  const {
    reply,
    upstreamResponse,
    activeController,
    apiRequestId,
    endpoint,
    upstreamEndpoint,
    transformContext,
    startedAt,
    upstreamRequestStartedAt,
  } = params;
  let firstTokenLatencyMs: number | null = null;
  let upstreamFirstChunkLatencyMs: number | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const streamTransformer = createProxyStreamTransformer(
    endpoint,
    upstreamEndpoint,
    transformContext,
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
            const text = decoder.decode(value, { stream: true });
            const outputText = streamTransformer.transformText(text);
            if (
              outputText &&
              !safeController.enqueue(encoder.encode(outputText))
            ) {
              throw createClientStreamClosedError();
            }
          }
        }
        const trailing = decoder.decode();
        const transformedTrailing =
          (trailing ? streamTransformer.transformText(trailing) : "") +
          streamTransformer.flush();
        if (
          transformedTrailing &&
          !safeController.enqueue(encoder.encode(transformedTrailing))
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
    streamTransformer.transforms
      ? "text/event-stream"
      : (upstreamResponse.headers.get("content-type") ?? "text/event-stream"),
  );
  reply.header("cache-control", "no-cache");
  return reply.send(
    Readable.fromWeb(
      stream as unknown as import("node:stream/web").ReadableStream,
    ),
  );
}
