import { prisma } from "@gateway/db";
import {
  resolveAccessRoutePolicy,
  type AccessRoutePolicy,
} from "./access-routing.js";
import { routeUpstreamRequest } from "./routing/router.js";
import { canRouteModelPoolChannel } from "./routing/channel-state.js";

export type RouteSimulationInput = {
  userId: string;
  apiKeyId: string;
  clientIp?: string | null;
  model: string;
};

export async function simulateRoute(input: RouteSimulationInput) {
  const [user, apiKey] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        status: true,
        tierId: true,
        tier: { select: { id: true, code: true, name: true, status: true } },
      },
    }),
    prisma.apiKey.findUnique({
      where: { id: input.apiKeyId },
      select: {
        id: true,
        userId: true,
        name: true,
        keyPrefix: true,
        status: true,
        tierId: true,
        tier: { select: { id: true, code: true, name: true, status: true } },
      },
    }),
  ]);

  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
  }

  if (!apiKey || apiKey.userId !== user.id) {
    throw Object.assign(new Error("API key not found for this user"), {
      statusCode: 404,
    });
  }

  const policy = await resolveAccessRoutePolicy({
    userId: user.id,
    apiKeyId: apiKey.id,
    userTierId: user.tierId,
    apiKeyTierId: apiKey.tierId,
    clientIp: input.clientIp,
  });
  const routed = await routeUpstreamRequest({
    billable: true,
    model: input.model,
    callerIdentity: `route-simulator:${user.id}:${apiKey.id}`,
    accessRoutePolicy: policy,
    dryRun: true,
  });
  const route = await explainModelRoute(input.model, policy, {
    selectedChannelId: routed.channelId,
    selectedUpstreamProviderKeyId: routed.upstreamProviderKeyId,
  });

  return {
    input,
    user,
    apiKey,
    policy,
    route,
    selectedRoute: {
      provider: {
        id: routed.provider.id,
        name: routed.provider.name,
        baseUrl: routed.provider.baseUrl,
        timeoutMs: routed.provider.timeoutMs,
      },
      priceId: routed.price?.id ?? null,
      channelId: routed.channelId ?? null,
      upstreamProviderKeyId: routed.upstreamProviderKeyId ?? null,
      decisionTrace: routed.decisionTrace ?? null,
    },
    steps: buildRouteSimulationSteps({
      user,
      apiKey,
      clientIp: input.clientIp,
      model: input.model,
      policy,
      route,
    }),
  };
}

export async function explainModelRoute(
  model: string,
  policy: AccessRoutePolicy,
  selected?: {
    selectedChannelId?: string;
    selectedUpstreamProviderKeyId?: string;
  },
) {
  const requestedPool = policy.tierId
    ? await readPoolExplanation(model, policy.tierId)
    : null;
  const effectivePool = requestedPool;

  const routeCandidates =
    effectivePool?.channels.filter(
      (channel) => channel.effectiveStatus !== "UNAVAILABLE",
    ) ?? [];

  return {
    requestedPool,
    fallbackToStandard: false,
    effectivePool,
    routeCandidates,
    selectedCandidate:
      routeCandidates.find(
        (candidate) => candidate.id === selected?.selectedChannelId,
      ) ??
      routeCandidates[0] ??
      null,
    selectedUpstreamProviderKeyId:
      selected?.selectedUpstreamProviderKeyId ?? null,
    unavailableReasons:
      routeCandidates.length > 0
        ? []
        : buildRouteUnavailableReasons(policy, requestedPool, effectivePool),
  };
}

async function readPoolExplanation(model: string, tierId: string) {
  const pool = await prisma.modelPool.findUnique({
    where: {
      model_tierId: {
        model,
        tierId,
      },
    },
    include: {
      tier: { select: { id: true, code: true, name: true, status: true } },
      channels: { orderBy: [{ priority: "asc" }, { upstreamProvider: "asc" }] },
    },
  });

  if (!pool) {
    const tier = await prisma.accessTier.findUnique({
      where: { id: tierId },
      select: { id: true, code: true, name: true, status: true },
    });
    return {
      pool: null,
      tier,
      channels: [],
      summary: {
        ready: 0,
        unavailable: 0,
      },
    };
  }

  const [providers, prices] = await Promise.all([
    prisma.upstreamProvider.findMany({
      where: {
        name: { in: pool.channels.map((channel) => channel.upstreamProvider) },
      },
      include: {
        keys: {
          where: { status: "ACTIVE" },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, keyPrefix: true, status: true },
        },
      },
    }),
    prisma.modelPrice.findMany({
      where: {
        model,
        upstreamProvider: {
          in: pool.channels.map((channel) => channel.upstreamProvider),
        },
      },
    }),
  ]);
  const providerMap = new Map(
    providers.map((provider) => [provider.name, provider]),
  );
  const priceMap = new Map(
    prices.map((price) => [`${price.upstreamProvider}:${price.model}`, price]),
  );
  const channels = pool.channels.map((channel) => {
    const provider = providerMap.get(channel.upstreamProvider);
    const price = priceMap.get(`${channel.upstreamProvider}:${model}`);
    const reasons = explainChannelUnavailable({
      poolStatus: pool.status,
      tierStatus: pool.tier?.status,
      channelStatus: channel.status,
      providerStatus: provider?.status,
      activeKeyCount: provider?.keys.length ?? 0,
      hasPrice: Boolean(price),
      priceEnabled: Boolean(price?.enabled),
    });

    return {
      id: channel.id,
      upstreamProvider: channel.upstreamProvider,
      status: channel.status,
      priority: channel.priority,
      lastFirstTokenLatencyMs: channel.lastFirstTokenLatencyMs,
      lastLatencyMs: channel.lastLatencyMs,
      lastError: channel.lastError,
      penalizedUntil: channel.penalizedUntil,
      providerStatus: provider?.status ?? "MISSING",
      activeKeys: provider?.keys ?? [],
      hasPrice: Boolean(price),
      priceEnabled: Boolean(price?.enabled),
      price: price
        ? {
            currency: price.currency,
            upstreamInputPer1MTok: price.upstreamInputPer1MTok.toString(),
            upstreamCachedInputPer1MTok:
              price.upstreamCachedInputPer1MTok.toString(),
            upstreamOutputPer1MTok: price.upstreamOutputPer1MTok.toString(),
            upstreamPriceMultiplier: price.upstreamPriceMultiplier.toString(),
            customerInputPer1MTok: price.customerInputPer1MTok.toString(),
            customerCachedInputPer1MTok:
              price.customerCachedInputPer1MTok.toString(),
            customerOutputPer1MTok: price.customerOutputPer1MTok.toString(),
            customerPriceMultiplier: price.customerPriceMultiplier.toString(),
            minimumChargeUsd: price.minimumChargeUsd.toString(),
          }
        : null,
      effectiveStatus: reasons.length === 0 ? "READY" : "UNAVAILABLE",
      unavailableReasons: reasons,
    };
  });

  return {
    pool: {
      id: pool.id,
      model: pool.model,
      tierId: pool.tierId,
      tier: pool.tier,
      status: pool.status,
      autoHealthCheckEnabled: pool.autoHealthCheckEnabled,
      healthCheckEndpoint: pool.healthCheckEndpoint,
    },
    tier: pool.tier,
    channels,
    summary: {
      ready: channels.filter((channel) => channel.effectiveStatus === "READY")
        .length,
      unavailable: channels.filter(
        (channel) => channel.effectiveStatus === "UNAVAILABLE",
      ).length,
    },
  };
}

function explainChannelUnavailable(params: {
  poolStatus: string;
  tierStatus?: string;
  channelStatus: string;
  providerStatus?: string;
  activeKeyCount: number;
  hasPrice: boolean;
  priceEnabled: boolean;
}) {
  const reasons: string[] = [];
  if (params.tierStatus && params.tierStatus !== "ACTIVE") {
    reasons.push("访问等级未启用");
  }
  if (params.poolStatus !== "ACTIVE") {
    reasons.push("模型池未启用");
  }
  if (!canRouteModelPoolChannel(params.channelStatus)) {
    reasons.push(`渠道状态为 ${params.channelStatus}`);
  }
  if (params.providerStatus !== "ACTIVE") {
    reasons.push(
      params.providerStatus
        ? `上游状态为 ${params.providerStatus}`
        : "上游不存在",
    );
  }
  if (params.activeKeyCount <= 0) {
    reasons.push("上游没有 ACTIVE Key");
  }
  if (!params.hasPrice) {
    reasons.push("缺少模型价格");
  } else if (!params.priceEnabled) {
    reasons.push("模型价格未启用");
  }
  return reasons;
}

function buildRouteUnavailableReasons(
  policy: AccessRoutePolicy,
  requestedPool: Awaited<ReturnType<typeof readPoolExplanation>> | null,
  effectivePool: Awaited<ReturnType<typeof readPoolExplanation>> | null,
) {
  const reasons: string[] = [];
  if (!requestedPool?.pool) {
    reasons.push("目标等级没有该模型池");
  } else if (
    effectivePool?.pool?.status &&
    effectivePool.pool.status !== "ACTIVE"
  ) {
    reasons.push("目标等级模型池未启用");
  }
  if (effectivePool?.channels.length === 0) {
    reasons.push("目标等级模型池没有渠道");
  }
  return reasons.length > 0 ? reasons : ["没有可用渠道"];
}

function buildRouteSimulationSteps(params: {
  user: { status: string; tier?: { name: string; code: string } | null };
  apiKey: { status: string; tier?: { name: string; code: string } | null };
  clientIp?: string | null;
  model: string;
  policy: AccessRoutePolicy;
  route: Awaited<ReturnType<typeof explainModelRoute>>;
}) {
  return [
    `用户状态：${params.user.status}`,
    `API Key 状态：${params.apiKey.status}`,
    `来源 IP：${params.clientIp?.trim() || "未提供"}`,
    `请求模型：${params.model}`,
    "按来源 IP 等级、Key 等级、用户等级、默认 standard 解析访问等级",
    `最终访问等级：${params.policy.tierCode}`,
    "仅使用最终访问等级对应的模型池",
    params.route.selectedCandidate
      ? `模拟首选渠道：${params.route.selectedCandidate.upstreamProvider}，客户输入/输出价 ${params.route.selectedCandidate.price?.customerInputPer1MTok ?? "-"} / ${params.route.selectedCandidate.price?.customerOutputPer1MTok ?? "-"} 每 1M tokens`
      : `无可用渠道：${params.route.unavailableReasons.join("；")}`,
  ];
}
