import http from "../http";

export type UpstreamProviderStatus = "ACTIVE" | "DISABLED";
export type CompactItemType = "compaction" | "compaction_summary";

export interface UpstreamProviderKey {
  id: string;
  upstreamProviderId: string;
  name: string;
  key: string;
  keyPrefix: string;
  status: string;
  priority: number;
  lastUsedAt: string | null;
  lastCheckStatus: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  dailyLimitUsd: string | null;
  monthlyLimitUsd: string | null;
  providerRateLimit: number | null;
  disabledReason: string | null;
  lastErrorCategory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpstreamProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  priority: number;
  timeoutMs: number;
  compactItemType: CompactItemType;
  status: UpstreamProviderStatus;
  createdAt: string;
  updatedAt: string;
  keys?: UpstreamProviderKey[];
}

export interface UpstreamProviderInput {
  name: string;
  baseUrl: string;
  apiKey?: string;
  priority: number;
  timeoutMs: number;
  compactItemType: CompactItemType;
  status: UpstreamProviderStatus;
}

export interface UpstreamProviderKeyInput {
  name?: string;
  key?: string;
  status: string;
  priority: number;
  dailyLimitUsd?: string | null;
  monthlyLimitUsd?: string | null;
  providerRateLimit?: number | null;
}

export interface ModelPrice {
  id: string;
  model: string;
  upstreamProvider: string;
  upstreamEndpoint: "responses" | "chat_completions";
  currency: string;
  upstreamInputPer1MTok: string;
  upstreamOutputPer1MTok: string;
  upstreamCachedInputPer1MTok: string;
  upstreamPriceMultiplier: string;
  customerInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerPriceMultiplier: string;
  minimumChargeUsd: string;
  enabled: boolean;
  priceVersion: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedPriceSetting {
  model: string;
  enabled: boolean;
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier: string;
}

export interface ModelPriceInput {
  model: string;
  upstreamProvider: string;
  upstreamEndpoint: "responses" | "chat_completions";
  currency: string;
  upstreamInputPer1MTok: string;
  upstreamOutputPer1MTok: string;
  upstreamCachedInputPer1MTok: string;
  upstreamPriceMultiplier: string;
  customerInputPer1MTok: string;
  customerOutputPer1MTok: string;
  customerCachedInputPer1MTok: string;
  customerPriceMultiplier: string;
  minimumChargeUsd: string;
  enabled: boolean;
  priceVersion: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface UnifiedPriceInput {
  model: string;
  enabled: boolean;
  customerInputPer1MTok: string;
  customerCachedInputPer1MTok?: string;
  customerOutputPer1MTok: string;
  customerPriceMultiplier?: string;
}

export interface UnifiedPriceBatchInput {
  updates: UnifiedPriceInput[];
}

export async function getUpstreamProviders() {
  const response = await http.get<{ providers: UpstreamProvider[] }>("/admin/upstream-providers");

  return response.data.providers;
}

export async function createUpstreamProvider(input: UpstreamProviderInput & { apiKey: string }) {
  const response = await http.post<{ provider: UpstreamProvider }>("/admin/upstream-providers", input);

  return response.data.provider;
}

export async function updateUpstreamProvider(id: string, input: UpstreamProviderInput) {
  const response = await http.patch<{ provider: UpstreamProvider }>(`/admin/upstream-providers/${id}`, input);

  return response.data.provider;
}

export async function deleteUpstreamProvider(id: string) {
  const response = await http.delete<{ ok: true; provider: UpstreamProvider }>(`/admin/upstream-providers/${id}`);

  return response.data;
}

export async function createUpstreamProviderKey(providerId: string, input: UpstreamProviderKeyInput & { key: string }) {
  const response = await http.post<{ key: UpstreamProviderKey }>(`/admin/upstream-providers/${providerId}/keys`, input);
  return response.data.key;
}

export async function updateUpstreamProviderKey(id: string, input: Partial<UpstreamProviderKeyInput>) {
  const response = await http.patch<{ key: UpstreamProviderKey }>(`/admin/upstream-provider-keys/${id}`, input);
  return response.data.key;
}

export async function deleteUpstreamProviderKey(id: string) {
  const response = await http.delete<{ ok: true; key: UpstreamProviderKey }>(`/admin/upstream-provider-keys/${id}`);
  return response.data;
}

export async function getModelPrices() {
  const response = await http.get<{
    modelPrices: ModelPrice[];
    unifiedPriceSettings: UnifiedPriceSetting[];
  }>("/admin/model-prices");

  return response.data;
}

export async function createModelPrice(input: ModelPriceInput) {
  const response = await http.post<{ modelPrice: ModelPrice }>("/admin/model-prices", input);

  return response.data.modelPrice;
}

export async function updateModelPrice(id: string, input: Partial<ModelPriceInput>) {
  const response = await http.put<{ modelPrice: ModelPrice }>(`/admin/model-prices/${id}`, input);

  return response.data.modelPrice;
}

export async function deleteModelPrice(id: string) {
  const response = await http.delete<{ ok: true }>(`/admin/model-prices/${id}`);

  return response.data;
}

export async function deleteModelPriceGroup(model: string) {
  const response = await http.delete<{
    ok: true;
    model: string;
    deletedPrices: number;
    deletedChannels: number;
  }>(`/admin/model-prices/by-model/${encodeURIComponent(model)}`);

  return response.data;
}

export async function updateUnifiedPrice(input: UnifiedPriceInput) {
  const response = await http.put<{
    updated: number;
    models: number;
    unifiedPriceSettings: UnifiedPriceSetting[];
  }>("/admin/model-prices/unified", {
    updates: [
      {
        enabled: input.enabled,
        model: input.model,
        customerInputPer1MTok: input.customerInputPer1MTok,
        customerCachedInputPer1MTok: input.customerCachedInputPer1MTok ?? "0",
        customerOutputPer1MTok: input.customerOutputPer1MTok,
        customerPriceMultiplier: input.customerPriceMultiplier ?? "1",
      },
    ],
  });

  return response.data;
}

export async function updateUnifiedPrices(input: UnifiedPriceBatchInput) {
  const response = await http.put<{
    updated: number;
    models: number;
    unifiedPriceSettings: UnifiedPriceSetting[];
  }>("/admin/model-prices/unified", {
    updates: input.updates.map((update) => ({
      enabled: update.enabled,
      model: update.model,
      customerInputPer1MTok: update.customerInputPer1MTok,
      customerCachedInputPer1MTok: update.customerCachedInputPer1MTok ?? "0",
      customerOutputPer1MTok: update.customerOutputPer1MTok,
      customerPriceMultiplier: update.customerPriceMultiplier ?? "1",
    })),
  });

  return response.data;
}
