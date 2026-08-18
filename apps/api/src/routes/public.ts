import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { prisma } from "@gateway/db";
import {
  isSmtpConfigured,
  readAuthSettings,
} from "../services/auth-settings.js";
import { readCharityAnnouncementSettings } from "../services/charity-announcement-settings.js";
import { sendEmergencyAdminCallEmail } from "../services/mailer.js";
import { onPublicStatusChanged } from "../services/public-status-events.js";
import { readUnifiedPriceSettings } from "../services/unified-pricing.js";
import {
  readSecurityResearchSkillFile,
  readSecurityResearchSkillManifest,
} from "../services/policy-recovery-security-skill.js";

type CharityRequestRow = {
  day: string;
  requests: bigint;
  success_requests: bigint;
  failed_requests: bigint;
  input_tokens: bigint | null;
  cached_input_tokens: bigint | null;
  output_tokens: bigint | null;
  total_tokens: bigint | null;
  charged_amount_usd: Prisma.Decimal | null;
  upstream_cost_usd: Prisma.Decimal | null;
};

type CharityRankRow = {
  user_id: string;
  display_name: string | null;
  requests: bigint;
  success_requests: bigint;
  input_tokens: bigint | null;
  cached_input_tokens: bigint | null;
  output_tokens: bigint | null;
  total_tokens: bigint | null;
  charged_amount_usd: Prisma.Decimal | null;
};

type CharityModelRow = {
  model: string;
  requests: bigint;
  success_requests: bigint;
  total_tokens: bigint | null;
  charged_amount_usd: Prisma.Decimal | null;
};

type CharityPriceUsageRow = {
  day: string;
  model: string;
  upstream_provider: string;
  input_tokens: bigint | null;
  cached_input_tokens: bigint | null;
  output_tokens: bigint | null;
};

type PublicReadyChannelRow = {
  count: bigint;
};

const emergencyAdminEmail = "1810499229@qq.com";
const emergencyAdminCallCooldownSeconds = 5 * 60;
const emergencyAdminFallbackLimits = new Map<string, number>();
const emergencyAdminCallSchema = z.object({
  message: z.string().trim().max(1000).optional().default(""),
  source: z.string().trim().max(40).optional(),
});

export async function publicRoutes(app: FastifyInstance) {
  app.get("/security-research/current", async (_request, reply) => {
    const content = readSecurityResearchSkillFile("SKILL.md");
    if (content === null) {
      return reply.status(404).send({ message: "Skill entry not found" });
    }
    return reply
      .type("text/markdown; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .send(content);
  });
  app.get<{ Params: { "*": string } }>(
    "/security-research/current/*",
    async (request, reply) => {
      const requestedPath = decodeURIComponent(request.params["*"] || "");
      if (requestedPath === "manifest.json") {
        return reply
          .type("application/json; charset=utf-8")
          .header("cache-control", "public, max-age=300")
          .send(readSecurityResearchSkillManifest());
      }
      const content = readSecurityResearchSkillFile(requestedPath);
      if (content === null) {
        return reply.status(404).send({ message: "Skill file not found" });
      }
      return reply
        .type(contentTypeForSkillPath(requestedPath))
        .header("cache-control", "public, max-age=300")
        .send(content);
    },
  );
  app.get("/public/charity-status", async () => getPublicModelPoolStatus());

  app.post("/public/emergency-admin-call", async (request, reply) => {
    const body = emergencyAdminCallSchema.parse(request.body ?? {});
    const ip = normalizeClientIp(request.ip);
    const allowed = await reserveEmergencyAdminCallSlot(app, ip);

    if (!allowed) {
      return reply.status(429).send({
        message: "同一 IP 5 分钟内只能呼叫一次管理员，请稍后再试。",
      });
    }

    const settings = await readAuthSettings();
    if (!isSmtpConfigured(settings)) {
      return reply.status(503).send({
        message: "邮件服务尚未配置，请稍后再试。",
      });
    }

    try {
      await sendEmergencyAdminCallEmail(settings, {
        to: emergencyAdminEmail,
        ip,
        calledAt: new Date(),
        message: body.message,
      });
    } catch (error) {
      app.log.error({ error, ip }, "Failed to send emergency admin call email");
      return reply.status(502).send({
        message: "呼叫邮件发送失败，请稍后再试。",
      });
    }

    return {
      ok: true,
      message: "已呼叫管理员，请等待处理。",
    };
  });

  app.get("/public/charity-status/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let previousPayload = "";
    let closed = false;
    let keepaliveTimer: NodeJS.Timeout | undefined;
    let fallbackTimer: NodeJS.Timeout | undefined;
    const sendStatus = async () => {
      if (closed || reply.raw.destroyed) {
        return;
      }

      try {
        const status = await getPublicModelPoolStatus();
        const payload = JSON.stringify(status);
        if (payload !== previousPayload) {
          previousPayload = payload;
          reply.raw.write(`event: status\ndata: ${payload}\n\n`);
        } else {
          reply.raw.write(": keepalive\n\n");
        }
      } catch (error) {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({
            available: false,
            message: error instanceof Error ? error.message : "status failed",
          })}\n\n`,
        );
      }
    };

    const offStatusChanged = onPublicStatusChanged(() => {
      void sendStatus();
    });

    request.raw.on("close", () => {
      closed = true;
      offStatusChanged();
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
      }
    });

    await sendStatus();
    keepaliveTimer = setInterval(() => {
      if (!closed && !reply.raw.destroyed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15000);
    fallbackTimer = setInterval(sendStatus, 5000);
  });

  app.get("/public/charity-dashboard", async () => getCharityDashboard());

  app.get("/public/charity-dashboard/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let previousPayload = "";
    let closed = false;
    let dashboardTimer: NodeJS.Timeout | undefined;
    let keepaliveTimer: NodeJS.Timeout | undefined;

    const sendDashboard = async () => {
      if (closed || reply.raw.destroyed) {
        return;
      }

      try {
        const dashboard = await getCharityDashboard();
        const payload = JSON.stringify(dashboard);
        if (payload !== previousPayload) {
          previousPayload = payload;
          reply.raw.write(`event: dashboard\ndata: ${payload}\n\n`);
        } else {
          reply.raw.write(": keepalive\n\n");
        }
      } catch (error) {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({
            message: error instanceof Error ? error.message : "dashboard failed",
          })}\n\n`,
        );
      }
    };

    request.raw.on("close", () => {
      closed = true;
      if (dashboardTimer) {
        clearInterval(dashboardTimer);
      }
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
      }
    });

    await sendDashboard();
    dashboardTimer = setInterval(sendDashboard, 5000);
    keepaliveTimer = setInterval(() => {
      if (!closed && !reply.raw.destroyed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15000);
  });
}

function contentTypeForSkillPath(path: string) {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".py")) return "text/x-python; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") || path.endsWith(".ts")) {
    return "text/javascript; charset=utf-8";
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml") || path.endsWith(".ps1") || path.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  return "text/markdown; charset=utf-8";
}

async function reserveEmergencyAdminCallSlot(
  app: FastifyInstance,
  ip: string,
) {
  const key = `public:emergency-admin-call:${ip}`;

  try {
    const result = await app.redis.set(
      key,
      String(Date.now()),
      "EX",
      emergencyAdminCallCooldownSeconds,
      "NX",
    );
    return result === "OK";
  } catch (error) {
    app.log.warn(
      { error, ip },
      "Redis unavailable for emergency admin call rate limit; using memory fallback",
    );
  }

  const now = Date.now();
  const blockedUntil = emergencyAdminFallbackLimits.get(ip) ?? 0;
  if (blockedUntil > now) {
    return false;
  }

  emergencyAdminFallbackLimits.set(
    ip,
    now + emergencyAdminCallCooldownSeconds * 1000,
  );
  cleanupEmergencyAdminFallbackLimits(now);
  return true;
}

function cleanupEmergencyAdminFallbackLimits(now: number) {
  if (emergencyAdminFallbackLimits.size < 1000) {
    return;
  }

  for (const [ip, blockedUntil] of emergencyAdminFallbackLimits) {
    if (blockedUntil <= now) {
      emergencyAdminFallbackLimits.delete(ip);
    }
  }
}

function normalizeClientIp(ip: string) {
  return ip.replace(/^::ffff:/, "");
}

async function getCharityDashboard() {
  const now = new Date();
  const todayKey = formatShanghaiDay(now);
  const since30Key = addDayKey(todayKey, -29);
  const since30 = startOfShanghaiDay(since30Key);

    const [
      charityUserRows,
      totals,
      trendRows,
      rankingRows,
      modelRows,
      priceUsageRows,
      modelPrices,
      unifiedPriceSettings,
      announcement,
    ] = await Promise.all([
      prisma.user.findMany({
        where: {
          charityEnabled: true,
          status: "ACTIVE",
        },
        orderBy: { createdAt: "desc" },
        select: {
          charityKey: true,
        },
      }),
      prisma.apiRequest.aggregate({
        where: charityRequestWhere(),
        _count: true,
        _sum: {
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          totalTokens: true,
          chargedAmountUsd: true,
          upstreamCostUsd: true,
        },
      }),
      prisma.$queryRaw<CharityRequestRow[]>(Prisma.sql`
        SELECT
          to_char(
            date_trunc('day', r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'),
            'YYYY-MM-DD'
          ) AS day,
          count(*) AS requests,
          count(*) FILTER (WHERE r.status = 'SUCCESS') AS success_requests,
          count(*) FILTER (WHERE r.status = 'FAILED') AS failed_requests,
          sum(r."inputTokens") AS input_tokens,
          sum(r."cachedInputTokens") AS cached_input_tokens,
          sum(r."outputTokens") AS output_tokens,
          sum(r."totalTokens") AS total_tokens,
          sum(r."chargedAmountUsd") AS charged_amount_usd,
          sum(r."upstreamCostUsd") AS upstream_cost_usd
        FROM "ApiRequest" r
        INNER JOIN "User" u ON u.id = r."userId"
        WHERE u."charityEnabled" = true
          AND r."createdAt" >= ${since30}
        GROUP BY day
        ORDER BY day ASC
      `),
      prisma.$queryRaw<CharityRankRow[]>(Prisma.sql`
        SELECT
          u.id AS user_id,
          u."charityDisplayName" AS display_name,
          count(*) AS requests,
          count(*) FILTER (WHERE r.status = 'SUCCESS') AS success_requests,
          sum(r."inputTokens") AS input_tokens,
          sum(r."cachedInputTokens") AS cached_input_tokens,
          sum(r."outputTokens") AS output_tokens,
          sum(r."totalTokens") AS total_tokens,
          sum(r."chargedAmountUsd") AS charged_amount_usd
        FROM "ApiRequest" r
        INNER JOIN "User" u ON u.id = r."userId"
        WHERE u."charityEnabled" = true
        GROUP BY u.id, u."charityDisplayName"
        ORDER BY total_tokens DESC NULLS LAST, requests DESC
        LIMIT 10
      `),
      prisma.$queryRaw<CharityModelRow[]>(Prisma.sql`
        SELECT
          r.model AS model,
          count(*) AS requests,
          count(*) FILTER (WHERE r.status = 'SUCCESS') AS success_requests,
          sum(r."totalTokens") AS total_tokens,
          sum(r."chargedAmountUsd") AS charged_amount_usd
        FROM "ApiRequest" r
        INNER JOIN "User" u ON u.id = r."userId"
        WHERE u."charityEnabled" = true
        GROUP BY r.model
        ORDER BY charged_amount_usd DESC NULLS LAST, total_tokens DESC NULLS LAST, requests DESC
        LIMIT 12
      `),
      prisma.$queryRaw<CharityPriceUsageRow[]>(Prisma.sql`
        SELECT
          to_char(
            date_trunc('day', r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'),
            'YYYY-MM-DD'
          ) AS day,
          r.model AS model,
          r."upstreamProvider" AS upstream_provider,
          sum(r."inputTokens") AS input_tokens,
          sum(r."cachedInputTokens") AS cached_input_tokens,
          sum(r."outputTokens") AS output_tokens
        FROM "ApiRequest" r
        INNER JOIN "User" u ON u.id = r."userId"
        WHERE u."charityEnabled" = true
          AND r.status = 'SUCCESS'
        GROUP BY day, r.model, r."upstreamProvider"
      `),
      prisma.modelPrice.findMany({
        where: { enabled: true },
      }),
      readUnifiedPriceSettings(),
      readCharityAnnouncementSettings(),
    ]);

    const requestCount = totals._count;
    const charityUsers = charityUserRows.length;
    const charityKey =
      charityUserRows.find((user) => user.charityKey?.trim())?.charityKey?.trim() ??
      null;
    const successCount = await prisma.apiRequest.count({
      where: {
        ...charityRequestWhere(),
        status: "SUCCESS",
      },
    });
    const failedCount = await prisma.apiRequest.count({
      where: {
        ...charityRequestWhere(),
        status: "FAILED",
      },
    });
    const displayCharges = calculateCharityDisplayCharges(
      priceUsageRows,
      modelPrices,
      unifiedPriceSettings,
    );

  return {
      generatedAt: now.toISOString(),
      gateway: "https://gateway.l-kx.cn",
      charityKey,
      announcement,
      totals: {
        charityUsers,
        requests: requestCount,
        successRequests: successCount,
        failedRequests: failedCount,
        successRate: requestCount > 0 ? successCount / requestCount : 0,
        inputTokens: numberFromUnknown(totals._sum.inputTokens),
        cachedInputTokens: numberFromUnknown(totals._sum.cachedInputTokens),
        outputTokens: numberFromUnknown(totals._sum.outputTokens),
        totalTokens: numberFromUnknown(totals._sum.totalTokens),
        chargedAmountUsd: displayCharges.total.toFixed(8),
        upstreamCostUsd: moneyFromUnknown(totals._sum.upstreamCostUsd),
      },
      trend30d: buildTrend(trendRows, since30Key, displayCharges.byDay),
      ranking: rankingRows.map((row, index) => ({
        name: row.display_name?.trim() || `公益项目 #${index + 1}`,
        requests: Number(row.requests),
        successRequests: Number(row.success_requests),
        successRate: Number(row.requests) > 0 ? Number(row.success_requests) / Number(row.requests) : 0,
        inputTokens: numberFromUnknown(row.input_tokens),
        cachedInputTokens: numberFromUnknown(row.cached_input_tokens),
        outputTokens: numberFromUnknown(row.output_tokens),
        totalTokens: numberFromUnknown(row.total_tokens),
        chargedAmountUsd: moneyFromUnknown(row.charged_amount_usd),
      })),
      models: modelRows.map((row) => ({
        model: row.model,
        requests: Number(row.requests),
        successRequests: Number(row.success_requests),
        successRate: Number(row.requests) > 0 ? Number(row.success_requests) / Number(row.requests) : 0,
        totalTokens: numberFromUnknown(row.total_tokens),
        chargedAmountUsd: moneyFromUnknown(row.charged_amount_usd),
      })),
  };
}

async function getPublicModelPoolStatus() {
  const now = new Date();
  const [settings, readyChannelRows, totalChannels] = await Promise.all([
    readCharityAnnouncementSettings(),
    prisma.$queryRaw<PublicReadyChannelRow[]>(Prisma.sql`
      SELECT count(*) AS count
      FROM "ModelPoolChannel" c
      INNER JOIN "ModelPool" p ON p.id = c."modelPoolId"
      INNER JOIN "ModelPrice" price
        ON price.model = p.model
       AND price."upstreamProvider" = c."upstreamProvider"
      INNER JOIN "UpstreamProvider" provider
        ON provider.name = c."upstreamProvider"
      WHERE p.status = 'ACTIVE'
        AND c.status IN ('ACTIVE', 'FORCED_ACTIVE')
        AND (c."penalizedUntil" IS NULL OR c."penalizedUntil" <= ${now})
        AND price.enabled = true
        AND provider.status = 'ACTIVE'
        AND EXISTS (
          SELECT 1
          FROM "UpstreamProviderKey" key
          WHERE key."upstreamProviderId" = provider.id
            AND key.status = 'ACTIVE'
        )
    `),
    prisma.modelPoolChannel.count({
      where: {
        modelPool: {
          status: "ACTIVE",
        },
      },
    }),
  ]);
  const readyChannels = Number(readyChannelRows[0]?.count ?? 0);
  if (!settings.serviceEnabled) {
    return {
      available: false,
      readyChannels,
      totalChannels,
      checkedAt: now.toISOString(),
      message: settings.serviceDisabledMessage,
    };
  }

  return {
    available: readyChannels > 0,
    readyChannels,
    totalChannels,
    checkedAt: now.toISOString(),
  };
}

function charityRequestWhere(): Prisma.ApiRequestWhereInput {
  return {
    user: {
      charityEnabled: true,
    },
  };
}

function buildTrend(
  rows: CharityRequestRow[],
  sinceDayKey: string,
  displayChargesByDay: Map<string, Decimal>,
) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const days: Array<{
    date: string;
    requests: number;
    successRequests: number;
    failedRequests: number;
    totalTokens: number;
    chargedAmountUsd: string;
    upstreamCostUsd: string;
  }> = [];

  for (let index = 0; index < 30; index += 1) {
    const key = addDayKey(sinceDayKey, index);
    const row = byDay.get(key);
    days.push({
      date: key,
      requests: row ? Number(row.requests) : 0,
      successRequests: row ? Number(row.success_requests) : 0,
      failedRequests: row ? Number(row.failed_requests) : 0,
      totalTokens: row ? numberFromUnknown(row.total_tokens) : 0,
      chargedAmountUsd: (displayChargesByDay.get(key) ?? new Decimal(0)).toFixed(8),
      upstreamCostUsd: row ? moneyFromUnknown(row.upstream_cost_usd) : "0.00000000",
    });
  }

  return days;
}

function calculateCharityDisplayCharges(
  rows: CharityPriceUsageRow[],
  prices: Array<{
    model: string;
    upstreamProvider: string;
    customerInputPer1MTok: Decimal;
    customerCachedInputPer1MTok: Decimal;
    customerOutputPer1MTok: Decimal;
  }>,
  unifiedSettings: Record<
    string,
    {
      enabled: boolean;
      customerInputPer1MTok: string;
      customerCachedInputPer1MTok: string;
      customerOutputPer1MTok: string;
    }
  >,
) {
  const priceByModelProvider = new Map(
    prices.map((price) => [`${price.model}\u0000${price.upstreamProvider}`, price]),
  );
  const byDay = new Map<string, Decimal>();
  let total = new Decimal(0);

  for (const row of rows) {
    const price = priceByModelProvider.get(`${row.model}\u0000${row.upstream_provider}`);
    if (!price) {
      continue;
    }
    const unified = unifiedSettings[row.model];
    const inputPrice =
      unified?.enabled === true
        ? new Decimal(unified.customerInputPer1MTok)
        : new Decimal(price.customerInputPer1MTok.toString());
    const cachedInputPrice =
      unified?.enabled === true
        ? new Decimal(unified.customerCachedInputPer1MTok)
        : new Decimal(price.customerCachedInputPer1MTok.toString());
    const outputPrice =
      unified?.enabled === true
        ? new Decimal(unified.customerOutputPer1MTok)
        : new Decimal(price.customerOutputPer1MTok.toString());
    const charge = new Decimal(numberFromUnknown(row.input_tokens))
      .div(1_000_000)
      .mul(inputPrice)
      .plus(
        new Decimal(numberFromUnknown(row.cached_input_tokens))
          .div(1_000_000)
          .mul(cachedInputPrice),
      )
      .plus(
        new Decimal(numberFromUnknown(row.output_tokens))
          .div(1_000_000)
          .mul(outputPrice),
      )
      .toDecimalPlaces(8);
    const day = row.day;
    byDay.set(day, (byDay.get(day) ?? new Decimal(0)).plus(charge));
    total = total.plus(charge);
  }

  return {
    byDay,
    total: total.toDecimalPlaces(8),
  };
}

function formatDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatShanghaiDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function addDayKey(dayKey: string, days: number) {
  const { year, month, day } = parseDayKey(dayKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDay(date);
}

function startOfShanghaiDay(dayKey: string) {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
}

function parseDayKey(dayKey: string) {
  const [year = 1970, month = 1, day = 1] = dayKey.split("-").map(Number);
  return { year, month, day };
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }

  return 0;
}

function moneyFromUnknown(value: unknown) {
  if (value && typeof value === "object" && "toString" in value) {
    return value.toString();
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }

  return "0.00000000";
}
