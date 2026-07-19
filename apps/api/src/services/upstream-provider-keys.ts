import { prisma, type UpstreamProvider, type UpstreamProviderKey } from "@gateway/db";
import { redis } from "../lib/redis.js";
import { getStickyProviderKeyOccupancies } from "./model-pool-stickiness.js";
import {
  encryptUpstreamKey,
  resolveStoredUpstreamKey,
} from "./upstream-key-encryption.js";
import type { RoutingKeyCandidateTrace } from "./routing/decision-trace.js";
import { readDispatchSettings } from "./dispatch-settings.js";

const initialProviderKeyName = "key-1";

export type UpstreamKeyReservation = {
  key: Pick<
    UpstreamProviderKey,
    | "id"
    | "upstreamProviderId"
    | "name"
    | "key"
    | "keyPrefix"
    | "status"
    | "priority"
    | "lastUsedAt"
    | "lastCheckStatus"
    | "lastCheckedAt"
    | "lastError"
    | "createdAt"
    | "updatedAt"
  >;
  release: () => Promise<void>;
  decisionTrace?: {
    selectedBy: "preferred" | "balanced" | "fallback";
    candidates: RoutingKeyCandidateTrace[];
  };
};

const keyInflightTtlSeconds = 180;
const refreshKeyInflightTtlMs = 30_000;

export function maskUpstreamKeySecret(secret: string) {
  if (!secret) {
    return "-";
  }

  const visibleStart = secret.slice(0, Math.min(7, secret.length));
  const visibleEnd = secret.length > 10 ? secret.slice(-4) : "";
  return `${visibleStart}${visibleEnd ? `...${visibleEnd}` : ""}`;
}

export function upstreamKeyPrefix(secret: string) {
  return secret.slice(0, Math.min(12, secret.length));
}

export function formatUpstreamKeyLabel(key: Pick<UpstreamProviderKey, "name" | "keyPrefix">) {
  const name = key.name === "默认 Key" ? initialProviderKeyName : key.name;
  return `${name} (${key.keyPrefix})`;
}

export function upstreamKeyInflightKey(keyId: string) {
  return `upstream-provider-key:inflight:${keyId}`;
}

export async function ensureDefaultProviderKey(
  provider: Pick<UpstreamProvider, "id" | "apiKey" | "status">,
) {
  if (!provider.apiKey.trim()) {
    return null;
  }

  const key = await prisma.upstreamProviderKey.findFirst({
    where: {
      upstreamProviderId: provider.id,
      key: provider.apiKey,
    },
  });

  if (key) {
    return key;
  }

  return prisma.upstreamProviderKey.upsert({
    where: {
      upstreamProviderId_name: {
        upstreamProviderId: provider.id,
        name: initialProviderKeyName,
      },
    },
    update: {
      key: provider.apiKey,
      ...encryptUpstreamKey(provider.apiKey),
      keyPrefix: upstreamKeyPrefix(provider.apiKey),
      status: provider.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
    },
    create: {
      upstreamProviderId: provider.id,
      name: initialProviderKeyName,
      key: provider.apiKey,
      ...encryptUpstreamKey(provider.apiKey),
      keyPrefix: upstreamKeyPrefix(provider.apiKey),
      status: provider.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
      priority: 100,
    },
  });
}

export async function getActiveProviderKeys(
  provider: Pick<UpstreamProvider, "id" | "apiKey" | "status">,
) {
  const keys = await prisma.upstreamProviderKey.findMany({
    where: {
      upstreamProviderId: provider.id,
      status: "ACTIVE",
    },
    orderBy: [
      { priority: "asc" },
      { lastUsedAt: "asc" },
      { createdAt: "asc" },
    ],
  });
  const quotaFilteredKeys = await filterKeysWithinSpendLimits(keys);

  if (
    quotaFilteredKeys.length > 0 ||
    keys.length > 0 ||
    provider.status !== "ACTIVE"
  ) {
    return quotaFilteredKeys;
  }

  const keyCount = await prisma.upstreamProviderKey.count({
    where: {
      upstreamProviderId: provider.id,
    },
  });

  if (keyCount > 0) {
    return [];
  }

  const defaultKey = await ensureDefaultProviderKey(provider);
  return defaultKey?.status === "ACTIVE"
    ? await filterKeysWithinSpendLimits([defaultKey])
    : [];
}

async function filterKeysWithinSpendLimits(keys: UpstreamProviderKey[]) {
  const limitedKeys = keys.filter(
    (key) => key.dailyLimitUsd !== null || key.monthlyLimitUsd !== null,
  );
  if (limitedKeys.length === 0) {
    return keys;
  }

  const now = new Date();
  const dailyStart = startOfUtcDay(now);
  const monthlyStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const [dailySpend, monthlySpend] = await Promise.all([
    prisma.apiRequest.groupBy({
      by: ["upstreamProviderKeyId"],
      where: {
        upstreamProviderKeyId: { in: limitedKeys.map((key) => key.id) },
        status: "SUCCESS",
        createdAt: { gte: dailyStart },
      },
      _sum: { upstreamCostUsd: true },
    }),
    prisma.apiRequest.groupBy({
      by: ["upstreamProviderKeyId"],
      where: {
        upstreamProviderKeyId: { in: limitedKeys.map((key) => key.id) },
        status: "SUCCESS",
        createdAt: { gte: monthlyStart },
      },
      _sum: { upstreamCostUsd: true },
    }),
  ]);
  const dailySpendByKey = new Map(
    dailySpend.map((row) => [
      row.upstreamProviderKeyId,
      Number(row._sum.upstreamCostUsd?.toString() ?? 0),
    ]),
  );
  const monthlySpendByKey = new Map(
    monthlySpend.map((row) => [
      row.upstreamProviderKeyId,
      Number(row._sum.upstreamCostUsd?.toString() ?? 0),
    ]),
  );

  return keys.filter((key) => {
    const dailyLimit = Number(key.dailyLimitUsd?.toString() ?? 0);
    if (dailyLimit > 0 && (dailySpendByKey.get(key.id) ?? 0) >= dailyLimit) {
      return false;
    }

    const monthlyLimit = Number(key.monthlyLimitUsd?.toString() ?? 0);
    if (
      monthlyLimit > 0 &&
      (monthlySpendByKey.get(key.id) ?? 0) >= monthlyLimit
    ) {
      return false;
    }

    return true;
  });
}

function startOfUtcDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export async function reserveProviderKey(
  provider: Pick<UpstreamProvider, "id" | "apiKey" | "status">,
  preferredKeyId?: string | null,
  options: { dryRun?: boolean } = {},
): Promise<UpstreamKeyReservation | null> {
  const keys = await getActiveProviderKeys(provider);

  if (keys.length === 0) {
    return null;
  }

  if (preferredKeyId) {
    const preferredKey = keys.find((key) => key.id === preferredKeyId);
    if (preferredKey) {
      const preferredTrace = {
        selectedBy: "preferred" as const,
        candidates: keys.map((key) => ({
          keyId: key.id,
          priority: key.priority,
          available: true,
        })),
      };
      if (options.dryRun) {
        return {
          ...createDryRunKeyReservation(preferredKey),
          decisionTrace: preferredTrace,
        };
      }

      try {
        await reservePreferredKeyAtomically(preferredKey.id);
        await prisma.upstreamProviderKey.update({
          where: { id: preferredKey.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => undefined);

        return {
          ...createKeyReservation(preferredKey),
          decisionTrace: preferredTrace,
        };
      } catch {
        await prisma.upstreamProviderKey.update({
          where: { id: preferredKey.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => undefined);

        return {
          ...createDryRunKeyReservation(preferredKey),
          decisionTrace: preferredTrace,
        };
      }
    }
  }

  const stickyOccupancies = await getStickyProviderKeyOccupancies(keys.map((key) => key.id));
  const dispatchSettings = await readDispatchSettings();
  const keyCandidates = keys.map((key) => ({
    keyId: key.id,
    priority: key.priority,
    stickyOccupancy: stickyOccupancies.get(key.id) ?? 0,
    available: true,
  }));

  if (options.dryRun) {
    const fallbackKey = chooseFallbackKey(
      keys,
      stickyOccupancies,
      dispatchSettings.stickyHitPenalty,
    );
    return fallbackKey
      ? {
          ...createDryRunKeyReservation(fallbackKey),
          decisionTrace: {
            selectedBy: "fallback",
            candidates: keyCandidates,
          },
        }
      : null;
  }

  try {
    const selectedKeyId = await reserveKeyAtomically(
      keys,
      stickyOccupancies,
      dispatchSettings.stickyHitPenalty,
    );
    const selectedKey = keys.find((key) => key.id === selectedKeyId);

    if (!selectedKey) {
      throw new Error("Redis selected an unknown upstream provider key");
    }

    await prisma.upstreamProviderKey.update({
      where: { id: selectedKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => undefined);

    return {
      ...createKeyReservation(selectedKey),
      decisionTrace: {
        selectedBy: "balanced",
        candidates: keyCandidates,
      },
    };
  } catch {
    const fallbackKey = chooseFallbackKey(
      keys,
      stickyOccupancies,
      dispatchSettings.stickyHitPenalty,
    );
    if (!fallbackKey) {
      return null;
    }

    await prisma.upstreamProviderKey.update({
      where: { id: fallbackKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => undefined);

    return {
      ...createDryRunKeyReservation(fallbackKey),
      decisionTrace: {
        selectedBy: "fallback",
        candidates: keyCandidates,
      },
    };
  }
}

async function reservePreferredKeyAtomically(keyId: string) {
  await redis.eval(
    `
local value = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[1])
return value
`,
    1,
    upstreamKeyInflightKey(keyId),
    String(keyInflightTtlSeconds),
  );
}

async function reserveKeyAtomically(
  keys: UpstreamProviderKey[],
  stickyOccupancies: Map<string, number>,
  stickyHitPenalty: number,
) {
  const redisKeys = keys.map((key) => upstreamKeyInflightKey(key.id));
  const args = [
    String(keyInflightTtlSeconds),
    ...keys.flatMap((key) => [
      key.id,
      String((stickyOccupancies.get(key.id) ?? 0) * stickyHitPenalty),
      String(key.priority),
      String(key.lastUsedAt?.getTime() ?? 0),
    ]),
  ];

  const result = await redis.eval(
    `
local ttl = tonumber(ARGV[1])
local bestIndex = 1
local bestEntropy = nil
local bestInflight = nil
local bestPriority = nil
local bestLastUsed = nil
local argIndex = 2

for index = 1, #KEYS do
  local entropy = tonumber(ARGV[argIndex + 1])
  local priority = tonumber(ARGV[argIndex + 2])
  local lastUsed = tonumber(ARGV[argIndex + 3])
  local inflight = math.max(0, tonumber(redis.call("GET", KEYS[index]) or "0"))

  if bestEntropy == nil
    or entropy < bestEntropy
    or (entropy == bestEntropy and inflight < bestInflight)
    or (entropy == bestEntropy and inflight == bestInflight and priority < bestPriority)
    or (entropy == bestEntropy and inflight == bestInflight and priority == bestPriority and lastUsed < bestLastUsed)
  then
    bestEntropy = entropy
    bestInflight = inflight
    bestPriority = priority
    bestLastUsed = lastUsed
    bestIndex = index
  end

  argIndex = argIndex + 4
end

redis.call("INCR", KEYS[bestIndex])
redis.call("EXPIRE", KEYS[bestIndex], ttl)
return ARGV[2 + ((bestIndex - 1) * 4)]
`,
    redisKeys.length,
    ...redisKeys,
    ...args,
  );

  return typeof result === "string" ? result : null;
}

function chooseFallbackKey(
  keys: UpstreamProviderKey[],
  stickyOccupancies: Map<string, number>,
  stickyHitPenalty: number,
) {
  return [...keys].sort((left, right) => {
    const entropyDelta =
      (stickyOccupancies.get(left.id) ?? 0) * stickyHitPenalty -
      (stickyOccupancies.get(right.id) ?? 0) * stickyHitPenalty;
    if (entropyDelta !== 0) {
      return entropyDelta;
    }

    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return (left.lastUsedAt?.getTime() ?? 0) - (right.lastUsedAt?.getTime() ?? 0);
  })[0] ?? null;
}

function createKeyReservation(key: UpstreamProviderKey) {
  const redisKey = upstreamKeyInflightKey(key.id);
  let released = false;
  const refreshTtl = setInterval(() => {
    void redis.expire(redisKey, keyInflightTtlSeconds).catch(() => undefined);
  }, refreshKeyInflightTtlMs);

  return {
    key: {
      ...key,
      key: resolveStoredUpstreamKey(key),
    },
    release: async () => {
      if (released) {
        return;
      }

      released = true;
      clearInterval(refreshTtl);

      try {
        await redis.eval(
          `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 1 then
  redis.call("DEL", KEYS[1])
  return 0
end

local next = redis.call("DECR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[1])
return next
`,
          1,
          redisKey,
          String(keyInflightTtlSeconds),
        );
      } catch {
        // TTL handles stale counters if Redis release fails.
      }
    },
  };
}

function createDryRunKeyReservation(key: UpstreamProviderKey) {
  return {
    key: {
      ...key,
      key: resolveStoredUpstreamKey(key),
    },
    release: async () => {},
  };
}
