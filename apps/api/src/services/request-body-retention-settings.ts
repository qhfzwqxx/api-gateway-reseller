import { Prisma, prisma } from "@gateway/db";

export type RequestBodyRetentionSettings = {
  enabled: boolean;
  retentionDays: number;
};

export const minRequestBodyRetentionDays = 1;
export const maxRequestBodyRetentionDays = 3650;
export const defaultRequestBodyRetentionSettings: RequestBodyRetentionSettings = {
  enabled: true,
  retentionDays: 300,
};

const settingKey = "request_body_retention_settings";
const settingsCacheTtlMs = 5_000;
const cleanupIntervalMs = 60 * 60 * 1000;
const initialCleanupDelayMs = 30 * 1000;
const cleanupBatchSize = 500;
const maxBatchesPerRun = 10;

let cachedSettings = defaultRequestBodyRetentionSettings;
let cachedSettingsLoadedAtMs = 0;
let cleanupInProgress = false;

type RequestBodyCleanupLogger = {
  error: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

export async function readRequestBodyRetentionSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedSettingsLoadedAtMs < settingsCacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeRequestBodyRetentionSettings(
    parseStoredSettings(setting?.value),
  );
  cachedSettingsLoadedAtMs = nowMs;
  return cachedSettings;
}

export async function saveRequestBodyRetentionSettings(
  input: Partial<RequestBodyRetentionSettings>,
) {
  const settings = normalizeRequestBodyRetentionSettings({
    ...(await readRequestBodyRetentionSettings()),
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });

  cachedSettings = settings;
  cachedSettingsLoadedAtMs = Date.now();
  return settings;
}

export function normalizeRequestBodyRetentionSettings(
  input: Partial<RequestBodyRetentionSettings>,
): RequestBodyRetentionSettings {
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : defaultRequestBodyRetentionSettings.enabled,
    retentionDays: normalizeRequestBodyRetentionDays(input.retentionDays),
  };
}

export function normalizeRequestBodyRetentionDays(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultRequestBodyRetentionSettings.retentionDays;
  }

  return Math.min(
    maxRequestBodyRetentionDays,
    Math.max(minRequestBodyRetentionDays, Math.round(numeric)),
  );
}

export async function cleanupExpiredRequestBodies() {
  if (cleanupInProgress) {
    return { count: 0, skipped: true as const, reason: "already_running" as const };
  }

  cleanupInProgress = true;
  try {
    const settings = await readRequestBodyRetentionSettings();
    if (!settings.enabled) {
      return { count: 0, skipped: true as const, reason: "disabled" as const };
    }

    const cutoff = new Date(
      Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000,
    );
    let count = 0;
    let batches = 0;
    let lastBatchSize = 0;

    while (batches < maxBatchesPerRun) {
      const clearedRows = await prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          WITH candidates AS (
            SELECT id
            FROM "ApiRequest"
            WHERE "requestBody" IS NOT NULL
              AND "createdAt" < ${cutoff}
            ORDER BY "createdAt" ASC, id ASC
            LIMIT ${cleanupBatchSize}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "ApiRequest" AS target
          SET "requestBody" = NULL
          FROM candidates
          WHERE target.id = candidates.id
          RETURNING target.id
        `,
      );

      lastBatchSize = clearedRows.length;
      count += clearedRows.length;
      batches += 1;
      if (clearedRows.length < cleanupBatchSize) {
        break;
      }
    }

    return {
      count,
      batches,
      cutoff: cutoff.toISOString(),
      retentionDays: settings.retentionDays,
      hasMore:
        batches === maxBatchesPerRun && lastBatchSize === cleanupBatchSize,
      skipped: false as const,
    };
  } finally {
    cleanupInProgress = false;
  }
}

export function startRequestBodyRetentionScheduler(
  logger?: RequestBodyCleanupLogger,
) {
  const runCleanup = () => {
    void cleanupExpiredRequestBodies()
      .then((result) => {
        if (!result.skipped && result.count > 0) {
          logger?.info?.(
            result,
            "Expired API request bodies cleared by retention policy",
          );
        }
      })
      .catch((error) => {
        logger?.error(error, "Expired API request body cleanup failed");
      });
  };

  const initialTimer = setTimeout(runCleanup, initialCleanupDelayMs);
  const intervalTimer = setInterval(runCleanup, cleanupIntervalMs);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}

function parseStoredSettings(value: string | undefined) {
  if (!value) {
    return defaultRequestBodyRetentionSettings;
  }

  try {
    return JSON.parse(value) as Partial<RequestBodyRetentionSettings>;
  } catch {
    return defaultRequestBodyRetentionSettings;
  }
}
