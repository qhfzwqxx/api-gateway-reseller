import type { FastifyInstance } from "fastify";
import {
  readRedisFailurePolicySettings,
  shouldAllowWhenRedisFails,
} from "./redis-failure-policy-settings.js";
import {
  renderGatewayNoticeTemplate,
  type GatewayNoticeSettings,
} from "./gateway-notice-settings.js";

export type GatewayRequestLimitLock =
  | {
      ok: true;
      release: () => Promise<void>;
    }
  | {
      ok: false;
      noticeText: string;
      redisFailure?: boolean;
      release: () => Promise<void>;
    };

type GatewayConcurrencyLock =
  | {
      ok: true;
      release: () => Promise<void>;
    }
  | {
      ok: false;
      layer: "user" | "key" | "tier";
      limit: number;
      redisFailure?: boolean;
      noticeText?: string;
      release: () => Promise<void>;
    };

type GatewayRateLimitResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      layer: "user" | "key" | "tier" | "charity_ip";
      limit: number;
      retryAfterSeconds: number;
    }
  | {
      ok: false;
      redisFailure: true;
      noticeText: string;
    };

export function createNoopConcurrencyLock(): GatewayRequestLimitLock {
  return {
    ok: true,
    release: async () => {},
  };
}

export async function checkNewRequestLimits(
  app: FastifyInstance,
  params: {
    userId: string;
    userConcurrencyLimit: number;
    userRateLimitPerMinute: number;
    apiKeyId: string;
    apiKeyConcurrencyLimit: number;
    apiKeyRateLimitPerMinute: number;
    accessTierId: string | null;
    tierConcurrencyLimit: number;
    tierRateLimitPerMinute: number;
    charityIpRateLimitEnabled: boolean;
    charityIpRateLimitPerMinute: number;
    clientIp: string | null;
    userRole?: string | null;
    noticeSettings: GatewayNoticeSettings;
  },
): Promise<GatewayRequestLimitLock> {
  const concurrencyLock = await acquireGatewayConcurrency(app, params);
  if (!concurrencyLock.ok) {
    return {
      ok: false,
      noticeText:
        concurrencyLock.noticeText ??
        concurrencyNotice(
          concurrencyLock.layer,
          concurrencyLock.limit,
          params.noticeSettings,
        ),
      redisFailure: concurrencyLock.redisFailure,
      release: concurrencyLock.release,
    };
  }

  const rateLimit = await checkGatewayRateLimit(app, params);
  if (!rateLimit.ok) {
    await concurrencyLock.release();
    if ("redisFailure" in rateLimit) {
      return {
        ok: false,
        noticeText: rateLimit.noticeText,
        redisFailure: true,
        release: async () => {},
      };
    }

    return {
      ok: false,
      noticeText: rateLimitNotice(
        rateLimit.layer,
        rateLimit.limit,
        rateLimit.retryAfterSeconds,
        params.noticeSettings,
      ),
      release: async () => {},
    };
  }

  return concurrencyLock;
}

async function acquireGatewayConcurrency(
  app: FastifyInstance,
  params: {
    userId: string;
    userConcurrencyLimit: number;
    apiKeyId: string;
    apiKeyConcurrencyLimit: number;
    accessTierId: string | null;
    tierConcurrencyLimit: number;
    userRole?: string | null;
  },
): Promise<GatewayConcurrencyLock> {
  const userLock = await acquireConcurrencySlot(app, {
    layer: "user",
    key: `concurrency:user:${params.userId}`,
    limit: params.userConcurrencyLimit,
    logContext: { userId: params.userId, layer: "user" },
    principal: { userId: params.userId, userRole: params.userRole },
  });

  if (!userLock.ok) {
    return {
      ok: false,
      layer: "user",
      limit: params.userConcurrencyLimit,
      redisFailure: userLock.redisFailure,
      noticeText: userLock.noticeText,
      release: userLock.release,
    };
  }

  const apiKeyLock = await acquireConcurrencySlot(app, {
    layer: "key",
    key: `concurrency:${params.apiKeyId}`,
    limit: params.apiKeyConcurrencyLimit,
    logContext: { apiKeyId: params.apiKeyId, layer: "key" },
    principal: { userId: params.userId, userRole: params.userRole },
  });

  if (!apiKeyLock.ok) {
    await userLock.release();
    return {
      ok: false,
      layer: "key",
      limit: params.apiKeyConcurrencyLimit,
      redisFailure: apiKeyLock.redisFailure,
      noticeText: apiKeyLock.noticeText,
      release: apiKeyLock.release,
    };
  }

  const tierLock = await acquireConcurrencySlot(app, {
    layer: "tier",
    key: `concurrency:user-tier:${params.userId}:${params.accessTierId ?? "none"}`,
    limit: params.accessTierId ? params.tierConcurrencyLimit : 0,
    logContext: {
      userId: params.userId,
      accessTierId: params.accessTierId,
      layer: "tier",
    },
    principal: { userId: params.userId, userRole: params.userRole },
  });

  if (!tierLock.ok) {
    await Promise.all([apiKeyLock.release(), userLock.release()]);
    return {
      ok: false,
      layer: "tier",
      limit: params.tierConcurrencyLimit,
      redisFailure: tierLock.redisFailure,
      noticeText: tierLock.noticeText,
      release: tierLock.release,
    };
  }

  return {
    ok: true,
    release: async () => {
      await Promise.all([
        tierLock.release(),
        apiKeyLock.release(),
        userLock.release(),
      ]);
    },
  };
}

async function acquireConcurrencySlot(
  app: FastifyInstance,
  params: {
    layer: "user" | "key" | "tier";
    key: string;
    limit: number;
    logContext: Record<string, unknown>;
    principal: { userId: string; userRole?: string | null };
  },
): Promise<GatewayConcurrencyLock> {
  const { layer, key, limit, logContext, principal } = params;
  if (limit <= 0) {
    return {
      ok: true as const,
      release: async () => {},
    };
  }

  try {
    const count = await app.redis.incr(key);
    if (count === 1) {
      await app.redis.expire(key, 120);
    }

    if (count > limit) {
      await app.redis.decr(key);
      return {
        ok: false as const,
        layer,
        limit,
        release: async () => {},
      };
    }

    let released = false;
    const refreshTtl = setInterval(() => {
      void app.redis.expire(key, 120).catch((error: unknown) => {
        app.log.warn(
          { error, ...logContext },
          "Failed to refresh gateway concurrency lock",
        );
      });
    }, 30_000);
    return {
      ok: true as const,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        clearInterval(refreshTtl);
        try {
          const current = await app.redis.decr(key);
          if (current <= 0) {
            await app.redis.del(key);
          }
        } catch (error) {
          app.log.warn(
            { error, ...logContext },
            "Failed to release gateway concurrency slot",
          );
        }
      },
    };
  } catch (error) {
    const failureDecision = await decideRedisFailure(app, error, {
      ...logContext,
      component: "concurrency",
      principal,
    });
    app.log.warn(
      { error, ...logContext, policy: failureDecision.policy },
      failureDecision.allow
        ? "Redis concurrency check failed, allowing request"
        : "Redis concurrency check failed, rejecting request",
    );
    if (!failureDecision.allow) {
      return {
        ok: false as const,
        layer,
        limit,
        redisFailure: true,
        noticeText: failureDecision.noticeText,
        release: async () => {},
      };
    }
    return {
      ok: true as const,
      release: async () => {},
    };
  }
}

async function checkGatewayRateLimit(
  app: FastifyInstance,
  params: {
    userId: string;
    userRateLimitPerMinute: number;
    apiKeyId: string;
    apiKeyRateLimitPerMinute: number;
    accessTierId: string | null;
    tierRateLimitPerMinute: number;
    charityIpRateLimitEnabled: boolean;
    charityIpRateLimitPerMinute: number;
    clientIp: string | null;
    userRole?: string | null;
  },
): Promise<GatewayRateLimitResult> {
  const userLimit = normalizeRuntimeLimit(params.userRateLimitPerMinute);
  const apiKeyLimit = normalizeRuntimeLimit(params.apiKeyRateLimitPerMinute);
  const tierLimit = params.accessTierId
    ? normalizeRuntimeLimit(params.tierRateLimitPerMinute)
    : 0;
  const charityIpLimit = params.charityIpRateLimitEnabled
    ? normalizeRuntimeLimit(params.charityIpRateLimitPerMinute)
    : 0;
  const clientIp = params.clientIp?.trim() || "unknown";

  if (
    userLimit <= 0 &&
    apiKeyLimit <= 0 &&
    tierLimit <= 0 &&
    charityIpLimit <= 0
  ) {
    return { ok: true };
  }

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const retryAfterSeconds = secondsUntilNextMinute(now);

  try {
    const result = await app.redis.eval(
      `
      local userLimit = tonumber(ARGV[1]) or 0
      local keyLimit = tonumber(ARGV[2]) or 0
      local tierLimit = tonumber(ARGV[3]) or 0
      local charityIpLimit = tonumber(ARGV[4]) or 0
      local ttl = tonumber(ARGV[5]) or 70
      local userCurrent = 0
      local keyCurrent = 0
      local tierCurrent = 0
      local charityIpCurrent = 0

      if userLimit > 0 then
        userCurrent = tonumber(redis.call("GET", KEYS[1]) or "0") or 0
        if userCurrent >= userLimit then
          return {0, "user", userLimit}
        end
      end

      if keyLimit > 0 then
        keyCurrent = tonumber(redis.call("GET", KEYS[2]) or "0") or 0
        if keyCurrent >= keyLimit then
          return {0, "key", keyLimit}
        end
      end

      if tierLimit > 0 then
        tierCurrent = tonumber(redis.call("GET", KEYS[3]) or "0") or 0
        if tierCurrent >= tierLimit then
          return {0, "tier", tierLimit}
        end
      end

      if charityIpLimit > 0 then
        charityIpCurrent = tonumber(redis.call("GET", KEYS[4]) or "0") or 0
        if charityIpCurrent >= charityIpLimit then
          return {0, "charity_ip", charityIpLimit}
        end
      end

      if userLimit > 0 then
        redis.call("INCR", KEYS[1])
        redis.call("EXPIRE", KEYS[1], ttl)
      end

      if keyLimit > 0 then
        redis.call("INCR", KEYS[2])
        redis.call("EXPIRE", KEYS[2], ttl)
      end

      if tierLimit > 0 then
        redis.call("INCR", KEYS[3])
        redis.call("EXPIRE", KEYS[3], ttl)
      end

      if charityIpLimit > 0 then
        redis.call("INCR", KEYS[4])
        redis.call("EXPIRE", KEYS[4], ttl)
      end

      return {1, "", 0}
      `,
      4,
      `ratelimit:user:${params.userId}:${minuteBucket}`,
      `ratelimit:${params.apiKeyId}:${minuteBucket}`,
      `ratelimit:user-tier:${params.userId}:${params.accessTierId ?? "none"}:${minuteBucket}`,
      `ratelimit:charity-ip:${params.userId}:${clientIp}:${minuteBucket}`,
      userLimit,
      apiKeyLimit,
      tierLimit,
      charityIpLimit,
      70,
    );

    if (!Array.isArray(result)) {
      return { ok: true };
    }

    const [allowed, layer, limit] = result;
    if (Number(allowed) === 1) {
      return { ok: true };
    }

    const limitedLayer =
      layer === "user" || layer === "tier" || layer === "charity_ip"
        ? layer
        : "key";
    const numericLimit = Number(limit);
    const fallbackLimit =
      limitedLayer === "user"
        ? userLimit
        : limitedLayer === "tier"
          ? tierLimit
          : limitedLayer === "charity_ip"
            ? charityIpLimit
            : apiKeyLimit;
    return {
      ok: false,
      layer: limitedLayer,
      limit:
        Number.isFinite(numericLimit) && numericLimit > 0
          ? numericLimit
          : fallbackLimit,
      retryAfterSeconds,
    };
  } catch (error) {
    const failureDecision = await decideRedisFailure(app, error, {
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      accessTierId: params.accessTierId,
      component: "rate_limit",
      principal: { userId: params.userId, userRole: params.userRole },
    });
    app.log.warn(
      {
        error,
        userId: params.userId,
        apiKeyId: params.apiKeyId,
        accessTierId: params.accessTierId,
        policy: failureDecision.policy,
      },
      failureDecision.allow
        ? "Redis gateway rate limit check failed, allowing request"
        : "Redis gateway rate limit check failed, rejecting request",
    );
    if (!failureDecision.allow) {
      return {
        ok: false,
        redisFailure: true,
        noticeText: failureDecision.noticeText,
      };
    }
    return { ok: true };
  }
}

async function decideRedisFailure(
  app: FastifyInstance,
  error: unknown,
  context: {
    principal: { userId: string; userRole?: string | null };
    [key: string]: unknown;
  },
) {
  const settings = await readRedisFailurePolicySettings();
  const allow = shouldAllowWhenRedisFails(settings, context.principal);
  app.log.warn(
    { error, ...context, policy: settings.policy, allow },
    "Applied Redis failure policy",
  );
  return {
    allow,
    policy: settings.policy,
    noticeText: settings.message,
  };
}

function normalizeRuntimeLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function secondsUntilNextMinute(now: number) {
  return Math.max(1, 60 - (Math.floor(now / 1000) % 60));
}

function concurrencyNotice(
  layer: "user" | "key" | "tier",
  limit: number,
  settings: GatewayNoticeSettings,
) {
  return renderGatewayNoticeTemplate(
    layer === "user"
      ? settings.userConcurrencyMessage
      : layer === "tier"
        ? settings.tierConcurrencyMessage
        : settings.keyConcurrencyMessage,
    { limit },
  );
}

function rateLimitNotice(
  layer: "user" | "key" | "tier" | "charity_ip",
  limit: number,
  retryAfterSeconds: number,
  settings: GatewayNoticeSettings,
) {
  const template =
    layer === "user"
      ? settings.userRateLimitMessage
      : layer === "tier"
        ? settings.tierRateLimitMessage
        : layer === "charity_ip"
          ? settings.charityIpRateLimitMessage
          : settings.keyRateLimitMessage;
  return renderGatewayNoticeTemplate(template, {
    limit,
    seconds: retryAfterSeconds,
  });
}
