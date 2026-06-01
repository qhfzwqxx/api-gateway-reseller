import http from "../http";
import type { AccessTierSummary } from "./routing";

export type SubscriptionPlanStatus = "ACTIVE" | "DISABLED";
export type SubscriptionQuotaMode = "DAILY" | "TOTAL" | "UNLIMITED";
export type UserSubscriptionStatus =
  | "ACTIVE"
  | "QUEUED"
  | "EXPIRED"
  | "DISABLED";

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  status: SubscriptionPlanStatus;
  tierId: string;
  tier: AccessTierSummary;
  durationDays: number;
  quotaMode: SubscriptionQuotaMode;
  quotaAmountUsd: string;
  sortOrder: number;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    userSubscriptions: number;
    redeemCodes: number;
  };
}

export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  tierId: string;
  status: UserSubscriptionStatus;
  active: boolean;
  startsAt: string;
  endsAt: string;
  remainingSeconds: number;
  quotaGrantCount: number;
  dailyUsageDateKey: string | null;
  dailyUsedUsd: string;
  totalUsedUsd: string;
  activatedAt: string | null;
  baseTierId: string | null;
  source: string;
  redeemCodeId: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  plan: SubscriptionPlan;
  tier: AccessTierSummary;
  baseTier: AccessTierSummary | null;
  redeemCode?: { id: string; codePrefix: string } | null;
  quotaMode: SubscriptionQuotaMode;
  quotaAmountUsd: string;
  todayUsedUsd: string;
  todayRemainingUsd: string | null;
  nextQuotaRefreshAt: string | null;
  totalRemainingUsd: string | null;
  walletFallbackRequired: boolean;
}

export interface UpsertSubscriptionPlanInput {
  code: string;
  name: string;
  status: SubscriptionPlanStatus;
  tierId: string;
  durationDays: number;
  quotaMode: SubscriptionQuotaMode;
  quotaAmountUsd: string;
  sortOrder: number;
  remark?: string | null;
}

export async function getSubscriptionPlans() {
  const response = await http.get<{ plans: SubscriptionPlan[] }>(
    "/admin/subscription-plans",
  );
  return response.data.plans;
}

export async function createSubscriptionPlan(
  input: UpsertSubscriptionPlanInput,
) {
  const response = await http.post<{ plan: SubscriptionPlan }>(
    "/admin/subscription-plans",
    input,
  );
  return response.data.plan;
}

export async function updateSubscriptionPlan(
  id: string,
  input: Partial<UpsertSubscriptionPlanInput>,
) {
  const response = await http.patch<{ plan: SubscriptionPlan }>(
    `/admin/subscription-plans/${id}`,
    input,
  );
  return response.data.plan;
}

export async function getAdminUserSubscriptions(userId: string) {
  const response = await http.get<{ subscriptions: UserSubscription[] }>(
    `/admin/users/${userId}/subscriptions`,
  );
  return response.data.subscriptions;
}

export async function grantAdminUserSubscription(
  userId: string,
  input: { planId: string; remark?: string | null; activate?: boolean },
) {
  const response = await http.post<{ subscription: UserSubscription }>(
    `/admin/users/${userId}/subscriptions`,
    input,
  );
  return response.data.subscription;
}

export async function updateAdminUserSubscription(
  id: string,
  input: Partial<
    Pick<UserSubscription, "status" | "remainingSeconds" | "remark">
  >,
) {
  const response = await http.patch<{ subscription: UserSubscription }>(
    `/admin/user-subscriptions/${id}`,
    input,
  );
  return response.data.subscription;
}

export async function activateAdminUserSubscription(id: string) {
  const response = await http.post<{ subscription: UserSubscription }>(
    `/admin/user-subscriptions/${id}/activate`,
  );
  return response.data.subscription;
}

export async function getMySubscriptions() {
  const response = await http.get<{
    subscriptions: UserSubscription[];
    activeSubscription: UserSubscription | null;
  }>("/me/subscriptions");
  return response.data;
}

export async function activateMySubscription(id: string) {
  const response = await http.post<{ subscription: UserSubscription }>(
    `/me/subscriptions/${id}/activate`,
  );
  return response.data.subscription;
}
