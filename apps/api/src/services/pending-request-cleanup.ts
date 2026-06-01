import { prisma } from "@gateway/db";
import {
  abortActiveApiRequest,
  createManualTerminateUsage,
  manualTerminateStatusCode,
} from "./active-api-requests.js";
import { readPendingAutoTerminateSettings } from "./pending-auto-terminate-settings.js";
import { redis } from "../lib/redis.js";
import { recordAutoTerminatedIp } from "./temporary-ip-notice-ban.js";
import { markRequestFailed } from "./billing.js";

type PendingRequestCleanupLogger = {
  error: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

const cleanupIntervalMs = 5 * 1000;
const cleanupBatchSize = 200;

export async function cleanupStalePendingRequests(olderThanMs?: number) {
  const settings = await readPendingAutoTerminateSettings();
  if (!settings.enabled && olderThanMs === undefined) {
    return { count: 0, abortedActiveCount: 0, skipped: true as const };
  }

  const stalePendingMs = olderThanMs ?? settings.timeoutSeconds * 1000;
  const cutoff = new Date(Date.now() - stalePendingMs);
  const pendingRequests = await prisma.apiRequest.findMany({
    where: {
      status: "PENDING",
      createdAt: {
        lt: cutoff,
      },
    },
    select: {
      id: true,
      createdAt: true,
      clientIp: true,
      responseUsage: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: cleanupBatchSize,
  });

  let count = 0;
  let abortedActiveCount = 0;

  for (const pendingRequest of pendingRequests) {
    if (isProtectedCompactRequest(pendingRequest.responseUsage)) {
      continue;
    }

    const abortResult = abortActiveApiRequest(pendingRequest.id);
    const latencyMs = Math.min(
      2147483647,
      Math.max(0, Math.round(Date.now() - pendingRequest.createdAt.getTime())),
    );
    const changed = await markRequestFailed(
      { id: pendingRequest.id },
      settings.message,
      manualTerminateStatusCode,
      latencyMs,
      createManualTerminateUsage(abortResult.aborted),
      "AUTO_TERMINATED",
    );

    if (changed) {
      count += 1;
      if (abortResult.aborted) {
        abortedActiveCount += 1;
      }
      await recordAutoTerminatedIp(redis, pendingRequest.clientIp);
    }
  }

  return { count, abortedActiveCount, skipped: false as const };
}

function isProtectedCompactRequest(responseUsage: unknown) {
  if (
    !responseUsage ||
    typeof responseUsage !== "object" ||
    Array.isArray(responseUsage)
  ) {
    return false;
  }

  const record = responseUsage as Record<string, unknown>;
  return (
    record.gatewayCompactFallback === true ||
    record.gatewayCompactKind === "normal" ||
    record.gatewayCompactKind === "fallback"
  );
}

export function startPendingRequestCleanupScheduler(
  logger?: PendingRequestCleanupLogger,
) {
  const timer = setInterval(() => {
    void cleanupStalePendingRequests()
      .then((result) => {
        if (result.count > 0) {
          logger?.info?.(
            result,
            "Stale pending API requests manually terminated by timeout",
          );
        }
      })
      .catch((error) => {
        logger?.error(error, "Stale pending API request cleanup failed");
      });
  }, cleanupIntervalMs);

  return () => clearInterval(timer);
}
