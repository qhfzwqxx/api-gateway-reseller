import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { requireApiKey, requireUser } from "../services/auth.js";
import { resolveAccessRoutePolicy } from "../services/access-routing.js";
import { getClientIp } from "../services/proxy-request-utils.js";
import type { ApiRequestWithUser } from "../types.js";
import { readImageGenerationToolSettings } from "../services/image-generation-tool-settings.js";

export async function usageRoutes(app: FastifyInstance) {
  app.get("/v1/models", async (request: ApiRequestWithUser, reply) => {
    await requireApiKey(app, request, reply);
    if (reply.sent || !request.apiAuth) {
      return;
    }

    const { apiKey, user } = request.apiAuth;
    const accessRoutePolicy = await resolveAccessRoutePolicy({
      userId: user.id,
      apiKeyId: apiKey.id,
      userTierId: user.tierId,
      apiKeyTierId: apiKey.tierId,
      clientIp: getClientIp(request),
    });
    const models = await listReadyModels({
      tierId: accessRoutePolicy.tierId,
      allowedModels:
        apiKey.allowedModels.length > 0
          ? apiKey.allowedModels
          : user.allowedModels,
    });
    const imageGenerationSettings = await readImageGenerationToolSettings();
    const canBridgeImageGeneration = models.some(
      (model) => model.model === imageGenerationSettings.routingModel,
    );

    return {
      object: "list",
      data: models.map((model) => ({
        id: model.model,
        object: "model",
        created: 0,
        owned_by: "gateway",
        ready_channel_count: model.readyChannelCount,
        capabilities: {
          image_generation:
            model.model.startsWith("gpt-image-") ||
            (canBridgeImageGeneration && !model.model.startsWith("gpt-image-")),
        },
      })),
    };
  });

  app.get("/models", { preHandler: requireUser }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: authUser.sub },
      select: { id: true, status: true, allowedModels: true, tierId: true },
    });

    if (!user || user.status !== "ACTIVE") {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const accessRoutePolicy = await resolveAccessRoutePolicy({
      userId: user.id,
      apiKeyId: "frontend",
      userTierId: user.tierId,
      clientIp: getClientIp(request),
    });

    const models = await listReadyModels({
      tierId: accessRoutePolicy.tierId,
      allowedModels: user.allowedModels,
    });

    return { models };
  });

  app.get("/usage/summary", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const summaryWhere = {
      userId: user.sub,
    };

    const [requests, totalsAggregate] = await Promise.all([
      prisma.apiRequest.findMany({
        where: summaryWhere,
        orderBy: { createdAt: "desc" },
        take: 500,
        select: publicRequestSelect,
      }),
      prisma.apiRequest.aggregate({
        where: summaryWhere,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          totalTokens: true,
          chargedAmountUsd: true,
        },
      }),
    ]);

    const totals = {
      requests: totalsAggregate._count._all,
      inputTokens: totalsAggregate._sum.inputTokens ?? 0,
      cachedInputTokens: totalsAggregate._sum.cachedInputTokens ?? 0,
      outputTokens: totalsAggregate._sum.outputTokens ?? 0,
      totalTokens: totalsAggregate._sum.totalTokens ?? 0,
      chargedAmountUsd: Number(totalsAggregate._sum.chargedAmountUsd ?? 0),
    };

    return { totals, requests };
  });

  app.get("/usage/requests", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const requests = await prisma.apiRequest.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: publicRequestSelect,
    });

    return { requests };
  });
}

async function listReadyModels(params: {
  tierId?: string | null;
  allowedModels: string[];
}) {
  const pools = await prisma.modelPool.findMany({
    where: {
      status: "ACTIVE",
      tierId: params.tierId,
      ...(params.allowedModels.length > 0
        ? { model: { in: params.allowedModels } }
        : {}),
    },
    orderBy: { model: "asc" },
    include: {
      channels: {
        where: { status: { in: ["ACTIVE", "FORCED_ACTIVE"] } },
        orderBy: [
          { lastFirstTokenLatencyMs: "asc" },
          { lastLatencyMs: "asc" },
          { priority: "asc" },
        ],
      },
    },
  });
  const [prices, providers] = await Promise.all([
    prisma.modelPrice.findMany({
      where: {
        enabled: true,
        model: { in: pools.map((pool) => pool.model) },
      },
      select: {
        model: true,
        upstreamProvider: true,
      },
    }),
    prisma.upstreamProvider.findMany({
      where: { status: "ACTIVE" },
      select: {
        name: true,
        keys: {
          where: { status: "ACTIVE" },
          select: { id: true },
        },
      },
    }),
  ]);
  const priceSet = new Set(
    prices.map((price) => `${price.upstreamProvider}:${price.model}`),
  );
  const providerSet = new Set(
    providers
      .filter((provider) => provider.keys.length > 0)
      .map((provider) => provider.name),
  );
  const modelsByName = new Map<
    string,
    { model: string; status: "READY"; readyChannelCount: number }
  >();

  for (const pool of pools) {
    const readyChannelCount = pool.channels.filter(
      (channel) =>
        providerSet.has(channel.upstreamProvider) &&
        priceSet.has(`${channel.upstreamProvider}:${pool.model}`),
    ).length;

    if (readyChannelCount <= 0) {
      continue;
    }

    const existing = modelsByName.get(pool.model);
    if (existing) {
      existing.readyChannelCount += readyChannelCount;
      continue;
    }

    modelsByName.set(pool.model, {
      model: pool.model,
      status: "READY",
      readyChannelCount,
    });
  }

  return [...modelsByName.values()];
}

const publicRequestSelect = {
  id: true,
  traceCode: true,
  clientIp: true,
  apiKey: {
    select: {
      id: true,
      name: true,
      keyPrefix: true,
    },
  },
  model: true,
  endpoint: true,
  method: true,
  status: true,
  httpStatus: true,
  inputTokens: true,
  cachedInputTokens: true,
  outputTokens: true,
  totalTokens: true,
  chargedAmountUsd: true,
  latencyMs: true,
  firstTokenLatencyMs: true,
  upstreamFirstChunkLatencyMs: true,
  errorMessage: true,
  createdAt: true,
} as const;
