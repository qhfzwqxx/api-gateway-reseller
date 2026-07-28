import { prisma } from "@gateway/db";
import { redis } from "../lib/redis.js";
import {
  getModelPoolPenaltySeconds,
  schedulePenalizedChannelRecovery,
} from "./model-pool-health.js";
import { clearStickyModelPoolChannel } from "./model-pool-stickiness.js";
import { readDispatchSettings } from "./dispatch-settings.js";

type Logger = {
  warn: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

const failureCounterTtlSeconds = 600;

function failureKey(
  callerIdentity: string,
  model: string,
  channelId: string,
  upstreamProviderKeyId?: string | null,
) {
  return `modelpool:caller-channel-key-failure:${callerIdentity}:${model}:${channelId}:${upstreamProviderKeyId ?? "provider"}`;
}

export async function recordModelPoolUserCallResult(params: {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  failed?: boolean;
  retryableFailure?: boolean;
  immediatePenalty?: boolean;
  penaltyReason?: string;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
  logger?: Logger;
}) {
  const { userId, apiKeyId, callerIdentity, model, channelId, upstreamProviderKeyId, failed, retryableFailure, immediatePenalty, penaltyReason, logger } = params;

  if (!channelId) {
    return;
  }

  const key = failureKey(callerIdentity, model, channelId, upstreamProviderKeyId);

  try {
    if (!failed) {
      await redis.del(key);
      await markChannelSuccessfulCall(channelId, logger);
      return;
    }

    if (failed && retryableFailure === false) {
      return;
    }

    if (!retryableFailure) {
      return;
    }

    if (immediatePenalty) {
      await redis.del(key).catch(() => undefined);
      await penalizeChannel({
        userId,
        apiKeyId,
        callerIdentity,
        model,
        channelId,
        immediatePenalty: true,
        penaltyReason,
        logger,
      });
      return;
    }

    const settings = await readDispatchSettings();
    if (!settings.penaltyEnabled) {
      return;
    }

    const failures = await redis.incr(key);
    await redis.expire(key, failureCounterTtlSeconds);

    if (failures < settings.penaltyFailureThreshold) {
      return;
    }

    await redis.del(key);
    await penalizeChannel({ userId, apiKeyId, callerIdentity, model, channelId, logger });
  } catch (error) {
    logger?.warn(
      { error, userId, apiKeyId, callerIdentity, model, channelId },
      "Failed to record model pool caller channel failure",
    );
  }
}

async function markChannelSuccessfulCall(channelId: string, logger?: Logger) {
  try {
    await prisma.modelPoolChannel.update({
      where: { id: channelId },
      data: { lastSuccessfulCallAt: new Date() },
    });
  } catch (error) {
    logger?.warn({ error, channelId }, "Failed to update model pool channel successful call time");
  }
}

async function penalizeChannel(params: {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId: string;
  immediatePenalty?: boolean;
  penaltyReason?: string;
  logger?: Logger;
}) {
  const { userId, apiKeyId, callerIdentity, model, channelId, immediatePenalty, logger } = params;
  await clearStickyModelPoolChannel(callerIdentity, model, channelId);
  const [penaltySeconds, settings] = await Promise.all([
    getModelPoolPenaltySeconds(),
    readDispatchSettings(),
  ]);
  const currentChannel = await prisma.modelPoolChannel.findUnique({
    where: { id: channelId },
    select: { status: true },
  });
  if (
    !currentChannel ||
    currentChannel.status === "DISABLED" ||
    (currentChannel.status === "FORCED_ACTIVE" && !immediatePenalty)
  ) {
    return;
  }
  const penalizedUntil = new Date(Date.now() + penaltySeconds * 1000);
  const penaltyReason =
    params.penaltyReason?.trim() ||
    `IP ${callerIdentity} failed this channel ${settings.penaltyFailureThreshold} times`;

  const channel = await prisma.modelPoolChannel.update({
    where: { id: channelId },
    data: {
      status: "PENALIZED",
      penalizedUntil,
      penaltyReason,
      recoverySuccesses: 0,
      consecutiveFailures: { increment: 1 },
      lastCheckStatus: "FAILED",
      lastError: penaltyReason.slice(0, 1000),
    },
  }).catch(() => null);

  if (!channel) {
    logger?.warn(
      { userId, apiKeyId, callerIdentity, model, channelId },
      "Penalized model pool channel could not be found",
    );
    return;
  }

  logger?.info?.(
    {
      userId,
      apiKeyId,
      callerIdentity,
      model,
      channelId,
      penalizedUntil: penalizedUntil.toISOString(),
      penaltySeconds,
      immediatePenalty: immediatePenalty === true,
    },
    "Model pool channel entered penalty period after caller failures",
  );

  schedulePenalizedChannelRecovery(channelId, penalizedUntil, logger);
}
