import { redis } from "../lib/redis.js";

const sessionFailedChannelTtlSeconds = 60;

function failedChannelKey(callerIdentity: string, model: string) {
  return `modelpool:session-failed-channels:${callerIdentity}:${model}`;
}

export async function getSessionFailedModelPoolChannelIds(
  callerIdentity: string,
  model: string,
) {
  try {
    return new Set(await redis.smembers(failedChannelKey(callerIdentity, model)));
  } catch {
    return new Set<string>();
  }
}

export async function markSessionModelPoolChannelFailed(
  callerIdentity: string,
  model: string,
  channelId: string,
) {
  try {
    const key = failedChannelKey(callerIdentity, model);
    await redis
      .multi()
      .sadd(key, channelId)
      .expire(key, sessionFailedChannelTtlSeconds)
      .exec();
  } catch {
    return;
  }
}

export async function clearSessionModelPoolChannelFailures(
  callerIdentity: string,
  model: string,
) {
  try {
    await redis.del(failedChannelKey(callerIdentity, model));
  } catch {
    return;
  }
}
