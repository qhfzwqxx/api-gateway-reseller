import http from "../http";

export interface RedeemCode {
  id: string;
  code?: string;
  codePrefix: string;
  rewardType: "BALANCE" | "SUBSCRIPTION";
  amount: string;
  currency: string;
  status: "ACTIVE" | "DISABLED";
  maxRedemptions: number;
  redeemedCount: number;
  campaignName: string | null;
  validUserTierId: string | null;
  validUserTier: { id: string; code: string; name: string } | null;
  subscriptionPlanId: string | null;
  subscriptionPlan: {
    id: string;
    code: string;
    name: string;
    durationDays: number;
    tier: { id: string; code: string; name: string; status: string };
  } | null;
  perUserLimit: number;
  expiresAt: string | null;
  remark: string | null;
  createdAt: string;
  redemptions?: Array<{
    id: string;
    amount: string;
    createdAt: string;
    user: { email: string };
  }>;
}

export interface CreateRedeemCodesInput {
  rewardType?: "BALANCE" | "SUBSCRIPTION";
  amount: string;
  currency?: string;
  count: number;
  maxRedemptions: number;
  expiresAt?: string | null;
  remark?: string;
  campaignName?: string | null;
  validUserTierId?: string | null;
  subscriptionPlanId?: string | null;
  perUserLimit: number;
}

export interface UpdateRedeemCodeInput {
  status?: "ACTIVE" | "DISABLED";
  expiresAt?: string | null;
  remark?: string | null;
  campaignName?: string | null;
  validUserTierId?: string | null;
  perUserLimit?: number;
}

export interface ReportDimensionRow {
  id?: string | null;
  label: string;
  requestCount: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd: string;
  grossProfitUsd: string;
}

export interface ReportSummary {
  dateFrom: string;
  dateTo: string;
  summary: {
    totalCount: number;
    totalTokens: number;
    chargedAmountUsd: string;
    upstreamCostUsd: string;
    grossProfitUsd: string;
  };
  dimensions: {
    users: ReportDimensionRow[];
    models: ReportDimensionRow[];
    upstreams: ReportDimensionRow[];
    tiers: ReportDimensionRow[];
  };
}

export interface LoginLog {
  id: string;
  userId: string | null;
  email: string | null;
  username: string | null;
  method: string;
  success: boolean;
  failureReason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; email: string; role: string; status: string } | null;
}

export interface LoginLogParams {
  take?: number;
  method?: string;
  success?: "true" | "false";
  userId?: string;
  email?: string;
  ip?: string;
}

export async function downloadFile(url: string, filename: string) {
  const response = await http.get<Blob>(url, { responseType: "blob" });
  const blobUrl = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export async function getRedeemCodes() {
  const response = await http.get<{ codes: RedeemCode[] }>(
    "/admin/redeem-codes",
  );
  return response.data.codes;
}

export async function createRedeemCodes(input: CreateRedeemCodesInput) {
  const response = await http.post<{ codes: RedeemCode[] }>(
    "/admin/redeem-codes",
    input,
  );
  return response.data.codes;
}

export async function updateRedeemCode(
  id: string,
  input: UpdateRedeemCodeInput,
) {
  const response = await http.patch<{ code: RedeemCode }>(
    `/admin/redeem-codes/${id}`,
    input,
  );
  return response.data.code;
}

export function exportRedeemCodesCsv() {
  return downloadFile(
    "/admin/redeem-codes/export",
    `redeem-codes-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

export async function getReportSummary() {
  const response = await http.get<ReportSummary>("/admin/reports/summary");
  return response.data;
}

export function exportReportSummaryCsv() {
  return downloadFile(
    "/admin/reports/summary/export",
    `admin-report-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

export async function getLoginLogs(params: LoginLogParams = {}) {
  const response = await http.get<{ logs: LoginLog[]; total: number }>(
    "/admin/login-logs",
    {
      params: Object.fromEntries(
        Object.entries(params).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
    },
  );
  return response.data;
}
