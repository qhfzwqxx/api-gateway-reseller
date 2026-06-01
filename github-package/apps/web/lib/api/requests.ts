import http from "../http";

export type ApiRequestStatus = "PENDING" | "SUCCESS" | "FAILED";

export type ApiRequestResultType =
  | "notice"
  | "ip_ban"
  | "error"
  | "PROXIED_SUCCESS"
  | "UPSTREAM_ERROR"
  | "GATEWAY_NOTICE"
  | "IP_BAN"
  | "RATE_LIMITED"
  | "INSUFFICIENT_BALANCE"
  | "MANUAL_TERMINATED"
  | "AUTO_TERMINATED"
  | "BILLING_ERROR"
  | "CLIENT_CLOSED"
  | "GATEWAY_ERROR";

export interface RequestRef {
  id: string;
  name: string;
  keyPrefix: string;
}

export interface RequestAccessTier {
  id: string;
  code: string;
  name: string;
  status?: string;
}

export interface ApiRequestRecord {
  id: string;
  traceCode: string | null;
  upstreamProvider: string | null;
  upstreamRequestId?: string | null;
  upstreamProviderKey: RequestRef | null;
  accessTier: RequestAccessTier | null;
  clientIp: string | null;
  userAgent?: string | null;
  apiKey: RequestRef | null;
  model: string;
  reasoningEffort: string | null;
  reasoningEffortActual: string | null;
  endpoint: string;
  method: string;
  status: ApiRequestStatus;
  httpStatus: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  chargedAmountUsd: string | null;
  upstreamCostUsd: string | null;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  upstreamFirstChunkLatencyMs: number | null;
  errorMessage: string | null;
  responseUsage: unknown;
  requestBody?: unknown;
  createdAt: string;
  updatedAt?: string;
  user: {
    email: string;
  } | null;
}

export interface AdminRequestsSummary {
  total: number;
  pending: number;
  success: number;
  failed: number;
  totalTokens: number;
  chargedAmountUsd: string | null;
  upstreamCostUsd: string | null;
}

export interface IpBanRule {
  id?: string;
  ip: string;
  reason?: string | null;
}

export interface GetRequestsParams {
  q?: string;
  userId?: string;
  model?: string;
  status?: ApiRequestStatus;
  dateFrom?: string;
  dateTo?: string;
  clientIp?: string;
  apiKey?: string;
  upstreamProvider?: string;
  upstreamKey?: string;
  endpoint?: string;
  httpStatus?: string;
  resultType?: ApiRequestResultType;
  minTokens?: string;
  maxTokens?: string;
  minChargedUsd?: string;
  maxChargedUsd?: string;
  minUpstreamCostUsd?: string;
  maxUpstreamCostUsd?: string;
  minGrossProfitUsd?: string;
  maxGrossProfitUsd?: string;
  minLatencyMs?: string;
  maxLatencyMs?: string;
  minFirstTokenLatencyMs?: string;
  maxFirstTokenLatencyMs?: string;
  cursor?: string;
  take?: number;
}

export interface GetRequestsResponse {
  requests: ApiRequestRecord[];
  hasMore: boolean;
  nextCursor: string | null;
  summary: AdminRequestsSummary;
  ipBanRules: IpBanRule[];
}

export interface RequestDetailResponse {
  request: ApiRequestRecord;
}

export interface TerminateRequestResponse {
  request: ApiRequestRecord;
  abortedActiveRequest: boolean;
}

export async function getRequests(params: GetRequestsParams = {}) {
  const response = await http.get<GetRequestsResponse>("/admin/requests", {
    params: cleanParams(params),
  });

  return response.data;
}

export async function getRequestDetail(id: string) {
  const response = await http.get<RequestDetailResponse>(`/admin/requests/${id}`);

  return response.data.request;
}

export async function terminateRequest(id: string) {
  const response = await http.post<TerminateRequestResponse>(`/admin/requests/${id}/terminate`);

  return response.data;
}

function cleanParams(params: GetRequestsParams) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}
