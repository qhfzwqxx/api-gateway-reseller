export type RoutingDecisionTrace = {
  model?: string;
  tierId?: string | null;
  tierCode?: string | null;
  dryRun?: boolean;
  stickyTried: boolean;
  stickyHit: boolean;
  selectedBy: "sticky" | "balanced" | "fallback" | "default-provider" | null;
  selectedChannelId?: string | null;
  selectedProvider?: string | null;
  selectedUpstreamProviderKeyId?: string | null;
  candidates: RoutingChannelCandidateTrace[];
  keyCandidates: RoutingKeyCandidateTrace[];
  unavailableReasons: string[];
};

export type RoutingChannelCandidateTrace = {
  channelId: string;
  provider: string;
  speedScoreMs?: number;
  entropyScoreMs?: number;
  stickyOccupancy?: number;
  available: boolean;
  rejectedReason?: string;
};

export type RoutingKeyCandidateTrace = {
  keyId: string;
  priority?: number;
  stickyOccupancy?: number;
  available: boolean;
  rejectedReason?: string;
};

export function createRoutingDecisionTrace(
  input: Partial<RoutingDecisionTrace> = {},
): RoutingDecisionTrace {
  return {
    model: input.model,
    tierId: input.tierId,
    tierCode: input.tierCode,
    dryRun: input.dryRun,
    stickyTried: input.stickyTried ?? false,
    stickyHit: input.stickyHit ?? false,
    selectedBy: input.selectedBy ?? null,
    selectedChannelId: input.selectedChannelId,
    selectedProvider: input.selectedProvider,
    selectedUpstreamProviderKeyId: input.selectedUpstreamProviderKeyId,
    candidates: input.candidates ?? [],
    keyCandidates: input.keyCandidates ?? [],
    unavailableReasons: input.unavailableReasons ?? [],
  };
}
