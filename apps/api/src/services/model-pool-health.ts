import { performance } from "node:perf_hooks";
import { prisma, type ModelPoolChannel } from "@gateway/db";
import {
  formatUpstreamKeyLabel,
  getActiveProviderKeys,
} from "./upstream-provider-keys.js";
import { resolveStoredUpstreamKey } from "./upstream-key-encryption.js";
import { buildUpstreamUrl } from "./upstream.js";
import {
  canHealthCheckModelPoolChannel,
  healthCheckedChannelStatuses,
  isPenalizedModelPoolChannel,
  nextChannelStatusAfterHealthFailure,
  nextChannelStatusAfterHealthSuccess,
} from "./routing/channel-state.js";
import {
  readDispatchSettings,
  writeDispatchSettings,
} from "./dispatch-settings.js";

type HealthLogger = {
  error: (value: unknown, message?: string) => void;
  warn?: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

type ChannelHealthCheckOptions = {
  unavailableOnFailure?: boolean;
  allowPenalizedRecovery?: boolean;
};

export const modelPoolHealthCheckEndpoints = ["responses", "chat.completions"] as const;
export type ModelPoolHealthCheckEndpoint = (typeof modelPoolHealthCheckEndpoints)[number];

export const defaultModelPoolHealthCheckIntervalSeconds = 30;
export const minModelPoolHealthCheckIntervalSeconds = 5;
export const maxModelPoolHealthCheckIntervalSeconds = 3600;
export const modelPoolHealthCheckIntervalSettingKey = "model_pool_health_interval_seconds";
export const defaultModelPoolSuccessGraceSeconds = 0;
export const minModelPoolSuccessGraceSeconds = 0;
export const maxModelPoolSuccessGraceSeconds = 86400;
export const modelPoolSuccessGraceSettingKey = "model_pool_success_grace_seconds";
export const defaultModelPoolPenaltySeconds = 60;
export const minModelPoolPenaltySeconds = 1;
export const maxModelPoolPenaltySeconds = 86400;
export const modelPoolPenaltySettingKey = "model_pool_penalty_seconds";
const schedulerTickMs = 1_000;
const maxCheckMs = 30_000;
const inFlightChannelChecks = new Map<
  string,
  {
    startedAt: Date;
    promise: Promise<ModelPoolChannel | null>;
  }
>();
const scheduledPenalizedRecoveries = new Map<
  string,
  {
    penalizedUntilMs: number;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let cachedHealthCheckIntervalSeconds = defaultModelPoolHealthCheckIntervalSeconds;
let cachedHealthCheckIntervalLoadedAtMs = 0;
let cachedPenaltySeconds = defaultModelPoolPenaltySeconds;
let cachedPenaltySecondsLoadedAtMs = 0;
let cachedSuccessGraceSeconds = defaultModelPoolSuccessGraceSeconds;
let cachedSuccessGraceSecondsLoadedAtMs = 0;
const healthCheckIntervalCacheTtlMs = 5_000;
const penaltySecondsCacheTtlMs = 5_000;
const successGraceSecondsCacheTtlMs = 5_000;
const recoverySuccessThreshold = 2;

export async function getModelPoolHealthCheckIntervalSeconds() {
  const nowMs = Date.now();
  if (nowMs - cachedHealthCheckIntervalLoadedAtMs < healthCheckIntervalCacheTtlMs) {
    return cachedHealthCheckIntervalSeconds;
  }

  const settings = await readDispatchSettings();
  const intervalSeconds = normalizeModelPoolHealthCheckIntervalSeconds(settings.healthCheckIntervalSeconds);

  cachedHealthCheckIntervalSeconds = intervalSeconds;
  cachedHealthCheckIntervalLoadedAtMs = nowMs;

  return intervalSeconds;
}

export async function setModelPoolHealthCheckIntervalSeconds(value: number) {
  const intervalSeconds = normalizeModelPoolHealthCheckIntervalSeconds(value);

  await writeDispatchSettings({ healthCheckIntervalSeconds: intervalSeconds });

  cachedHealthCheckIntervalSeconds = intervalSeconds;
  cachedHealthCheckIntervalLoadedAtMs = Date.now();

  return intervalSeconds;
}

export function normalizeModelPoolHealthCheckIntervalSeconds(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return defaultModelPoolHealthCheckIntervalSeconds;
  }

  return Math.min(
    maxModelPoolHealthCheckIntervalSeconds,
    Math.max(minModelPoolHealthCheckIntervalSeconds, Math.round(numeric)),
  );
}

export async function getModelPoolSuccessGraceSeconds() {
  const nowMs = Date.now();
  if (nowMs - cachedSuccessGraceSecondsLoadedAtMs < successGraceSecondsCacheTtlMs) {
    return cachedSuccessGraceSeconds;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: modelPoolSuccessGraceSettingKey },
  });
  const successGraceSeconds = normalizeModelPoolSuccessGraceSeconds(setting?.value);

  cachedSuccessGraceSeconds = successGraceSeconds;
  cachedSuccessGraceSecondsLoadedAtMs = nowMs;

  return successGraceSeconds;
}

export async function setModelPoolSuccessGraceSeconds(value: number) {
  const successGraceSeconds = normalizeModelPoolSuccessGraceSeconds(value);

  await prisma.systemSetting.upsert({
    where: { key: modelPoolSuccessGraceSettingKey },
    update: { value: String(successGraceSeconds) },
    create: {
      key: modelPoolSuccessGraceSettingKey,
      value: String(successGraceSeconds),
    },
  });

  cachedSuccessGraceSeconds = successGraceSeconds;
  cachedSuccessGraceSecondsLoadedAtMs = Date.now();

  return successGraceSeconds;
}

export function normalizeModelPoolSuccessGraceSeconds(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return defaultModelPoolSuccessGraceSeconds;
  }

  return Math.min(
    maxModelPoolSuccessGraceSeconds,
    Math.max(minModelPoolSuccessGraceSeconds, Math.round(numeric)),
  );
}

export async function getModelPoolPenaltySeconds() {
  const nowMs = Date.now();
  if (nowMs - cachedPenaltySecondsLoadedAtMs < penaltySecondsCacheTtlMs) {
    return cachedPenaltySeconds;
  }

  const settings = await readDispatchSettings();
  const penaltySeconds = normalizeModelPoolPenaltySeconds(settings.penaltySeconds);

  cachedPenaltySeconds = penaltySeconds;
  cachedPenaltySecondsLoadedAtMs = nowMs;

  return penaltySeconds;
}

export async function setModelPoolPenaltySeconds(value: number) {
  const penaltySeconds = normalizeModelPoolPenaltySeconds(value);

  await writeDispatchSettings({ penaltySeconds });

  cachedPenaltySeconds = penaltySeconds;
  cachedPenaltySecondsLoadedAtMs = Date.now();

  return penaltySeconds;
}

export function normalizeModelPoolPenaltySeconds(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return defaultModelPoolPenaltySeconds;
  }

  return Math.min(
    maxModelPoolPenaltySeconds,
    Math.max(minModelPoolPenaltySeconds, Math.round(numeric)),
  );
}

export function getModelPoolChannelHealthTiming(
  channel: ModelPoolChannel,
  intervalSeconds: number,
  successGraceSeconds: number,
  now = new Date(),
) {
  const inFlightCheck = inFlightChannelChecks.get(channel.id);
  const isChecking = Boolean(inFlightCheck);
  const checkIntervalSeconds = normalizeModelPoolHealthCheckIntervalSeconds(intervalSeconds);
  const checkIntervalMs = checkIntervalSeconds * 1000;
  const successGraceMs = normalizeModelPoolSuccessGraceSeconds(successGraceSeconds) * 1000;
  const penalizedUntilMs = channel.penalizedUntil?.getTime() ?? null;
  const successGraceUntilMs = channel.lastSuccessfulCallAt
    ? channel.lastSuccessfulCallAt.getTime() + successGraceMs
    : null;

  if (isPenalizedModelPoolChannel(channel.status)) {
    const penaltyRemainingSeconds = penalizedUntilMs === null
      ? null
      : Math.max(0, Math.ceil((penalizedUntilMs - now.getTime()) / 1000));

    return {
      isChecking,
      checkingStartedAt: inFlightCheck?.startedAt.toISOString() ?? null,
      checkIntervalSeconds,
      nextCheckAt: penaltyRemainingSeconds === 0 ? now.toISOString() : null,
      nextCheckRemainingSeconds: penaltyRemainingSeconds === 0 ? 0 : null,
      penaltyRemainingSeconds,
      successGraceRemainingSeconds: null,
      healthCheckVersion: channel.lastCheckedAt?.toISOString() ?? null,
    };
  }

  if (!canHealthCheckModelPoolChannel(channel.status)) {
    return {
      isChecking,
      checkingStartedAt: inFlightCheck?.startedAt.toISOString() ?? null,
      checkIntervalSeconds,
      nextCheckAt: null,
      nextCheckRemainingSeconds: null,
      penaltyRemainingSeconds: null,
      successGraceRemainingSeconds: null,
      healthCheckVersion: channel.lastCheckedAt?.toISOString() ?? null,
    };
  }

  if (isChecking) {
    return {
      isChecking: true,
      checkingStartedAt: inFlightCheck?.startedAt.toISOString() ?? null,
      checkIntervalSeconds,
      nextCheckAt: null,
      nextCheckRemainingSeconds: null,
      penaltyRemainingSeconds: null,
      successGraceRemainingSeconds: successGraceRemainingSeconds(successGraceUntilMs, now),
      healthCheckVersion: channel.lastCheckedAt?.toISOString() ?? null,
    };
  }

  if (!channel.lastCheckedAt) {
    if (successGraceUntilMs !== null) {
      const nowMs = now.getTime();
      const nextCheckAtMs = successGraceUntilMs + checkIntervalMs;
      return {
        isChecking: false,
        checkingStartedAt: null,
        checkIntervalSeconds,
        nextCheckAt: new Date(nextCheckAtMs).toISOString(),
        nextCheckRemainingSeconds: Math.max(0, Math.ceil((nextCheckAtMs - nowMs) / 1000)),
        penaltyRemainingSeconds: null,
        successGraceRemainingSeconds: successGraceRemainingSeconds(successGraceUntilMs, now),
        healthCheckVersion: null,
      };
    }

    return {
      isChecking: false,
      checkingStartedAt: null,
      checkIntervalSeconds,
      nextCheckAt: now.toISOString(),
      nextCheckRemainingSeconds: 0,
      penaltyRemainingSeconds: null,
      successGraceRemainingSeconds: successGraceRemainingSeconds(successGraceUntilMs, now),
      healthCheckVersion: null,
    };
  }

  const nowMs = now.getTime();
  const resultCheckedAtMs = channel.lastCheckedAt.getTime();
  const effectiveLastCheckedAtMs = Math.max(
    resultCheckedAtMs,
    successGraceUntilMs ?? resultCheckedAtMs,
  );
  const nextCheckAtMs = effectiveLastCheckedAtMs + checkIntervalMs;

  return {
    isChecking: false,
    checkingStartedAt: null,
    checkIntervalSeconds,
    nextCheckAt: new Date(nextCheckAtMs).toISOString(),
    nextCheckRemainingSeconds: Math.max(0, Math.ceil((nextCheckAtMs - nowMs) / 1000)),
    penaltyRemainingSeconds: null,
    successGraceRemainingSeconds: successGraceRemainingSeconds(successGraceUntilMs, now),
    healthCheckVersion: channel.lastCheckedAt.toISOString(),
  };
}

export async function checkModelPoolChannel(
  channelId: string,
  options: ChannelHealthCheckOptions = {},
) {
  return runChannelHealthCheck(channelId, {
    allowPenalizedRecovery: true,
    ...options,
  });
}

export function schedulePenalizedChannelRecovery(
  channelId: string,
  penalizedUntil: Date,
  logger?: Pick<HealthLogger, "warn" | "info">,
) {
  const penalizedUntilMs = penalizedUntil.getTime();
  const previous = scheduledPenalizedRecoveries.get(channelId);
  if (previous && previous.penalizedUntilMs >= penalizedUntilMs) {
    return;
  }

  if (previous) {
    clearTimeout(previous.timer);
  }

  const delayMs = Math.max(0, penalizedUntilMs - Date.now());
  const timer = setTimeout(() => {
    const scheduled = scheduledPenalizedRecoveries.get(channelId);
    if (!scheduled || scheduled.timer !== timer) {
      return;
    }
    scheduledPenalizedRecoveries.delete(channelId);

    void runChannelHealthCheck(channelId, {
      allowPenalizedRecovery: true,
    })
      .then((channel) => {
        if (
          channel?.status === "PENALIZED" &&
          channel.penalizedUntil &&
          channel.penalizedUntil.getTime() > Date.now()
        ) {
          schedulePenalizedChannelRecovery(
            channelId,
            channel.penalizedUntil,
            logger,
          );
          return;
        }

        logger?.info?.(
          {
            channelId,
            status: channel?.status,
            lastCheckStatus: channel?.lastCheckStatus,
          },
          "Penalized model pool channel recovery health check completed",
        );
      })
      .catch((error) => {
        logger?.warn?.(
          { error, channelId },
          "Failed to run penalized model pool channel recovery health check",
        );
      });
  }, delayMs);

  scheduledPenalizedRecoveries.set(channelId, {
    penalizedUntilMs,
    timer,
  });
}

async function performModelPoolChannelCheck(
  channelId: string,
  options: ChannelHealthCheckOptions,
): Promise<ModelPoolChannel | null> {
  let channel = await prisma.modelPoolChannel.findUnique({
    where: { id: channelId },
    include: { modelPool: true },
  });

  if (!channel) {
    return null;
  }

  if (
    channel.status === "PENALIZED" &&
    channel.penalizedUntil &&
    channel.penalizedUntil.getTime() > Date.now()
  ) {
    return channel;
  }

  if (channel.status === "PENALIZED") {
    const releasedChannel = await releaseExpiredPenalizedChannel(channel.id);
    if (!options.allowPenalizedRecovery) {
      return releasedChannel;
    }

    channel = await prisma.modelPoolChannel.findUnique({
      where: { id: channel.id },
      include: { modelPool: true },
    });
    if (!channel) {
      return null;
    }
  }

  if (!canHealthCheckModelPoolChannel(channel.status)) {
    return channel;
  }

  const [provider, price] = await Promise.all([
    prisma.upstreamProvider.findUnique({
      where: { name: channel.upstreamProvider },
    }),
    prisma.modelPrice.findUnique({
      where: {
        upstreamProvider_model: {
          upstreamProvider: channel.upstreamProvider,
          model: channel.modelPool.model,
        },
      },
    }),
  ]);

  if (channel.modelPool.status !== "ACTIVE") {
    return markChannelFailure(channel, "Model pool is disabled", undefined, options);
  }

  if (!provider || provider.status !== "ACTIVE") {
    return markChannelFailure(channel, "Upstream provider is missing or disabled", undefined, options);
  }

  if (!price || !price.enabled) {
    return markChannelFailure(channel, "Model price is missing or disabled", undefined, options);
  }

  const activeKeys = await getActiveProviderKeys(provider);

  if (activeKeys.length === 0) {
    return markChannelFailure(channel, "No active upstream key is available", undefined, options);
  }

  const resolvedActiveKeys = activeKeys
    .map((key) => ({
      ...key,
      key: resolveStoredUpstreamKey(key),
    }))
    .filter((key) => key.key);

  if (resolvedActiveKeys.length === 0) {
    return markChannelFailure(channel, "No decryptable active upstream key is available", undefined, options);
  }

  const healthCheckEndpoint = normalizeModelPoolHealthCheckEndpoint(channel.modelPool.healthCheckEndpoint);
  const keyResults = await Promise.all(
    resolvedActiveKeys.map((key) =>
      probeProviderKey({
        baseUrl: provider.baseUrl,
        apiKey: key.key,
        timeoutMs: provider.timeoutMs,
        model: channel.modelPool.model,
        endpoint: healthCheckEndpoint,
      }).then(async (result) => {
        await prisma.upstreamProviderKey.update({
          where: { id: key.id },
          data: {
            lastCheckStatus: result.ok ? "SUCCESS" : "FAILED",
            lastCheckedAt: new Date(),
            lastError: result.ok ? null : result.message.slice(0, 1000),
          },
        });

        return { key, result };
      }),
    ),
  );
  const failedKey = keyResults.find(({ result }) => !result.ok);

  if (failedKey && !failedKey.result.ok) {
    const message = `${formatUpstreamKeyLabel(failedKey.key)}: ${failedKey.result.message}`;
    const latencyMs = failedKey.result.latencyMs;
    return markChannelFailure(channel, message, latencyMs, options);
  }

  const latencyMs = averageNumbers(keyResults.map(({ result }) => result.latencyMs)) ?? 0;
  const firstTokenLatencyMs = averageNullableNumbers(
    keyResults.map(({ result }) => (result.ok ? result.firstTokenLatencyMs : null)),
  );

  return markChannelSuccess(channel, latencyMs, firstTokenLatencyMs);
}

export async function checkDueModelPoolChannels() {
  const channels = await findDueModelPoolChannels();
  const dueChannels = channels.filter((channel) => !inFlightChannelChecks.has(channel.id));

  await Promise.allSettled(
    dueChannels.map((channel) =>
      runChannelHealthCheck(channel.id, {
        allowPenalizedRecovery: channel.status === "PENALIZED",
      }),
    ),
  );

  return { checked: dueChannels.length };
}

async function scheduleDueModelPoolChannels(logger?: HealthLogger) {
  const channels = await findDueModelPoolChannels();
  let checked = 0;

  for (const channel of channels) {
    if (inFlightChannelChecks.has(channel.id)) {
      continue;
    }

    checked += 1;
    void runChannelHealthCheck(channel.id, {
      allowPenalizedRecovery: channel.status === "PENALIZED",
    }).catch((error) => {
      logger?.error(error, "Model pool channel health check failed");
    });

    // Keep checks staggered so channels do not permanently share one countdown cadence.
    break;
  }

  return { checked, inFlight: inFlightChannelChecks.size };
}

async function findDueModelPoolChannels() {
  const [intervalSeconds, successGraceSeconds] = await Promise.all([
    getModelPoolHealthCheckIntervalSeconds(),
    getModelPoolSuccessGraceSeconds(),
  ]);
  const intervalMs = intervalSeconds * 1000;
  const successGraceMs = successGraceSeconds * 1000;
  const now = new Date();
  const candidates = await prisma.modelPoolChannel.findMany({
    where: {
      modelPool: {
        status: "ACTIVE",
        autoHealthCheckEnabled: true,
      },
      OR: [
        {
          status: { in: [...healthCheckedChannelStatuses] },
        },
        {
          status: "PENALIZED",
          OR: [
            { penalizedUntil: null },
            { penalizedUntil: { lte: now } },
          ],
        },
      ],
    },
    orderBy: [
      { penalizedUntil: "asc" },
      { lastCheckedAt: "asc" },
      { priority: "asc" },
    ],
    take: 100,
  });
  const nowMs = now.getTime();

  return candidates
    .filter((channel) =>
      isModelPoolChannelDueForHealthCheck(channel, nowMs, intervalMs, successGraceMs),
    )
    .slice(0, 20);
}

export function startModelPoolHealthScheduler(logger?: HealthLogger) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const result = await scheduleDueModelPoolChannels(logger);
      if (result.checked > 0) {
        logger?.info?.(result, "Model pool health check completed");
      }
    } catch (error) {
      logger?.error(error, "Model pool health check failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, schedulerTickMs);

  void tick();

  return () => clearInterval(timer);
}

async function runChannelHealthCheck(
  channelId: string,
  options: ChannelHealthCheckOptions = {},
) {
  const existing = inFlightChannelChecks.get(channelId);

  if (existing) {
    if (!options.unavailableOnFailure) {
      return existing.promise;
    }

    return existing.promise.then(forceUnavailableAfterFailedCheck);
  }

  const startedAt = new Date();
  const promise = performModelPoolChannelCheck(channelId, options);
  inFlightChannelChecks.set(channelId, { startedAt, promise });

  try {
    return await promise;
  } finally {
    if (inFlightChannelChecks.get(channelId)?.promise === promise) {
      inFlightChannelChecks.delete(channelId);
    }
  }
}

async function releaseExpiredPenalizedChannel(channelId: string) {
  const now = new Date();
  return prisma.modelPoolChannel.updateMany({
    where: {
      id: channelId,
      status: "PENALIZED",
      OR: [{ penalizedUntil: null }, { penalizedUntil: { lte: now } }],
    },
    data: {
      status: "UNAVAILABLE",
      recoverySuccesses: 0,
      penalizedUntil: null,
      penaltyReason: null,
      lastCheckedAt: now,
    },
  }).then(async (result) => {
    if (result.count === 0) {
      return prisma.modelPoolChannel.findUnique({ where: { id: channelId } });
    }

    return prisma.modelPoolChannel.findUnique({ where: { id: channelId } });
  });
}

function isModelPoolChannelDueForHealthCheck(
  channel: ModelPoolChannel,
  nowMs: number,
  intervalMs: number,
  successGraceMs = 0,
) {
  if (isPenalizedModelPoolChannel(channel.status)) {
    return channel.penalizedUntil === null || channel.penalizedUntil.getTime() <= nowMs;
  }

  if (!canHealthCheckModelPoolChannel(channel.status)) {
    return false;
  }

  const successGraceUntilMs = channel.lastSuccessfulCallAt
    ? channel.lastSuccessfulCallAt.getTime() + successGraceMs
    : null;

  if (!channel.lastCheckedAt) {
    return successGraceUntilMs === null
      ? true
      : successGraceUntilMs + intervalMs <= nowMs;
  }

  const resultCheckedAtMs = channel.lastCheckedAt.getTime();
  const effectiveLastCheckedAtMs = Math.max(
    resultCheckedAtMs,
    successGraceUntilMs ?? resultCheckedAtMs,
  );
  return effectiveLastCheckedAtMs + intervalMs <= nowMs;
}

function successGraceRemainingSeconds(successGraceUntilMs: number | null, now: Date) {
  if (successGraceUntilMs === null) {
    return null;
  }

  return Math.max(0, Math.ceil((successGraceUntilMs - now.getTime()) / 1000));
}

function averageNullableNumbers(values: Array<number | null>) {
  const numericValues = values.filter((value): value is number => value !== null);
  return averageNumbers(numericValues);
}

function averageNumbers(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

async function markChannelSuccess(
  channel: ModelPoolChannel,
  latencyMs: number,
  firstTokenLatencyMs: number | null,
) {
  const nextRecoverySuccesses = channel.status === "FORCED_ACTIVE"
    ? 0
    : Math.min(recoverySuccessThreshold, channel.recoverySuccesses + 1);
  const nextStatus = nextChannelStatusAfterHealthSuccess(
    channel.status,
    nextRecoverySuccesses,
    recoverySuccessThreshold,
  );

  return prisma.modelPoolChannel.update({
    where: { id: channel.id },
    data: {
      status: nextStatus,
      priority: Math.max(1, firstTokenLatencyMs ?? latencyMs),
      consecutiveFailures: 0,
      recoverySuccesses: nextStatus === "ACTIVE" ? 0 : nextRecoverySuccesses,
      penalizedUntil: null,
      penaltyReason: null,
      lastCheckStatus: "SUCCESS",
      lastCheckedAt: new Date(),
      lastLatencyMs: latencyMs,
      lastFirstTokenLatencyMs: firstTokenLatencyMs,
      lastError: null,
    },
  });
}

async function markChannelFailure(
  channel: ModelPoolChannel,
  message: string,
  latencyMs?: number,
  options: ChannelHealthCheckOptions = {},
) {
  const consecutiveFailures = channel.consecutiveFailures + 1;
  const nextStatus = nextChannelStatusAfterHealthFailure(channel.status);
  const shouldPenalize = nextStatus === "PENALIZED";
  const penaltySeconds = shouldPenalize
    ? await getModelPoolPenaltySeconds()
    : null;
  const penalizedUntil = penaltySeconds
    ? new Date(Date.now() + penaltySeconds * 1000)
    : null;
  const penaltyReason = shouldPenalize
    ? `Health check failed: ${message}`.slice(0, 1000)
    : null;

  const updated = await prisma.modelPoolChannel.update({
    where: { id: channel.id },
    data: {
      status: nextStatus,
      priority: Math.min(10_000, channel.priority + 1000),
      consecutiveFailures,
      recoverySuccesses: 0,
      penalizedUntil,
      penaltyReason,
      lastCheckStatus: "FAILED",
      lastCheckedAt: new Date(),
      lastLatencyMs: latencyMs,
      lastFirstTokenLatencyMs: null,
      lastError: message.slice(0, 1000),
    },
  });

  if (penalizedUntil) {
    schedulePenalizedChannelRecovery(channel.id, penalizedUntil);
  }

  return updated;
}

async function forceUnavailableAfterFailedCheck(channel: ModelPoolChannel | null) {
  if (
    !channel ||
    channel.status === "PENALIZED" ||
    channel.status === "UNAVAILABLE" ||
    channel.lastCheckStatus !== "FAILED"
  ) {
    return channel;
  }

  return prisma.modelPoolChannel.update({
    where: { id: channel.id },
    data: {
      status: "UNAVAILABLE",
      recoverySuccesses: 0,
      penalizedUntil: null,
      penaltyReason: null,
    },
  });
}

type ProbeInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpoint: ModelPoolHealthCheckEndpoint;
  signal: AbortSignal;
};

type ProbeResult =
  | { ok: true; mode: ModelPoolHealthCheckEndpoint; firstTokenLatencyMs: number | null; latencyMs: number }
  | { ok: false; message: string; latencyMs: number };

async function probeProviderKey(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  model: string;
  endpoint: ModelPoolHealthCheckEndpoint;
}) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutMs = Math.min(input.timeoutMs, maxCheckMs);
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    return await probeUpstream({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      endpoint: input.endpoint,
      signal: controller.signal,
    });
  } catch (error) {
    return {
      ok: false as const,
      message: formatHealthProbeError(error, timeoutMs),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatHealthProbeError(error: unknown, timeoutMs: number) {
  const message = error instanceof Error ? error.message : "Health check failed";
  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  const normalized = `${name} ${message}`.toLowerCase();

  if (normalized.includes("abort")) {
    return `健康检测超时：上游在 ${Math.max(1, Math.round(timeoutMs / 1000))} 秒内没有返回，网关主动中止了检测。`;
  }

  return message;
}

async function probeUpstream(input: ProbeInput): Promise<ProbeResult> {
  if (input.endpoint === "responses") {
    return postHealthProbe({
      ...input,
      mode: "responses",
      path: "/v1/responses",
      body: {
        model: input.model,
        instructions: "Reply with ok.",
        input: [{ role: "user", content: "ok" }],
        reasoning: { effort: "low" },
        store: false,
        stream: true,
      },
    });
  }

  return postHealthProbe({
    ...input,
    mode: "chat.completions",
    path: "/v1/chat/completions",
    body: {
      model: input.model,
      messages: [{ role: "user", content: "ok" }],
      reasoning_effort: "low",
      max_tokens: 1,
      stream: true,
    },
  });
}

type PostHealthProbeInput = ProbeInput & {
  mode: ModelPoolHealthCheckEndpoint;
  path: string;
  body: unknown;
};

export function normalizeModelPoolHealthCheckEndpoint(value: unknown): ModelPoolHealthCheckEndpoint {
  return value === "chat.completions" ? "chat.completions" : "responses";
}

async function postHealthProbe(input: PostHealthProbeInput): Promise<ProbeResult> {
  const startedAt = performance.now();
  const response = await fetch(buildUpstreamUrl(input.baseUrl, input.path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      message: `${input.mode}: ${response.status} ${text}`.slice(0, 1000),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  const firstTokenLatencyMs = await readHealthProbeResponse(response, startedAt);
  if (firstTokenLatencyMs === null) {
    return {
      ok: false,
      message: `${input.mode}: no output token received`,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  return {
    ok: true,
    mode: input.mode,
    firstTokenLatencyMs,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function readHealthProbeResponse(response: Response, startedAt: number) {
  if (!response.body) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let firstTokenLatencyMs: number | null = null;
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value.length > 0) {
        pending += decoder.decode(value, { stream: true });

        if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
          firstTokenLatencyMs = Math.round(performance.now() - startedAt);
        }

        const lastEventBoundary = pending.lastIndexOf("\n\n");
        if (lastEventBoundary >= 0) {
          pending = pending.slice(lastEventBoundary + 2);
        }
      }
    }

    const trailing = decoder.decode();
    if (trailing) {
      pending += trailing;

      if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return firstTokenLatencyMs;
}

function sseBufferHasOutputToken(buffer: string) {
  return parseSseJsonPayloads(buffer).some(streamChunkHasOutputToken);
}

function parseSseJsonPayloads(buffer: string) {
  const payloads: unknown[] = [];

  for (const event of buffer.split("\n\n")) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        payloads.push(JSON.parse(data));
      } catch {
        continue;
      }
    }
  }

  return payloads;
}

function streamChunkHasOutputToken(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object") {
    return false;
  }

  const event = chunk as Record<string, unknown>;

  if (typeof event.delta === "string" && event.delta.length > 0) {
    return true;
  }

  if (typeof event.text === "string" && event.text.length > 0) {
    return true;
  }

  if (Array.isArray(event.choices)) {
    return event.choices.some((choice) => {
      if (!choice || typeof choice !== "object") {
        return false;
      }

      const item = choice as Record<string, unknown>;
      return textLikeValueHasContent(item.text) || textLikeValueHasContent(item.delta);
    });
  }

  return textLikeValueHasContent(event.output);
}

function textLikeValueHasContent(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0;
  }

  if (Array.isArray(value)) {
    return value.some(textLikeValueHasContent);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    textLikeValueHasContent(record.content) ||
    textLikeValueHasContent(record.text) ||
    textLikeValueHasContent(record.delta)
  );
}
