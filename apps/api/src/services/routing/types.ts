import type { getDefaultProvider, getProviderForModel } from "../upstream.js";
import type { AccessRoutePolicy } from "../access-routing.js";
import type { RoutingDecisionTrace } from "./decision-trace.js";

export type ModelRoute = NonNullable<
  Awaited<ReturnType<typeof getProviderForModel>>
>;

export type UpstreamAttemptRoute = {
  provider:
    | ModelRoute["provider"]
    | Awaited<ReturnType<typeof getDefaultProvider>>;
  price: ModelRoute["price"] | null;
  channelId?: string;
  upstreamProviderKeyId?: string;
  release?: () => Promise<void>;
  decisionTrace?: RoutingDecisionTrace;
  policyRecoveryEnabled?: boolean;
};

export type RoutingInput = {
  billable: boolean;
  model?: string;
  callerIdentity: string;
  accessRoutePolicy?: AccessRoutePolicy;
  excludeChannelIds?: string[];
  bypassSticky?: boolean;
  skipStickyUpdate?: boolean;
  dryRun?: boolean;
};

export type RoutingFeedbackInput = {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  failed?: boolean;
  streamed?: boolean;
  retryableFailure?: boolean;
  immediatePenalty?: boolean;
  penaltyReason?: string;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
  ignoreSlowPenalty?: boolean;
  logger?: {
    warn: (value: unknown, message?: string) => void;
    info?: (value: unknown, message?: string) => void;
  };
};
