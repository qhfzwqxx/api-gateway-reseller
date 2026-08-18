import { prisma } from "@gateway/db";

export const dispatchSettingsKey = "model_dispatch_settings";

export type DispatchSettings = {
  stickyEnabled: boolean;
  stickyTtlSeconds: number;
  stickySlowUnbindEnabled: boolean;
  slowFirstTokenMs: number;
  slowTotalLatencyMs: number;
  slowUnbindThreshold: number;
  penaltyEnabled: boolean;
  penaltyFailureThreshold: number;
  penaltySeconds: number;
  healthCheckIntervalSeconds: number;
  speedRankPenalty: number;
  stickyHitPenalty: number;
  channelConcurrencyPenalty: number;
  keyConcurrencyPenalty: number;
  recentFailurePenalty: number;
  forceAvailableButtonEnabled: boolean;
};

export const defaultDispatchSettings: DispatchSettings = {
  stickyEnabled: true,
  stickyTtlSeconds: 600,
  stickySlowUnbindEnabled: true,
  slowFirstTokenMs: 15_000,
  slowTotalLatencyMs: 45_000,
  slowUnbindThreshold: 3,
  penaltyEnabled: true,
  penaltyFailureThreshold: 2,
  penaltySeconds: 60,
  healthCheckIntervalSeconds: 30,
  speedRankPenalty: 300,
  stickyHitPenalty: 500,
  channelConcurrencyPenalty: 300,
  keyConcurrencyPenalty: 200,
  recentFailurePenalty: 250,
  forceAvailableButtonEnabled: true,
};

const cacheTtlMs = 5_000;
let cachedSettings = defaultDispatchSettings;
let cachedAtMs = 0;

export async function readDispatchSettings() {
  const now = Date.now();
  if (now - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: dispatchSettingsKey },
  });
  cachedSettings = normalizeDispatchSettings(parseJson(setting?.value));
  cachedAtMs = now;
  return cachedSettings;
}

export async function writeDispatchSettings(value: Partial<DispatchSettings>) {
  const next = normalizeDispatchSettings({
    ...(await readDispatchSettings()),
    ...value,
  });

  await prisma.systemSetting.upsert({
    where: { key: dispatchSettingsKey },
    update: { value: JSON.stringify(next) },
    create: { key: dispatchSettingsKey, value: JSON.stringify(next) },
  });

  cachedSettings = next;
  cachedAtMs = Date.now();
  return next;
}

export function normalizeDispatchSettings(value: unknown): DispatchSettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<keyof DispatchSettings, unknown>>
    : {};

  return {
    stickyEnabled: bool(input.stickyEnabled, defaultDispatchSettings.stickyEnabled),
    stickyTtlSeconds: int(input.stickyTtlSeconds, 60, 86_400, defaultDispatchSettings.stickyTtlSeconds),
    stickySlowUnbindEnabled: bool(input.stickySlowUnbindEnabled, defaultDispatchSettings.stickySlowUnbindEnabled),
    slowFirstTokenMs: int(input.slowFirstTokenMs, 1_000, 300_000, defaultDispatchSettings.slowFirstTokenMs),
    slowTotalLatencyMs: int(input.slowTotalLatencyMs, 1_000, 600_000, defaultDispatchSettings.slowTotalLatencyMs),
    slowUnbindThreshold: int(input.slowUnbindThreshold, 1, 100, defaultDispatchSettings.slowUnbindThreshold),
    penaltyEnabled: bool(input.penaltyEnabled, defaultDispatchSettings.penaltyEnabled),
    penaltyFailureThreshold: int(input.penaltyFailureThreshold, 1, 100, defaultDispatchSettings.penaltyFailureThreshold),
    penaltySeconds: int(input.penaltySeconds, 1, 86_400, defaultDispatchSettings.penaltySeconds),
    healthCheckIntervalSeconds: int(input.healthCheckIntervalSeconds, 5, 3_600, defaultDispatchSettings.healthCheckIntervalSeconds),
    speedRankPenalty: int(input.speedRankPenalty, 0, 60_000, defaultDispatchSettings.speedRankPenalty),
    stickyHitPenalty: int(input.stickyHitPenalty, 0, 60_000, defaultDispatchSettings.stickyHitPenalty),
    channelConcurrencyPenalty: int(input.channelConcurrencyPenalty, 0, 60_000, defaultDispatchSettings.channelConcurrencyPenalty),
    keyConcurrencyPenalty: int(input.keyConcurrencyPenalty, 0, 60_000, defaultDispatchSettings.keyConcurrencyPenalty),
    recentFailurePenalty: int(input.recentFailurePenalty, 0, 60_000, defaultDispatchSettings.recentFailurePenalty),
    forceAvailableButtonEnabled: bool(input.forceAvailableButtonEnabled, defaultDispatchSettings.forceAvailableButtonEnabled),
  };
}

function parseJson(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}
