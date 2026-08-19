import http from "../http";
import type { UserRole, UserStatus } from "../types/auth";

export interface AdminUserWallet {
  id: string;
  userId: string;
  balance: string;
  reservedBalance?: string;
  currency: string;
  balanceCurrency?: {
    code: string;
    name: string;
    symbol: string;
    icon: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserWalletTransaction {
  id: string;
  type: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  remark: string | null;
  createdAt: string;
}

export interface AdminUserApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keySecret?: string | null;
  status: string;
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tierId: string | null;
  tier: AdminUserTier | null;
  totalLimitUsd?: string | null;
  dailyLimitUsd?: string | null;
  expiresAt?: string | null;
  allowedModels: string[];
  noticeEnabled: boolean;
  noticeText?: string | null;
  forceFastMode?: boolean;
  tags: string[];
  disabledReason?: string | null;
  disabledAt?: string | null;
  ipWhitelist: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  usedUsd?: string;
  totalUsedUsd?: string;
  totalRemainingUsd?: string | null;
}

export interface AdminUserModelMapping {
  id?: string;
  fromModel: string;
  toModel: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUserIpBanRule {
  ip: string;
  mode: "error" | "notice";
  message: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserIpSummary {
  ip: string;
  loginSuccessCount: number;
  loginFailureCount: number;
  apiRequestCount: number;
  totalCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  banRule: AdminUserIpBanRule | null;
}

export interface AdminUserTier {
  id: string;
  code: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  statusReason: string | null;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  displayGroup: string;
  tierId: string | null;
  tier: AdminUserTier | null;
  charityEnabled: boolean;
  charityDisplayName: string | null;
  charityKey: string | null;
  charityIpRateLimitEnabled: boolean;
  charityIpRateLimitPerMinute: number;
  tokenVersion: number;
  createdAt: string;
  wallet: AdminUserWallet | null;
  walletTransactions?: AdminUserWalletTransaction[];
  apiKeys?: AdminUserApiKey[];
  modelMappings?: AdminUserModelMapping[];
  _count: {
    apiKeys: number;
    apiRequests: number;
  };
}

export interface UpdateUserModelMappingsInput {
  mappings: Array<{
    fromModel: string;
    toModel: string;
  }>;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface AdminUserIpsResponse {
  user: Pick<AdminUser, "id" | "email">;
  ips: AdminUserIpSummary[];
}

export interface UpsertAdminUserInput {
  email: string;
  role: UserRole;
  status: UserStatus;
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  displayGroup?: string;
  tierId?: string | null;
  initialBalance?: string;
  allowedModels?: string[];
  charityEnabled?: boolean;
  charityDisplayName?: string | null;
  charityKey?: string | null;
  charityIpRateLimitEnabled?: boolean;
  charityIpRateLimitPerMinute?: number;
}

export interface UpsertAdminApiKeyInput {
  name: string;
  status?: string;
  tierId?: string | null;
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  totalLimitUsd?: string | null;
  expiresAt?: string | null;
  allowedModels?: string[];
  noticeEnabled?: boolean;
  noticeText?: string | null;
  forceFastMode?: boolean;
  tags?: string[];
  ipWhitelist?: string[];
  disabledReason?: string | null;
}

export interface AdjustUserBalanceInput {
  amount: string;
  remark?: string;
}

export async function getAdminUsers() {
  const response = await http.get<AdminUsersResponse>("/admin/users");

  return response.data.users;
}

export async function getAdminUserIps(id: string) {
  const response = await http.get<AdminUserIpsResponse>(`/admin/users/${id}/ips`);

  return response.data;
}

export async function deleteAdminUserIpBanRule(ip: string) {
  const response = await http.delete<{
    ip: string;
    deleted: boolean;
    rules: AdminUserIpBanRule[];
  }>(`/admin/ip-ban-rules/${encodeURIComponent(ip)}`);

  return response.data;
}

export async function getAdminCharityUsers() {
  const response = await http.get<AdminUsersResponse>("/admin/users", {
    params: { scope: "charity" },
  });

  return response.data.users;
}

export async function createAdminUser(input: UpsertAdminUserInput) {
  const payload = {
    ...input,
    tierId: input.tierId || null,
    initialBalance: input.initialBalance ? input.initialBalance : undefined,
  };
  const response = await http.post<{ user: AdminUser }>("/admin/users", payload);

  return response.data.user;
}

export async function updateAdminUser(id: string, input: Omit<UpsertAdminUserInput, "initialBalance">) {
  const response = await http.patch<{ user: AdminUser }>(`/admin/users/${id}`, {
    ...input,
    tierId: input.tierId || null,
  });

  return response.data.user;
}

export async function adjustUserBalance(id: string, input: AdjustUserBalanceInput) {
  const response = await http.post<{
    wallet: AdminUserWallet;
    transaction: AdminUserWalletTransaction;
  }>(`/admin/users/${id}/balance`, input);

  return response.data;
}

export async function logoutAdminUser(id: string) {
  const response = await http.post<{ ok: true; user: Pick<AdminUser, "id" | "email" | "tokenVersion"> }>(
    `/admin/users/${id}/logout`,
  );

  return response.data;
}

export async function deleteAdminUser(id: string) {
  const response = await http.delete<{ ok: true; user: Pick<AdminUser, "id" | "email"> }>(`/admin/users/${id}`);

  return response.data;
}

export async function createAdminUserApiKey(userId: string, input: UpsertAdminApiKeyInput) {
  const response = await http.post<{ apiKey: AdminUserApiKey; secret: string }>(`/admin/users/${userId}/api-keys`, {
    ...input,
    tierId: input.tierId || null,
  });

  return response.data;
}

export async function updateAdminApiKey(id: string, input: Partial<UpsertAdminApiKeyInput>) {
  const response = await http.patch<{ apiKey: AdminUserApiKey }>(`/admin/api-keys/${id}`, {
    ...input,
    tierId: input.tierId || null,
  });

  return response.data.apiKey;
}

export async function updateUserModelMappings(
  userId: string,
  input: UpdateUserModelMappingsInput,
) {
  const response = await http.put<{ mappings: AdminUserModelMapping[] }>(
    `/admin/users/${userId}/model-mappings`,
    input,
  );

  return response.data.mappings;
}
