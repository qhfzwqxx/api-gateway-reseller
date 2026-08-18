import { prisma } from "@gateway/db";
import { env } from "../env.js";
import {
  clearStickyModelPoolChannel,
  getStickyChannelOccupancies,
  getStickyModelPoolRoute,
} from "./model-pool-stickiness.js";
import {
  getInflightPenaltyMs,
  getSpeedScoreMs,
  reserveBalancedModelPoolChannel,
  reserveModelPoolChannel,
} from "./routing/channel-selector.js";
import { readDispatchSettings } from "./dispatch-settings.js";
import {
  getChannelHealthSpeedScores,
  getRecentChannelFailureCounts,
} from "./model-pool-routing-metrics.js";
import {
  reserveProviderKey,
  type UpstreamKeyReservation,
} from "./routing/key-selector.js";
import { callableChannelStatuses } from "./routing/channel-state.js";
import {
  createRoutingDecisionTrace,
  type RoutingDecisionTrace,
} from "./routing/decision-trace.js";

type Provider = Awaited<ReturnType<typeof getDefaultProvider>>;
type ReleaseModelPoolReservation = () => Promise<void>;
type RoutedProvider = Provider & {
  apiKey: string;
  upstreamProviderKeyId?: string;
  upstreamProviderKeyName?: string;
  upstreamProviderKeyPrefix?: string;
};
type PreparedModelRoute = {
  provider: RoutedProvider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId: string;
  upstreamProviderKeyId?: string;
  keyDecisionTrace?: UpstreamKeyReservation["decisionTrace"];
  release?: ReleaseModelPoolReservation;
  decisionTrace?: RoutingDecisionTrace;
  policyRecoveryEnabled?: boolean;
};
type RouteCandidate = {
  provider: Provider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId: string;
  speedScoreMs: number;
  entropyScore: number;
  stickyOccupancy: number;
  recentFailureCount: number;
};
type ModelRouteOptions = {
  tierId?: string | null;
  excludeChannelIds?: string[];
  bypassSticky?: boolean;
  skipStickyUpdate?: boolean;
  dryRun?: boolean;
};

export function scopeModelPoolCallerIdentity(
  callerIdentity: string,
  tierId?: string | null,
) {
  return tierId ? `${callerIdentity}:tier:${tierId}` : callerIdentity;
}

export async function getDefaultProvider() {
  const provider = await prisma.upstreamProvider.findFirst({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      priority: "asc",
    },
  });

  if (provider) {
    return provider;
  }

  return {
    id: "env",
    name: "default",
    baseUrl: env.UPSTREAM_BASE_URL,
    apiKey: env.UPSTREAM_API_KEY,
    status: "ACTIVE" as const,
    priority: 100,
    timeoutMs: env.UPSTREAM_TIMEOUT_MS,
    compactItemType: "compaction_summary",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getProviderForModel(
  callerIdentity: string,
  model: string,
  options: ModelRouteOptions = {},
): Promise<PreparedModelRoute | null> {
  const decisionTrace = createRoutingDecisionTrace({
    model,
    tierId: options.tierId,
    dryRun: options.dryRun,
  });
  const modelPool = await findModelPoolForTier(model, options.tierId);

  if (!modelPool || modelPool.channels.length === 0) {
    decisionTrace.unavailableReasons.push(
      "没有可用模型池或模型池没有可路由渠道",
    );
    return null;
  }

  const scopedCallerIdentity = scopeModelPoolCallerIdentity(
    callerIdentity,
    options.tierId,
  );
  const excludedChannelIds = new Set(options.excludeChannelIds ?? []);
  const dispatchSettings = await readDispatchSettings();
  const stickyRouteState =
    options.bypassSticky || !dispatchSettings.stickyEnabled
      ? null
      : await getStickyModelPoolRoute(scopedCallerIdentity, model);
  decisionTrace.stickyTried = Boolean(stickyRouteState);
  if (!options.bypassSticky && !dispatchSettings.stickyEnabled) {
    await clearStickyModelPoolChannel(scopedCallerIdentity, model).catch(
      () => undefined,
    );
  }
  if (stickyRouteState) {
    const stickyChannel = modelPool.channels.find(
      (channel) => channel.id === stickyRouteState.channelId,
    );
    if (stickyChannel && !excludedChannelIds.has(stickyChannel.id)) {
      const stickyRoute = await getRouteForChannelWithKey(
        model,
        stickyChannel,
        stickyRouteState.upstreamProviderKeyId,
        options.dryRun,
      );

      if (stickyRoute) {
        stickyRoute.decisionTrace = decisionTrace;
        decisionTrace.stickyHit = true;
        decisionTrace.selectedBy = "sticky";
        decisionTrace.selectedChannelId = stickyRoute.channelId;
        decisionTrace.selectedProvider = stickyRoute.provider.name;
        decisionTrace.selectedUpstreamProviderKeyId =
          stickyRoute.upstreamProviderKeyId ?? null;
        decisionTrace.keyCandidates =
          stickyRoute.keyDecisionTrace?.candidates ?? [];
        return {
          ...stickyRoute,
          policyRecoveryEnabled: modelPool.policyRecoveryEnabled,
        };
      }
    }

    await clearStickyModelPoolChannel(
      scopedCallerIdentity,
      model,
      stickyRouteState.channelId,
      stickyRouteState.upstreamProviderKeyId,
    );
  }

  const routeCandidates = await getRouteCandidates(
    model,
    modelPool.channels.filter((channel) => !excludedChannelIds.has(channel.id)),
  );
  decisionTrace.candidates = routeCandidates.map((route) => ({
    channelId: route.channelId,
    provider: route.provider.name,
    speedScoreMs: route.speedScoreMs,
    entropyScoreMs: route.entropyScore,
    stickyOccupancy: route.stickyOccupancy,
    recentFailureCount: route.recentFailureCount,
    available: true,
  }));
  if (routeCandidates.length === 0) {
    decisionTrace.unavailableReasons.push(
      "没有通过价格、上游和 Key 检查的渠道",
    );
    return null;
  }

  const skippedChannelIds = new Set<string>();

  while (skippedChannelIds.size < routeCandidates.length) {
    const selectableRoutes = routeCandidates.filter(
      (route) => !skippedChannelIds.has(route.channelId),
    );
    const balancedRoute = await getBalancedRoute(selectableRoutes, {
      dryRun: options.dryRun,
      channelConcurrencyPenalty: dispatchSettings.channelConcurrencyPenalty,
    });
    if (!balancedRoute) {
      return null;
    }

    const preparedRoute = await prepareRoute(
      balancedRoute,
      undefined,
      options.dryRun,
    );
    if (preparedRoute) {
      preparedRoute.decisionTrace = decisionTrace;
      decisionTrace.selectedBy = balancedRoute.release
        ? "balanced"
        : "fallback";
      decisionTrace.selectedChannelId = preparedRoute.channelId;
      decisionTrace.selectedProvider = preparedRoute.provider.name;
      decisionTrace.selectedUpstreamProviderKeyId =
        preparedRoute.upstreamProviderKeyId ?? null;
      decisionTrace.keyCandidates =
        preparedRoute.keyDecisionTrace?.candidates ?? [];
      return {
        ...preparedRoute,
        policyRecoveryEnabled: modelPool.policyRecoveryEnabled,
      };
    }

    await balancedRoute.release?.();
    skippedChannelIds.add(balancedRoute.channelId);
    await clearStickyModelPoolChannel(
      scopedCallerIdentity,
      model,
      balancedRoute.channelId,
    );
  }

  decisionTrace.unavailableReasons.push("渠道存在，但没有可用上游 Key");
  return null;
}

async function findModelPoolForTier(model: string, tierId?: string | null) {
  return tierId ? findActiveModelPool(model, tierId) : null;
}

function findActiveModelPool(model: string, tierId: string) {
  return prisma.modelPool.findFirst({
    where: {
      model,
      tierId,
      status: "ACTIVE",
    },
    include: {
      channels: {
        where: {
          status: { in: [...callableChannelStatuses] },
        },
        orderBy: [
          { lastFirstTokenLatencyMs: "asc" },
          { lastLatencyMs: "asc" },
          { priority: "asc" },
          { updatedAt: "desc" },
        ],
      },
    },
  });
}

async function getRouteCandidates(
  model: string,
  channels: Array<{
    id: string;
    upstreamProvider: string;
    lastFirstTokenLatencyMs: number | null;
    lastLatencyMs: number | null;
    priority: number;
  }>,
): Promise<RouteCandidate[]> {
  const routes = await Promise.all(
    channels.map(async (channel) => {
      const route = await getRouteForChannel(model, channel);

      if (!route) {
        return null;
      }

      return {
        ...route,
        speedScoreMs: getSpeedScoreMs({
          firstTokenLatencyMs: channel.lastFirstTokenLatencyMs,
          latencyMs: channel.lastLatencyMs,
          priority: channel.priority,
        }),
      };
    }),
  );

  const availableRoutes = routes.filter(
    (route): route is NonNullable<(typeof routes)[number]> => Boolean(route),
  );
  const stickyOccupancies = await getStickyChannelOccupancies(
    availableRoutes.map((route) => route.channelId),
  );
  const [healthSpeedScores, recentFailureCounts] = await Promise.all([
    getChannelHealthSpeedScores(availableRoutes.map((route) => route.channelId)),
    getRecentChannelFailureCounts(availableRoutes.map((route) => route.channelId)),
  ]);
  const settings = await readDispatchSettings();
  const speedScores = availableRoutes.map((route) =>
    healthSpeedScores.get(route.channelId) ?? route.speedScoreMs,
  );
  const fastestSpeedScore = Math.max(1, Math.min(...speedScores));
  const totalStickyOccupancy = availableRoutes.reduce(
    (sum, route) => sum + (stickyOccupancies.get(route.channelId) ?? 0),
    0,
  );

  return availableRoutes
    .map((route) => {
      const speedScoreMs =
        healthSpeedScores.get(route.channelId) ?? route.speedScoreMs;
      const stickyOccupancy = stickyOccupancies.get(route.channelId) ?? 0;
      const recentFailureCount = recentFailureCounts.get(route.channelId) ?? 0;
      const relativeSpeedPenalty =
        ((speedScoreMs - fastestSpeedScore) /
          Math.max(fastestSpeedScore, 500)) *
        settings.speedRankPenalty;
      const stickyPenalty = totalStickyOccupancy > 0
        ? (stickyOccupancy / totalStickyOccupancy) * settings.stickyHitPenalty
        : 0;

      return {
        ...route,
        speedScoreMs,
        stickyOccupancy,
        recentFailureCount,
        entropyScore:
          Math.max(0, relativeSpeedPenalty) +
          stickyPenalty +
          recentFailureCount * settings.recentFailurePenalty,
      };
    })
    .sort((a, b) => a.entropyScore - b.entropyScore);
}

async function getBalancedRoute(
  routes: Array<{
    provider: Provider;
    price: NonNullable<
      Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>
    >;
    channelId: string;
    speedScoreMs: number;
    entropyScore: number;
    stickyOccupancy: number;
    recentFailureCount: number;
  }>,
  options: { dryRun?: boolean; channelConcurrencyPenalty?: number } = {},
) {
  if (routes.length === 0) {
    return null;
  }

  const reservation = options.dryRun
    ? null
    : await reserveBalancedModelPoolChannel(
        routes.map((route) => ({
          channelId: route.channelId,
          speedScoreMs: route.entropyScore,
          stickyOccupancy: route.stickyOccupancy,
        })),
        getInflightPenaltyMs(options.channelConcurrencyPenalty),
      );

  if (reservation) {
    const route = routes.find(
      (candidate) => candidate.channelId === reservation.channelId,
    );
    if (route) {
      return {
        provider: route.provider,
        price: route.price,
        channelId: route.channelId,
        release: reservation.release,
      };
    }

    await reservation.release();
  }

  const fallbackRoute = routes[0];
  if (!fallbackRoute) {
    return null;
  }

  return {
    provider: fallbackRoute.provider,
    price: fallbackRoute.price,
    channelId: fallbackRoute.channelId,
  };
}

async function getRouteForChannel(
  model: string,
  channel: {
    id: string;
    upstreamProvider: string;
  },
): Promise<{
  provider: Provider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId: string;
} | null> {
  const provider = await prisma.upstreamProvider.findFirst({
    where: {
      name: channel.upstreamProvider,
      status: "ACTIVE",
    },
  });

  if (!provider) {
    return null;
  }

  const price = await prisma.modelPrice.findUnique({
    where: {
      upstreamProvider_model: {
        upstreamProvider: channel.upstreamProvider,
        model,
      },
    },
  });

  if (price?.enabled) {
    const [activeKeyCount, keyCount] = await Promise.all([
      prisma.upstreamProviderKey.count({
        where: {
          upstreamProviderId: provider.id,
          status: "ACTIVE",
        },
      }),
      prisma.upstreamProviderKey.count({
        where: {
          upstreamProviderId: provider.id,
        },
      }),
    ]);

    if (activeKeyCount === 0 && (keyCount > 0 || !provider.apiKey.trim())) {
      return null;
    }

    return { provider, price, channelId: channel.id };
  }

  return null;
}

async function getRouteForChannelWithKey(
  model: string,
  channel: {
    id: string;
    upstreamProvider: string;
  },
  preferredKeyId?: string | null,
  dryRun?: boolean,
) {
  const route = await getRouteForChannel(model, channel);

  if (!route) {
    return null;
  }

  const channelReservation = dryRun
    ? null
    : await reserveModelPoolChannel(route.channelId);

  try {
    const preparedRoute = await prepareRoute(
      channelReservation
        ? { ...route, release: channelReservation.release }
        : route,
      preferredKeyId,
      dryRun,
    );
    if (!preparedRoute) {
      await channelReservation?.release();
      return null;
    }

    return preparedRoute;
  } catch (error) {
    await channelReservation?.release();
    throw error;
  }
}

async function prepareRoute(
  route: {
    provider: Provider;
    price: NonNullable<
      Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>
    >;
    channelId: string;
    release?: ReleaseModelPoolReservation;
  },
  preferredKeyId?: string | null,
  dryRun?: boolean,
): Promise<PreparedModelRoute | null> {
  const keyReservation = await reserveKeyForProvider(
    route.provider,
    preferredKeyId,
    dryRun,
  );

  if (!keyReservation) {
    return null;
  }

  return {
    provider: {
      ...route.provider,
      apiKey: keyReservation.key.key,
      upstreamProviderKeyId: keyReservation.key.id,
      upstreamProviderKeyName: keyReservation.key.name,
      upstreamProviderKeyPrefix: keyReservation.key.keyPrefix,
    },
    price: route.price,
    channelId: route.channelId,
    upstreamProviderKeyId: keyReservation.key.id,
    keyDecisionTrace: keyReservation.decisionTrace,
    release: composeReleases(route.release, keyReservation.release),
  };
}

async function reserveKeyForProvider(
  provider: Provider,
  preferredKeyId?: string | null,
  dryRun?: boolean,
): Promise<UpstreamKeyReservation | null> {
  if (provider.id === "env") {
    return {
      key: {
        id: "env",
        upstreamProviderId: "env",
        name: "环境变量 Key",
        key: provider.apiKey,
        keyPrefix: provider.apiKey.slice(
          0,
          Math.min(12, provider.apiKey.length),
        ),
        status: "ACTIVE",
        priority: provider.priority,
        lastUsedAt: null,
        lastCheckStatus: null,
        lastCheckedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      release: async () => {},
    };
  }

  return reserveProviderKey(provider, preferredKeyId, { dryRun });
}

function composeReleases(
  first: ReleaseModelPoolReservation | undefined,
  second: ReleaseModelPoolReservation,
): ReleaseModelPoolReservation {
  return async () => {
    await Promise.allSettled([first?.(), second()]);
  };
}

export function buildUpstreamUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedBase.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
}
