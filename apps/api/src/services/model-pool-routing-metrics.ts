import { randomInt } from "node:crypto";
import { redis } from "../lib/redis.js";

const healthSampleLimit = 5;
const healthSampleTtlSeconds = 7 * 24 * 60 * 60;
const healthKeyRotationTtlSeconds = healthSampleTtlSeconds;
const recentFailureTtlSeconds = 120;
const recentFailureMaxCount = 20;

function healthSamplesKey(channelId: string) {
  return `modelpool:health-samples:${channelId}`;
}

function healthKeyRotationKey(channelId: string) {
  return `modelpool:health-key-rotation:${channelId}`;
}

function recentFailureKey(channelId: string) {
  return `modelpool:recent-failures:${channelId}`;
}

export type ChannelHealthSample = {
  firstTokenLatencyMs: number | null;
  latencyMs: number;
  recordedAtMs: number;
};

export async function recordChannelHealthSample(
  channelId: string,
  sample: Omit<ChannelHealthSample, "recordedAtMs">,
) {
  try {
    const value = JSON.stringify({
      ...sample,
      recordedAtMs: Date.now(),
    });
    await redis
      .multi()
      .lpush(healthSamplesKey(channelId), value)
      .ltrim(healthSamplesKey(channelId), 0, healthSampleLimit - 1)
      .expire(healthSamplesKey(channelId), healthSampleTtlSeconds)
      .exec();
  } catch {
    // Health samples are an optimization; the database's latest result remains usable.
  }
}

export async function getChannelHealthSpeedScores(channelIds: string[]) {
  const uniqueIds = [...new Set(channelIds)];
  const entries = await Promise.all(
    uniqueIds.map(async (channelId) => {
      try {
        const values = await redis.lrange(healthSamplesKey(channelId), 0, healthSampleLimit - 1);
        const samples = values
          .map(parseHealthSample)
          .filter((sample): sample is ChannelHealthSample => sample !== null);
        return [channelId, medianSpeedScore(samples)] as const;
      } catch {
        return [channelId, null] as const;
      }
    }),
  );

  return new Map(entries);
}

export async function selectRotatingHealthCheckKeyIndex(
  channelId: string,
  keyCount: number,
) {
  if (keyCount <= 1) {
    return 0;
  }

  try {
    const value = await redis.incr(healthKeyRotationKey(channelId));
    await redis.expire(healthKeyRotationKey(channelId), healthKeyRotationTtlSeconds);
    return Math.max(0, (value - 1) % keyCount);
  } catch {
    return randomInt(keyCount);
  }
}

export async function recordRecentChannelFailure(channelId: string) {
  try {
    const key = recentFailureKey(channelId);
    const value = await redis.incr(key);
    await redis.expire(key, recentFailureTtlSeconds);
    if (value > recentFailureMaxCount) {
      await redis.set(key, String(recentFailureMaxCount), "EX", recentFailureTtlSeconds);
      return recentFailureMaxCount;
    }
    return value;
  } catch {
    return 0;
  }
}

export async function recordRecentChannelSuccess(channelId: string) {
  try {
    const key = recentFailureKey(channelId);
    const value = await redis.eval(
      `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 1 then
  redis.call("DEL", KEYS[1])
  return 0
end
return redis.call("DECR", KEYS[1])
`,
      1,
      key,
    );
    return typeof value === "number" ? value : Number(value ?? 0);
  } catch {
    return 0;
  }
}

export async function getRecentChannelFailureCounts(channelIds: string[]) {
  const uniqueIds = [...new Set(channelIds)];
  const entries = await Promise.all(
    uniqueIds.map(async (channelId) => {
      try {
        const value = await redis.get(recentFailureKey(channelId));
        return [channelId, Math.max(0, Number(value ?? 0))] as const;
      } catch {
        return [channelId, 0] as const;
      }
    }),
  );

  return new Map(entries);
}

function parseHealthSample(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<ChannelHealthSample>;
    if (
      typeof parsed.latencyMs !== "number" ||
      !Number.isFinite(parsed.latencyMs) ||
      (parsed.firstTokenLatencyMs !== null &&
        typeof parsed.firstTokenLatencyMs !== "number")
    ) {
      return null;
    }

    return {
      firstTokenLatencyMs:
        typeof parsed.firstTokenLatencyMs === "number" &&
        Number.isFinite(parsed.firstTokenLatencyMs)
          ? parsed.firstTokenLatencyMs
          : null,
      latencyMs: parsed.latencyMs,
      recordedAtMs:
        typeof parsed.recordedAtMs === "number" && Number.isFinite(parsed.recordedAtMs)
          ? parsed.recordedAtMs
          : 0,
    } satisfies ChannelHealthSample;
  } catch {
    return null;
  }
}

function medianSpeedScore(samples: ChannelHealthSample[]) {
  const scores = samples
    .map((sample) => sample.firstTokenLatencyMs ?? sample.latencyMs)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (scores.length === 0) {
    return null;
  }

  const middle = Math.floor(scores.length / 2);
  return scores.length % 2 === 0
    ? ((scores[middle - 1] ?? scores[middle] ?? 0) + (scores[middle] ?? 0)) / 2
    : scores[middle] ?? null;
}
