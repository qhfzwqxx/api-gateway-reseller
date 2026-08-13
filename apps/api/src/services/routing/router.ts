import { getDefaultProvider, getProviderForModel } from "./pool-catalog.js";
import { createRoutingDecisionTrace } from "./decision-trace.js";
import type { RoutingInput, UpstreamAttemptRoute } from "./types.js";

export async function routeUpstreamRequest(
  input: RoutingInput,
): Promise<UpstreamAttemptRoute> {
  const modelRoute =
    input.billable && input.model
      ? await getProviderForModel(input.callerIdentity, input.model, {
          tierId: input.accessRoutePolicy?.tierId,
          excludeChannelIds: input.excludeChannelIds,
          bypassSticky: input.bypassSticky || input.dryRun,
          skipStickyUpdate: input.skipStickyUpdate || input.dryRun,
          dryRun: input.dryRun,
        })
      : null;

  if (modelRoute) {
    return {
      provider: modelRoute.provider,
      price: modelRoute.price,
      channelId: modelRoute.channelId,
      upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(modelRoute),
      release: modelRoute.release,
      decisionTrace: modelRoute.decisionTrace,
      policyRecoveryEnabled: modelRoute.policyRecoveryEnabled,
    };
  }

  return {
    provider: await getDefaultProvider(),
    price: null,
    decisionTrace: createRoutingDecisionTrace({
      model: input.model,
      tierId: input.accessRoutePolicy?.tierId,
      tierCode: input.accessRoutePolicy?.tierCode,
      dryRun: input.dryRun,
      selectedBy: "default-provider",
      unavailableReasons: input.billable
        ? ["没有可用模型池路由，回落默认上游"]
        : ["非计费请求使用默认上游"],
    }),
  };
}

export function getLoggedUpstreamProviderKeyId(
  route: Pick<UpstreamAttemptRoute, "upstreamProviderKeyId" | "provider">,
) {
  const providerKeyId =
    "upstreamProviderKeyId" in route.provider
      ? route.provider.upstreamProviderKeyId
      : undefined;
  const keyId = route.upstreamProviderKeyId ?? providerKeyId;
  return keyId === "env" ? undefined : keyId;
}
