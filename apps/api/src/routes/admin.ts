import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createApiKey, createRedeemCode } from "../lib/crypto.js";
import { hashPassword, requireAdmin, requireUser } from "../services/auth.js";
import {
  abortActiveApiRequest,
  countActiveApiRequests,
  createManualTerminateUsage,
  manualTerminateMessage,
  manualTerminateStatusCode,
} from "../services/active-api-requests.js";
import { isProtectedCompactRequest } from "../services/compact-request-utils.js";
import { getApiKeyTotalUsageUsd } from "../services/api-key-limits.js";
import {
  readAuthSettings,
  isSmtpConfigured,
  saveAuthSettings,
  toAdminAuthSettings,
} from "../services/auth-settings.js";
import {
  maxCharityAnnouncementIntervalHours,
  minCharityAnnouncementIntervalHours,
  readCharityAnnouncementSettings,
  saveCharityAnnouncementSettings,
} from "../services/charity-announcement-settings.js";
import {
  maxPendingAutoTerminateSeconds,
  minPendingAutoTerminateSeconds,
  readPendingAutoTerminateSettings,
  savePendingAutoTerminateSettings,
} from "../services/pending-auto-terminate-settings.js";
import {
  cleanupExpiredRequestBodies,
  defaultRequestBodyRetentionSettings,
  maxRequestBodyRetentionDays,
  minRequestBodyRetentionDays,
  readRequestBodyRetentionSettings,
  saveRequestBodyRetentionSettings,
} from "../services/request-body-retention-settings.js";
import {
  defaultResponseContentFilterSettings,
  invalidateResponseContentFilterUpstreamCache,
  isSafeResponseContentFilterReplacement,
  maxResponseContentFilterReplacementLength,
  maxResponseContentFilterTermLength,
  maxResponseContentFilterTerms,
  readResponseContentFilterSettings,
  readUpstreamBaseUrlBlockedTerms,
  saveResponseContentFilterSettings,
} from "../services/response-content-filter-settings.js";
import {
  createPolicyRecoverySnapshot,
  defaultPolicyRecoverySettings,
  maxPolicyRecoveryInspectableBytes,
  maxPolicyRecoveryInstructionsLength,
  maxPolicyRecoveryLayerBytes,
  maxPolicyRecoveryMergedBytes,
  maxPolicyRecoverySkillBytes,
  maxPolicyRecoverySseProbeBytes,
  maxPolicyRecoveryUnifiedBytes,
  minPolicyRecoveryInspectableBytes,
  minPolicyRecoverySseProbeBytes,
  buildUnifiedPolicyRecoveryDocument,
  policyRecoveryLibrary,
  readPolicyRecoverySettings,
  resetAllPolicyRecoverySettings,
  resetPolicyRecoveryLayer,
  savePolicyRecoverySettings,
} from "../services/policy-recovery-settings.js";
import {
  buildPolicyRecoveryBody,
  createPolicyRecoveryContext,
  detectPolicyBlock,
} from "../services/policy-recovery.js";
import {
  reasoningEffortValues,
  getReasoningEffortFromBody,
  readReasoningEffortTransformSettings,
  saveReasoningEffortTransformSettings,
  validateReasoningEffortTransformRules,
  normalizeReasoningEffortTransformRule,
} from "../services/reasoning-effort-transform-settings.js";
import {
  defaultImageGenerationToolSettings,
  normalizeImageGenerationToolSettings,
  readImageGenerationToolSettings,
  saveImageGenerationToolSettings,
} from "../services/image-generation-tool-settings.js";
import { sendSmtpTestEmail } from "../services/mailer.js";
import {
  checkModelPoolChannel,
  getModelPoolChannelHealthTiming,
  getModelPoolHealthCheckIntervalSeconds,
  getModelPoolPenaltySeconds,
  getModelPoolSuccessGraceSeconds,
  maxModelPoolHealthCheckIntervalSeconds,
  maxModelPoolPenaltySeconds,
  maxModelPoolSuccessGraceSeconds,
  minModelPoolHealthCheckIntervalSeconds,
  minModelPoolPenaltySeconds,
  minModelPoolSuccessGraceSeconds,
  modelPoolHealthCheckEndpoints,
  normalizeModelPoolHealthCheckEndpoint,
  setModelPoolHealthCheckIntervalSeconds,
  setModelPoolPenaltySeconds,
  setModelPoolSuccessGraceSeconds,
} from "../services/model-pool-health.js";
import { emitPublicStatusChanged } from "../services/public-status-events.js";
import {
  ensureDefaultProviderKey,
  maskUpstreamKeySecret,
  upstreamKeyPrefix,
} from "../services/upstream-provider-keys.js";
import { encryptUpstreamKey } from "../services/upstream-key-encryption.js";
import {
  listUnifiedPriceSettings,
  saveUnifiedPriceSettings,
} from "../services/unified-pricing.js";
import {
  deleteIpBanRule,
  ipBanErrorUsageSource,
  ipBanModes,
  ipBanNoticeUsageSource,
  listIpBanRules,
  normalizeIpAddress,
  saveIpBanRule,
} from "../services/ip-ban-rules.js";
import {
  deleteTemporaryIpNoticeBan,
  listTemporaryIpNoticeBans,
  maxTemporaryIpNoticeBanSeconds,
  maxTemporaryIpNoticeBanThreshold,
  maxTemporaryIpNoticeBanWindowSeconds,
  minTemporaryIpNoticeBanSeconds,
  minTemporaryIpNoticeBanThreshold,
  minTemporaryIpNoticeBanWindowSeconds,
  readTemporaryIpNoticeBanSettings,
  saveTemporaryIpNoticeBanSettings,
} from "../services/temporary-ip-notice-ban.js";
import {
  defaultGatewayNoticeSettings,
  readGatewayNoticeSettings,
  saveGatewayNoticeSettings,
} from "../services/gateway-notice-settings.js";
import {
  defaultRedisFailurePolicySettings,
  readRedisFailurePolicySettings,
  redisFailurePolicyValues,
  saveRedisFailurePolicySettings,
} from "../services/redis-failure-policy-settings.js";
import {
  defaultGlobalCircuitBreakerSettings,
  readGlobalCircuitBreakerSettings,
  saveGlobalCircuitBreakerSettings,
} from "../services/global-circuit-breaker-settings.js";
import {
  defaultBannedUserNoticeSettings,
  readBannedUserNoticeSettings,
  saveBannedUserNoticeSettings,
} from "../services/banned-user-notice-settings.js";
import {
  defaultWhitelistFilterSettings,
  readWhitelistFilterSettings,
  rotateWhitelistFilterSecret,
  saveWhitelistFilterSettings,
} from "../services/whitelist-filter-settings.js";
import {
  checkImageProxyService,
  defaultImageProxySettings,
  normalizeImageProxySettings,
  readImageProxySettings,
  saveImageProxySettings,
} from "../services/image-proxy-settings.js";
import {
  clearStandardAccessTierCache,
  ensureStandardAccessTier,
  ipMatchesPattern,
  standardAccessTierCode,
} from "../services/access-routing.js";
import {
  baseUnitsPerUnitFromUnitsPerBase,
  balanceCurrencySelect,
  getActiveBalanceCurrency,
  getRedeemableBalanceCurrencyOrThrow,
  migrateWalletsToCurrency,
  normalizeCurrencyCode,
  readBalanceCurrencySettings,
  toBalanceCurrencyDto,
  upsertWalletWithActiveCurrency,
} from "../services/balance-currency.js";
import { simulateRoute } from "../services/route-simulator.js";
import {
  alertSeverityValues,
  buildOperationalStatus,
  defaultExternalAlertSettings,
  maxExternalAlertIntervalSeconds,
  minExternalAlertIntervalSeconds,
  readExternalAlertSettings,
  saveExternalAlertSettings,
  sendExternalAlertTest,
} from "../services/operational-alerts.js";
import {
  defaultDispatchSettings,
  normalizeDispatchSettings,
  readDispatchSettings,
  writeDispatchSettings,
} from "../services/dispatch-settings.js";
import {
  activateUserSubscription,
  grantSubscription,
  subscriptionPlanInclude,
  subscriptionSeconds,
  summarizeSubscriptionQuota,
  syncSubscriptionsForPlanUpdate,
  syncUserSubscriptionState,
  userSubscriptionInclude,
} from "../services/subscriptions.js";

const callableChannelStatuses = new Set(["ACTIVE", "FORCED_ACTIVE"]);
const channelStatusSchema = z.enum([
  "ACTIVE",
  "FORCED_ACTIVE",
  "DISABLED",
  "UNAVAILABLE",
  "PENALIZED",
]);
const modelPoolHealthCheckEndpointSchema = z.enum(
  modelPoolHealthCheckEndpoints,
);
const dispatchSettingsSchema = z.object({
  stickyEnabled: z.boolean().optional(),
  stickyTtlSeconds: z.number().int().min(60).max(86400).optional(),
  stickySlowUnbindEnabled: z.boolean().optional(),
  slowFirstTokenMs: z.number().int().min(1000).max(300000).optional(),
  slowTotalLatencyMs: z.number().int().min(1000).max(600000).optional(),
  slowUnbindThreshold: z.number().int().min(1).max(100).optional(),
  penaltyEnabled: z.boolean().optional(),
  penaltyFailureThreshold: z.number().int().min(1).max(100).optional(),
  penaltySeconds: z.number().int().min(1).max(86400).optional(),
  healthCheckIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  speedRankPenalty: z.number().int().min(0).max(60000).optional(),
  stickyHitPenalty: z.number().int().min(0).max(60000).optional(),
  channelConcurrencyPenalty: z.number().int().min(0).max(60000).optional(),
  keyConcurrencyPenalty: z.number().int().min(0).max(60000).optional(),
  recentFailurePenalty: z.number().int().min(0).max(60000).optional(),
  forceAvailableButtonEnabled: z.boolean().optional(),
});
const upstreamProviderKeyStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
const compactItemTypeSchema = z.enum(["compaction", "compaction_summary"]);
const userStatusSchema = z.enum([
  "ACTIVE",
  "DISABLED",
  "SUSPENDED",
  "TRIAL",
  "RISK_REVIEW",
  "BANNED",
]);
const moneyLimitSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null || String(value).trim() === "") {
      return null;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      context.addIssue({
        code: "custom",
        message: "Limit must be a non-negative number",
      });
      return z.NEVER;
    }

    return numeric.toFixed(8);
  });
const expiresAtSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null || value.trim() === "") {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be a valid date",
      });
      return z.NEVER;
    }

    return date;
  });
const noticeTextSchema = z
  .union([z.string().max(8000), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });
const userRuntimeLimitSchema = z.number().int().min(0).max(10000);
const optionalTierIdSchema = z.string().min(1).nullable().optional();
const priceVersionSchema = z.string().trim().min(1).max(80).default("v1");
const upstreamEndpointSchema = z
  .enum(["responses", "chat_completions", "images_generations"])
  .default("responses");
const pricingModeSchema = z.enum(["token", "request"]).default("token");
const accessTierCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Use letters, numbers, underscore or dash");
const accessTierBillingMultiplierSchema = z
  .string()
  .or(z.number())
  .transform((value, context) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      context.addIssue({
        code: "custom",
        message: "Billing multiplier must be a non-negative number",
      });
      return z.NEVER;
    }

    return numeric.toFixed(8);
  });
const nonNegativeMoneySchema = z
  .string()
  .or(z.number())
  .transform((value, context) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      context.addIssue({
        code: "custom",
        message: "Amount must be a non-negative number",
      });
      return z.NEVER;
    }

    return numeric.toFixed(8);
  });
const optionalNonNegativeMoneySchema = z
  .string()
  .or(z.number())
  .nullable()
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || String(value).trim() === "") {
      return "0";
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      context.addIssue({
        code: "custom",
        message: "Amount must be a non-negative number",
      });
      return z.NEVER;
    }

    return numeric.toFixed(8);
  });
const authSettingsSchema = z.object({
  emailCodeLoginEnabled: z.boolean(),
  emailCodeAutoRegisterEnabled: z.boolean(),
  newUserBonusUsd: nonNegativeMoneySchema,
  emailCodeTtlSeconds: z.number().int().min(60).max(3600),
  emailCodeCooldownSeconds: z.number().int().min(10).max(600),
  smtpHost: z.string().trim().max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(255),
  smtpPassword: z.string().max(1000).optional(),
  smtpFrom: z.string().trim().max(255),
});
const authSettingsTestEmailSchema = authSettingsSchema.extend({
  testEmail: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
});
const pendingAutoTerminateSettingsSchema = z.object({
  enabled: z.boolean(),
  timeoutSeconds: z
    .number()
    .int()
    .min(minPendingAutoTerminateSeconds)
    .max(maxPendingAutoTerminateSeconds),
  message: z.string().trim().min(1).max(8000).optional(),
});
const charityAnnouncementSettingsSchema = z.object({
  serviceEnabled: z.boolean(),
  serviceDisabledMessage: z.string().trim().min(1).max(8000),
  enabled: z.boolean(),
  frequency: z.enum(["every_visit", "interval"]),
  intervalHours: z
    .number()
    .int()
    .min(minCharityAnnouncementIntervalHours)
    .max(maxCharityAnnouncementIntervalHours),
  title: z.string().trim().max(80),
  content: z.string().trim().max(2000),
});
const reasoningEffortTransformRuleSchema = z.object({
  enabled: z.boolean(),
  from: z.enum(reasoningEffortValues),
  to: z.enum(reasoningEffortValues),
});
const reasoningEffortTransformRulesSchema = z.object({
  rules: z.array(reasoningEffortTransformRuleSchema).min(0).max(20),
  gpt56Force: z.object({
    enabled: z.boolean(),
    effort: z.enum(reasoningEffortValues),
  }).optional(),
});
const requestBodyRetentionSettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z
    .number()
    .int()
    .min(minRequestBodyRetentionDays)
    .max(maxRequestBodyRetentionDays),
});
const responseContentFilterSettingsSchema = z
  .object({
    enabled: z.boolean(),
    blockedTerms: z
      .array(
        z.string().trim().min(1).max(maxResponseContentFilterTermLength),
      )
      .max(maxResponseContentFilterTerms),
    replacement: z
      .string()
      .max(maxResponseContentFilterReplacementLength)
      .refine(isSafeResponseContentFilterReplacement, {
        message: "Replacement cannot contain quotes, backslashes, or control characters",
      }),
    caseSensitive: z.boolean(),
    includeUpstreamBaseUrls: z.boolean(),
  })
  .partial();
const adminCreateApiKeySchema = z.object({
  name: z.string().min(1).max(80),
  tierId: optionalTierIdSchema,
  rateLimitPerMinute: z.number().int().positive().max(10000).default(60),
  totalLimitUsd: moneyLimitSchema,
  dailyLimitUsd: moneyLimitSchema,
  expiresAt: expiresAtSchema,
  concurrencyLimit: z.number().int().min(0).max(10000).default(0),
  allowedModels: z.array(z.string()).default([]),
  noticeEnabled: z.boolean().default(false),
  noticeText: noticeTextSchema,
  forceFastMode: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ipWhitelist: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
});

function normalizeTags(tags: string[] | undefined) {
  return Array.from(
    new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
  ).slice(0, 20);
}

function normalizeIpPatterns(patterns: string[] | undefined) {
  return Array.from(
    new Set((patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean)),
  ).slice(0, 100);
}

const adminPatchApiKeySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  tierId: optionalTierIdSchema,
  status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
  rateLimitPerMinute: z.number().int().positive().max(10000).optional(),
  totalLimitUsd: moneyLimitSchema,
  dailyLimitUsd: moneyLimitSchema,
  expiresAt: expiresAtSchema,
  concurrencyLimit: z.number().int().min(0).max(10000).optional(),
  allowedModels: z.array(z.string()).optional(),
  noticeEnabled: z.boolean().optional(),
  noticeText: noticeTextSchema,
  forceFastMode: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  disabledReason: z.string().trim().max(500).nullable().optional(),
  ipWhitelist: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
});
const adminBatchUpdateApiKeysSchema = z.object({
  keyIds: z.array(z.string()).min(1).max(500),
  tierId: optionalTierIdSchema,
  status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
  noticeEnabled: z.boolean().optional(),
  noticeText: noticeTextSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  disabledReason: z.string().trim().max(500).nullable().optional(),
});
const modelPriceImportSchema = z
  .object({
    format: z.enum(["json", "csv"]).optional(),
    dryRun: z.boolean().default(false),
    rows: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
    content: z.string().max(2_000_000).optional(),
  })
  .refine((value) => value.rows?.length || value.content?.trim(), {
    message: "Provide rows or content",
  });
const ipBanRuleSchema = z.object({
  ip: z.string().min(1).max(128),
  mode: z.enum(ipBanModes),
  message: z.string().max(8000).optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});
const temporaryIpNoticeBanSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().int().min(2).max(20).optional(),
  windowSeconds: z.number().int().min(60).max(86400).optional(),
  banSeconds: z
    .number()
    .int()
    .min(minTemporaryIpNoticeBanSeconds)
    .max(maxTemporaryIpNoticeBanSeconds),
  message: z.string().trim().min(1).max(8000).optional(),
});
const gatewayNoticeSettingsSchema = z
  .object(
    Object.fromEntries(
      Object.keys(defaultGatewayNoticeSettings).map((key) => [
        key,
        z.string().trim().min(1).max(8000),
      ]),
    ) as Record<keyof typeof defaultGatewayNoticeSettings, z.ZodString>,
  )
  .partial();
const redisFailurePolicySettingsSchema = z
  .object({
    policy: z.enum(redisFailurePolicyValues),
    degradedAdminBypassEnabled: z.boolean(),
    degradedUserIds: z.array(z.string().trim().min(1)).max(500),
    message: z.string().trim().min(1).max(1000),
  })
  .partial();
const globalCircuitBreakerSettingsSchema = z
  .object({
    enabled: z.boolean(),
    allowAdmins: z.boolean(),
    allowedUserIds: z.array(z.string().trim().min(1)).max(500),
    message: z.string().trim().min(1).max(1000),
  })
  .partial();
const whitelistFilterSettingsSchema = z
  .object({
    enabled: z.boolean(),
    noticeText: z.string().trim().min(1).max(8000),
    applyToAdmins: z.boolean(),
  })
  .partial();
const bannedUserNoticeSettingsSchema = z
  .object({
    noticeText: z.string().trim().min(1).max(8000),
  })
  .partial();
const externalAlertSettingsSchema = z
  .object({
    enabled: z.boolean(),
    webhookUrl: z.string().trim().max(2000),
    minSeverity: z.enum(alertSeverityValues),
    intervalSeconds: z
      .number()
      .int()
      .min(minExternalAlertIntervalSeconds)
      .max(maxExternalAlertIntervalSeconds),
    mentionText: z.string().trim().max(500),
  })
  .partial();
const adminRequestResultTypes = [
  "notice",
  "ip_ban",
  "error",
  "PROXIED_SUCCESS",
  "UPSTREAM_ERROR",
  "GATEWAY_NOTICE",
  "IP_BAN",
  "RATE_LIMITED",
  "INSUFFICIENT_BALANCE",
  "MANUAL_TERMINATED",
  "AUTO_TERMINATED",
  "BILLING_ERROR",
  "CLIENT_CLOSED",
  "GATEWAY_ERROR",
] as const;
const adminRequestsQuerySchema = z.object({
  q: z.string().optional(),
  userId: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  clientIp: z.string().optional(),
  apiKey: z.string().optional(),
  upstreamProvider: z.string().optional(),
  upstreamKey: z.string().optional(),
  endpoint: z.string().optional(),
  httpStatus: z.string().optional(),
  resultType: z.enum(adminRequestResultTypes).optional(),
  minTokens: z.string().optional(),
  maxTokens: z.string().optional(),
  minChargedUsd: z.string().optional(),
  maxChargedUsd: z.string().optional(),
  minUpstreamCostUsd: z.string().optional(),
  maxUpstreamCostUsd: z.string().optional(),
  minGrossProfitUsd: z.string().optional(),
  maxGrossProfitUsd: z.string().optional(),
  minLatencyMs: z.string().optional(),
  maxLatencyMs: z.string().optional(),
  minFirstTokenLatencyMs: z.string().optional(),
  maxFirstTokenLatencyMs: z.string().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(300).default(120),
  summaryMode: z.enum(["full", "page"]).default("full"),
});
type AdminRequestsQuery = z.infer<typeof adminRequestsQuerySchema>;
const adminAuditLogsQuerySchema = z.object({
  q: z.string().trim().optional(),
  adminUserId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  outcome: z.enum(["success", "failure", "unknown"]).optional(),
  targetType: z.string().trim().optional(),
  targetId: z.string().trim().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(80),
});
type FiniteRange = {
  min?: number;
  max?: number;
};
const recoveryNoticeUsageSource = "gateway_recovery_notice";
const temporaryIpNoticeBanUsageSource = "gateway_temporary_ip_notice_ban";
const charityServiceDisabledNoticeUsageSource =
  "gateway_charity_service_disabled_notice";
const modelUnavailableNoticeUsageSource = "gateway_model_unavailable_notice";

const adminApiKeySelect = {
  id: true,
  userId: true,
  name: true,
  keyPrefix: true,
  keySecret: true,
  status: true,
  rateLimitPerMinute: true,
  dailyLimitUsd: true,
  totalLimitUsd: true,
  tierId: true,
  tier: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  expiresAt: true,
  concurrencyLimit: true,
  allowedModels: true,
  noticeEnabled: true,
  noticeText: true,
  forceFastMode: true,
  tags: true,
  disabledReason: true,
  disabledAt: true,
  ipWhitelist: true,
  lastUsedAt: true,
  createdAt: true,
} satisfies Prisma.ApiKeySelect;

function cleanAdminRequestFilter(value: string | undefined) {
  return value?.trim() ?? "";
}

function badAdminRequestFilter(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseOptionalFiniteNumber(value: string | undefined, label: string) {
  const text = cleanAdminRequestFilter(value);
  if (!text) {
    return undefined;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    throw badAdminRequestFilter(`${label} must be a finite number`);
  }

  return numeric;
}

function parseFiniteRange(
  min: string | undefined,
  max: string | undefined,
  label: string,
): FiniteRange | null {
  const range = {
    min: parseOptionalFiniteNumber(min, `${label} min`),
    max: parseOptionalFiniteNumber(max, `${label} max`),
  };

  if (range.min === undefined && range.max === undefined) {
    return null;
  }

  if (
    range.min !== undefined &&
    range.max !== undefined &&
    range.min > range.max
  ) {
    throw badAdminRequestFilter(`${label} min cannot be greater than max`);
  }

  return range;
}

function intRangeFilter(range: FiniteRange): Prisma.IntFilter<"ApiRequest"> {
  return {
    ...(range.min !== undefined ? { gte: Math.ceil(range.min) } : {}),
    ...(range.max !== undefined ? { lte: Math.floor(range.max) } : {}),
  };
}

function decimalRangeFilter(
  range: FiniteRange,
): Prisma.DecimalFilter<"ApiRequest"> {
  return {
    ...(range.min !== undefined
      ? { gte: new Decimal(range.min).toFixed(8) }
      : {}),
    ...(range.max !== undefined
      ? { lte: new Decimal(range.max).toFixed(8) }
      : {}),
  };
}

function responseSourceFilter(
  ...sources: string[]
): Prisma.ApiRequestWhereInput {
  return {
    OR: sources.map((source) => ({
      responseUsage: {
        path: ["source"],
        equals: source,
      },
    })),
  };
}

function noticeResultFilter(): Prisma.ApiRequestWhereInput {
  return {
    AND: [
      responseSourceFilter(
        recoveryNoticeUsageSource,
        ipBanNoticeUsageSource,
        temporaryIpNoticeBanUsageSource,
        charityServiceDisabledNoticeUsageSource,
        modelUnavailableNoticeUsageSource,
      ),
      {
        responseUsage: {
          path: ["returnedToUser"],
          equals: true,
        },
      },
    ],
  };
}

function ipBanResultFilter(): Prisma.ApiRequestWhereInput {
  return {
    OR: [
      responseSourceFilter(
        ipBanNoticeUsageSource,
        ipBanErrorUsageSource,
        temporaryIpNoticeBanUsageSource,
      ),
      {
        errorMessage: {
          contains: "IP banned",
          mode: "insensitive",
        },
      },
    ],
  };
}

function ordinaryErrorResultFilter(): Prisma.ApiRequestWhereInput {
  return {
    status: "FAILED",
    NOT: [noticeResultFilter(), ipBanResultFilter()],
  };
}

async function findGrossProfitRequestIds(range: FiniteRange) {
  const minClause =
    range.min !== undefined
      ? Prisma.sql`AND ("chargedAmountUsd" - "upstreamCostUsd") >= ${new Decimal(range.min).toFixed(8)}::numeric`
      : Prisma.empty;
  const maxClause =
    range.max !== undefined
      ? Prisma.sql`AND ("chargedAmountUsd" - "upstreamCostUsd") <= ${new Decimal(range.max).toFixed(8)}::numeric`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "ApiRequest"
      WHERE 1 = 1
      ${minClause}
      ${maxClause}
    `,
  );

  return rows.map((row) => row.id);
}

async function buildAdminRequestsWhere(query: AdminRequestsQuery) {
  const andFilters: Prisma.ApiRequestWhereInput[] = [];
  const q = cleanAdminRequestFilter(query.q);
  const clientIp = cleanAdminRequestFilter(query.clientIp);
  const apiKey = cleanAdminRequestFilter(query.apiKey);
  const upstreamProvider = cleanAdminRequestFilter(query.upstreamProvider);
  const upstreamKey = cleanAdminRequestFilter(query.upstreamKey);
  const endpoint = cleanAdminRequestFilter(query.endpoint);
  const httpStatus = parseOptionalFiniteNumber(query.httpStatus, "HTTP status");
  const tokenRange = parseFiniteRange(
    query.minTokens,
    query.maxTokens,
    "total token range",
  );
  const chargedRange = parseFiniteRange(
    query.minChargedUsd,
    query.maxChargedUsd,
    "charged USD range",
  );
  const upstreamCostRange = parseFiniteRange(
    query.minUpstreamCostUsd,
    query.maxUpstreamCostUsd,
    "upstream cost USD range",
  );
  const grossProfitRange = parseFiniteRange(
    query.minGrossProfitUsd,
    query.maxGrossProfitUsd,
    "gross profit USD range",
  );
  const latencyRange = parseFiniteRange(
    query.minLatencyMs,
    query.maxLatencyMs,
    "latency ms range",
  );
  const firstTokenLatencyRange = parseFiniteRange(
    query.minFirstTokenLatencyMs,
    query.maxFirstTokenLatencyMs,
    "first token latency ms range",
  );

  if (query.userId) {
    andFilters.push({ userId: query.userId });
  }

  if (query.model) {
    andFilters.push({
      model: {
        contains: query.model,
        mode: "insensitive",
      },
    });
  }

  if (query.status) {
    andFilters.push({ status: query.status });
  }

  if (query.dateFrom || query.dateTo) {
    andFilters.push({
      createdAt: {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      },
    });
  }

  if (q.length >= 2) {
    const matchingUserIds = await findAdminRequestSearchUserIds(q);
    const searchFilters: Prisma.ApiRequestWhereInput[] = [
      {
        traceCode: {
          contains: q,
          mode: "insensitive",
        },
      },
      {
        model: {
          contains: q,
          mode: "insensitive",
        },
      },
      {
        endpoint: {
          contains: q,
          mode: "insensitive",
        },
      },
      {
        clientIp: {
          contains: q,
          mode: "insensitive",
        },
      },
    ];

    if (matchingUserIds.length > 0) {
      searchFilters.push({ userId: { in: matchingUserIds } });
    }

    andFilters.push({
      OR: searchFilters,
    });
  }

  if (clientIp) {
    andFilters.push({
      clientIp: {
        contains: clientIp,
        mode: "insensitive",
      },
    });
  }

  if (apiKey) {
    andFilters.push({
      apiKey: {
        is: {
          OR: [
            { name: { contains: apiKey, mode: "insensitive" } },
            { keyPrefix: { contains: apiKey, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  if (upstreamProvider) {
    andFilters.push({
      upstreamProvider: {
        contains: upstreamProvider,
        mode: "insensitive",
      },
    });
  }

  if (upstreamKey) {
    andFilters.push({
      upstreamProviderKey: {
        is: {
          OR: [
            { name: { contains: upstreamKey, mode: "insensitive" } },
            { keyPrefix: { contains: upstreamKey, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  if (endpoint) {
    andFilters.push({
      endpoint: {
        contains: endpoint,
        mode: "insensitive",
      },
    });
  }

  if (httpStatus !== undefined) {
    if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
      throw badAdminRequestFilter(
        "HTTP status must be an integer between 100 and 599",
      );
    }
    andFilters.push({ httpStatus });
  }

  if (query.resultType === "notice") {
    andFilters.push(noticeResultFilter());
  } else if (query.resultType === "ip_ban") {
    andFilters.push(ipBanResultFilter());
  } else if (query.resultType === "error") {
    andFilters.push(ordinaryErrorResultFilter());
  } else if (query.resultType) {
    andFilters.push({ resultType: query.resultType });
  }

  if (tokenRange) {
    andFilters.push({ totalTokens: intRangeFilter(tokenRange) });
  }

  if (chargedRange) {
    andFilters.push({ chargedAmountUsd: decimalRangeFilter(chargedRange) });
  }

  if (upstreamCostRange) {
    andFilters.push({ upstreamCostUsd: decimalRangeFilter(upstreamCostRange) });
  }

  if (latencyRange) {
    andFilters.push({ latencyMs: intRangeFilter(latencyRange) });
  }

  if (firstTokenLatencyRange) {
    andFilters.push({
      upstreamFirstChunkLatencyMs: intRangeFilter(firstTokenLatencyRange),
    });
  }

  if (grossProfitRange) {
    const matchingIds = await findGrossProfitRequestIds(grossProfitRange);
    andFilters.push(
      matchingIds.length > 0
        ? { id: { in: matchingIds } }
        : { id: "__no_matching_request__" },
    );
  }

  return andFilters.length > 0 ? { AND: andFilters } : undefined;
}

async function findAdminRequestSearchUserIds(q: string) {
  const users = await prisma.user.findMany({
    where: {
      email: {
        contains: q,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

function summarizeAdminRequestPage(
  rows: Array<{
    status: "PENDING" | "SUCCESS" | "FAILED";
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: Decimal;
    upstreamCostUsd: Decimal;
    latencyMs: number | null;
    upstreamFirstChunkLatencyMs: number | null;
  }>,
) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.inputTokens += row.inputTokens;
      acc.cachedInputTokens += row.cachedInputTokens;
      acc.outputTokens += row.outputTokens;
      acc.totalTokens += row.totalTokens;
      acc.chargedAmountUsd = acc.chargedAmountUsd.plus(row.chargedAmountUsd);
      acc.upstreamCostUsd = acc.upstreamCostUsd.plus(row.upstreamCostUsd);
      if (row.status === "PENDING") acc.pendingCount += 1;
      if (row.status === "SUCCESS") acc.successCount += 1;
      if (row.status === "FAILED") acc.failedCount += 1;
      if (row.latencyMs !== null) {
        acc.latencyTotal += row.latencyMs;
        acc.latencyCount += 1;
      }
      if (row.upstreamFirstChunkLatencyMs !== null) {
        acc.firstTokenLatencyTotal += row.upstreamFirstChunkLatencyMs;
        acc.firstTokenLatencyCount += 1;
      }
      return acc;
    },
    {
      pendingCount: 0,
      successCount: 0,
      failedCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      chargedAmountUsd: new Decimal(0),
      upstreamCostUsd: new Decimal(0),
      latencyTotal: 0,
      latencyCount: 0,
      firstTokenLatencyTotal: 0,
      firstTokenLatencyCount: 0,
    },
  );
  const totalCount = rows.length;

  return {
    totalCount,
    successCount: totals.successCount,
    failedCount: totals.failedCount,
    pendingCount: totals.pendingCount,
    failureRate: totalCount > 0 ? (totals.failedCount / totalCount) * 100 : 0,
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    chargedAmountUsd: totals.chargedAmountUsd.toFixed(8),
    upstreamCostUsd: totals.upstreamCostUsd.toFixed(8),
    grossProfitUsd: totals.chargedAmountUsd
      .minus(totals.upstreamCostUsd)
      .toFixed(8),
    avgLatencyMs:
      totals.latencyCount > 0 ? totals.latencyTotal / totals.latencyCount : null,
    avgFirstTokenLatencyMs:
      totals.firstTokenLatencyCount > 0
        ? totals.firstTokenLatencyTotal / totals.firstTokenLatencyCount
        : null,
  };
}

async function getAdminRequestsSummary(
  where: Prisma.ApiRequestWhereInput | undefined,
) {
  const [aggregate, statusGroups, effectivePendingCount] = await Promise.all([
    prisma.apiRequest.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        totalTokens: true,
        chargedAmountUsd: true,
        subscriptionChargedAmountUsd: true,
        walletChargedAmountUsd: true,
        upstreamCostUsd: true,
      },
      _avg: {
        latencyMs: true,
        firstTokenLatencyMs: true,
        upstreamFirstChunkLatencyMs: true,
      },
    }),
    prisma.apiRequest.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    countEffectivePendingRequests(where),
  ]);
  const countByStatus = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  );
  const totalCount = aggregate._count._all;
  const successCount = countByStatus.SUCCESS ?? 0;
  const failedCount = countByStatus.FAILED ?? 0;
  const chargedAmountUsd = new Decimal(
    aggregate._sum.chargedAmountUsd?.toString() ?? "0",
  );
  const upstreamCostUsd = new Decimal(
    aggregate._sum.upstreamCostUsd?.toString() ?? "0",
  );

  return {
    totalCount,
    successCount,
    failedCount,
    pendingCount: effectivePendingCount,
    failureRate: totalCount > 0 ? (failedCount / totalCount) * 100 : 0,
    inputTokens: aggregate._sum.inputTokens ?? 0,
    cachedInputTokens: aggregate._sum.cachedInputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
    totalTokens: aggregate._sum.totalTokens ?? 0,
    chargedAmountUsd: chargedAmountUsd.toFixed(8),
    upstreamCostUsd: upstreamCostUsd.toFixed(8),
    grossProfitUsd: chargedAmountUsd.minus(upstreamCostUsd).toFixed(8),
    avgLatencyMs: aggregate._avg.latencyMs,
    avgFirstTokenLatencyMs: aggregate._avg.upstreamFirstChunkLatencyMs,
  };
}

async function countEffectivePendingRequests(
  where: Prisma.ApiRequestWhereInput | undefined,
) {
  const pendingAutoTerminateSettings = await readPendingAutoTerminateSettings();
  const staleCutoff = new Date(
    Date.now() - pendingAutoTerminateSettings.timeoutSeconds * 1000,
  );
  const effectivePendingWhere = {
    AND: [
      where ?? {},
      { status: "PENDING" },
      {
        OR: [
          { createdAt: { gte: staleCutoff } },
          {
            AND: [
              { endpoint: { not: "/v1/responses/compact" } },
              {
                NOT: [
                  {
                    responseUsage: {
                      path: ["gatewayCompactFallback"],
                      equals: true,
                    },
                  },
                  {
                    responseUsage: {
                      path: ["gatewayCompactKind"],
                      equals: "normal",
                    },
                  },
                  {
                    responseUsage: {
                      path: ["gatewayCompactKind"],
                      equals: "fallback",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } satisfies Prisma.ApiRequestWhereInput;

  return prisma.apiRequest.count({ where: effectivePendingWhere });
}

type ReportDimensionField =
  | "userId"
  | "model"
  | "upstreamProvider"
  | "accessTierId";

const reportDimensionSql: Record<ReportDimensionField, Prisma.Sql> = {
  userId: Prisma.sql`"userId"`,
  model: Prisma.sql`"model"`,
  upstreamProvider: Prisma.sql`"upstreamProvider"`,
  accessTierId: Prisma.sql`"accessTierId"`,
};

async function aggregateReportDimension(
  field: ReportDimensionField,
  where: Prisma.ApiRequestWhereInput,
) {
  const dateFrom =
    typeof where.createdAt === "object" &&
    where.createdAt &&
    "gte" in where.createdAt
      ? where.createdAt.gte
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const column = reportDimensionSql[field];
  const rows = await prisma.$queryRaw<
    Array<{
      id: string | null;
      requestCount: bigint;
      totalTokens: bigint | null;
      chargedAmountUsd: Decimal | null;
      upstreamCostUsd: Decimal | null;
    }>
  >`
    SELECT
      ${column}::text AS "id",
      COUNT(*)::bigint AS "requestCount",
      COALESCE(SUM("totalTokens"), 0)::bigint AS "totalTokens",
      COALESCE(SUM("chargedAmountUsd"), 0) AS "chargedAmountUsd",
      COALESCE(SUM("upstreamCostUsd"), 0) AS "upstreamCostUsd"
    FROM "ApiRequest"
    WHERE "createdAt" >= ${dateFrom}
    GROUP BY ${column}
    ORDER BY COALESCE(SUM("chargedAmountUsd"), 0) DESC
    LIMIT 20
  `;

  return rows.map((row) => {
    const chargedAmountUsd = new Decimal(row.chargedAmountUsd ?? 0);
    const upstreamCostUsd = new Decimal(row.upstreamCostUsd ?? 0);
    return {
      id: row.id,
      label: row.id ?? "未记录",
      requestCount: Number(row.requestCount),
      totalTokens: Number(row.totalTokens ?? 0),
      chargedAmountUsd: chargedAmountUsd.toFixed(8),
      upstreamCostUsd: upstreamCostUsd.toFixed(8),
      grossProfitUsd: chargedAmountUsd.minus(upstreamCostUsd).toFixed(8),
    };
  });
}

type AdminReportSummaryPayload = Awaited<
  ReturnType<typeof buildAdminReportSummary>
>;

async function buildAdminReportSummary() {
  const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where = {
    createdAt: { gte: dateFrom },
  } satisfies Prisma.ApiRequestWhereInput;
  const [summary, byUser, byModel, byUpstream, byTier] = await Promise.all([
    getAdminRequestsSummary(where),
    aggregateReportDimension("userId", where),
    aggregateReportDimension("model", where),
    aggregateReportDimension("upstreamProvider", where),
    aggregateReportDimension("accessTierId", where),
  ]);
  const userIds = byUser
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
  const tierIds = byTier
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
  const [users, tiers] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    }),
    prisma.accessTier.findMany({
      where: { id: { in: tierIds } },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user.email]));
  const tierMap = new Map(
    tiers.map((tier) => [tier.id, `${tier.name} (${tier.code})`]),
  );

  return {
    dateFrom: dateFrom.toISOString(),
    dateTo: new Date().toISOString(),
    summary,
    dimensions: {
      users: byUser.map((row) => ({
        ...row,
        label: row.id ? (userMap.get(row.id) ?? row.id) : "未知用户",
      })),
      models: byModel,
      upstreams: byUpstream,
      tiers: byTier.map((row) => ({
        ...row,
        label: row.id ? (tierMap.get(row.id) ?? row.id) : "未记录等级",
      })),
    },
  };
}

function buildAdminReportSummaryCsv(report: AdminReportSummaryPayload) {
  const rows = [
    [
      "section",
      "id",
      "label",
      "requestCount",
      "totalTokens",
      "chargedAmountUsd",
      "upstreamCostUsd",
      "grossProfitUsd",
    ],
    [
      "summary",
      "",
      "30 天经营汇总",
      String(report.summary.totalCount),
      String(report.summary.totalTokens),
      report.summary.chargedAmountUsd,
      report.summary.upstreamCostUsd,
      report.summary.grossProfitUsd,
    ],
    ...reportDimensionCsvRows("users", report.dimensions.users),
    ...reportDimensionCsvRows("models", report.dimensions.models),
    ...reportDimensionCsvRows("upstreams", report.dimensions.upstreams),
    ...reportDimensionCsvRows("tiers", report.dimensions.tiers),
  ];

  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}

function reportDimensionCsvRows(
  section: string,
  rows: AdminReportSummaryPayload["dimensions"]["users"],
) {
  return rows.map((row) => [
    section,
    row.id ?? "",
    row.label,
    String(row.requestCount),
    String(row.totalTokens),
    row.chargedAmountUsd,
    row.upstreamCostUsd,
    row.grossProfitUsd,
  ]);
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.addHook("preHandler", requireAdmin);
  app.addHook("onSend", async (request, _reply, payload) => {
    if (
      auditedAdminMethods.has(request.method) &&
      request.url.startsWith("/admin/") &&
      !request.url.startsWith("/admin/audit-logs")
    ) {
      (
        request as FastifyRequest & { auditReplyPayload?: unknown }
      ).auditReplyPayload = parseAuditReplyPayload(payload);
    }
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    await writeAdminAuditLog(request, reply.statusCode, app);
  });

  app.get("/admin/requests/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let previousPayload = "";
    let closed = false;
    let refreshTimer: NodeJS.Timeout | undefined;
    let keepaliveTimer: NodeJS.Timeout | undefined;

    const sendRequestsSignature = async () => {
      if (closed || reply.raw.destroyed) {
        return;
      }

      try {
        const rows = await prisma.apiRequest.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
          select: {
            id: true,
            status: true,
            httpStatus: true,
            latencyMs: true,
            firstTokenLatencyMs: true,
            upstreamFirstChunkLatencyMs: true,
            upstreamProvider: true,
            updatedAt: true,
            createdAt: true,
          },
        });
        const payload = JSON.stringify(
          rows.map((row) => ({
            id: row.id,
            status: row.status,
            httpStatus: row.httpStatus,
            latencyMs: row.latencyMs,
            firstTokenLatencyMs: row.firstTokenLatencyMs,
            upstreamFirstChunkLatencyMs: row.upstreamFirstChunkLatencyMs,
            upstreamProvider: row.upstreamProvider,
            updatedAt: row.updatedAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
          })),
        );

        if (payload !== previousPayload) {
          previousPayload = payload;
          reply.raw.write(`event: requests\ndata: ${payload}\n\n`);
        }
      } catch (error) {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({
            message:
              error instanceof Error ? error.message : "request events failed",
          })}\n\n`,
        );
      }
    };

    request.raw.on("close", () => {
      closed = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    });

    await sendRequestsSignature();
    refreshTimer = setInterval(sendRequestsSignature, 2000);
    keepaliveTimer = setInterval(() => {
      if (!closed && !reply.raw.destroyed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15000);
  });

  app.get("/admin/model-pools/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let previousPayload = "";
    let closed = false;
    let refreshTimer: NodeJS.Timeout | undefined;
    let keepaliveTimer: NodeJS.Timeout | undefined;

    const sendModelPoolSignature = async () => {
      if (closed || reply.raw.destroyed) {
        return;
      }

      try {
        const rows = await prisma.modelPoolChannel.findMany({
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            modelPoolId: true,
            status: true,
            priority: true,
            consecutiveFailures: true,
            recoverySuccesses: true,
            penalizedUntil: true,
            lastCheckStatus: true,
            lastCheckedAt: true,
            lastLatencyMs: true,
            lastFirstTokenLatencyMs: true,
            lastError: true,
            updatedAt: true,
          },
        });
        const payload = JSON.stringify(
          rows.map((row) => ({
            ...row,
            penalizedUntil: row.penalizedUntil?.toISOString() ?? null,
            lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
            updatedAt: row.updatedAt.toISOString(),
          })),
        );

        if (payload !== previousPayload) {
          previousPayload = payload;
          reply.raw.write(`event: model-pools\ndata: ${payload}\n\n`);
        }
      } catch (error) {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({
            message:
              error instanceof Error
                ? error.message
                : "model pool events failed",
          })}\n\n`,
        );
      }
    };

    request.raw.on("close", () => {
      closed = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    });

    await sendModelPoolSignature();
    refreshTimer = setInterval(sendModelPoolSignature, 1000);
    keepaliveTimer = setInterval(() => {
      if (!closed && !reply.raw.destroyed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15000);
  });

  app.get("/admin/access-tiers", async () => {
    await ensureStandardAccessTier();
    const tiers = await prisma.accessTier.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            users: true,
            apiKeys: true,
            modelPools: true,
          },
        },
      },
    });
    return { tiers };
  });

  app.post("/admin/access-tiers", async (request, reply) => {
    const body = z
      .object({
        code: accessTierCodeSchema.transform((value) => value.toLowerCase()),
        name: z.string().trim().min(1).max(80),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
        sortOrder: z.number().int().min(1).max(10000).default(100),
        billingMultiplier: accessTierBillingMultiplierSchema.default("1"),
        rateLimitPerMinute: userRuntimeLimitSchema.default(0),
        concurrencyLimit: userRuntimeLimitSchema.default(0),
        walletRequired: z.boolean().default(true),
        minimumWalletBalanceUsd: z.string().trim().regex(/^\d+(\.\d{1,8})?$/).nullable().optional(),
        userSelectable: z.boolean().default(false),
        description: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);

    try {
      const tier = await prisma.accessTier.create({
        data: {
          ...body,
          description: normalizeNullableText(body.description),
        },
      });
      clearStandardAccessTierCache();
      return { tier };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .status(409)
          .send({ message: "Access tier code already exists" });
      }
      throw error;
    }
  });

  app.patch("/admin/access-tiers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        code: accessTierCodeSchema
          .transform((value) => value.toLowerCase())
          .optional(),
        name: z.string().trim().min(1).max(80).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        sortOrder: z.number().int().min(1).max(10000).optional(),
        billingMultiplier: accessTierBillingMultiplierSchema.optional(),
        rateLimitPerMinute: userRuntimeLimitSchema.optional(),
        concurrencyLimit: userRuntimeLimitSchema.optional(),
        walletRequired: z.boolean().optional(),
        minimumWalletBalanceUsd: z.string().trim().regex(/^\d+(\.\d{1,8})?$/).nullable().optional(),
        userSelectable: z.boolean().optional(),
        description: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);
    const existing = await prisma.accessTier.findUnique({
      where: { id: params.id },
      select: { code: true },
    });

    if (!existing) {
      return reply.status(404).send({ message: "Access tier not found" });
    }

    if (
      existing.code === standardAccessTierCode &&
      body.code &&
      body.code !== standardAccessTierCode
    ) {
      return reply
        .status(400)
        .send({ message: "Free tier code cannot be changed" });
    }

    if (
      existing.code === standardAccessTierCode &&
      body.status === "DISABLED"
    ) {
      return reply.status(400).send({
        message: "Free tier is the default tier and cannot be disabled",
      });
    }

    try {
      const tier = await prisma.accessTier.update({
        where: { id: params.id },
        data: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.sortOrder !== undefined
            ? { sortOrder: body.sortOrder }
            : {}),
          ...(body.billingMultiplier !== undefined
            ? { billingMultiplier: body.billingMultiplier }
            : {}),
          ...(body.rateLimitPerMinute !== undefined
            ? { rateLimitPerMinute: body.rateLimitPerMinute }
            : {}),
          ...(body.concurrencyLimit !== undefined
            ? { concurrencyLimit: body.concurrencyLimit }
            : {}),
          ...(body.walletRequired !== undefined
            ? { walletRequired: body.walletRequired }
            : {}),
          ...(body.minimumWalletBalanceUsd !== undefined
            ? { minimumWalletBalanceUsd: body.minimumWalletBalanceUsd }
            : {}),
          ...(body.userSelectable !== undefined
            ? { userSelectable: body.userSelectable }
            : {}),
          ...(body.description !== undefined
            ? { description: normalizeNullableText(body.description) }
            : {}),
        },
      });
      clearStandardAccessTierCache();
      return { tier };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .status(409)
          .send({ message: "Access tier code already exists" });
      }
      throw error;
    }
  });

  app.delete("/admin/access-tiers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const tier = await prisma.accessTier.findUnique({
      where: { id: params.id },
      select: { id: true, code: true },
    });

    if (!tier) {
      return reply.status(404).send({ message: "Access tier not found" });
    }

    if (tier.code === standardAccessTierCode) {
      return reply
        .status(400)
        .send({ message: "Free tier cannot be deleted" });
    }

    await prisma.accessTier.delete({ where: { id: params.id } });
    clearStandardAccessTierCache();
    return { ok: true };
  });

  app.get("/admin/subscription-plans", async () => {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        ...subscriptionPlanInclude,
        _count: {
          select: {
            userSubscriptions: true,
            redeemCodes: true,
          },
        },
      },
    });

    return { plans };
  });

  app.post("/admin/subscription-plans", async (request, reply) => {
    const body = z
      .object({
        code: accessTierCodeSchema.transform((value) => value.toLowerCase()),
        name: z.string().trim().min(1).max(80),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
        tierId: z.string().trim().min(1),
        durationDays: z.number().int().min(1).max(3650),
        quotaMode: z.enum(["DAILY", "TOTAL", "UNLIMITED"]).default("DAILY"),
        quotaAmountUsd: z
          .string()
          .or(z.number())
          .transform(String)
          .refine((value) => Number(value) >= 0, "Quota must be non-negative"),
        sortOrder: z.number().int().min(1).max(10000).default(100),
        remark: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);

    const tier = await prisma.accessTier.findUnique({
      where: { id: body.tierId },
      select: { id: true },
    });
    if (!tier) {
      return reply.status(404).send({ message: "Access tier not found" });
    }

    try {
      const plan = await prisma.subscriptionPlan.create({
        data: {
          code: body.code,
          name: body.name,
          status: body.status,
          tierId: body.tierId,
          durationDays: body.durationDays,
          quotaMode: body.quotaMode,
          quotaAmountUsd: body.quotaAmountUsd,
          sortOrder: body.sortOrder,
          remark: normalizeNullableText(body.remark),
        },
        include: subscriptionPlanInclude,
      });
      return { plan };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .status(409)
          .send({ message: "Subscription plan code already exists" });
      }
      throw error;
    }
  });

  app.patch("/admin/subscription-plans/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        code: accessTierCodeSchema
          .transform((value) => value.toLowerCase())
          .optional(),
        name: z.string().trim().min(1).max(80).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        tierId: z.string().trim().min(1).optional(),
        durationDays: z.number().int().min(1).max(3650).optional(),
        quotaMode: z.enum(["DAILY", "TOTAL", "UNLIMITED"]).optional(),
        quotaAmountUsd: z
          .string()
          .or(z.number())
          .transform(String)
          .refine((value) => Number(value) >= 0, "Quota must be non-negative")
          .optional(),
        sortOrder: z.number().int().min(1).max(10000).optional(),
        remark: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);

    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id: params.id },
      select: { id: true, durationDays: true, tierId: true },
    });
    if (!existing) {
      return reply.status(404).send({ message: "Subscription plan not found" });
    }

    if (body.tierId) {
      const tier = await prisma.accessTier.findUnique({
        where: { id: body.tierId },
        select: { id: true },
      });
      if (!tier) {
        return reply.status(404).send({ message: "Access tier not found" });
      }
    }

    try {
      const plan = await prisma.$transaction(async (tx) => {
        const updated = await tx.subscriptionPlan.update({
          where: { id: params.id },
          data: {
            ...(body.code !== undefined ? { code: body.code } : {}),
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.tierId !== undefined ? { tierId: body.tierId } : {}),
            ...(body.durationDays !== undefined
              ? { durationDays: body.durationDays }
              : {}),
            ...(body.quotaMode !== undefined
              ? { quotaMode: body.quotaMode }
              : {}),
            ...(body.quotaAmountUsd !== undefined
              ? { quotaAmountUsd: body.quotaAmountUsd }
              : {}),
            ...(body.sortOrder !== undefined
              ? { sortOrder: body.sortOrder }
              : {}),
            ...(body.remark !== undefined
              ? { remark: normalizeNullableText(body.remark) }
              : {}),
          },
          include: subscriptionPlanInclude,
        });

        if (body.durationDays !== undefined || body.tierId !== undefined) {
          await syncSubscriptionsForPlanUpdate(tx, {
            planId: updated.id,
            previousDurationDays: existing.durationDays,
            nextDurationDays: updated.durationDays,
            nextTierId: updated.tierId,
          });
        }

        return updated;
      });
      return { plan };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .status(409)
          .send({ message: "Subscription plan code already exists" });
      }
      throw error;
    }
  });

  app.get("/admin/dispatch-settings", async () => {
    const settings = await readDispatchSettings();
    return { settings, defaults: defaultDispatchSettings };
  });

  app.patch("/admin/dispatch-settings", async (request) => {
    const body = dispatchSettingsSchema.parse(request.body);
    const settings = await writeDispatchSettings(body);
    return { settings, defaults: defaultDispatchSettings };
  });

  app.get("/admin/ip-access-tiers", async () => {
    const rules = await prisma.ipAccessTierRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      include: {
        tier: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    return { rules };
  });

  app.post("/admin/ip-access-tiers", async (request, reply) => {
    const body = z
      .object({
        cidrOrIp: z.string().trim().min(1).max(80),
        tierId: z.string().min(1),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
        priority: z.number().int().min(1).max(10000).default(100),
        remark: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);
    const tier = await prisma.accessTier.findUnique({
      where: { id: body.tierId },
      select: { id: true },
    });
    if (!tier) {
      return reply.status(404).send({ message: "Access tier not found" });
    }
    if (!isValidIpAccessPattern(body.cidrOrIp)) {
      return reply
        .status(400)
        .send({ message: "IP rule must be IPv4 or IPv4 CIDR" });
    }

    try {
      const rule = await prisma.ipAccessTierRule.create({
        data: {
          ...body,
          cidrOrIp: body.cidrOrIp.trim(),
          remark: normalizeNullableText(body.remark),
        },
        include: {
          tier: { select: { id: true, code: true, name: true, status: true } },
        },
      });
      return { rule };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .status(409)
          .send({ message: "IP access tier rule already exists" });
      }
      throw error;
    }
  });

  app.patch("/admin/ip-access-tiers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        cidrOrIp: z.string().trim().min(1).max(80).optional(),
        tierId: z.string().min(1).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        priority: z.number().int().min(1).max(10000).optional(),
        remark: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);
    if (body.cidrOrIp !== undefined && !isValidIpAccessPattern(body.cidrOrIp)) {
      return reply
        .status(400)
        .send({ message: "IP rule must be IPv4 or IPv4 CIDR" });
    }
    if (body.tierId) {
      const tier = await prisma.accessTier.findUnique({
        where: { id: body.tierId },
        select: { id: true },
      });
      if (!tier) {
        return reply.status(404).send({ message: "Access tier not found" });
      }
    }

    try {
      const rule = await prisma.ipAccessTierRule.update({
        where: { id: params.id },
        data: {
          ...(body.cidrOrIp !== undefined
            ? { cidrOrIp: body.cidrOrIp.trim() }
            : {}),
          ...(body.tierId !== undefined ? { tierId: body.tierId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.remark !== undefined
            ? { remark: normalizeNullableText(body.remark) }
            : {}),
        },
        include: {
          tier: { select: { id: true, code: true, name: true, status: true } },
        },
      });
      return { rule };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .status(409)
          .send({ message: "IP access tier rule already exists" });
      }
      throw error;
    }
  });

  app.delete("/admin/ip-access-tiers/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    await prisma.ipAccessTierRule.delete({ where: { id: params.id } });
    return { ok: true };
  });

  app.post("/admin/route-simulator", async (request) => {
    const body = z
      .object({
        userId: z.string().min(1),
        apiKeyId: z.string().min(1),
        clientIp: z.string().trim().max(128).nullable().optional(),
        model: z.string().trim().min(1).max(160),
      })
      .parse(request.body);

    return {
      simulation: await simulateRoute(body),
    };
  });

  app.get("/admin/overview", async () => {
    const [users, requests, walletAgg, requestAgg, walletCurrency] = await Promise.all([
      prisma.user.count(),
      prisma.apiRequest.count(),
      prisma.wallet.aggregate({
        _sum: { balance: true },
      }),
      prisma.apiRequest.aggregate({
        _sum: {
          chargedAmountUsd: true,
          upstreamCostUsd: true,
          totalTokens: true,
        },
      }),
      getActiveBalanceCurrency(),
    ]);

    const revenue = new Decimal(
      requestAgg._sum.chargedAmountUsd?.toString() ?? "0",
    );
    const upstreamCost = new Decimal(
      requestAgg._sum.upstreamCostUsd?.toString() ?? "0",
    );

    return {
      users,
      requests,
      totalWalletBalance: walletAgg._sum.balance ?? "0",
      walletCurrency: {
        code: walletCurrency.code,
        name: walletCurrency.name,
        symbol: walletCurrency.symbol,
        icon: walletCurrency.icon,
      },
      revenue: revenue.toFixed(8),
      upstreamCost: upstreamCost.toFixed(8),
      grossProfit: revenue.minus(upstreamCost).toFixed(8),
      totalTokens: requestAgg._sum.totalTokens ?? 0,
    };
  });

  app.get("/admin/reports/summary", async () => {
    return buildAdminReportSummary();
  });

  app.get("/admin/reports/summary/export", async (_request, reply) => {
    const report = await buildAdminReportSummary();
    const exportedAt = new Date().toISOString();
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="admin-report-${exportedAt.slice(0, 10)}.csv"`,
    );

    return buildAdminReportSummaryCsv(report);
  });

  app.get("/admin/setup-wizard", async () => {
    return { wizard: await buildSetupWizardStatus() };
  });

  app.get("/admin/server-status", async () => {
    return buildOperationalStatus(app);
  });

  app.get("/admin/risk-center", async () => {
    const [
      ipBanRules,
      temporaryIpNoticeBans,
      temporaryIpNoticeBanSettings,
      pendingAutoTerminateSettings,
      gatewayNoticeSettings,
      redisFailurePolicySettings,
      globalCircuitBreakerSettings,
      whitelistFilterSettings,
      bannedUserNoticeSettings,
      responseContentFilterSettings,
      upstreamBaseUrlBlockedTerms,
      bannedUsers,
      externalAlertSettings,
      charityAnnouncementSettings,
      reasoningEffortTransformSettings,
      failedRequests24h,
      noticeRequests24h,
      rateLimitedRequests24h,
    ] = await Promise.all([
      listIpBanRules(),
      listTemporaryIpNoticeBans(app.redis),
      readTemporaryIpNoticeBanSettings(),
      readPendingAutoTerminateSettings(),
      readGatewayNoticeSettings(),
      readRedisFailurePolicySettings(),
      readGlobalCircuitBreakerSettings(),
      readWhitelistFilterSettings(),
      readBannedUserNoticeSettings(),
      readResponseContentFilterSettings(),
      readUpstreamBaseUrlBlockedTerms(),
      prisma.user.findMany({
        where: { status: "BANNED" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          email: true,
          statusReason: true,
          displayGroup: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              apiKeys: true,
              apiRequests: true,
            },
          },
        },
      }),
      readExternalAlertSettings(),
      readCharityAnnouncementSettings(),
      readReasoningEffortTransformSettings(),
      prisma.apiRequest.count({
        where: {
          status: "FAILED",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.apiRequest.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          responseUsage: {
            path: ["returnedToUser"],
            equals: true,
          },
        },
      }),
      prisma.apiRequest.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          errorMessage: { contains: "rate limit", mode: "insensitive" },
        },
      }),
    ]);

    return {
      ipBanRules,
      temporaryIpNoticeBans,
      temporaryIpNoticeBanSettings: {
        ...temporaryIpNoticeBanSettings,
        minBanSeconds: minTemporaryIpNoticeBanSeconds,
        maxBanSeconds: maxTemporaryIpNoticeBanSeconds,
        minThreshold: minTemporaryIpNoticeBanThreshold,
        maxThreshold: maxTemporaryIpNoticeBanThreshold,
        minWindowSeconds: minTemporaryIpNoticeBanWindowSeconds,
        maxWindowSeconds: maxTemporaryIpNoticeBanWindowSeconds,
      },
      pendingAutoTerminateSettings: {
        ...pendingAutoTerminateSettings,
        minTimeoutSeconds: minPendingAutoTerminateSeconds,
        maxTimeoutSeconds: maxPendingAutoTerminateSeconds,
      },
      gatewayNoticeSettings,
      redisFailurePolicySettings,
      globalCircuitBreakerSettings,
      whitelistFilterSettings,
      bannedUserNoticeSettings,
      responseContentFilterSettings,
      upstreamBaseUrlBlockedTerms,
      responseContentFilterLimits: {
        maxTerms: maxResponseContentFilterTerms,
        maxTermLength: maxResponseContentFilterTermLength,
        maxReplacementLength: maxResponseContentFilterReplacementLength,
      },
      bannedUsers,
      externalAlertSettings,
      charityAnnouncementSettings: {
        ...charityAnnouncementSettings,
        minIntervalHours: minCharityAnnouncementIntervalHours,
        maxIntervalHours: maxCharityAnnouncementIntervalHours,
      },
      reasoningEffortTransformSettings,
      counters: {
        pendingRequests: countActiveApiRequests(),
        failedRequests24h,
        noticeRequests24h,
        rateLimitedRequests24h,
      },
      checkedAt: new Date().toISOString(),
    };
  });

  app.get("/admin/auth-settings", async () => {
    const settings = await readAuthSettings();
    return { settings: toAdminAuthSettings(settings) };
  });

  app.put("/admin/auth-settings", async (request) => {
    const body = authSettingsSchema.parse(request.body);
    const settings = await saveAuthSettings({
      ...body,
      smtpPassword: body.smtpPassword?.trim() ? body.smtpPassword : undefined,
    });

    return { settings: toAdminAuthSettings(settings) };
  });

  app.post("/admin/auth-settings/test-email", async (request, reply) => {
    const body = authSettingsTestEmailSchema.parse(request.body);
    const currentSettings = await readAuthSettings();
    const settings = {
      ...currentSettings,
      ...body,
      smtpPassword: body.smtpPassword?.trim()
        ? body.smtpPassword
        : currentSettings.smtpPassword,
    };

    if (!isSmtpConfigured(settings)) {
      return reply
        .status(400)
        .send({ message: "请先填写完整 SMTP Host、端口和发件人。" });
    }

    try {
      await sendSmtpTestEmail(settings, {
        to: body.testEmail,
        code: "482913",
        ttlMinutes: Math.max(
          1,
          Math.ceil(Number(body.emailCodeTtlSeconds) / 60),
        ),
      });
    } catch (error) {
      app.log.error(
        { error, email: body.testEmail },
        "Failed to send SMTP test email",
      );
      return reply
        .status(502)
        .send({ message: "测试邮件发送失败，请检查 SMTP 设置。" });
    }

    return { ok: true };
  });

  app.get("/admin/balance-currencies", async () => {
    return readBalanceCurrencySettings();
  });

  app.post("/admin/balance-currencies", async (request, reply) => {
    const body = z
      .object({
        code: z.string().trim().min(2).max(32),
        name: z.string().trim().min(1).max(80),
        symbol: z.string().trim().min(1).max(20),
        icon: z.string().trim().min(1).max(40).default("circle-dollar-sign"),
        unitsPerBase: z.string().or(z.number()).default("1"),
      })
      .parse(request.body);
    const code = normalizeCurrencyCode(body.code);
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) {
      return reply
        .status(400)
        .send({ message: "货币代码只能使用大写字母、数字和下划线" });
    }

    let currency;
    try {
      currency = await prisma.balanceCurrency.create({
        data: {
          code,
          name: body.name,
          symbol: body.symbol,
          icon: body.icon,
          baseUnitsPerUnit: baseUnitsPerUnitFromUnitsPerBase(body.unitsPerBase),
          isBase: false,
        },
        select: balanceCurrencySelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return reply.status(409).send({ message: `余额货币代码已存在：${code}` });
      }
      throw error;
    }

    return {
      currency: toBalanceCurrencyDto(currency),
      ...(await readBalanceCurrencySettings()),
    };
  });

  app.post("/admin/balance-currencies/:code/activate", async (request) => {
    const params = z.object({ code: z.string().min(1).max(32) }).parse(request.params);
    const result = await prisma.$transaction(
      (tx) => migrateWalletsToCurrency(tx, normalizeCurrencyCode(params.code)),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      ...result,
      ...(await readBalanceCurrencySettings()),
    };
  });

  app.get("/admin/pending-auto-terminate-settings", async () => {
    const settings = await readPendingAutoTerminateSettings();
    return {
      settings: {
        ...settings,
        minTimeoutSeconds: minPendingAutoTerminateSeconds,
        maxTimeoutSeconds: maxPendingAutoTerminateSeconds,
      },
    };
  });

  app.put("/admin/pending-auto-terminate-settings", async (request) => {
    const body = pendingAutoTerminateSettingsSchema.parse(request.body);
    const settings = await savePendingAutoTerminateSettings(body);
    return {
      settings: {
        ...settings,
        minTimeoutSeconds: minPendingAutoTerminateSeconds,
        maxTimeoutSeconds: maxPendingAutoTerminateSeconds,
      },
    };
  });

  app.get("/admin/charity-announcement-settings", async () => {
    const settings = await readCharityAnnouncementSettings();
    return {
      settings: {
        ...settings,
        minIntervalHours: minCharityAnnouncementIntervalHours,
        maxIntervalHours: maxCharityAnnouncementIntervalHours,
      },
    };
  });

  app.put("/admin/charity-announcement-settings", async (request) => {
    const body = charityAnnouncementSettingsSchema.parse(request.body);
    const settings = await saveCharityAnnouncementSettings(body);
    emitPublicStatusChanged();
    return {
      settings: {
        ...settings,
        minIntervalHours: minCharityAnnouncementIntervalHours,
        maxIntervalHours: maxCharityAnnouncementIntervalHours,
      },
    };
  });

  app.get("/admin/gateway-notice-settings", async () => {
    const settings = await readGatewayNoticeSettings();
    return {
      settings,
      defaults: defaultGatewayNoticeSettings,
    };
  });

  app.put("/admin/gateway-notice-settings", async (request) => {
    const body = gatewayNoticeSettingsSchema.parse(request.body);
    const settings = await saveGatewayNoticeSettings(body);
    return {
      settings,
      defaults: defaultGatewayNoticeSettings,
    };
  });

  app.get("/admin/redis-failure-policy-settings", async () => {
    const settings = await readRedisFailurePolicySettings();
    return {
      settings,
      defaults: defaultRedisFailurePolicySettings,
      policies: redisFailurePolicyValues,
    };
  });

  app.put("/admin/redis-failure-policy-settings", async (request) => {
    const body = redisFailurePolicySettingsSchema.parse(request.body);
    const settings = await saveRedisFailurePolicySettings(body);
    return {
      settings,
      defaults: defaultRedisFailurePolicySettings,
      policies: redisFailurePolicyValues,
    };
  });

  app.get("/admin/global-circuit-breaker-settings", async () => {
    return {
      settings: await readGlobalCircuitBreakerSettings(),
      defaults: defaultGlobalCircuitBreakerSettings,
    };
  });

  app.put("/admin/global-circuit-breaker-settings", async (request) => {
    const body = globalCircuitBreakerSettingsSchema.parse(request.body);
    const settings = await saveGlobalCircuitBreakerSettings(body);
    return {
      settings,
      defaults: defaultGlobalCircuitBreakerSettings,
    };
  });

  app.get("/admin/whitelist-filter-settings", async () => {
    const settings = await readWhitelistFilterSettings();
    return {
      settings,
      defaults: defaultWhitelistFilterSettings,
    };
  });

  app.put("/admin/whitelist-filter-settings", async (request) => {
    const body = whitelistFilterSettingsSchema.parse(request.body);
    const settings = await saveWhitelistFilterSettings(body);
    return {
      settings,
      defaults: defaultWhitelistFilterSettings,
    };
  });

  app.post("/admin/whitelist-filter-settings/rotate-secret", async () => {
    const settings = await rotateWhitelistFilterSecret();
    return {
      settings,
      defaults: defaultWhitelistFilterSettings,
    };
  });

  app.get("/admin/banned-user-notice-settings", async () => {
    const settings = await readBannedUserNoticeSettings();
    return {
      settings,
      defaults: defaultBannedUserNoticeSettings,
    };
  });

  app.put("/admin/banned-user-notice-settings", async (request) => {
    const body = bannedUserNoticeSettingsSchema.parse(request.body);
    const settings = await saveBannedUserNoticeSettings(body);
    return {
      settings,
      defaults: defaultBannedUserNoticeSettings,
    };
  });

  app.get("/admin/external-alert-settings", async () => {
    return {
      settings: await readExternalAlertSettings(),
      defaults: defaultExternalAlertSettings,
      severityOptions: alertSeverityValues,
      minIntervalSeconds: minExternalAlertIntervalSeconds,
      maxIntervalSeconds: maxExternalAlertIntervalSeconds,
    };
  });

  app.put("/admin/external-alert-settings", async (request) => {
    const body = externalAlertSettingsSchema.parse(request.body);
    const settings = await saveExternalAlertSettings(body);
    return {
      settings,
      defaults: defaultExternalAlertSettings,
      severityOptions: alertSeverityValues,
      minIntervalSeconds: minExternalAlertIntervalSeconds,
      maxIntervalSeconds: maxExternalAlertIntervalSeconds,
    };
  });

  app.post("/admin/external-alert-settings/test", async (request, reply) => {
    const body = externalAlertSettingsSchema.parse(request.body);
    const current = await readExternalAlertSettings();
    const settings = await saveExternalAlertSettings({ ...current, ...body });

    try {
      await sendExternalAlertTest(settings);
    } catch (error) {
      app.log.warn({ error }, "External alert test failed");
      return reply.status(502).send({
        message: error instanceof Error ? error.message : "外部告警测试失败",
      });
    }

    return { ok: true, settings };
  });

  app.get("/admin/reasoning-effort-transform-settings", async () => {
    const settings = await readReasoningEffortTransformSettings();
    return { settings, options: reasoningEffortValues };
  });

  app.put(
    "/admin/reasoning-effort-transform-settings",
    async (request, reply) => {
      const body = reasoningEffortTransformRulesSchema.parse(request.body);
      const normalizedRules = body.rules.map((rule) =>
        normalizeReasoningEffortTransformRule(rule),
      );
      const validation = validateReasoningEffortTransformRules(normalizedRules);
      if (!validation.ok) {
        return reply.status(409).send({
          message: "推理强度转换存在冲突",
          conflicts: validation.conflicts,
          selfTransforms: validation.selfTransforms,
        });
      }

      const settings = await saveReasoningEffortTransformSettings({
        rules: normalizedRules,
        ...(body.gpt56Force ? { gpt56Force: body.gpt56Force } : {}),
      });
      return { settings, options: reasoningEffortValues };
    },
  );

  app.get("/admin/request-body-retention-settings", async () => {
    return {
      settings: await readRequestBodyRetentionSettings(),
      defaults: defaultRequestBodyRetentionSettings,
      limits: {
        minRetentionDays: minRequestBodyRetentionDays,
        maxRetentionDays: maxRequestBodyRetentionDays,
      },
    };
  });

  app.put("/admin/request-body-retention-settings", async (request) => {
    const body = requestBodyRetentionSettingsSchema.parse(request.body);
    const settings = await saveRequestBodyRetentionSettings(body);

    void cleanupExpiredRequestBodies()
      .then((result) => {
        if (!result.skipped && result.count > 0) {
          app.log.info(
            result,
            "Expired API request bodies cleared after retention settings update",
          );
        }
      })
      .catch((error) => {
        app.log.error(
          error,
          "Expired API request body cleanup after settings update failed",
        );
      });

    return {
      settings,
      defaults: defaultRequestBodyRetentionSettings,
      limits: {
        minRetentionDays: minRequestBodyRetentionDays,
        maxRetentionDays: maxRequestBodyRetentionDays,
      },
    };
  });

  app.get("/admin/response-content-filter-settings", async () => {
    const [settings, upstreamBaseUrlBlockedTerms] = await Promise.all([
      readResponseContentFilterSettings(),
      readUpstreamBaseUrlBlockedTerms(),
    ]);
    return {
      settings,
      upstreamBaseUrlBlockedTerms,
      defaults: defaultResponseContentFilterSettings,
      limits: {
        maxTerms: maxResponseContentFilterTerms,
        maxTermLength: maxResponseContentFilterTermLength,
        maxReplacementLength: maxResponseContentFilterReplacementLength,
      },
    };
  });

  app.put("/admin/response-content-filter-settings", async (request) => {
    const body = responseContentFilterSettingsSchema.parse(request.body);
    const settings = await saveResponseContentFilterSettings(body);
    return {
      settings,
      upstreamBaseUrlBlockedTerms: await readUpstreamBaseUrlBlockedTerms(),
      defaults: defaultResponseContentFilterSettings,
      limits: {
        maxTerms: maxResponseContentFilterTerms,
        maxTermLength: maxResponseContentFilterTermLength,
        maxReplacementLength: maxResponseContentFilterReplacementLength,
      },
    };
  });

  const policyRecoveryLimits = {
    maxInstructionsLength: maxPolicyRecoveryInstructionsLength,
    maxLayerBytes: maxPolicyRecoveryLayerBytes,
    maxMergedBytes: maxPolicyRecoveryMergedBytes,
    maxUnifiedBytes: maxPolicyRecoveryUnifiedBytes,
    maxSkillBytes: maxPolicyRecoverySkillBytes,
    minSseProbeBytes: minPolicyRecoverySseProbeBytes,
    maxSseProbeBytes: maxPolicyRecoverySseProbeBytes,
    minInspectableResponseBytes: minPolicyRecoveryInspectableBytes,
    maxInspectableResponseBytes: maxPolicyRecoveryInspectableBytes,
  };

  app.get("/admin/policy-recovery-settings", async () => ({
    settings: await readPolicyRecoverySettings(),
    defaults: createPolicyRecoverySnapshot(defaultPolicyRecoverySettings),
    limits: policyRecoveryLimits,
  }));

  const policyRecoveryLayerSchema = z.object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(160),
    source: z.enum(["exe", "seagull", "custom"]),
    enabled: z.boolean(),
    content: z.string().trim().min(1).max(maxPolicyRecoveryLayerBytes),
    builtinSha256: z.string().max(64),
  });

  app.put("/admin/policy-recovery-settings", async (request) => {
    const body = z.object({
      masterEnabled: z.boolean(),
      activeProfile: z.enum(["layered-v1", "unified-v2"]),
      layers: z.array(policyRecoveryLayerSchema).min(1).max(32),
      unifiedDocument: z.string().trim().min(1).max(maxPolicyRecoveryUnifiedBytes),
      securitySkillEnabled: z.boolean(),
      securitySkillMode: z.enum(["routed", "full"]),
      securitySkillStartupTemplate: z.string().trim().min(1).max(maxPolicyRecoveryInstructionsLength),
      prefillConversationEnabled: z.boolean(),
      prefillUserMessage: z.string().trim().min(1).max(maxPolicyRecoveryInstructionsLength),
      prefillAssistantMessage: z.string().trim().min(1).max(maxPolicyRecoveryInstructionsLength),
      retryInstructionsTemplate: z.string().trim().min(1).max(maxPolicyRecoveryInstructionsLength),
      maxRecoveries: z.number().int().min(0).max(3),
      sseProbeBytes: z.number().int().min(minPolicyRecoverySseProbeBytes).max(maxPolicyRecoverySseProbeBytes),
      maxInspectableResponseBytes: z.number().int().min(minPolicyRecoveryInspectableBytes).max(maxPolicyRecoveryInspectableBytes),
    }).parse(request.body);
    return {
      settings: await savePolicyRecoverySettings(body),
      defaults: createPolicyRecoverySnapshot(defaultPolicyRecoverySettings),
      limits: policyRecoveryLimits,
    };
  });

  app.post("/admin/policy-recovery-settings/preview", async (request) => {
    const body = z.object({
      endpoint: z.enum(["/v1/responses", "/v1/responses/compact", "/v1/chat/completions"]),
      requestBody: z.record(z.string(), z.unknown()),
      responseStatus: z.number().int().min(100).max(599).optional(),
      responseHeaders: z.record(z.string(), z.string()).optional(),
      responseBody: z.unknown().optional(),
    }).parse(request.body);
    const settings = await readPolicyRecoverySettings();
    const context = createPolicyRecoveryContext(body.requestBody, settings);
    const injectedBody = buildPolicyRecoveryBody({
      context,
      endpoint: body.endpoint,
      recoveryAttempt: 0,
      provider: "preview",
      model: typeof body.requestBody.model === "string" ? body.requestBody.model : "preview-model",
    });
    const signal = body.responseBody === undefined && !body.responseHeaders
      ? null
      : detectPolicyBlock({
          statusCode: body.responseStatus ?? 200,
          headers: body.responseHeaders ?? {},
          body: body.responseBody,
          source: body.endpoint === "/v1/chat/completions" ? "json" : "json",
        });
    return {
      preview: {
        endpoint: body.endpoint,
        enabled: settings.masterEnabled,
        activeProfile: settings.activeProfile,
        activeProfileName: settings.activeProfileName,
        mergedInstructions: settings.baseInstructions,
        mergedBytes: settings.mergedBytes,
        mergedSha256: settings.mergedSha256,
        estimatedTokens: settings.estimatedTokens,
        injectedBody,
        signal,
      },
    };
  });

  app.post("/admin/policy-recovery-settings/reset-layer", async (request) => {
    const body = z.object({ layerId: z.string().trim().min(1).max(128) }).parse(request.body);
    return { settings: await resetPolicyRecoveryLayer(body.layerId) };
  });

  app.post("/admin/policy-recovery-settings/regenerate-unified", async (request) => {
    const body = z.discriminatedUnion("source", [
      z.object({
        source: z.literal("current-layers"),
        layers: z.array(policyRecoveryLayerSchema).min(1).max(32),
      }),
      z.object({ source: z.literal("builtin-default") }),
    ]).parse(request.body);
    const unifiedDocument = buildUnifiedPolicyRecoveryDocument(
      body.source === "builtin-default"
        ? defaultPolicyRecoverySettings.layers
        : body.layers,
    );
    return { unifiedDocument };
  });

  app.post("/admin/policy-recovery-settings/reset-all", async () => ({
    settings: await resetAllPolicyRecoverySettings(),
  }));

  app.get("/admin/policy-recovery-library", async () => ({ entries: policyRecoveryLibrary }));

  app.get("/admin/policy-recovery-stats", async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [enabledPools, recentRequests] = await Promise.all([
      prisma.modelPool.count({ where: { policyRecoveryEnabled: true } }),
      prisma.apiRequest.findMany({
        where: { createdAt: { gte: since }, policyRecoveryAudit: { not: Prisma.JsonNull } },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          createdAt: true,
          model: true,
          upstreamProvider: true,
          httpStatus: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
          policyRecoveryAudit: true,
          accessTier: { select: { name: true } },
        },
      }),
    ]);
    const audits = recentRequests.map((item) => ({
      ...item,
      audit: item.policyRecoveryAudit,
    }));
    const recovered = audits.filter((item) => asRecord(item.audit)?.recovered === true).length;
    const exhausted = audits.filter((item) => asRecord(item.audit)?.finalOutcome === "exhausted").length;
    return {
      stats: {
        enabledPools,
        totalRequests: audits.length,
        recovered,
        exhausted,
        recoveryRate: audits.length ? recovered / audits.length : 0,
        exhaustedRate: audits.length ? exhausted / audits.length : 0,
        recentRequests: audits.slice(0, 100),
      },
    };
  });

  app.get("/admin/image-generation-tool-settings", async () => {
    return {
      settings: await readImageGenerationToolSettings(),
      defaults: defaultImageGenerationToolSettings,
    };
  });

  app.put("/admin/image-generation-tool-settings", async (request) => {
    const body = normalizeImageGenerationToolSettings(request.body);
    const settings = await saveImageGenerationToolSettings(body);
    return { settings, defaults: defaultImageGenerationToolSettings };
  });

  app.get("/admin/image-proxy-settings", async () => {
    const [settings, models] = await Promise.all([
      readImageProxySettings(),
      prisma.modelPrice.findMany({
        where: {
          enabled: true,
          upstreamEndpoint: "images_generations",
        },
        select: { model: true },
        orderBy: { model: "asc" },
      }),
    ]);
    return {
      settings,
      defaults: defaultImageProxySettings,
      models: [...new Set(models.map((item) => item.model))],
    };
  });

  app.put("/admin/image-proxy-settings", async (request) => {
    const body = normalizeImageProxySettings(request.body);
    const settings = await saveImageProxySettings(body);
    return { settings, defaults: defaultImageProxySettings };
  });

  app.post("/admin/image-proxy-settings/check", async () => {
    return { result: await checkImageProxyService() };
  });

  app.get("/admin/users", async (request) => {
    const query = z
      .object({
        scope: z.enum(["all", "charity"]).default("all"),
      })
      .parse(request.query);
    const where =
      query.scope === "charity"
        ? {
            OR: [
              { charityEnabled: true },
              {
                email: { equals: "free@qq.com", mode: "insensitive" as const },
              },
            ],
          }
        : undefined;
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        statusReason: true,
        allowedModels: true,
        rateLimitPerMinute: true,
        concurrencyLimit: true,
        displayGroup: true,
        tierId: true,
        tier: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        charityEnabled: true,
        charityDisplayName: true,
        charityKey: true,
        charityIpRateLimitEnabled: true,
        charityIpRateLimitPerMinute: true,
        tokenVersion: true,
        createdAt: true,
        wallet: {
          include: {
            balanceCurrency: {
              select: {
                code: true,
                name: true,
                symbol: true,
                icon: true,
              },
            },
          },
        },
        walletTransactions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            type: true,
            amount: true,
            balanceBefore: true,
            balanceAfter: true,
            currency: true,
            remark: true,
            createdAt: true,
          },
        },
        apiKeys: {
          orderBy: { createdAt: "desc" },
          select: adminApiKeySelect,
        },
        modelMappings: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fromModel: true,
            toModel: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        _count: {
          select: {
            apiKeys: true,
            apiRequests: true,
          },
        },
      },
    });

    return {
      users: await Promise.all(
        users.map(async (user) => ({
          ...user,
          apiKeys: await Promise.all(user.apiKeys.map(withAdminApiKeyUsage)),
        })),
      ),
    };
  });

  app.get("/admin/users/:id/ips", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, email: true },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    const [loginGroups, apiGroups, ipBanRules] = await Promise.all([
      prisma.loginLog.groupBy({
        by: ["ip", "success"],
        where: {
          userId: user.id,
          ip: { not: null },
        },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      prisma.apiRequest.groupBy({
        by: ["clientIp"],
        where: {
          userId: user.id,
          clientIp: { not: null },
        },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      listIpBanRules(),
    ]);

    const banRuleByIp = new Map(
      ipBanRules.map((rule) => [normalizeIpAddress(rule.ip) ?? rule.ip, rule]),
    );
    const ipMap = new Map<
      string,
      {
        ip: string;
        loginSuccessCount: number;
        loginFailureCount: number;
        apiRequestCount: number;
        firstSeenAt: Date | null;
        lastSeenAt: Date | null;
      }
    >();

    function touchIp(
      rawIp: string | null,
      counts: {
        loginSuccessCount?: number;
        loginFailureCount?: number;
        apiRequestCount?: number;
      },
      firstSeenAt?: Date | null,
      lastSeenAt?: Date | null,
    ) {
      const normalizedIp = normalizeIpAddress(rawIp);
      if (!normalizedIp) {
        return;
      }
      const current = ipMap.get(normalizedIp) ?? {
        ip: normalizedIp,
        loginSuccessCount: 0,
        loginFailureCount: 0,
        apiRequestCount: 0,
        firstSeenAt: null,
        lastSeenAt: null,
      };
      current.loginSuccessCount += counts.loginSuccessCount ?? 0;
      current.loginFailureCount += counts.loginFailureCount ?? 0;
      current.apiRequestCount += counts.apiRequestCount ?? 0;
      if (
        firstSeenAt &&
        (!current.firstSeenAt || firstSeenAt < current.firstSeenAt)
      ) {
        current.firstSeenAt = firstSeenAt;
      }
      if (
        lastSeenAt &&
        (!current.lastSeenAt || lastSeenAt > current.lastSeenAt)
      ) {
        current.lastSeenAt = lastSeenAt;
      }
      ipMap.set(normalizedIp, current);
    }

    for (const group of loginGroups) {
      touchIp(
        group.ip,
        group.success
          ? { loginSuccessCount: group._count._all }
          : { loginFailureCount: group._count._all },
        group._min.createdAt,
        group._max.createdAt,
      );
    }

    for (const group of apiGroups) {
      touchIp(
        group.clientIp,
        { apiRequestCount: group._count._all },
        group._min.createdAt,
        group._max.createdAt,
      );
    }

    const ips = Array.from(ipMap.values())
      .map((item) => ({
        ...item,
        totalCount:
          item.loginSuccessCount +
          item.loginFailureCount +
          item.apiRequestCount,
        firstSeenAt: item.firstSeenAt?.toISOString() ?? null,
        lastSeenAt: item.lastSeenAt?.toISOString() ?? null,
        banRule: banRuleByIp.get(item.ip) ?? null,
      }))
      .sort((left, right) =>
        (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? ""),
      );

    return { user, ips };
  });

  app.get("/admin/users/:id/subscriptions", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    await prisma.$transaction((tx) => syncUserSubscriptionState(tx, params.id));
    const subscriptions = await prisma.userSubscription.findMany({
      where: { userId: params.id },
      orderBy: [{ active: "desc" }, { status: "asc" }, { updatedAt: "desc" }],
      include: userSubscriptionInclude,
    });
    return {
      subscriptions: subscriptions.map((subscription) =>
        summarizeSubscriptionQuota(subscription),
      ),
    };
  });

  app.post("/admin/users/:id/subscriptions", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        planId: z.string().trim().min(1),
        remark: z.string().trim().max(500).nullable().optional(),
        activate: z.boolean().default(false),
      })
      .parse(request.body);

    const subscription = await prisma.$transaction(async (tx) => {
      const granted = await grantSubscription(tx, {
        userId: params.id,
        planId: body.planId,
        source: "ADMIN",
        remark: normalizeNullableText(body.remark),
      });
      if (body.activate && !granted.active) {
        return activateUserSubscription(tx, {
          userId: params.id,
          subscriptionId: granted.id,
        });
      }
      return granted;
    });

    return { subscription: summarizeSubscriptionQuota(subscription) };
  });

  app.patch("/admin/user-subscriptions/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(["ACTIVE", "QUEUED", "EXPIRED", "DISABLED"]).optional(),
        remainingSeconds: z.number().int().min(0).optional(),
        remark: z.string().trim().max(500).nullable().optional(),
      })
      .parse(request.body);

    const subscription = await prisma.$transaction(async (tx) => {
      const existing = await tx.userSubscription.findUnique({
        where: { id: params.id },
      });
      if (!existing) {
        throw Object.assign(new Error("Subscription not found"), {
          statusCode: 404,
        });
      }
      await syncUserSubscriptionState(tx, existing.userId);

      if (
        body.status &&
        ["DISABLED", "EXPIRED"].includes(body.status) &&
        existing.active
      ) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { tierId: existing.baseTierId },
        });
      }

      return tx.userSubscription.update({
        where: { id: params.id },
        data: {
          ...(body.status !== undefined
            ? {
                status: body.status,
                active: body.status === "ACTIVE" ? existing.active : false,
              }
            : {}),
          ...(body.remainingSeconds !== undefined
            ? { remainingSeconds: body.remainingSeconds }
            : {}),
          ...(body.remark !== undefined
            ? { remark: normalizeNullableText(body.remark) }
            : {}),
        },
        include: userSubscriptionInclude,
      });
    });

    return { subscription: summarizeSubscriptionQuota(subscription) };
  });

  app.post("/admin/user-subscriptions/:id/activate", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.userSubscription.findUnique({
      where: { id: params.id },
      select: { userId: true },
    });
    if (!existing) {
      throw Object.assign(new Error("Subscription not found"), {
        statusCode: 404,
      });
    }
    const subscription = await prisma.$transaction((tx) =>
      activateUserSubscription(tx, {
        userId: existing.userId,
        subscriptionId: params.id,
      }),
    );
    return { subscription: summarizeSubscriptionQuota(subscription) };
  });

  app.patch("/admin/users/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        email: z.string().email().optional(),
        role: z.enum(["USER", "ADMIN"]).optional(),
        status: userStatusSchema.optional(),
        statusReason: z.string().trim().max(500).nullable().optional(),
        allowedModels: z.array(z.string()).optional(),
        rateLimitPerMinute: userRuntimeLimitSchema.optional(),
        concurrencyLimit: userRuntimeLimitSchema.optional(),
        displayGroup: z.string().trim().min(1).max(32).optional(),
        tierId: optionalTierIdSchema,
        charityEnabled: z.boolean().optional(),
        charityDisplayName: z.string().max(80).nullable().optional(),
        charityKey: z.string().max(300).nullable().optional(),
        charityIpRateLimitEnabled: z.boolean().optional(),
        charityIpRateLimitPerMinute: userRuntimeLimitSchema.optional(),
      })
      .parse(request.body);
    const standardTier = await ensureStandardAccessTier();

    const data = {
      ...(body.email ? { email: body.email } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.statusReason !== undefined
        ? { statusReason: normalizeNullableText(body.statusReason) }
        : {}),
      ...(body.allowedModels !== undefined
        ? { allowedModels: body.allowedModels }
        : {}),
      ...(body.rateLimitPerMinute !== undefined
        ? { rateLimitPerMinute: body.rateLimitPerMinute }
        : {}),
      ...(body.concurrencyLimit !== undefined
        ? { concurrencyLimit: body.concurrencyLimit }
        : {}),
      ...(body.displayGroup !== undefined
        ? { displayGroup: body.displayGroup }
        : {}),
      ...(body.tierId !== undefined
        ? { tierId: body.tierId ?? standardTier.id }
        : {}),
      ...(body.charityEnabled !== undefined
        ? { charityEnabled: body.charityEnabled }
        : {}),
      ...(body.charityDisplayName !== undefined
        ? { charityDisplayName: normalizeNullableText(body.charityDisplayName) }
        : {}),
      ...(body.charityKey !== undefined
        ? { charityKey: normalizeNullableText(body.charityKey) }
        : {}),
      ...(body.charityIpRateLimitEnabled !== undefined
        ? { charityIpRateLimitEnabled: body.charityIpRateLimitEnabled }
        : {}),
      ...(body.charityIpRateLimitPerMinute !== undefined
        ? { charityIpRateLimitPerMinute: body.charityIpRateLimitPerMinute }
        : {}),
    };

    const user = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        statusReason: true,
        allowedModels: true,
        rateLimitPerMinute: true,
        concurrencyLimit: true,
        displayGroup: true,
        tierId: true,
        tier: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        charityEnabled: true,
        charityDisplayName: true,
        charityKey: true,
        charityIpRateLimitEnabled: true,
        charityIpRateLimitPerMinute: true,
        tokenVersion: true,
        createdAt: true,
        wallet: true,
        _count: {
          select: {
            apiKeys: true,
            apiRequests: true,
          },
        },
      },
    });

    return { user };
  });

  app.put("/admin/users/:id/model-mappings", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        mappings: z
          .array(
            z.object({
              fromModel: z.string().trim().min(1).max(200),
              toModel: z.string().trim().min(1).max(200),
            }),
          )
          .max(500),
      })
      .parse(request.body);

    const exists = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) {
      return reply.status(404).send({ message: "User not found" });
    }

    const mappings = normalizeUserModelMappings(body.mappings);
    await prisma.$transaction([
      prisma.userModelMapping.deleteMany({ where: { userId: params.id } }),
      ...mappings.map((mapping) =>
        prisma.userModelMapping.create({
          data: {
            userId: params.id,
            fromModel: mapping.fromModel,
            toModel: mapping.toModel,
          },
        }),
      ),
    ]);

    return {
      mappings: await prisma.userModelMapping.findMany({
        where: { userId: params.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromModel: true,
          toModel: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    };
  });

  app.post("/admin/users", async (request) => {
    const body = z
      .object({
        email: z.string().email(),
        role: z.enum(["USER", "ADMIN"]).default("USER"),
        status: userStatusSchema.default("ACTIVE"),
        statusReason: z.string().trim().max(500).nullable().optional(),
        allowedModels: z.array(z.string()).default([]),
        rateLimitPerMinute: userRuntimeLimitSchema.default(0),
        concurrencyLimit: userRuntimeLimitSchema.default(0),
        displayGroup: z.string().trim().min(1).max(32).default("普通用户组"),
        tierId: optionalTierIdSchema,
        charityEnabled: z.boolean().default(false),
        charityDisplayName: z.string().max(80).nullable().optional(),
        charityKey: z.string().max(300).nullable().optional(),
        charityIpRateLimitEnabled: z.boolean().default(false),
        charityIpRateLimitPerMinute: userRuntimeLimitSchema.default(0),
        initialBalance: z.string().or(z.number()).optional(),
      })
      .parse(request.body);
    const standardTier = await ensureStandardAccessTier();

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: body.email,
            role: body.role,
            status: body.status,
            statusReason: normalizeNullableText(body.statusReason),
            allowedModels: body.allowedModels,
            rateLimitPerMinute: body.rateLimitPerMinute,
            concurrencyLimit: body.concurrencyLimit,
            displayGroup: body.displayGroup,
            tierId: body.tierId ?? standardTier.id,
            charityEnabled: body.charityEnabled,
            charityDisplayName: normalizeNullableText(body.charityDisplayName),
            charityKey: normalizeNullableText(body.charityKey),
            charityIpRateLimitEnabled: body.charityIpRateLimitEnabled,
            charityIpRateLimitPerMinute: body.charityIpRateLimitPerMinute,
            passwordHash: await hashPassword(
              randomBytes(32).toString("base64url"),
            ),
            wallet: {
              create: {
                balance: body.initialBalance
                  ? String(body.initialBalance)
                  : "0",
                currency: (await getActiveBalanceCurrency(tx)).code,
              },
            },
          },
        });

        if (body.initialBalance) {
          await tx.walletTransaction.create({
            data: {
              userId: created.id,
              type: "RECHARGE",
              source: "ADMIN_RECHARGE",
              amount: String(body.initialBalance),
              balanceBefore: "0",
              balanceAfter: String(body.initialBalance),
              currency: (await getActiveBalanceCurrency(tx)).code,
              remark: "Initial balance",
            },
          });
        }

        return created;
      });

      return { user };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw Object.assign(new Error("Email already exists"), {
          statusCode: 409,
        });
      }

      throw error;
    }
  });

  app.post("/admin/users/:id/logout", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const currentUser = request.user as { sub: string };

    if (params.id === currentUser.sub) {
      return reply
        .status(400)
        .send({ message: "Cannot logout your own admin session" });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        tokenVersion: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        tokenVersion: {
          increment: 1,
        },
      },
      select: {
        id: true,
        email: true,
        tokenVersion: true,
      },
    });

    return { ok: true, user: updated };
  });

  app.delete("/admin/users/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const currentUser = request.user as { sub: string };

    if (params.id === currentUser.sub) {
      return reply
        .status(400)
        .send({ message: "Cannot delete your own admin account" });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    await prisma.user.delete({
      where: { id: params.id },
    });

    return { ok: true, user };
  });

  app.post("/admin/users/:id/balance", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        amount: z.string().or(z.number()).transform(String),
        remark: z.string().optional(),
      })
      .parse(request.body);
    const amount = new Decimal(body.amount);

    if (!amount.isFinite() || amount.equals(0)) {
      return reply.status(400).send({ message: "Amount cannot be zero" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!targetUser) {
      return reply.status(404).send({ message: "User not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await upsertWalletWithActiveCurrency(tx, params.id);
      const balanceBefore = new Decimal(wallet.balance.toString());
      const balanceAfter = balanceBefore.plus(amount);

      if (balanceAfter.lt(0)) {
        throw Object.assign(new Error("Balance cannot be negative"), {
          statusCode: 400,
        });
      }

      const updatedWallet = await tx.wallet.update({
        where: { userId: params.id },
        data: {
          balance: balanceAfter.toFixed(8),
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId: params.id,
          type: "ADJUST",
          source: "ADMIN_ADJUST",
          amount: amount.toFixed(8),
          balanceBefore: balanceBefore.toFixed(8),
          balanceAfter: balanceAfter.toFixed(8),
          currency: wallet.currency,
          remark: body.remark ?? "Admin balance adjustment",
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    return result;
  });

  app.get("/admin/users/:id/api-keys", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: params.id },
      orderBy: { createdAt: "desc" },
      select: adminApiKeySelect,
    });

    return { apiKeys: await Promise.all(apiKeys.map(withAdminApiKeyUsage)) };
  });

  app.post("/admin/users/:id/api-keys", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adminCreateApiKeySchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    if (body.noticeEnabled && !body.noticeText) {
      return reply
        .status(400)
        .send({ message: "Notice text is required when notice is enabled" });
    }

    const generated = createApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: params.id,
        name: body.name,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        keySecret: generated.key,
        rateLimitPerMinute: body.rateLimitPerMinute,
        totalLimitUsd: body.totalLimitUsd ?? body.dailyLimitUsd ?? null,
        tierId: body.tierId ?? null,
        expiresAt: body.expiresAt,
        concurrencyLimit: body.concurrencyLimit,
        allowedModels: body.allowedModels,
        noticeEnabled: body.noticeEnabled,
        noticeText: body.noticeText ?? null,
        forceFastMode: body.forceFastMode,
        tags: normalizeTags(body.tags),
        ipWhitelist: normalizeIpPatterns(body.ipWhitelist),
      },
      select: adminApiKeySelect,
    });

    return {
      apiKey: await withAdminApiKeyUsage(apiKey),
      secret: generated.key,
    };
  });

  app.patch("/admin/users/:id/api-keys/batch", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adminBatchUpdateApiKeysSchema.parse(request.body);
    const data = {
      ...(body.tierId !== undefined ? { tierId: body.tierId } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.noticeEnabled !== undefined
        ? { noticeEnabled: body.noticeEnabled }
        : {}),
      ...(body.noticeText !== undefined ? { noticeText: body.noticeText } : {}),
      ...(body.tags !== undefined ? { tags: normalizeTags(body.tags) } : {}),
      ...(body.disabledReason !== undefined
        ? { disabledReason: normalizeNullableText(body.disabledReason) }
        : {}),
      ...(body.status !== undefined && body.status !== "ACTIVE"
        ? {
            disabledAt: new Date(),
            disabledReason:
              normalizeNullableText(body.disabledReason) ?? "Admin disabled",
          }
        : {}),
      ...(body.status === "ACTIVE"
        ? { disabledAt: null, disabledReason: null }
        : {}),
    };

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ message: "No batch changes provided" });
    }

    if (body.noticeEnabled && !body.noticeText) {
      return reply
        .status(400)
        .send({ message: "Notice text is required when notice is enabled" });
    }

    const uniqueKeyIds = Array.from(new Set(body.keyIds));
    const existingKeys = await prisma.apiKey.findMany({
      where: {
        id: { in: uniqueKeyIds },
        userId: params.id,
      },
      select: {
        id: true,
        expiresAt: true,
        totalLimitUsd: true,
      },
    });

    if (existingKeys.length !== uniqueKeyIds.length) {
      return reply
        .status(404)
        .send({ message: "Some API keys were not found for this user" });
    }

    if (body.status === "ACTIVE") {
      const now = new Date();
      const expiredKey = existingKeys.find(
        (apiKey) => apiKey.expiresAt && apiKey.expiresAt <= now,
      );
      if (expiredKey) {
        return reply
          .status(400)
          .send({ message: "Cannot enable expired API keys" });
      }

      for (const apiKey of existingKeys) {
        if (!apiKey.totalLimitUsd) {
          continue;
        }

        const usedUsd = await getApiKeyTotalUsageUsd(apiKey.id);
        if (usedUsd.gte(apiKey.totalLimitUsd.toString())) {
          return reply
            .status(400)
            .send({ message: "Cannot enable API keys over their total quota" });
        }
      }
    }

    await prisma.apiKey.updateMany({
      where: {
        id: { in: uniqueKeyIds },
        userId: params.id,
      },
      data,
    });

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        id: { in: uniqueKeyIds },
        userId: params.id,
      },
      orderBy: { createdAt: "desc" },
      select: adminApiKeySelect,
    });

    return {
      count: apiKeys.length,
      apiKeys: await Promise.all(apiKeys.map(withAdminApiKeyUsage)),
    };
  });

  app.patch("/admin/api-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adminPatchApiKeySchema.parse(request.body);
    const existing = await prisma.apiKey.findUnique({
      where: { id: params.id },
      select: adminApiKeySelect,
    });

    if (!existing) {
      return reply.status(404).send({ message: "API key not found" });
    }

    const totalLimitUsd =
      body.totalLimitUsd === undefined
        ? body.dailyLimitUsd
        : body.totalLimitUsd;
    const shouldActivate = body.status === "ACTIVE";
    const nextNoticeEnabled =
      body.noticeEnabled === undefined
        ? existing.noticeEnabled
        : body.noticeEnabled;
    const nextNoticeText =
      body.noticeText === undefined ? existing.noticeText : body.noticeText;

    if (nextNoticeEnabled && !nextNoticeText) {
      return reply
        .status(400)
        .send({ message: "Notice text is required when notice is enabled" });
    }

    if (shouldActivate) {
      const nextExpiresAt =
        body.expiresAt !== undefined ? body.expiresAt : existing.expiresAt;
      if (nextExpiresAt && nextExpiresAt <= new Date()) {
        return reply
          .status(400)
          .send({ message: "Cannot enable an expired API key" });
      }

      const nextTotalLimitUsd =
        totalLimitUsd === undefined
          ? existing.totalLimitUsd?.toString()
          : totalLimitUsd;
      if (nextTotalLimitUsd) {
        const usedUsd = await getApiKeyTotalUsageUsd(existing.id);
        if (usedUsd.gte(nextTotalLimitUsd)) {
          return reply
            .status(400)
            .send({ message: "Cannot enable an API key over its total quota" });
        }
      }
    }

    const apiKey = await prisma.apiKey.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.status !== undefined && body.status !== "ACTIVE"
          ? {
              disabledAt: new Date(),
              disabledReason:
                normalizeNullableText(body.disabledReason) ??
                existing.disabledReason ??
                "Admin disabled",
            }
          : {}),
        ...(body.status === "ACTIVE"
          ? { disabledAt: null, disabledReason: null }
          : body.disabledReason !== undefined
            ? { disabledReason: normalizeNullableText(body.disabledReason) }
            : {}),
        ...(body.rateLimitPerMinute !== undefined
          ? { rateLimitPerMinute: body.rateLimitPerMinute }
          : {}),
        ...(totalLimitUsd !== undefined ? { totalLimitUsd } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
        ...(body.concurrencyLimit !== undefined
          ? { concurrencyLimit: body.concurrencyLimit }
          : {}),
        ...(body.tierId !== undefined ? { tierId: body.tierId } : {}),
        ...(body.allowedModels !== undefined
          ? { allowedModels: body.allowedModels }
          : {}),
        ...(body.noticeEnabled !== undefined
          ? { noticeEnabled: body.noticeEnabled }
          : {}),
        ...(body.noticeText !== undefined
          ? { noticeText: body.noticeText }
          : {}),
        ...(body.forceFastMode !== undefined
          ? { forceFastMode: body.forceFastMode }
          : {}),
        ...(body.tags !== undefined ? { tags: normalizeTags(body.tags) } : {}),
        ...(body.ipWhitelist !== undefined
          ? { ipWhitelist: normalizeIpPatterns(body.ipWhitelist) }
          : {}),
      },
      select: adminApiKeySelect,
    });

    return { apiKey: await withAdminApiKeyUsage(apiKey) };
  });

  app.delete("/admin/api-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: params.id },
      select: adminApiKeySelect,
    });

    if (!apiKey) {
      return reply.status(404).send({ message: "API key not found" });
    }

    await prisma.apiKey.delete({
      where: { id: params.id },
    });

    return { ok: true, apiKey: await withAdminApiKeyUsage(apiKey) };
  });

  app.get("/admin/ip-ban-rules", async () => {
    return { rules: await listIpBanRules() };
  });

  app.put("/admin/ip-ban-rules/:ip", async (request) => {
    const params = z
      .object({ ip: z.string().min(1).max(128) })
      .parse(request.params);
    const body = ipBanRuleSchema.omit({ ip: true }).parse(request.body);
    const rule = await saveIpBanRule({
      ip: params.ip,
      mode: body.mode,
      message: body.message,
      reason: body.reason,
    });

    return {
      rule,
      rules: await listIpBanRules(),
    };
  });

  app.post("/admin/ip-ban-rules", async (request) => {
    const body = ipBanRuleSchema.parse(request.body);
    const rule = await saveIpBanRule(body);

    return {
      rule,
      rules: await listIpBanRules(),
    };
  });

  app.delete("/admin/ip-ban-rules/:ip", async (request) => {
    const params = z
      .object({ ip: z.string().min(1).max(128) })
      .parse(request.params);
    const result = await deleteIpBanRule(params.ip);

    return {
      ...result,
      rules: await listIpBanRules(),
    };
  });

  app.get("/admin/temporary-ip-notice-bans", async () => {
    const [bans, settings] = await Promise.all([
      listTemporaryIpNoticeBans(app.redis),
      readTemporaryIpNoticeBanSettings(),
    ]);
    return {
      bans,
      settings: {
        ...settings,
        minBanSeconds: minTemporaryIpNoticeBanSeconds,
        maxBanSeconds: maxTemporaryIpNoticeBanSeconds,
        minThreshold: minTemporaryIpNoticeBanThreshold,
        maxThreshold: maxTemporaryIpNoticeBanThreshold,
        minWindowSeconds: minTemporaryIpNoticeBanWindowSeconds,
        maxWindowSeconds: maxTemporaryIpNoticeBanWindowSeconds,
      },
    };
  });

  app.put("/admin/temporary-ip-notice-bans/settings", async (request) => {
    const body = temporaryIpNoticeBanSettingsSchema.parse(request.body);
    const settings = await saveTemporaryIpNoticeBanSettings(body);
    return {
      settings: {
        ...settings,
        minBanSeconds: minTemporaryIpNoticeBanSeconds,
        maxBanSeconds: maxTemporaryIpNoticeBanSeconds,
        minThreshold: minTemporaryIpNoticeBanThreshold,
        maxThreshold: maxTemporaryIpNoticeBanThreshold,
        minWindowSeconds: minTemporaryIpNoticeBanWindowSeconds,
        maxWindowSeconds: maxTemporaryIpNoticeBanWindowSeconds,
      },
      bans: await listTemporaryIpNoticeBans(app.redis),
    };
  });

  app.delete("/admin/temporary-ip-notice-bans/:ip", async (request) => {
    const params = z
      .object({ ip: z.string().min(1).max(128) })
      .parse(request.params);
    const result = await deleteTemporaryIpNoticeBan(app.redis, params.ip);
    return {
      ...result,
      bans: await listTemporaryIpNoticeBans(app.redis),
    };
  });

  app.get("/admin/requests", async (request) => {
    const query = adminRequestsQuerySchema.parse(request.query);
    const where = await buildAdminRequestsWhere(query);

    const [rows, summary, ipBanRules] = await Promise.all([
      prisma.apiRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          traceCode: true,
          upstreamProvider: true,
          upstreamProviderKey: {
            select: {
              id: true,
              name: true,
              keyPrefix: true,
            },
          },
          accessTier: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
            },
          },
          clientIp: true,
          apiKey: {
            select: {
              id: true,
              name: true,
              keyPrefix: true,
            },
          },
          model: true,
          reasoningEffort: true,
          reasoningEffortActual: true,
          endpoint: true,
          method: true,
          status: true,
          httpStatus: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          totalTokens: true,
          chargedAmountUsd: true,
          subscriptionChargedAmountUsd: true,
          walletChargedAmountUsd: true,
          upstreamCostUsd: true,
          latencyMs: true,
          firstTokenLatencyMs: true,
          upstreamFirstChunkLatencyMs: true,
          errorMessage: true,
          createdAt: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      }),
      query.summaryMode === "page" ? Promise.resolve(null) : getAdminRequestsSummary(where),
      listIpBanRules(),
    ]);
    const hasMore = rows.length > query.take;
    const visibleRows = hasMore ? rows.slice(0, query.take) : rows;
    const requests = visibleRows.map(({ reasoningEffort, ...row }) => {
      return {
        ...row,
        reasoningEffort: reasoningEffort ?? null,
      };
    });

    return {
      requests,
      hasMore,
      summary: summary ?? summarizeAdminRequestPage(visibleRows),
      ipBanRules,
      nextCursor: hasMore ? (requests.at(-1)?.id ?? null) : null,
    };
  });

  app.get("/admin/requests/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const apiRequest = await prisma.apiRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        traceCode: true,
        upstreamProvider: true,
        upstreamRequestId: true,
        upstreamProviderKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
        accessTier: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        clientIp: true,
        userAgent: true,
        apiKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
        model: true,
        reasoningEffort: true,
        reasoningEffortActual: true,
        endpoint: true,
        method: true,
        status: true,
        httpStatus: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        totalTokens: true,
        chargedAmountUsd: true,
        upstreamCostUsd: true,
        latencyMs: true,
        firstTokenLatencyMs: true,
        upstreamFirstChunkLatencyMs: true,
        errorMessage: true,
        requestBody: true,
        responseUsage: true,
        policyRecoveryAudit: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!apiRequest) {
      return reply.status(404).send({ message: "Request not found" });
    }

    return {
      request: {
        ...apiRequest,
        reasoningEffort:
          apiRequest.reasoningEffort ?? getReasoningEffortFromBody(apiRequest.requestBody),
      },
    };
  });

  app.get("/admin/audit-logs", async (request) => {
    const query = adminAuditLogsQuerySchema.parse(request.query);
    const where: Prisma.AdminAuditLogWhereInput = {};
    const q = query.q?.trim();

    if (q) {
      where.OR = [
        { action: { contains: q, mode: "insensitive" } },
        { path: { contains: q, mode: "insensitive" } },
        { adminEmail: { contains: q, mode: "insensitive" } },
        { targetType: { contains: q, mode: "insensitive" } },
        { targetId: { contains: q, mode: "insensitive" } },
        { errorMessage: { contains: q, mode: "insensitive" } },
        { ip: { contains: q, mode: "insensitive" } },
      ];
    }

    if (query.adminUserId) {
      where.adminUserId = query.adminUserId;
    }
    if (query.action) {
      where.action = { contains: query.action, mode: "insensitive" };
    }
    if (query.outcome) {
      where.outcome = query.outcome;
    }
    if (query.targetType) {
      where.targetType = { equals: query.targetType, mode: "insensitive" };
    }
    if (query.targetId) {
      where.targetId = query.targetId;
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const logs = await prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.take + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });
    const hasMore = logs.length > query.take;
    const items = hasMore ? logs.slice(0, query.take) : logs;

    return {
      logs: items,
      nextCursor: hasMore ? items.at(-1)?.id : null,
    };
  });

  app.get("/admin/login-logs", async (request) => {
    const query = z
      .object({
        take: z.coerce.number().int().min(1).max(500).default(100),
        method: z.string().trim().max(80).optional(),
        success: z
          .enum(["true", "false"])
          .optional()
          .transform((value) =>
            value === undefined ? undefined : value === "true",
          ),
        userId: z.string().trim().min(1).optional(),
        email: z.string().trim().max(255).optional(),
        ip: z.string().trim().max(128).optional(),
      })
      .parse(request.query);
    const where: Prisma.LoginLogWhereInput = {
      ...(query.method ? { method: query.method } : {}),
      ...(query.success !== undefined ? { success: query.success } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.email
        ? { email: { contains: query.email, mode: "insensitive" } }
        : {}),
      ...(query.ip ? { ip: { contains: query.ip } } : {}),
    };
    const [logs, total] = await Promise.all([
      prisma.loginLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.take,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      }),
      prisma.loginLog.count({ where }),
    ]);

    return { logs, total };
  });

  app.post("/admin/requests/:id/terminate", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.apiRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        createdAt: true,
        endpoint: true,
        requestBody: true,
        responseUsage: true,
      },
    });

    if (!existing) {
      return reply.status(404).send({ message: "Request not found" });
    }

    if (existing.status !== "PENDING") {
      return reply
        .status(409)
        .send({ message: "Only PENDING requests can be terminated" });
    }

    if (
      isProtectedCompactRequest({
        endpoint: existing.endpoint,
        requestBody: existing.requestBody,
        responseUsage: existing.responseUsage,
      })
    ) {
      return reply
        .status(409)
        .send({ message: "Compact requests cannot be manually terminated" });
    }

    const abortResult = abortActiveApiRequest(existing.id);
    const latencyMs = Math.min(
      2147483647,
      Math.max(0, Math.round(Date.now() - existing.createdAt.getTime())),
    );
    const updateResult = await prisma.apiRequest.updateMany({
      where: {
        id: existing.id,
        status: "PENDING",
      },
      data: {
        status: "FAILED",
        httpStatus: manualTerminateStatusCode,
        errorMessage: manualTerminateMessage,
        latencyMs,
        responseUsage: createManualTerminateUsage(abortResult.aborted),
      },
    });

    if (updateResult.count === 0) {
      return reply
        .status(409)
        .send({ message: "Request is no longer PENDING" });
    }

    const apiRequest = await prisma.apiRequest.findUniqueOrThrow({
      where: { id: existing.id },
      select: {
        id: true,
        upstreamProvider: true,
        upstreamProviderKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
        clientIp: true,
        apiKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
        model: true,
        endpoint: true,
        method: true,
        status: true,
        httpStatus: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        totalTokens: true,
        chargedAmountUsd: true,
        upstreamCostUsd: true,
        latencyMs: true,
        firstTokenLatencyMs: true,
        upstreamFirstChunkLatencyMs: true,
        errorMessage: true,
        responseUsage: true,
        createdAt: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    return {
      request: apiRequest,
      abortedActiveRequest: abortResult.aborted,
    };
  });

  app.get("/admin/redeem-codes", async () => {
    const codes = await prisma.redeemCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        validUserTier: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        subscriptionPlan: {
          include: subscriptionPlanInclude,
        },
        redemptions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    return { codes };
  });

  app.get("/admin/redeem-codes/export", async (_request, reply) => {
    const codes = await prisma.redeemCode.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        validUserTier: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        subscriptionPlan: {
          include: subscriptionPlanInclude,
        },
        redemptions: {
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                email: true,
              },
            },
          },
        },
      },
    });
    const exportedAt = new Date().toISOString();
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="redeem-codes-${exportedAt.slice(0, 10)}.csv"`,
    );

    return buildRedeemCodesCsv(codes);
  });

  app.post("/admin/redeem-codes", async (request, reply) => {
    const admin = request.user as { sub: string };
    const body = z
      .object({
        rewardType: z.enum(["BALANCE", "SUBSCRIPTION"]).default("BALANCE"),
        amount: z.string().or(z.number()).transform(String).optional(),
        currency: z.string().trim().min(1).max(32).optional(),
        count: z.number().int().min(1).max(100).default(1),
        maxRedemptions: z.number().int().min(1).max(1000).default(1),
        expiresAt: z.string().datetime().nullable().optional(),
        remark: z.string().max(500).optional(),
        campaignName: z.string().trim().max(120).nullable().optional(),
        validUserTierId: z.string().trim().min(1).nullable().optional(),
        subscriptionPlanId: z.string().trim().min(1).nullable().optional(),
        perUserLimit: z.number().int().min(1).max(1000).default(1),
      })
      .parse(request.body);
    const amount = new Decimal(body.amount ?? "0");
    const codeCurrency =
      body.rewardType === "BALANCE" && body.currency
        ? await getRedeemableBalanceCurrencyOrThrow(
            prisma,
            normalizeCurrencyCode(body.currency),
          )
        : await getActiveBalanceCurrency();

    if (body.rewardType === "BALANCE" && codeCurrency.isBase) {
      return reply.status(400).send({
        message: "余额兑换码必须选择基准货币之外的启用货币",
      });
    }

    if (
      body.rewardType === "BALANCE" &&
      (!amount.isFinite() || amount.lte(0))
    ) {
      return reply.status(400).send({ message: "Amount must be positive" });
    }
    if (body.rewardType === "SUBSCRIPTION" && !body.subscriptionPlanId) {
      return reply
        .status(400)
        .send({ message: "Subscription plan is required" });
    }
    if (body.rewardType === "BALANCE" && body.subscriptionPlanId) {
      return reply.status(400).send({
        message: "Balance redeem code cannot include subscription plan",
      });
    }

    if (body.perUserLimit > body.maxRedemptions) {
      return reply
        .status(400)
        .send({ message: "Per-user limit cannot exceed max redemptions" });
    }

    if (body.validUserTierId) {
      const tier = await prisma.accessTier.findUnique({
        where: { id: body.validUserTierId },
        select: { id: true },
      });
      if (!tier) {
        return reply.status(404).send({ message: "Access tier not found" });
      }
    }
    if (body.subscriptionPlanId) {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id: body.subscriptionPlanId },
        select: { id: true },
      });
      if (!plan) {
        return reply
          .status(404)
          .send({ message: "Subscription plan not found" });
      }
    }

    const generated = Array.from({ length: body.count }, () =>
      createRedeemCode(),
    );
    const codes = await prisma.$transaction(
      generated.map((item) =>
        prisma.redeemCode.create({
          data: {
            codeHash: item.hash,
            codePrefix: item.prefix,
            rewardType: body.rewardType,
            amount: amount.toFixed(8),
            currency: codeCurrency.code,
            maxRedemptions: body.maxRedemptions,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            createdByUserId: admin.sub,
            remark: body.remark,
            campaignName: normalizeNullableText(body.campaignName),
            validUserTierId: body.validUserTierId ?? null,
            subscriptionPlanId:
              body.rewardType === "SUBSCRIPTION"
                ? body.subscriptionPlanId
                : null,
            perUserLimit: body.perUserLimit,
          },
          include: {
            validUserTier: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            subscriptionPlan: {
              include: subscriptionPlanInclude,
            },
          },
        }),
      ),
    );

    return {
      codes: codes.map((code, index) => ({
        ...code,
        code: generated[index]?.code,
      })),
    };
  });

  app.patch("/admin/redeem-codes/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
        remark: z.string().max(500).nullable().optional(),
        campaignName: z.string().trim().max(120).nullable().optional(),
        validUserTierId: z.string().trim().min(1).nullable().optional(),
        subscriptionPlanId: z.string().trim().min(1).nullable().optional(),
        perUserLimit: z.number().int().min(1).max(1000).optional(),
      })
      .parse(request.body);

    const existing = await prisma.redeemCode.findUnique({
      where: { id: params.id },
      select: { maxRedemptions: true },
    });
    if (!existing) {
      throw Object.assign(new Error("Redeem code not found"), {
        statusCode: 404,
      });
    }

    if (body.perUserLimit && body.perUserLimit > existing.maxRedemptions) {
      throw Object.assign(
        new Error("Per-user limit cannot exceed max redemptions"),
        { statusCode: 400 },
      );
    }

    if (body.validUserTierId) {
      const tier = await prisma.accessTier.findUnique({
        where: { id: body.validUserTierId },
        select: { id: true },
      });
      if (!tier) {
        throw Object.assign(new Error("Access tier not found"), {
          statusCode: 404,
        });
      }
    }
    if (body.subscriptionPlanId) {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id: body.subscriptionPlanId },
        select: { id: true },
      });
      if (!plan) {
        throw Object.assign(new Error("Subscription plan not found"), {
          statusCode: 404,
        });
      }
    }

    const code = await prisma.redeemCode.update({
      where: { id: params.id },
      include: {
        validUserTier: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        subscriptionPlan: {
          include: subscriptionPlanInclude,
        },
      },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
        ...(body.remark !== undefined ? { remark: body.remark } : {}),
        ...(body.campaignName !== undefined
          ? { campaignName: normalizeNullableText(body.campaignName) }
          : {}),
        ...(body.validUserTierId !== undefined
          ? { validUserTierId: body.validUserTierId }
          : {}),
        ...(body.subscriptionPlanId !== undefined
          ? { subscriptionPlanId: body.subscriptionPlanId }
          : {}),
        ...(body.perUserLimit !== undefined
          ? { perUserLimit: body.perUserLimit }
          : {}),
      },
    });

    return { code };
  });

  app.get("/admin/model-prices", async () => {
    const modelPrices = await prisma.modelPrice.findMany({
      orderBy: [{ upstreamProvider: "asc" }, { model: "asc" }],
    });
    const unifiedPriceSettings = await listUnifiedPriceSettings(
      modelPrices.map((price) => price.model),
    );

    return { modelPrices, unifiedPriceSettings };
  });

  app.get("/admin/model-prices/export", async (request, reply) => {
    const query = z
      .object({
        format: z.enum(["json", "csv"]).default("json"),
      })
      .parse(request.query);
    const modelPrices = await prisma.modelPrice.findMany({
      orderBy: [{ upstreamProvider: "asc" }, { model: "asc" }],
    });
    const exportedAt = new Date().toISOString();

    if (query.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header(
        "content-disposition",
        `attachment; filename="model-prices-${exportedAt.slice(0, 10)}.csv"`,
      );
      return buildModelPricesCsv(modelPrices);
    }

    reply.header("content-type", "application/json; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="model-prices-${exportedAt.slice(0, 10)}.json"`,
    );
    return {
      exportedAt,
      count: modelPrices.length,
      modelPrices,
    };
  });

  app.post("/admin/model-prices/import", async (request, reply) => {
    const admin = request.user as { sub: string };
    const body = modelPriceImportSchema.parse(request.body);
    const rows =
      body.rows ??
      parseModelPriceImportContent(body.content ?? "", body.format ?? "csv");
    const normalized = normalizeImportedModelPriceRows(rows);
    await annotateImportedModelPriceActions(normalized.rows);

    if (normalized.errors.length > 0) {
      return reply.status(400).send({
        message: "Model price import contains invalid rows",
        errors: normalized.errors,
        preview: normalized.rows.slice(0, 20),
      });
    }

    if (body.dryRun) {
      return {
        dryRun: true,
        summary: {
          rows: normalized.rows.length,
          creates: normalized.rows.filter((row) => row.action === "create")
            .length,
          updates: normalized.rows.filter((row) => row.action === "update")
            .length,
        },
        rows: normalized.rows.slice(0, 100),
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      const modelPrices = [];

      for (const row of normalized.rows) {
        const existing = await tx.modelPrice.findUnique({
          where: {
            upstreamProvider_model: {
              upstreamProvider: row.data.upstreamProvider,
              model: row.data.model,
            },
          },
          select: { id: true },
        });
        const modelPrice = await tx.modelPrice.upsert({
          where: {
            upstreamProvider_model: {
              upstreamProvider: row.data.upstreamProvider,
              model: row.data.model,
            },
          },
          update: {
            ...row.data,
            createdByUserId: admin.sub,
          },
          create: {
            ...row.data,
            createdByUserId: admin.sub,
          },
        });
        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }
        modelPrices.push(modelPrice);
      }

      return { created, updated, modelPrices };
    });

    emitPublicStatusChanged();
    return {
      imported: result.created + result.updated,
      created: result.created,
      updated: result.updated,
      modelPrices: result.modelPrices,
    };
  });

  app.get("/admin/model-pools", async () => {
    const serverNow = new Date();
    const [healthCheckIntervalSeconds, penaltySeconds, successGraceSeconds] =
      await Promise.all([
        getModelPoolHealthCheckIntervalSeconds(),
        getModelPoolPenaltySeconds(),
        getModelPoolSuccessGraceSeconds(),
      ]);
    const [pools, prices, providers, accessTiers, dispatchSettings] =
      await Promise.all([
        prisma.modelPool.findMany({
          orderBy: [{ model: "asc" }, { tier: { sortOrder: "asc" } }],
          include: {
            tier: {
              select: {
                id: true,
                code: true,
                name: true,
                status: true,
              },
            },
            channels: {
              orderBy: [{ upstreamProvider: "asc" }],
            },
          },
        }),
        prisma.modelPrice.findMany({
          orderBy: [{ model: "asc" }, { upstreamProvider: "asc" }],
        }),
        prisma.upstreamProvider.findMany({
          orderBy: [{ priority: "asc" }, { name: "asc" }],
          select: {
            name: true,
            groupName: true,
            status: true,
            priority: true,
            keys: {
              where: { status: "ACTIVE" },
              select: { id: true },
            },
          },
        }),
        prisma.accessTier.findMany({
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, code: true, name: true, status: true },
        }),
        readDispatchSettings(),
      ]);
    const priceMap = new Map(
      prices.map((price) => [
        `${price.upstreamProvider}:${price.model}`,
        price,
      ]),
    );
    const providerMap = new Map(
      providers.map((provider) => [provider.name, provider]),
    );
    const availablePrices = prices.filter(
      (price) =>
        providerMap.has(price.upstreamProvider) &&
        price.upstreamProvider.trim().toLowerCase() !== "default",
    );

    return {
      modelPools: pools.map((pool) => {
        const channels = pool.channels
          .map((channel) => {
            const price = priceMap.get(
              `${channel.upstreamProvider}:${pool.model}`,
            );
            const provider = providerMap.get(channel.upstreamProvider);
            const baseHealthTiming = getModelPoolChannelHealthTiming(
              channel,
              healthCheckIntervalSeconds,
              successGraceSeconds,
              serverNow,
            );
            const healthTiming =
              pool.autoHealthCheckEnabled || channel.status === "PENALIZED"
                ? baseHealthTiming
                : {
                    ...baseHealthTiming,
                    nextCheckAt: null,
                    nextCheckRemainingSeconds: null,
                  };
            const activeKeyCount = provider?.keys.length ?? 0;
            const unavailableReasons = explainAdminChannelUnavailable({
              poolStatus: pool.status,
              tierStatus: pool.tier?.status,
              channelStatus: channel.status,
              providerStatus: provider?.status,
              activeKeyCount,
              hasPrice: Boolean(price),
              priceEnabled: price?.enabled ?? false,
            });
            return {
              ...channel,
              statusLabel: channelStatusLabel(channel.status),
              hasPrice: Boolean(price),
              priceEnabled: price?.enabled ?? false,
              providerStatus: provider?.status ?? "MISSING",
              providerPriority: provider?.priority ?? null,
              providerGroupName: provider?.groupName ?? null,
              activeKeyCount,
              unavailableReasons,
              ...healthTiming,
              effectiveStatus:
                unavailableReasons.length === 0
                  ? channel.status === "FORCED_ACTIVE"
                    ? "FORCED_READY"
                    : "READY"
                  : "UNAVAILABLE",
              effectiveStatusLabel:
                unavailableReasons.length === 0
                  ? channel.status === "FORCED_ACTIVE"
                    ? "强制可用"
                    : "可用"
                  : "不可用",
            };
          })
          .sort(compareModelPoolChannelsForAdmin);

        return {
          ...pool,
          healthCheckEndpoint: normalizeModelPoolHealthCheckEndpoint(
            pool.healthCheckEndpoint,
          ),
          channels,
          readyChannelCount: channels.filter(
            (channel) => channel.effectiveStatus !== "UNAVAILABLE",
          ).length,
          pricedChannelCount: availablePrices.filter(
            (price) => price.model === pool.model,
          ).length,
        };
      }),
      availableChannels: availablePrices.map((price) => ({
        id: price.id,
        model: price.model,
        upstreamProvider: price.upstreamProvider,
        providerGroupName:
          providerMap.get(price.upstreamProvider)?.groupName ?? null,
        priceEnabled: price.enabled,
        providerStatus:
          providerMap.get(price.upstreamProvider)?.status ?? "MISSING",
        activeKeyCount:
          providerMap.get(price.upstreamProvider)?.keys.length ?? 0,
      })),
      accessTiers,
      healthCheck: {
        intervalSeconds: healthCheckIntervalSeconds,
        minIntervalSeconds: minModelPoolHealthCheckIntervalSeconds,
        maxIntervalSeconds: maxModelPoolHealthCheckIntervalSeconds,
        penaltySeconds,
        minPenaltySeconds: minModelPoolPenaltySeconds,
        maxPenaltySeconds: maxModelPoolPenaltySeconds,
        successGraceSeconds,
        minSuccessGraceSeconds: minModelPoolSuccessGraceSeconds,
        maxSuccessGraceSeconds: maxModelPoolSuccessGraceSeconds,
        serverNow: serverNow.toISOString(),
      },
      dispatchSettings,
    };
  });

  app.patch("/admin/model-pools/health-check", async (request) => {
    const body = z
      .object({
        intervalSeconds: z
          .number()
          .int()
          .min(minModelPoolHealthCheckIntervalSeconds)
          .max(maxModelPoolHealthCheckIntervalSeconds)
          .optional(),
        penaltySeconds: z
          .number()
          .int()
          .min(minModelPoolPenaltySeconds)
          .max(maxModelPoolPenaltySeconds)
          .optional(),
        successGraceSeconds: z
          .number()
          .int()
          .min(minModelPoolSuccessGraceSeconds)
          .max(maxModelPoolSuccessGraceSeconds)
          .optional(),
      })
      .parse(request.body);
    const [intervalSeconds, penaltySeconds, successGraceSeconds] =
      await Promise.all([
        body.intervalSeconds === undefined
          ? getModelPoolHealthCheckIntervalSeconds()
          : setModelPoolHealthCheckIntervalSeconds(body.intervalSeconds),
        body.penaltySeconds === undefined
          ? getModelPoolPenaltySeconds()
          : setModelPoolPenaltySeconds(body.penaltySeconds),
        body.successGraceSeconds === undefined
          ? getModelPoolSuccessGraceSeconds()
          : setModelPoolSuccessGraceSeconds(body.successGraceSeconds),
      ]);

    return {
      healthCheck: {
        intervalSeconds,
        minIntervalSeconds: minModelPoolHealthCheckIntervalSeconds,
        maxIntervalSeconds: maxModelPoolHealthCheckIntervalSeconds,
        penaltySeconds,
        minPenaltySeconds: minModelPoolPenaltySeconds,
        maxPenaltySeconds: maxModelPoolPenaltySeconds,
        successGraceSeconds,
        minSuccessGraceSeconds: minModelPoolSuccessGraceSeconds,
        maxSuccessGraceSeconds: maxModelPoolSuccessGraceSeconds,
        serverNow: new Date().toISOString(),
      },
    };
  });

  app.post("/admin/model-pools/copy-standard", async (request, reply) => {
    const body = z
      .object({
        targetTierId: z.string().min(1),
        overwriteExisting: z.boolean().default(false),
      })
      .parse(request.body);
    const standardTier = await ensureStandardAccessTier();

    if (body.targetTierId === standardTier.id) {
      return reply
        .status(400)
        .send({ message: "Target tier must not be the standard tier" });
    }

    const targetTier = await prisma.accessTier.findUnique({
      where: { id: body.targetTierId },
      select: { id: true, code: true, name: true, status: true },
    });

    if (!targetTier) {
      return reply.status(404).send({ message: "Target tier not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const sourcePools = await tx.modelPool.findMany({
        where: { tierId: standardTier.id },
        include: {
          channels: {
            orderBy: [{ upstreamProvider: "asc" }],
          },
        },
        orderBy: { model: "asc" },
      });
      let createdPools = 0;
      let updatedPools = 0;
      let createdChannels = 0;
      let updatedChannels = 0;
      const skippedModels: string[] = [];

      for (const sourcePool of sourcePools) {
        const existing = await tx.modelPool.findUnique({
          where: {
            model_tierId: {
              model: sourcePool.model,
              tierId: targetTier.id,
            },
          },
          include: { channels: true },
        });

        if (existing && !body.overwriteExisting) {
          skippedModels.push(sourcePool.model);
          continue;
        }

        const targetPool = existing
          ? await tx.modelPool.update({
              where: { id: existing.id },
              data: {
                status: sourcePool.status,
                autoHealthCheckEnabled: sourcePool.autoHealthCheckEnabled,
                healthCheckEndpoint: sourcePool.healthCheckEndpoint,
                policyRecoveryEnabled: sourcePool.policyRecoveryEnabled,
              },
            })
          : await tx.modelPool.create({
              data: {
                model: sourcePool.model,
                tierId: targetTier.id,
                status: sourcePool.status,
                autoHealthCheckEnabled: sourcePool.autoHealthCheckEnabled,
                healthCheckEndpoint: sourcePool.healthCheckEndpoint,
                policyRecoveryEnabled: sourcePool.policyRecoveryEnabled,
              },
            });

        if (existing) {
          updatedPools += 1;
        } else {
          createdPools += 1;
        }

        for (const sourceChannel of sourcePool.channels) {
          const channelExists = Boolean(
            existing?.channels.some(
              (channel) =>
                channel.upstreamProvider === sourceChannel.upstreamProvider,
            ),
          );
          await tx.modelPoolChannel.upsert({
            where: {
              modelPoolId_upstreamProvider: {
                modelPoolId: targetPool.id,
                upstreamProvider: sourceChannel.upstreamProvider,
              },
            },
            update: {
              status: sourceChannel.status,
              priority: sourceChannel.priority,
              consecutiveFailures: 0,
              recoverySuccesses: 0,
              penalizedUntil: null,
              penaltyReason: null,
              lastCheckStatus: null,
              lastCheckedAt: null,
              lastSuccessfulCallAt: null,
              lastLatencyMs: null,
              lastFirstTokenLatencyMs: null,
              lastError: null,
            },
            create: {
              modelPoolId: targetPool.id,
              upstreamProvider: sourceChannel.upstreamProvider,
              status: sourceChannel.status,
              priority: sourceChannel.priority,
            },
          });

          if (channelExists) {
            updatedChannels += 1;
          } else {
            createdChannels += 1;
          }
        }
      }

      return {
        sourceTier: standardTier,
        targetTier,
        sourcePools: sourcePools.length,
        createdPools,
        updatedPools,
        createdChannels,
        updatedChannels,
        skippedModels,
      };
    });

    emitPublicStatusChanged();
    return { result };
  });

  app.patch(
    "/admin/model-pool-channels/by-provider",
    async (request, reply) => {
      const body = z
        .object({
          upstreamProvider: z.string().trim().min(1).max(80),
          status: channelStatusSchema,
        })
        .parse(request.body);
      const provider = await prisma.upstreamProvider.findUnique({
        where: { name: body.upstreamProvider },
        select: { name: true },
      });

      if (!provider) {
        return reply
          .status(404)
          .send({ message: "Upstream provider not found" });
      }

      const result = await prisma.modelPoolChannel.updateMany({
        where: {
          upstreamProvider: provider.name,
          ...(body.status === "DISABLED"
            ? { status: { not: "DISABLED" } }
            : {}),
        },
        data: {
          status: body.status,
          ...(body.status === "ACTIVE" || body.status === "FORCED_ACTIVE"
            ? {
                consecutiveFailures: 0,
                recoverySuccesses: 0,
                penalizedUntil: null,
                penaltyReason: null,
              }
            : {}),
        },
      });

      emitPublicStatusChanged();
      return {
        result: {
          upstreamProvider: provider.name,
          status: body.status,
          updatedChannels: result.count,
        },
      };
    },
  );

  app.post("/admin/model-pools/add-provider", async (request, reply) => {
    const body = z
      .object({
        upstreamProvider: z.string().trim().min(1).max(80),
        tierId: z.string().min(1).optional(),
        channelStatus: channelStatusSchema.default("ACTIVE"),
        onlyEnabledPrices: z.boolean().default(true),
      })
      .parse(request.body);
    const [provider, standardTier] = await Promise.all([
      prisma.upstreamProvider.findUnique({
        where: { name: body.upstreamProvider },
        select: { name: true },
      }),
      ensureStandardAccessTier(),
    ]);

    if (!provider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    const tierId = body.tierId ?? standardTier.id;
    const targetTier = await prisma.accessTier.findUnique({
      where: { id: tierId },
      select: { id: true, code: true, name: true, status: true },
    });

    if (!targetTier) {
      return reply.status(404).send({ message: "Target tier not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const prices = await tx.modelPrice.findMany({
        where: {
          upstreamProvider: provider.name,
          ...(body.onlyEnabledPrices ? { enabled: true } : {}),
        },
        select: { model: true },
        orderBy: { model: "asc" },
      });
      const models = Array.from(new Set(prices.map((price) => price.model)));
      let createdPools = 0;
      let existingPools = 0;
      let createdChannels = 0;
      let updatedChannels = 0;

      for (const model of models) {
        const existingPool = await tx.modelPool.findUnique({
          where: {
            model_tierId: {
              model,
              tierId: targetTier.id,
            },
          },
          include: {
            channels: {
              where: { upstreamProvider: provider.name },
              select: { id: true },
            },
          },
        });
        const pool =
          existingPool ??
          (await tx.modelPool.create({
            data: {
              model,
              tierId: targetTier.id,
              status: "ACTIVE",
              autoHealthCheckEnabled: true,
              healthCheckEndpoint: "responses",
            },
          }));

        if (existingPool) {
          existingPools += 1;
        } else {
          createdPools += 1;
        }

        const channelExists = Boolean(existingPool?.channels.length);
        await tx.modelPoolChannel.upsert({
          where: {
            modelPoolId_upstreamProvider: {
              modelPoolId: pool.id,
              upstreamProvider: provider.name,
            },
          },
          update: {
            status: body.channelStatus,
            ...(body.channelStatus === "ACTIVE" ||
            body.channelStatus === "FORCED_ACTIVE"
              ? {
                  consecutiveFailures: 0,
                  recoverySuccesses: 0,
                  penalizedUntil: null,
                  penaltyReason: null,
                }
              : {}),
          },
          create: {
            modelPoolId: pool.id,
            upstreamProvider: provider.name,
            status: body.channelStatus,
          },
        });

        if (channelExists) {
          updatedChannels += 1;
        } else {
          createdChannels += 1;
        }
      }

      return {
        upstreamProvider: provider.name,
        targetTier,
        pricedModels: models.length,
        createdPools,
        existingPools,
        createdChannels,
        updatedChannels,
      };
    });

    emitPublicStatusChanged();
    return { result };
  });

  app.post("/admin/model-pools", async (request, reply) => {
    const body = z
      .object({
        model: z.string().min(1).max(120),
        tierId: z.string().min(1).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
        autoHealthCheckEnabled: z.boolean().default(true),
        healthCheckEndpoint:
          modelPoolHealthCheckEndpointSchema.default("responses"),
        policyRecoveryEnabled: z.boolean().default(false),
      })
      .parse(request.body);
    const standardTier = await ensureStandardAccessTier();
    const tierId = body.tierId ?? standardTier.id;
    const providers = await prisma.upstreamProvider.findMany({
      select: { name: true },
    });
    const priceCount = await prisma.modelPrice.count({
      where: {
        model: body.model,
        upstreamProvider: { in: providers.map((provider) => provider.name) },
      },
    });

    if (priceCount === 0) {
      return reply.status(400).send({
        message:
          "Model must have upstream pricing before it can be added to the pool",
      });
    }

    const pool = await prisma.modelPool.upsert({
      where: {
        model_tierId: {
          model: body.model,
          tierId,
        },
      },
      update: {
        status: body.status,
        autoHealthCheckEnabled: body.autoHealthCheckEnabled,
        healthCheckEndpoint: body.healthCheckEndpoint,
        policyRecoveryEnabled: body.policyRecoveryEnabled,
      },
      create: {
        ...body,
        tierId,
      },
    });

    emitPublicStatusChanged();
    return { modelPool: pool };
  });

  app.patch("/admin/model-pools/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        autoHealthCheckEnabled: z.boolean().optional(),
        healthCheckEndpoint: modelPoolHealthCheckEndpointSchema.optional(),
        policyRecoveryEnabled: z.boolean().optional(),
      })
      .parse(request.body);
    const modelPool = await prisma.modelPool.update({
      where: { id: params.id },
      data: body,
    });

    emitPublicStatusChanged();
    return { modelPool };
  });

  app.delete("/admin/model-pools/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const modelPool = await prisma.modelPool.findUnique({
      where: { id: params.id },
      select: { id: true, model: true },
    });

    if (!modelPool) {
      return reply.status(404).send({ message: "Model pool not found" });
    }

    await prisma.modelPool.delete({
      where: { id: params.id },
    });

    emitPublicStatusChanged();
    return { ok: true, modelPool };
  });

  app.post("/admin/model-pools/:id/channels", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        upstreamProvider: z.string().min(1).max(80),
        status: channelStatusSchema.default("ACTIVE"),
      })
      .parse(request.body);
    const pool = await prisma.modelPool.findUnique({
      where: { id: params.id },
    });

    if (!pool) {
      return reply.status(404).send({ message: "Model pool not found" });
    }

    if (body.upstreamProvider.trim().toLowerCase() === "default") {
      return reply.status(400).send({
        message: "Default upstream cannot be added to the model pool",
      });
    }

    const [provider, price] = await Promise.all([
      prisma.upstreamProvider.findUnique({
        where: { name: body.upstreamProvider },
      }),
      prisma.modelPrice.findUnique({
        where: {
          upstreamProvider_model: {
            upstreamProvider: body.upstreamProvider,
            model: pool.model,
          },
        },
      }),
    ]);

    if (!provider) {
      return reply.status(400).send({
        message:
          "Upstream provider must exist before it can be added to the model pool",
      });
    }

    if (!price) {
      return reply.status(400).send({
        message: "Only priced upstream channels can be added to the model pool",
      });
    }

    const channel = await prisma.modelPoolChannel.upsert({
      where: {
        modelPoolId_upstreamProvider: {
          modelPoolId: pool.id,
          upstreamProvider: body.upstreamProvider,
        },
      },
      update: {
        status: body.status,
      },
      create: {
        modelPoolId: pool.id,
        upstreamProvider: body.upstreamProvider,
        status: body.status,
      },
    });

    emitPublicStatusChanged();
    return { channel };
  });

  app.patch("/admin/model-pool-channels/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: channelStatusSchema.optional(),
        priority: z.number().int().min(1).max(10000).optional(),
      })
      .parse(request.body);
    const channel = await prisma.modelPoolChannel.update({
      where: { id: params.id },
      data: {
        ...body,
        ...(body.status === "ACTIVE" ||
        body.status === "FORCED_ACTIVE" ||
        body.status === "DISABLED"
          ? {
              consecutiveFailures: 0,
              recoverySuccesses: 0,
              penalizedUntil: null,
              penaltyReason: null,
            }
          : {}),
      },
    });

    emitPublicStatusChanged();
    return { channel };
  });

  app.delete("/admin/model-pool-channels/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const channel = await prisma.modelPoolChannel.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!channel) {
      return reply
        .status(404)
        .send({ message: "Model pool channel not found" });
    }

    await prisma.modelPoolChannel.delete({
      where: { id: params.id },
    });

    emitPublicStatusChanged();
    return { ok: true };
  });

  app.post("/admin/model-pool-channels/:id/check", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await checkModelPoolChannel(params.id);

    if (!result) {
      return reply
        .status(404)
        .send({ message: "Model pool channel not found" });
    }

    emitPublicStatusChanged();
    return { result };
  });

  app.post("/admin/model-prices", async (request, reply) => {
    const admin = request.user as { sub: string };
    const body = z
      .object({
        model: z.string().min(1).max(120),
        upstreamProvider: z.string().min(1).max(80).default("default"),
        upstreamEndpoint: upstreamEndpointSchema,
        pricingMode: pricingModeSchema,
        currency: z.string().default("USD"),
        upstreamInputPer1MTok: z.string().or(z.number()),
        upstreamOutputPer1MTok: z.string().or(z.number()),
        upstreamCachedInputPer1MTok: z.string().or(z.number()).default("0"),
        upstreamPriceMultiplier: z.string().or(z.number()).default("1"),
        upstreamPerRequestUsd: z.string().or(z.number()).default("0"),
        customerInputPer1MTok: z.string().or(z.number()),
        customerOutputPer1MTok: z.string().or(z.number()),
        customerCachedInputPer1MTok: z.string().or(z.number()).default("0"),
        customerPriceMultiplier: z.string().or(z.number()).default("1"),
        minimumChargeUsd: z.string().or(z.number()).default("0"),
        perRequestUsd: z.string().or(z.number()).default("0"),
        enabled: z.boolean().default(true),
        priceVersion: priceVersionSchema,
        effectiveFrom: expiresAtSchema,
        effectiveTo: expiresAtSchema,
      })
      .parse(request.body);

    const validityError = validatePriceValidityWindow(
      body.effectiveFrom,
      body.effectiveTo,
    );
    if (validityError) {
      return validityError(reply);
    }

    const modelPrice = await prisma.modelPrice.upsert({
      where: {
        upstreamProvider_model: {
          upstreamProvider: body.upstreamProvider,
          model: body.model,
        },
      },
      update: {
        upstreamProvider: body.upstreamProvider,
        upstreamEndpoint: body.upstreamEndpoint,
        pricingMode: body.pricingMode,
        currency: body.currency,
        upstreamInputPer1MTok: String(body.upstreamInputPer1MTok),
        upstreamOutputPer1MTok: String(body.upstreamOutputPer1MTok),
        upstreamCachedInputPer1MTok: String(body.upstreamCachedInputPer1MTok),
        upstreamPriceMultiplier: String(body.upstreamPriceMultiplier),
        upstreamPerRequestUsd: String(body.upstreamPerRequestUsd),
        customerInputPer1MTok: String(body.customerInputPer1MTok),
        customerOutputPer1MTok: String(body.customerOutputPer1MTok),
        customerCachedInputPer1MTok: String(body.customerCachedInputPer1MTok),
        customerPriceMultiplier: String(body.customerPriceMultiplier),
        minimumChargeUsd: String(body.minimumChargeUsd),
        perRequestUsd: String(body.perRequestUsd),
        enabled: body.enabled,
        priceVersion: body.priceVersion,
        ...(body.effectiveFrom !== undefined
          ? { effectiveFrom: body.effectiveFrom }
          : {}),
        ...(body.effectiveTo !== undefined
          ? { effectiveTo: body.effectiveTo }
          : {}),
        createdByUserId: admin.sub,
      },
      create: {
        model: body.model,
        upstreamProvider: body.upstreamProvider,
        upstreamEndpoint: body.upstreamEndpoint,
        pricingMode: body.pricingMode,
        currency: body.currency,
        upstreamInputPer1MTok: String(body.upstreamInputPer1MTok),
        upstreamOutputPer1MTok: String(body.upstreamOutputPer1MTok),
        upstreamCachedInputPer1MTok: String(body.upstreamCachedInputPer1MTok),
        upstreamPriceMultiplier: String(body.upstreamPriceMultiplier),
        upstreamPerRequestUsd: String(body.upstreamPerRequestUsd),
        customerInputPer1MTok: String(body.customerInputPer1MTok),
        customerOutputPer1MTok: String(body.customerOutputPer1MTok),
        customerCachedInputPer1MTok: String(body.customerCachedInputPer1MTok),
        customerPriceMultiplier: String(body.customerPriceMultiplier),
        minimumChargeUsd: String(body.minimumChargeUsd),
        perRequestUsd: String(body.perRequestUsd),
        enabled: body.enabled,
        priceVersion: body.priceVersion,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        createdByUserId: admin.sub,
      },
    });

    return { modelPrice };
  });

  app.put("/admin/model-prices/unified", async (request) => {
    const body = z
      .object({
        updates: z
          .array(
            z.object({
              model: z.string().min(1).max(120),
              enabled: z.boolean(),
              pricingMode: pricingModeSchema,
              customerInputPer1MTok: z.string().or(z.number()),
              customerCachedInputPer1MTok: z
                .string()
                .or(z.number())
                .default("0"),
              customerOutputPer1MTok: z.string().or(z.number()),
              customerPriceMultiplier: z.string().or(z.number()).default("1"),
              perRequestUsd: z.string().or(z.number()).default("0"),
            }),
          )
          .min(1),
      })
      .parse(request.body);

    const updatesByModel = new Map(
      body.updates.map((update) => [
        update.model,
        {
          model: update.model,
          enabled: update.enabled,
          pricingMode: update.pricingMode,
          customerInputPer1MTok: String(update.customerInputPer1MTok),
          customerCachedInputPer1MTok: String(
            update.customerCachedInputPer1MTok,
          ),
          customerOutputPer1MTok: String(update.customerOutputPer1MTok),
          customerPriceMultiplier: String(update.customerPriceMultiplier),
          perRequestUsd: String(update.perRequestUsd),
        },
      ]),
    );

    const pricedModels = await prisma.modelPrice.findMany({
      where: { model: { in: Array.from(updatesByModel.keys()) } },
      select: { model: true },
    });
    const pricedModelSet = new Set(pricedModels.map((price) => price.model));
    const validUpdates = Array.from(updatesByModel.values()).filter((update) =>
      pricedModelSet.has(update.model),
    );
    const unifiedPriceSettings =
      validUpdates.length > 0
        ? await saveUnifiedPriceSettings(validUpdates)
        : [];

    return {
      updated: validUpdates.length,
      models: validUpdates.length,
      unifiedPriceSettings,
    };
  });

  app.put("/admin/model-prices/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        model: z.string().min(1).max(120).optional(),
        upstreamProvider: z.string().min(1).max(80).optional(),
        upstreamEndpoint: upstreamEndpointSchema.optional(),
        pricingMode: pricingModeSchema.optional(),
        currency: z.string().optional(),
        upstreamInputPer1MTok: z.string().or(z.number()).optional(),
        upstreamOutputPer1MTok: z.string().or(z.number()).optional(),
        upstreamCachedInputPer1MTok: z.string().or(z.number()).optional(),
        upstreamPriceMultiplier: z.string().or(z.number()).optional(),
        upstreamPerRequestUsd: z.string().or(z.number()).optional(),
        customerInputPer1MTok: z.string().or(z.number()).optional(),
        customerOutputPer1MTok: z.string().or(z.number()).optional(),
        customerCachedInputPer1MTok: z.string().or(z.number()).optional(),
        customerPriceMultiplier: z.string().or(z.number()).optional(),
        minimumChargeUsd: z.string().or(z.number()).optional(),
        perRequestUsd: z.string().or(z.number()).optional(),
        enabled: z.boolean().optional(),
        priceVersion: z.string().trim().min(1).max(80).optional(),
        effectiveFrom: expiresAtSchema,
        effectiveTo: expiresAtSchema,
      })
      .parse(request.body);

    const existing = await prisma.modelPrice.findUnique({
      where: { id: params.id },
      select: { effectiveFrom: true, effectiveTo: true },
    });

    if (!existing) {
      return reply.status(404).send({ message: "Model price not found" });
    }

    const nextEffectiveFrom =
      body.effectiveFrom !== undefined
        ? body.effectiveFrom
        : existing.effectiveFrom;
    const nextEffectiveTo =
      body.effectiveTo !== undefined ? body.effectiveTo : existing.effectiveTo;
    const validityError = validatePriceValidityWindow(
      nextEffectiveFrom,
      nextEffectiveTo,
    );
    if (validityError) {
      return validityError(reply);
    }

    const data = buildModelPriceUpdateData(body);

    const modelPrice = await prisma.modelPrice.update({
      where: { id: params.id },
      data,
    });

    return { modelPrice };
  });

  app.delete("/admin/model-prices/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const modelPrice = await prisma.modelPrice.findUnique({
      where: { id: params.id },
      select: { id: true, model: true, upstreamProvider: true },
    });

    if (!modelPrice) {
      return reply.status(404).send({ message: "Model price not found" });
    }

    await prisma.$transaction(async (tx) => {
      const pools = await tx.modelPool.findMany({
        where: { model: modelPrice.model },
        select: { id: true },
      });

      await tx.modelPoolChannel.deleteMany({
        where: {
          modelPoolId: { in: pools.map((pool) => pool.id) },
          upstreamProvider: modelPrice.upstreamProvider,
        },
      });

      await tx.modelPrice.delete({
        where: { id: params.id },
      });
    });

    return { ok: true };
  });

  app.delete("/admin/model-prices/by-model/:model", async (request, reply) => {
    const params = z.object({ model: z.string().min(1) }).parse(request.params);
    const model = decodeURIComponent(params.model).trim();

    if (!model) {
      return reply.status(400).send({ message: "Model is required" });
    }

    const modelPrices = await prisma.modelPrice.findMany({
      where: { model },
      select: { id: true },
    });

    if (modelPrices.length === 0) {
      return reply.status(404).send({ message: "Model prices not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const pools = await tx.modelPool.findMany({
        where: { model },
        select: { id: true },
      });

      const deletedChannels = await tx.modelPoolChannel.deleteMany({
        where: {
          modelPoolId: { in: pools.map((pool) => pool.id) },
        },
      });

      const deletedPrices = await tx.modelPrice.deleteMany({
        where: { model },
      });

      return {
        deletedPrices: deletedPrices.count,
        deletedChannels: deletedChannels.count,
      };
    });

    return { ok: true, model, ...result };
  });

  app.get("/admin/upstream-providers", async () => {
    const providers = await prisma.upstreamProvider.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      include: {
        keys: {
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    return {
      providers: providers.map(maskProviderKey),
    };
  });

  app.get("/admin/upstream-provider-groups", async () => {
    const groups = await prisma.upstreamProviderGroup.findMany({
      orderBy: [{ name: "asc" }],
      include: {
        _count: {
          select: { providers: true },
        },
      },
    });

    return { groups };
  });

  app.post("/admin/upstream-provider-groups", async (request, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
      })
      .parse(request.body);

    try {
      const group = await prisma.upstreamProviderGroup.create({
        data: { name: body.name },
        include: {
          _count: {
            select: { providers: true },
          },
        },
      });
      return reply.status(201).send({ group });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ message: "Upstream group already exists" });
      }
      throw error;
    }
  });

  app.post("/admin/upstream-providers", async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        groupName: z.string().trim().max(80).nullable().optional(),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1),
        priority: z.number().int().min(1).max(10000).default(100),
        timeoutMs: z.number().int().min(5000).max(600000).default(180000),
        compactItemType: compactItemTypeSchema.default("compaction_summary"),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
      })
      .parse(request.body);
    const groupName = normalizeNullableText(body.groupName);
    if (groupName) {
      const group = await prisma.upstreamProviderGroup.findUnique({
        where: { name: groupName },
        select: { name: true },
      });
      if (!group) {
        return reply.status(400).send({ message: "Upstream group not found" });
      }
    }

    const provider = await prisma.upstreamProvider.upsert({
      where: { name: body.name },
      update: {
        ...(body.groupName !== undefined ? { groupName } : {}),
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
        apiKey: body.apiKey,
        priority: body.priority,
        timeoutMs: body.timeoutMs,
        compactItemType: body.compactItemType,
        status: body.status,
      },
      create: {
        ...body,
        groupName,
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
      },
    });

    await ensureDefaultProviderKey(provider);
    invalidateResponseContentFilterUpstreamCache();

    return { provider: maskProviderKey(provider) };
  });

  app.patch("/admin/upstream-providers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        groupName: z.string().trim().max(80).nullable().optional(),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().optional(),
        priority: z.number().int().min(1).max(10000).optional(),
        timeoutMs: z.number().int().min(5000).max(600000).optional(),
        compactItemType: compactItemTypeSchema.optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
      })
      .parse(request.body);
    const groupName = normalizeNullableText(body.groupName);
    if (groupName) {
      const group = await prisma.upstreamProviderGroup.findUnique({
        where: { name: groupName },
        select: { name: true },
      });
      if (!group) {
        return reply.status(400).send({ message: "Upstream group not found" });
      }
    }

    const data = {
      ...body,
      ...(body.groupName !== undefined
        ? { groupName }
        : {}),
      ...(body.baseUrl ? { baseUrl: body.baseUrl.replace(/\/+$/, "") } : {}),
      ...(body.apiKey && body.apiKey.trim().length > 0
        ? { apiKey: body.apiKey.trim() }
        : {}),
    };

    if (body.apiKey !== undefined && body.apiKey.trim().length === 0) {
      delete data.apiKey;
    }

    const existingProvider = await prisma.upstreamProvider.findUnique({
      where: { id: params.id },
      select: { name: true },
    });

    if (!existingProvider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    const provider = await prisma.$transaction(async (tx) => {
      const updatedProvider = await tx.upstreamProvider.update({
        where: { id: params.id },
        data,
      });

      if (body.name && body.name !== existingProvider.name) {
        await tx.modelPrice.deleteMany({
          where: { upstreamProvider: body.name },
        });
        await tx.modelPoolChannel.deleteMany({
          where: { upstreamProvider: body.name },
        });
        await tx.modelPrice.updateMany({
          where: { upstreamProvider: existingProvider.name },
          data: { upstreamProvider: body.name },
        });
        await tx.modelPoolChannel.updateMany({
          where: { upstreamProvider: existingProvider.name },
          data: { upstreamProvider: body.name },
        });
      }

      return updatedProvider;
    });

    if (body.apiKey && body.apiKey.trim().length > 0) {
      await ensureDefaultProviderKey(provider);
    }
    invalidateResponseContentFilterUpstreamCache();

    return { provider: maskProviderKey(provider) };
  });

  app.post("/admin/upstream-providers/:id/keys", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().max(80).optional(),
        key: z.string().min(1),
        status: upstreamProviderKeyStatusSchema.default("ACTIVE"),
        priority: z.number().int().min(1).max(10000).default(100),
        dailyLimitUsd: moneyLimitSchema,
        monthlyLimitUsd: moneyLimitSchema,
        providerRateLimit: z
          .number()
          .int()
          .min(0)
          .max(1000000)
          .nullable()
          .optional(),
      })
      .parse(request.body);
    const provider = await prisma.upstreamProvider.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!provider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    const name =
      body.name?.trim() || (await nextUpstreamProviderKeyName(params.id));
    let key;
    try {
      key = await prisma.upstreamProviderKey.create({
        data: {
          upstreamProviderId: params.id,
          name,
          key: body.key.trim(),
          ...encryptUpstreamKey(body.key.trim()),
          keyPrefix: upstreamKeyPrefix(body.key.trim()),
          status: body.status,
          priority: body.priority,
          dailyLimitUsd: body.dailyLimitUsd,
          monthlyLimitUsd: body.monthlyLimitUsd,
          providerRateLimit: body.providerRateLimit,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({
          message: "Upstream key name already exists for this provider",
        });
      }
      throw error;
    }

    return { key: maskProviderPoolKey(key) };
  });

  app.patch("/admin/upstream-provider-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        key: z.string().optional(),
        status: upstreamProviderKeyStatusSchema.optional(),
        priority: z.number().int().min(1).max(10000).optional(),
        dailyLimitUsd: moneyLimitSchema,
        monthlyLimitUsd: moneyLimitSchema,
        providerRateLimit: z
          .number()
          .int()
          .min(0)
          .max(1000000)
          .nullable()
          .optional(),
        disabledReason: z.string().trim().max(500).nullable().optional(),
        lastErrorCategory: z.string().trim().max(80).nullable().optional(),
      })
      .parse(request.body);
    const existing = await prisma.upstreamProviderKey.findUnique({
      where: { id: params.id },
    });

    if (!existing) {
      return reply.status(404).send({ message: "Upstream key not found" });
    }

    const trimmedKey = body.key?.trim();
    let key;
    try {
      key = await prisma.upstreamProviderKey.update({
        where: { id: params.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(trimmedKey
            ? {
                key: trimmedKey,
                ...encryptUpstreamKey(trimmedKey),
                keyPrefix: upstreamKeyPrefix(trimmedKey),
              }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.dailyLimitUsd !== undefined
            ? { dailyLimitUsd: body.dailyLimitUsd }
            : {}),
          ...(body.monthlyLimitUsd !== undefined
            ? { monthlyLimitUsd: body.monthlyLimitUsd }
            : {}),
          ...(body.providerRateLimit !== undefined
            ? { providerRateLimit: body.providerRateLimit }
            : {}),
          ...(body.disabledReason !== undefined
            ? { disabledReason: normalizeNullableText(body.disabledReason) }
            : {}),
          ...(body.lastErrorCategory !== undefined
            ? {
                lastErrorCategory: normalizeNullableText(
                  body.lastErrorCategory,
                ),
              }
            : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({
          message: "Upstream key name already exists for this provider",
        });
      }
      throw error;
    }

    return { key: maskProviderPoolKey(key) };
  });

  app.delete("/admin/upstream-provider-keys", async (request, reply) => {
    const body = z
      .object({
        ids: z.array(z.string().min(1)).min(1).max(500),
      })
      .parse(request.body);
    const ids = Array.from(new Set(body.ids));
    const keys = await prisma.upstreamProviderKey.findMany({
      where: { id: { in: ids } },
    });

    if (keys.length !== ids.length) {
      return reply
        .status(404)
        .send({ message: "Some upstream keys were not found" });
    }

    await prisma.upstreamProviderKey.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      ok: true,
      count: keys.length,
      keys: keys.map(maskProviderPoolKey),
    };
  });

  app.delete("/admin/upstream-provider-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const key = await prisma.upstreamProviderKey.findUnique({
      where: { id: params.id },
    });

    if (!key) {
      return reply.status(404).send({ message: "Upstream key not found" });
    }

    await prisma.upstreamProviderKey.delete({
      where: { id: params.id },
    });

    return { ok: true, key: maskProviderPoolKey(key) };
  });

  app.delete("/admin/upstream-providers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);

    const provider = await prisma.upstreamProvider.findUnique({
      where: { id: params.id },
    });

    if (!provider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    await prisma.$transaction([
      prisma.modelPoolChannel.deleteMany({
        where: { upstreamProvider: provider.name },
      }),
      prisma.modelPrice.deleteMany({
        where: { upstreamProvider: provider.name },
      }),
      prisma.upstreamProvider.delete({
        where: { id: params.id },
      }),
    ]);
    invalidateResponseContentFilterUpstreamCache();

    return { ok: true, provider: maskProviderKey(provider) };
  });
}

function maskProviderKey<T extends { apiKey: string }>(provider: T) {
  const keys =
    "keys" in provider && Array.isArray(provider.keys)
      ? { keys: provider.keys.map(maskProviderPoolKey) }
      : {};

  return {
    ...provider,
    apiKey: maskUpstreamKeySecret(provider.apiKey),
    ...keys,
  };
}

function maskProviderPoolKey<T extends { key: string }>(key: T) {
  return {
    ...key,
    key: maskUpstreamKeySecret(key.key),
  };
}

async function nextUpstreamProviderKeyName(upstreamProviderId: string) {
  const count = await prisma.upstreamProviderKey.count({
    where: { upstreamProviderId },
  });
  let index = count + 1;

  while (true) {
    const name = `key-${index}`;
    const existing = await prisma.upstreamProviderKey.findUnique({
      where: {
        upstreamProviderId_name: {
          upstreamProviderId,
          name,
        },
      },
      select: { id: true },
    });

    if (!existing) {
      return name;
    }

    index += 1;
  }
}

async function buildSetupWizardStatus() {
  const standardTier = await ensureStandardAccessTier();
  const [
    providers,
    activeProviderKeys,
    enabledPrices,
    standardPools,
    readyStandardChannels,
    users,
    activeApiKeys,
    fundedWallets,
    successfulRequests,
  ] = await Promise.all([
    prisma.upstreamProvider.count({ where: { status: "ACTIVE" } }),
    prisma.upstreamProviderKey.count({ where: { status: "ACTIVE" } }),
    prisma.modelPrice.count({ where: { enabled: true } }),
    prisma.modelPool.count({
      where: { tierId: standardTier.id, status: "ACTIVE" },
    }),
    prisma.modelPoolChannel.count({
      where: {
        status: { in: ["ACTIVE", "FORCED_ACTIVE"] },
        modelPool: { tierId: standardTier.id, status: "ACTIVE" },
      },
    }),
    prisma.user.count({ where: { role: "USER", status: "ACTIVE" } }),
    prisma.apiKey.count({ where: { status: "ACTIVE" } }),
    prisma.wallet.count({ where: { balance: { gt: 0 } } }),
    prisma.apiRequest.count({ where: { status: "SUCCESS" } }),
  ]);
  const steps = [
    {
      id: "provider",
      label: "配置上游 Provider",
      completed: providers > 0,
      detail: `${providers} 个 ACTIVE 上游`,
    },
    {
      id: "provider-key",
      label: "添加上游 Key",
      completed: activeProviderKeys > 0,
      detail: `${activeProviderKeys} 个 ACTIVE Key`,
    },
    {
      id: "model-price",
      label: "配置模型价格",
      completed: enabledPrices > 0,
      detail: `${enabledPrices} 条启用价格`,
    },
    {
      id: "standard-tier",
      label: "确认 standard 等级",
      completed: Boolean(standardTier.id),
      detail: standardTier.code,
    },
    {
      id: "standard-pool",
      label: "创建 standard 模型池",
      completed: standardPools > 0,
      detail: `${standardPools} 个 ACTIVE 池`,
    },
    {
      id: "pool-channel",
      label: "添加模型池渠道",
      completed: readyStandardChannels > 0,
      detail: `${readyStandardChannels} 个可调渠道`,
    },
    {
      id: "user",
      label: "创建用户",
      completed: users > 0,
      detail: `${users} 个 ACTIVE 用户`,
    },
    {
      id: "wallet",
      label: "用户充值",
      completed: fundedWallets > 0,
      detail: `${fundedWallets} 个有余额钱包`,
    },
    {
      id: "api-key",
      label: "创建 API Key",
      completed: activeApiKeys > 0,
      detail: `${activeApiKeys} 个 ACTIVE API Key`,
    },
    {
      id: "test-call",
      label: "完成真实测试调用",
      completed: successfulRequests > 0,
      detail: `${successfulRequests} 条成功请求`,
    },
  ];
  const completed = steps.filter((step) => step.completed).length;

  return {
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    steps,
  };
}

async function withAdminApiKeyUsage<
  T extends { id: string; totalLimitUsd?: unknown },
>(apiKey: T) {
  const usedUsd = await getApiKeyTotalUsageUsd(apiKey.id);
  const totalLimitUsd = apiKey.totalLimitUsd?.toString();
  const remainingUsd =
    totalLimitUsd && Number(totalLimitUsd) > 0
      ? Decimal.max(0, new Decimal(totalLimitUsd).minus(usedUsd)).toFixed(8)
      : null;

  return {
    ...apiKey,
    totalUsedUsd: usedUsd.toFixed(8),
    totalRemainingUsd: remainingUsd,
  };
}

function compareModelPoolChannelsForAdmin(
  left: {
    effectiveStatus: string;
    lastFirstTokenLatencyMs: number | null;
    lastLatencyMs: number | null;
    priority: number;
    upstreamProvider: string;
  },
  right: {
    effectiveStatus: string;
    lastFirstTokenLatencyMs: number | null;
    lastLatencyMs: number | null;
    priority: number;
    upstreamProvider: string;
  },
) {
  return (
    modelPoolChannelAvailabilityRank(left.effectiveStatus) -
      modelPoolChannelAvailabilityRank(right.effectiveStatus) ||
    nullableNumberRank(left.lastFirstTokenLatencyMs) -
      nullableNumberRank(right.lastFirstTokenLatencyMs) ||
    nullableNumberRank(left.lastLatencyMs) -
      nullableNumberRank(right.lastLatencyMs) ||
    left.priority - right.priority ||
    left.upstreamProvider.localeCompare(right.upstreamProvider)
  );
}

function modelPoolChannelAvailabilityRank(status: string) {
  return status === "READY" || status === "FORCED_READY" ? 0 : 1;
}

function channelStatusLabel(status: string) {
  switch (status) {
    case "ACTIVE":
      return "可用";
    case "FORCED_ACTIVE":
      return "强制可用";
    case "DISABLED":
      return "停用";
    case "PENALIZED":
      return "惩罚中";
    case "UNAVAILABLE":
      return "不可用";
    default:
      return status;
  }
}

function nullableNumberRank(value: number | null | undefined) {
  return value ?? Number.MAX_SAFE_INTEGER;
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isValidIpAccessPattern(value: string) {
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    (ipMatchesPattern(trimmed, trimmed) ||
      ipMatchesPattern("127.0.0.1", trimmed))
  );
}

const auditedAdminMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const auditBodySensitiveKeys = new Set([
  "password",
  "passwordHash",
  "token",
  "apiKey",
  "key",
  "keySecret",
  "secret",
  "authorization",
  "charityKey",
]);

async function writeAdminAuditLog(
  request: FastifyRequest,
  responseStatus: number,
  app: FastifyInstance,
) {
  if (
    !auditedAdminMethods.has(request.method) ||
    !request.url.startsWith("/admin/") ||
    request.url.startsWith("/admin/audit-logs")
  ) {
    return;
  }

  const user = request.user as
    | { sub?: string; email?: string; role?: string }
    | undefined;
  const target = parseAuditTarget(request.method, request.url);

  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: user?.sub ?? null,
        adminEmail: user?.email ?? null,
        action: buildAuditAction(request.method, target.targetType),
        method: request.method,
        path: request.url.split("?")[0] ?? request.url,
        targetType: target.targetType,
        targetId: target.targetId,
        requestBody: sanitizeAuditValue(request.body) as Prisma.InputJsonValue,
        responseStatus,
        outcome: responseStatus >= 400 ? "failure" : "success",
        errorMessage:
          responseStatus >= 400
            ? getAuditErrorMessage(
                replyPayloadFromRequest(request),
                responseStatus,
              )
            : null,
        ip: getRequestIp(request),
        userAgent: pickHeaderValue(request.headers["user-agent"]),
      },
    });
  } catch (error) {
    app.log.warn({ error }, "failed to write admin audit log");
  }
}

function replyPayloadFromRequest(request: FastifyRequest) {
  return (request as FastifyRequest & { auditReplyPayload?: unknown })
    .auditReplyPayload;
}

function parseAuditReplyPayload(payload: unknown) {
  if (typeof payload !== "string") {
    return undefined;
  }

  const trimmed = payload.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function getAuditErrorMessage(payload: unknown, responseStatus: number) {
  const message = extractAuditErrorMessage(payload);
  return message ?? `HTTP ${responseStatus}`;
}

function extractAuditErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.message, record.error, record.reason];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 2000);
    }
  }
  return null;
}

function parseAuditTarget(method: string, url: string) {
  const cleanPath = url.split("?")[0] ?? url;
  const segments = cleanPath.split("/").filter(Boolean);
  const resource = segments[1] ?? "admin";
  const id = segments[2];
  const action = segments[3];
  const targetType = action ? `${resource}.${action}` : resource;
  const targetId = id && method !== "POST" ? id : null;
  return { targetType, targetId };
}

function buildAuditAction(method: string, targetType: string | null) {
  const verb =
    method === "POST"
      ? "create"
      : method === "PATCH" || method === "PUT"
        ? "update"
        : method === "DELETE"
          ? "delete"
          : method.toLowerCase();
  return targetType ? `${verb}:${targetType}` : verb;
}

function sanitizeAuditValue(value: unknown): unknown {
  return sanitizeAuditValueAtDepth(value, 0);
}

const maxAuditStringLength = 2000;
const maxAuditArrayItems = 50;
const maxAuditObjectKeys = 120;
const maxAuditDepth = 8;

function sanitizeAuditValueAtDepth(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  if (depth > maxAuditDepth) {
    return "[TRUNCATED_DEPTH]";
  }
  if (typeof value === "string") {
    return truncateAuditString(value);
  }
  if (Array.isArray(value)) {
    const items =
      value.length > maxAuditArrayItems
        ? value.slice(0, maxAuditArrayItems)
        : value;
    const sanitized = items.map((item) =>
      sanitizeAuditValueAtDepth(item, depth + 1),
    );
    return value.length > maxAuditArrayItems
      ? [
          ...sanitized,
          {
            omittedItems: value.length - maxAuditArrayItems,
            reason: "audit_array_truncated",
          },
        ]
      : sanitized;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, child]) => child !== undefined,
    );
    const visibleEntries = entries.slice(0, maxAuditObjectKeys);
    const sanitized = Object.fromEntries(
      visibleEntries.map(([key, child]) => [
        key,
        auditBodySensitiveKeys.has(key.toLowerCase())
          ? "[REDACTED]"
          : sanitizeAuditValueAtDepth(child, depth + 1),
      ]),
    );
    if (entries.length > maxAuditObjectKeys) {
      sanitized.__auditTruncatedKeys = entries.length - maxAuditObjectKeys;
    }
    return sanitized;
  }
  return value;
}

function truncateAuditString(value: string) {
  if (/^data:[^;]+;base64,/.test(value)) {
    return `[REDACTED_DATA_URL length=${value.length}]`;
  }

  if (value.length <= maxAuditStringLength) {
    return value;
  }

  return `${value.slice(0, maxAuditStringLength)}...[truncated ${value.length - maxAuditStringLength} chars]`;
}

function getRequestIp(request: FastifyRequest) {
  return (
    pickHeaderValue(request.headers["cf-connecting-ip"]) ??
    pickHeaderValue(request.headers["x-real-ip"]) ??
    pickHeaderValue(request.headers["x-client-ip"]) ??
    pickHeaderValue(request.headers["true-client-ip"]) ??
    pickForwardedFor(request.headers["x-forwarded-for"]) ??
    request.ip ??
    request.socket.remoteAddress ??
    null
  );
}

function pickHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

function pickForwardedFor(value: string | string[] | undefined) {
  const text = pickHeaderValue(value);
  return text?.split(",")[0]?.trim() || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeUserModelMappings(
  mappings: Array<{ fromModel: string; toModel: string }>,
) {
  const byFromModel = new Map<string, { fromModel: string; toModel: string }>();
  for (const mapping of mappings) {
    const fromModel = mapping.fromModel.trim();
    const toModel = mapping.toModel.trim();
    if (!fromModel || !toModel) {
      continue;
    }
    byFromModel.set(fromModel, { fromModel, toModel });
  }
  return [...byFromModel.values()];
}

function explainAdminChannelUnavailable(params: {
  poolStatus: string;
  tierStatus?: string;
  channelStatus: string;
  providerStatus?: string;
  activeKeyCount: number;
  hasPrice: boolean;
  priceEnabled: boolean;
}) {
  const reasons: string[] = [];
  if (params.tierStatus && params.tierStatus !== "ACTIVE") {
    reasons.push("访问等级未启用");
  }
  if (params.poolStatus !== "ACTIVE") {
    reasons.push("模型池未启用");
  }
  if (!callableChannelStatuses.has(params.channelStatus)) {
    reasons.push(`渠道状态为 ${params.channelStatus}`);
  }
  if (params.providerStatus !== "ACTIVE") {
    reasons.push(
      params.providerStatus
        ? `上游状态为 ${params.providerStatus}`
        : "上游不存在",
    );
  }
  if (params.activeKeyCount <= 0) {
    reasons.push("上游没有 ACTIVE Key");
  }
  if (!params.hasPrice) {
    reasons.push("缺少模型价格");
  } else if (!params.priceEnabled) {
    reasons.push("模型价格未启用");
  }
  return reasons;
}

type ModelPriceBody = {
  model?: string;
  upstreamProvider?: string;
  upstreamEndpoint?: string;
  pricingMode?: string;
  currency?: string;
  upstreamInputPer1MTok?: string | number;
  upstreamOutputPer1MTok?: string | number;
  upstreamCachedInputPer1MTok?: string | number;
  upstreamPriceMultiplier?: string | number;
  upstreamPerRequestUsd?: string | number;
  customerInputPer1MTok?: string | number;
  customerOutputPer1MTok?: string | number;
  customerCachedInputPer1MTok?: string | number;
  customerPriceMultiplier?: string | number;
  minimumChargeUsd?: string | number;
  perRequestUsd?: string | number;
  enabled?: boolean;
  priceVersion?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
};

function buildModelPriceUpdateData(body: ModelPriceBody) {
  return {
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.upstreamProvider !== undefined
      ? { upstreamProvider: body.upstreamProvider }
      : {}),
    ...(body.upstreamEndpoint !== undefined
      ? { upstreamEndpoint: body.upstreamEndpoint }
      : {}),
    ...(body.pricingMode !== undefined
      ? { pricingMode: body.pricingMode }
      : {}),
    ...(body.currency !== undefined ? { currency: body.currency } : {}),
    ...(body.upstreamInputPer1MTok !== undefined
      ? { upstreamInputPer1MTok: String(body.upstreamInputPer1MTok) }
      : {}),
    ...(body.upstreamOutputPer1MTok !== undefined
      ? { upstreamOutputPer1MTok: String(body.upstreamOutputPer1MTok) }
      : {}),
    ...(body.upstreamCachedInputPer1MTok !== undefined
      ? {
          upstreamCachedInputPer1MTok: String(body.upstreamCachedInputPer1MTok),
        }
      : {}),
    ...(body.upstreamPriceMultiplier !== undefined
      ? { upstreamPriceMultiplier: String(body.upstreamPriceMultiplier) }
      : {}),
    ...(body.upstreamPerRequestUsd !== undefined
      ? { upstreamPerRequestUsd: String(body.upstreamPerRequestUsd) }
      : {}),
    ...(body.customerInputPer1MTok !== undefined
      ? { customerInputPer1MTok: String(body.customerInputPer1MTok) }
      : {}),
    ...(body.customerOutputPer1MTok !== undefined
      ? { customerOutputPer1MTok: String(body.customerOutputPer1MTok) }
      : {}),
    ...(body.customerCachedInputPer1MTok !== undefined
      ? {
          customerCachedInputPer1MTok: String(body.customerCachedInputPer1MTok),
        }
      : {}),
    ...(body.customerPriceMultiplier !== undefined
      ? { customerPriceMultiplier: String(body.customerPriceMultiplier) }
      : {}),
    ...(body.minimumChargeUsd !== undefined
      ? { minimumChargeUsd: String(body.minimumChargeUsd) }
      : {}),
    ...(body.perRequestUsd !== undefined
      ? { perRequestUsd: String(body.perRequestUsd) }
      : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.priceVersion !== undefined
      ? { priceVersion: body.priceVersion.trim() }
      : {}),
    ...(body.effectiveFrom !== undefined
      ? { effectiveFrom: body.effectiveFrom }
      : {}),
    ...(body.effectiveTo !== undefined
      ? { effectiveTo: body.effectiveTo }
      : {}),
  };
}

function validatePriceValidityWindow(
  effectiveFrom: Date | null | undefined,
  effectiveTo: Date | null | undefined,
) {
  if (
    effectiveFrom &&
    effectiveTo &&
    effectiveFrom.getTime() >= effectiveTo.getTime()
  ) {
    return (reply: FastifyReply) =>
      reply.status(400).send({
        message: "Price effectiveTo must be later than effectiveFrom",
      });
  }

  return null;
}

type ModelPriceExportRow = {
  id: string;
  model: string;
  upstreamProvider: string;
  upstreamEndpoint: string;
  pricingMode: string;
  currency: string;
  upstreamInputPer1MTok: Decimal;
  upstreamCachedInputPer1MTok: Decimal;
  upstreamOutputPer1MTok: Decimal;
  upstreamPriceMultiplier: Decimal;
  upstreamPerRequestUsd: Decimal;
  customerInputPer1MTok: Decimal;
  customerCachedInputPer1MTok: Decimal;
  customerOutputPer1MTok: Decimal;
  customerPriceMultiplier: Decimal;
  minimumChargeUsd: Decimal;
  perRequestUsd: Decimal;
  enabled: boolean;
  priceVersion: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RedeemCodeExportRow = Prisma.RedeemCodeGetPayload<{
  include: {
    validUserTier: {
      select: {
        id: true;
        code: true;
        name: true;
      };
    };
    redemptions: {
      include: {
        user: {
          select: {
            id: true;
            email: true;
          };
        };
      };
    };
  };
}>;

function buildRedeemCodesCsv(codes: RedeemCodeExportRow[]) {
  const header = [
    "id",
    "codePrefix",
    "amount",
    "currency",
    "status",
    "maxRedemptions",
    "redeemedCount",
    "campaignName",
    "validUserTier",
    "perUserLimit",
    "expiresAt",
    "remark",
    "createdAt",
    "redemptionCount",
    "redemptionUsers",
    "lastRedeemedAt",
  ];
  const rows = codes.map((code) => [
    code.id,
    code.codePrefix,
    code.amount.toString(),
    code.currency,
    code.status,
    String(code.maxRedemptions),
    String(code.redeemedCount),
    code.campaignName ?? "",
    code.validUserTier
      ? `${code.validUserTier.name} (${code.validUserTier.code})`
      : "",
    String(code.perUserLimit),
    code.expiresAt?.toISOString() ?? "",
    code.remark ?? "",
    code.createdAt.toISOString(),
    String(code.redemptions.length),
    code.redemptions
      .map((redemption) => redemption.user.email)
      .filter(Boolean)
      .join("; "),
    code.redemptions[0]?.createdAt.toISOString() ?? "",
  ]);

  return `${[header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}

function buildModelPricesCsv(modelPrices: ModelPriceExportRow[]) {
  const headers = [
    "id",
    "model",
    "upstreamProvider",
    "upstreamEndpoint",
    "pricingMode",
    "currency",
    "upstreamInputPer1MTok",
    "upstreamCachedInputPer1MTok",
    "upstreamOutputPer1MTok",
    "upstreamPriceMultiplier",
    "upstreamPerRequestUsd",
    "customerInputPer1MTok",
    "customerCachedInputPer1MTok",
    "customerOutputPer1MTok",
    "customerPriceMultiplier",
    "minimumChargeUsd",
    "perRequestUsd",
    "enabled",
    "priceVersion",
    "effectiveFrom",
    "effectiveTo",
    "createdByUserId",
    "createdAt",
    "updatedAt",
  ];
  const rows = modelPrices.map((price) => [
    price.id,
    price.model,
    price.upstreamProvider,
    price.upstreamEndpoint,
    price.pricingMode,
    price.currency,
    price.upstreamInputPer1MTok.toString(),
    price.upstreamCachedInputPer1MTok.toString(),
    price.upstreamOutputPer1MTok.toString(),
    price.upstreamPriceMultiplier.toString(),
    price.upstreamPerRequestUsd.toString(),
    price.customerInputPer1MTok.toString(),
    price.customerCachedInputPer1MTok.toString(),
    price.customerOutputPer1MTok.toString(),
    price.customerPriceMultiplier.toString(),
    price.minimumChargeUsd.toString(),
    price.perRequestUsd.toString(),
    String(price.enabled),
    price.priceVersion,
    price.effectiveFrom?.toISOString() ?? "",
    price.effectiveTo?.toISOString() ?? "",
    price.createdByUserId ?? "",
    price.createdAt.toISOString(),
    price.updatedAt.toISOString(),
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

type ImportedModelPriceData = Prisma.ModelPriceUncheckedCreateInput & {
  model: string;
  upstreamProvider: string;
};

function parseModelPriceImportContent(content: string, format: "json" | "csv") {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (format === "json") {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed) ? parsed : asRecord(parsed)?.modelPrices;
    if (!Array.isArray(rows)) {
      throw Object.assign(
        new Error("JSON import must be an array or { modelPrices: [...] }"),
        { statusCode: 400 },
      );
    }
    return rows.map((row) => asStringRecord(row));
  }

  return parseCsvRows(trimmed);
}

function parseCsvRows(content: string) {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  return rows.slice(1).flatMap((row) => {
    if (row.every((cell) => !cell.trim())) {
      return [];
    }
    return [
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? ""]),
      ),
    ];
  });
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeImportedModelPriceRows(rows: Record<string, unknown>[]) {
  const errors: Array<{ row: number; message: string }> = [];
  const normalizedRows: Array<{
    action: "create" | "update";
    data: ImportedModelPriceData;
  }> = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    try {
      const data = normalizeImportedModelPriceRow(row);
      const key = `${data.upstreamProvider}:${data.model}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate row for ${key}`);
      }
      seen.add(key);
      normalizedRows.push({ action: "update", data });
    } catch (error) {
      errors.push({
        row: index + 1,
        message: error instanceof Error ? error.message : "Invalid row",
      });
    }
  });

  return { rows: normalizedRows, errors };
}

async function annotateImportedModelPriceActions(
  rows: Array<{ action: "create" | "update"; data: ImportedModelPriceData }>,
) {
  if (rows.length === 0) {
    return;
  }

  const existing = await prisma.modelPrice.findMany({
    where: {
      OR: rows.map((row) => ({
        upstreamProvider: row.data.upstreamProvider,
        model: row.data.model,
      })),
    },
    select: { model: true, upstreamProvider: true },
  });
  const existingKeys = new Set(
    existing.map((price) => `${price.upstreamProvider}:${price.model}`),
  );

  for (const row of rows) {
    row.action = existingKeys.has(
      `${row.data.upstreamProvider}:${row.data.model}`,
    )
      ? "update"
      : "create";
  }
}

function normalizeImportedModelPriceRow(row: Record<string, unknown>) {
  const model = readImportString(row, "model", true);
  const upstreamProvider =
    readImportString(row, "upstreamProvider", true) ?? "default";
  const effectiveFrom = parseOptionalImportDate(
    readImportString(row, "effectiveFrom", false),
  );
  const effectiveTo = parseOptionalImportDate(
    readImportString(row, "effectiveTo", false),
  );

  if (effectiveFrom && effectiveTo && effectiveFrom >= effectiveTo) {
    throw new Error("effectiveTo must be later than effectiveFrom");
  }

  return {
    model,
    upstreamProvider,
    upstreamEndpoint: readImportUpstreamEndpoint(row),
    pricingMode: readImportPricingMode(row),
    currency: readImportString(row, "currency", false) || "USD",
    upstreamInputPer1MTok: readImportDecimal(row, "upstreamInputPer1MTok"),
    upstreamCachedInputPer1MTok: readImportDecimal(
      row,
      "upstreamCachedInputPer1MTok",
      "0",
    ),
    upstreamOutputPer1MTok: readImportDecimal(row, "upstreamOutputPer1MTok"),
    upstreamPriceMultiplier: readImportDecimal(
      row,
      "upstreamPriceMultiplier",
      "1",
    ),
    upstreamPerRequestUsd: readImportDecimal(row, "upstreamPerRequestUsd", "0"),
    customerInputPer1MTok: readImportDecimal(row, "customerInputPer1MTok"),
    customerCachedInputPer1MTok: readImportDecimal(
      row,
      "customerCachedInputPer1MTok",
      "0",
    ),
    customerOutputPer1MTok: readImportDecimal(row, "customerOutputPer1MTok"),
    customerPriceMultiplier: readImportDecimal(
      row,
      "customerPriceMultiplier",
      "1",
    ),
    minimumChargeUsd: readImportDecimal(row, "minimumChargeUsd", "0"),
    perRequestUsd: readImportDecimal(row, "perRequestUsd", "0"),
    enabled: readImportBoolean(row, "enabled", true),
    priceVersion: readImportString(row, "priceVersion", false) || "v1",
    effectiveFrom,
    effectiveTo,
  } satisfies ImportedModelPriceData;
}

function readImportUpstreamEndpoint(row: Record<string, unknown>) {
  const value = readImportString(row, "upstreamEndpoint", false) || "responses";
  if (
    value === "responses" ||
    value === "chat_completions" ||
    value === "images_generations"
  ) {
    return value;
  }

  throw new Error(
    "upstreamEndpoint must be responses, chat_completions or images_generations",
  );
}

function readImportPricingMode(row: Record<string, unknown>) {
  const value = readImportString(row, "pricingMode", false) || "token";
  if (value === "token" || value === "request") {
    return value;
  }

  throw new Error("pricingMode must be token or request");
}

function asStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Each import row must be an object"), {
      statusCode: 400,
    });
  }
  return value as Record<string, unknown>;
}

function readImportString(
  row: Record<string, unknown>,
  key: string,
  required: true,
): string;
function readImportString(
  row: Record<string, unknown>,
  key: string,
  required: false,
): string | null;
function readImportString(
  row: Record<string, unknown>,
  key: string,
  required: boolean,
) {
  const value = row[key];
  const text =
    value === null || value === undefined ? "" : String(value).trim();
  if (!text && required) {
    throw new Error(`${key} is required`);
  }
  return text || null;
}

function readImportDecimal(
  row: Record<string, unknown>,
  key: string,
  fallback?: string,
) {
  const raw = row[key];
  const value =
    raw === null || raw === undefined || String(raw).trim() === ""
      ? fallback
      : String(raw).trim();
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lt(0)) {
    throw new Error(`${key} must be a non-negative number`);
  }
  return decimal.toFixed(8);
}

function readImportBoolean(
  row: Record<string, unknown>,
  key: string,
  fallback: boolean,
) {
  const raw = row[key];
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return fallback;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "active", "enabled"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "disabled"].includes(normalized)) {
    return false;
  }
  throw new Error(`${key} must be boolean`);
}

function parseOptionalImportDate(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }
  return date;
}

function escapeCsvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function ipPatternsOverlap(left?: string | null, right?: string | null) {
  if (!left || !right) {
    return false;
  }
  const leftRange = parseIpv4Range(left);
  const rightRange = parseIpv4Range(right);
  if (!leftRange || !rightRange) {
    return left.trim() === right.trim();
  }
  return leftRange.start <= rightRange.end && rightRange.start <= leftRange.end;
}

function parseIpv4Range(pattern: string) {
  const normalized = pattern.trim();
  const [ip, prefixText] = normalized.includes("/")
    ? normalized.split("/")
    : [normalized, "32"];
  const bytes = parseIpv4Bytes(ip ?? "");
  const prefix = Number(prefixText);
  if (!bytes || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }
  const value = ipv4BytesToNumber(bytes);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = value & mask;
  const size = 2 ** (32 - prefix);
  return { start, end: start + size - 1 };
}

function parseIpv4Bytes(value: string) {
  const parts = value.trim().split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => Number(part));
  if (
    bytes.some(
      (byte, index) =>
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255 ||
        String(byte) !== parts[index],
    )
  ) {
    return null;
  }
  return bytes;
}

function ipv4BytesToNumber(bytes: number[]) {
  return (
    (((bytes[0] ?? 0) << 24) |
      ((bytes[1] ?? 0) << 16) |
      ((bytes[2] ?? 0) << 8) |
      (bytes[3] ?? 0)) >>>
    0
  );
}

function isValidIpPattern(pattern: string) {
  if (!pattern.includes("/")) {
    return ipMatchesPattern(pattern, pattern);
  }

  const [ip, prefix] = pattern.split("/");
  return (
    ipMatchesPattern(ip ?? "", pattern) &&
    Number.isInteger(Number(prefix)) &&
    Number(prefix) >= 0 &&
    Number(prefix) <= 32
  );
}
