import http from "../http";

export type AccessTierStatus = "ACTIVE" | "DISABLED";
export type ModelPoolStatus = "ACTIVE" | "DISABLED";
export type PoolChannelStatus = "ACTIVE" | "FORCED_ACTIVE" | "DISABLED" | "UNAVAILABLE" | "PENALIZED";
export type HealthCheckEndpoint = "responses" | "chat.completions";

export interface AccessTier {
  id: string;
  code: string;
  name: string;
  status: AccessTierStatus;
  sortOrder: number;
  billingMultiplier: string;
  walletRequired: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    users: number;
    apiKeys: number;
    modelPools: number;
  };
}

export interface AccessTierSummary {
  id: string;
  code: string;
  name: string;
  status: AccessTierStatus;
}

export interface IpAccessTierRule {
  id: string;
  cidrOrIp: string;
  tierId: string;
  status: AccessTierStatus;
  priority: number;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  tier: AccessTierSummary;
}

export interface PoolChannel {
  id: string;
  modelPoolId: string;
  upstreamProvider: string;
  status: PoolChannelStatus;
  statusLabel?: string;
  priority: number;
  consecutiveFailures: number;
  recoverySuccesses: number;
  penalizedUntil: string | null;
  penaltyReason: string | null;
  lastCheckStatus: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulCallAt: string | null;
  lastLatencyMs: number | null;
  lastFirstTokenLatencyMs: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  hasPrice?: boolean;
  priceEnabled?: boolean;
  providerStatus?: string;
  providerPriority?: number | null;
  activeKeyCount?: number;
  unavailableReasons?: string[];
  isChecking?: boolean;
  checkingStartedAt?: string | null;
  nextCheckAt?: string | null;
  nextCheckRemainingSeconds?: number | null;
  penaltyRemainingSeconds?: number | null;
  successGraceRemainingSeconds?: number | null;
  healthCheckVersion?: string | null;
  effectiveStatus?: "READY" | "FORCED_READY" | "UNAVAILABLE";
  effectiveStatusLabel?: string;
}

export interface ModelPool {
  id: string;
  model: string;
  tierId: string;
  status: ModelPoolStatus;
  autoHealthCheckEnabled: boolean;
  healthCheckEndpoint: HealthCheckEndpoint;
  createdAt: string;
  updatedAt: string;
  tier: AccessTierSummary | null;
  channels: PoolChannel[];
  readyChannelCount: number;
  pricedChannelCount: number;
}

export interface AvailableChannel {
  id: string;
  model: string;
  upstreamProvider: string;
  priceEnabled: boolean;
  providerStatus: string;
  activeKeyCount: number;
}

export interface DispatchSettings {
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
  forceAvailableButtonEnabled: boolean;
}

export interface ModelPoolsResponse {
  modelPools: ModelPool[];
  availableChannels: AvailableChannel[];
  accessTiers: AccessTierSummary[];
  healthCheck: {
    intervalSeconds: number;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
    penaltySeconds: number;
    minPenaltySeconds: number;
    maxPenaltySeconds: number;
    successGraceSeconds: number;
    minSuccessGraceSeconds: number;
    maxSuccessGraceSeconds: number;
    serverNow: string;
  };
  dispatchSettings: DispatchSettings;
}

export interface ModelPoolInput {
  model: string;
  tierId?: string;
  status: ModelPoolStatus;
  autoHealthCheckEnabled: boolean;
  healthCheckEndpoint: HealthCheckEndpoint;
}

export interface PoolChannelInput {
  upstreamProvider: string;
  status: PoolChannelStatus;
}

export interface RouteSimulatorInput {
  userId: string;
  apiKeyId: string;
  clientIp?: string | null;
  model: string;
}

export interface RouteSimulationResponse {
  simulation: unknown;
}

export async function getAccessTiers() {
  const response = await http.get<{ tiers: AccessTier[] }>("/admin/access-tiers");
  return response.data.tiers;
}

export async function createAccessTier(input: Pick<AccessTier, "code" | "name" | "status" | "sortOrder" | "billingMultiplier"> & { description?: string | null }) {
  const response = await http.post<{ tier: AccessTier }>("/admin/access-tiers", input);
  return response.data.tier;
}

export async function updateAccessTier(id: string, input: Partial<Pick<AccessTier, "code" | "name" | "status" | "sortOrder" | "billingMultiplier" | "description">>) {
  const response = await http.patch<{ tier: AccessTier }>(`/admin/access-tiers/${id}`, input);
  return response.data.tier;
}

export async function deleteAccessTier(id: string) {
  const response = await http.delete<{ ok: true }>(`/admin/access-tiers/${id}`);
  return response.data;
}

export async function getIpAccessTierRules() {
  const response = await http.get<{ rules: IpAccessTierRule[] }>("/admin/ip-access-tiers");
  return response.data.rules;
}

export async function createIpAccessTierRule(input: Pick<IpAccessTierRule, "cidrOrIp" | "tierId" | "status" | "priority"> & { remark?: string | null }) {
  const response = await http.post<{ rule: IpAccessTierRule }>("/admin/ip-access-tiers", input);
  return response.data.rule;
}

export async function updateIpAccessTierRule(id: string, input: Partial<Pick<IpAccessTierRule, "cidrOrIp" | "tierId" | "status" | "priority" | "remark">>) {
  const response = await http.patch<{ rule: IpAccessTierRule }>(`/admin/ip-access-tiers/${id}`, input);
  return response.data.rule;
}

export async function deleteIpAccessTierRule(id: string) {
  const response = await http.delete<{ ok: true }>(`/admin/ip-access-tiers/${id}`);
  return response.data;
}

export async function getDispatchSettings() {
  const response = await http.get<{ settings: DispatchSettings; defaults: DispatchSettings }>("/admin/dispatch-settings");
  return response.data;
}

export async function updateDispatchSettings(input: Partial<DispatchSettings>) {
  const response = await http.patch<{ settings: DispatchSettings; defaults: DispatchSettings }>("/admin/dispatch-settings", input);
  return response.data;
}

export async function simulateRoute(input: RouteSimulatorInput) {
  const response = await http.post<RouteSimulationResponse>("/admin/route-simulator", input);
  return response.data.simulation;
}

export async function getModelPools() {
  const response = await http.get<ModelPoolsResponse>("/admin/model-pools");
  return response.data;
}

export async function createModelPool(input: ModelPoolInput) {
  const response = await http.post<{ modelPool: ModelPool }>("/admin/model-pools", input);
  return response.data.modelPool;
}

export async function updateModelPool(id: string, input: Partial<Omit<ModelPoolInput, "model" | "tierId">>) {
  const response = await http.patch<{ modelPool: ModelPool }>(`/admin/model-pools/${id}`, input);
  return response.data.modelPool;
}

export async function deleteModelPool(id: string) {
  const response = await http.delete<{ ok: true; modelPool: Pick<ModelPool, "id" | "model"> }>(`/admin/model-pools/${id}`);
  return response.data;
}

export async function updateModelPoolHealthCheck(input: Partial<ModelPoolsResponse["healthCheck"]>) {
  const response = await http.patch<{ healthCheck: ModelPoolsResponse["healthCheck"] }>("/admin/model-pools/health-check", input);
  return response.data.healthCheck;
}

export async function copyStandardPools(input: { targetTierId: string; overwriteExisting: boolean }) {
  const response = await http.post<{ result: unknown }>("/admin/model-pools/copy-standard", input);
  return response.data.result;
}

export async function addProviderToPools(input: {
  upstreamProvider: string;
  tierId?: string;
  channelStatus: PoolChannelStatus;
  onlyEnabledPrices: boolean;
}) {
  const response = await http.post<{ result: unknown }>("/admin/model-pools/add-provider", input);
  return response.data.result;
}

export async function createPoolChannel(poolId: string, input: PoolChannelInput) {
  const response = await http.post<{ channel: PoolChannel }>(`/admin/model-pools/${poolId}/channels`, input);
  return response.data.channel;
}

export async function updatePoolChannel(id: string, input: Partial<Pick<PoolChannel, "status" | "priority">>) {
  const response = await http.patch<{ channel: PoolChannel }>(`/admin/model-pool-channels/${id}`, input);
  return response.data.channel;
}

export async function deletePoolChannel(id: string) {
  const response = await http.delete<{ ok: true }>(`/admin/model-pool-channels/${id}`);
  return response.data;
}

export async function checkPoolChannel(id: string) {
  const response = await http.post<{ result: unknown }>(`/admin/model-pool-channels/${id}/check`);
  return response.data.result;
}
