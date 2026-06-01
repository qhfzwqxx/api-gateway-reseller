"use client";

import {
  CircleStop,
  FileSearch,
  Plus,
  RefreshCw,
  Save,
  Send,
  Shield,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAdminResource } from "../_components/admin-hooks";
import { apiBaseUrl, apiFetch, getToken } from "../../../lib/api";
import { adminDownload } from "../_components/admin-api";
import { confirmAdminAction } from "../_components/admin-confirm";
import {
  dateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  money,
  seconds,
} from "../_components/admin-format";
import { AdminDataTable, AdminFoldout, InfoLine, Metric, ModalShell, MobileField, MobileRecord, StatusPill } from "../_components/admin-ui";

type ApiRequest = {
  id: string;
  traceCode?: string | null;
  userId?: string | null;
  upstreamProvider?: string | null;
  upstreamProviderKey?: { id: string; name: string; keyPrefix: string } | null;
  accessTier?: { id: string; code: string; name: string } | null;
  clientIp?: string | null;
  model: string;
  reasoningEffort?: string | null;
  reasoningEffortActual?: string | null;
  endpoint: string;
  method?: string;
  status: string;
  httpStatus?: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd?: string | null;
  grossProfitUsd?: string | null;
  latencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  upstreamFirstChunkLatencyMs?: number | null;
  errorMessage?: string | null;
  responseUsage?: unknown | null;
  createdAt: string;
  user?: { email: string };
  apiKey?: { id: string; name: string; keyPrefix: string } | null;
};

type ApiRequestDetail = ApiRequest & {
  upstreamRequestId?: string | null;
  userAgent?: string | null;
  requestBody?: unknown | null;
  updatedAt?: string;
};

type AdminRequestsSummary = {
  totalCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  failureRate: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd: string;
  grossProfitUsd: string;
  avgLatencyMs: number | null;
  avgFirstTokenLatencyMs: number | null;
};

type AdminRequestsPage = {
  requests: ApiRequest[];
  summary: AdminRequestsSummary;
  ipBanRules?: IpBanRule[];
  hasMore: boolean;
  nextCursor?: string | null;
};

type RiskCenterResponse = {
  ipBanRules: IpBanRule[];
  pendingAutoTerminateSettings: PendingAutoTerminateSettings;
  reasoningEffortTransformSettings: ReasoningEffortTransformSettings;
};

type UsersResponse = {
  users: AdminUser[];
};

type IpBanMode = "error" | "notice";

type IpBanRule = {
  ip: string;
  mode: IpBanMode;
  message: string;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
};

type TemporaryIpNoticeBan = {
  ip: string;
  message: string;
  ttlSeconds: number;
};

type TemporaryIpNoticeBanSettings = {
  enabled: boolean;
  banSeconds: number;
  threshold: number;
  windowSeconds: number;
  message: string;
  minBanSeconds?: number;
  maxBanSeconds?: number;
  minThreshold?: number;
  maxThreshold?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
};

type PendingAutoTerminateSettings = {
  enabled: boolean;
  timeoutSeconds: number;
  message: string;
  minTimeoutSeconds?: number;
  maxTimeoutSeconds?: number;
};

type ReasoningEffortTransformSettings = {
  rules: ReasoningEffortTransformRule[];
};

type ReasoningEffortTransformRule = {
  enabled: boolean;
  from: string;
  to: string;
};

type AdminUser = {
  id: string;
  email: string;
};

type RequestFilters = {
  q: string;
  userId: string;
  model: string;
  status: "" | "PENDING" | "SUCCESS" | "FAILED";
  dateFrom: string;
  dateTo: string;
  clientIp: string;
  apiKey: string;
  upstreamProvider: string;
  upstreamKey: string;
  endpoint: string;
  httpStatus: string;
  resultType:
    | ""
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
  minTokens: string;
  maxTokens: string;
  minChargedUsd: string;
  maxChargedUsd: string;
  minUpstreamCostUsd: string;
  maxUpstreamCostUsd: string;
  minGrossProfitUsd: string;
  maxGrossProfitUsd: string;
  minLatencyMs: string;
  maxLatencyMs: string;
  minFirstTokenLatencyMs: string;
  maxFirstTokenLatencyMs: string;
};

const emptyRequestFilters: RequestFilters = {
  q: "",
  userId: "",
  model: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  clientIp: "",
  apiKey: "",
  upstreamProvider: "",
  upstreamKey: "",
  endpoint: "",
  httpStatus: "",
  resultType: "",
  minTokens: "",
  maxTokens: "",
  minChargedUsd: "",
  maxChargedUsd: "",
  minUpstreamCostUsd: "",
  maxUpstreamCostUsd: "",
  minGrossProfitUsd: "",
  maxGrossProfitUsd: "",
  minLatencyMs: "",
  maxLatencyMs: "",
  minFirstTokenLatencyMs: "",
  maxFirstTokenLatencyMs: "",
};

const advancedRequestFilterKeys = [
  "clientIp",
  "apiKey",
  "upstreamProvider",
  "upstreamKey",
  "endpoint",
  "httpStatus",
  "resultType",
  "minTokens",
  "maxTokens",
  "minChargedUsd",
  "maxChargedUsd",
  "minUpstreamCostUsd",
  "maxUpstreamCostUsd",
  "minGrossProfitUsd",
  "maxGrossProfitUsd",
  "minLatencyMs",
  "maxLatencyMs",
  "minFirstTokenLatencyMs",
  "maxFirstTokenLatencyMs",
] as const satisfies readonly (keyof RequestFilters)[];

const emptyAdminRequestsSummary: AdminRequestsSummary = {
  totalCount: 0,
  successCount: 0,
  failedCount: 0,
  pendingCount: 0,
  failureRate: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  chargedAmountUsd: "0",
  upstreamCostUsd: "0",
  grossProfitUsd: "0",
  avgLatencyMs: null,
  avgFirstTokenLatencyMs: null,
};

const defaultIpBanMessage = "当前 IP 已被网关封禁，请联系管理员。";

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function MobileEmpty({ children }: { children: ReactNode }) {
  return <div className="mobile-empty">{children}</div>;
}

function countAdvancedRequestFilters(filters: RequestFilters) {
  return advancedRequestFilterKeys.filter((key) => filters[key].trim()).length;
}

function normalizeIpForCompare(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || text.includes("/")) {
    return "";
  }

  if (text.includes(":")) {
    try {
      const hostname = new URL(`http://[${text}]/`).hostname;
      return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1).toLowerCase()
        : hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split(".").map(Number);
    if (
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return parts.join(".");
    }
  }

  return "";
}

function formatRequestApiKey(apiKey: ApiRequest["apiKey"]) {
  if (!apiKey) {
    return "-";
  }

  return `${apiKey.name} (${apiKey.keyPrefix})`;
}

function formatRequestTraceCode(request: Pick<ApiRequest, "id" | "traceCode">) {
  return (
    request.traceCode?.trim() || `REQ-${request.id.slice(-8).toUpperCase()}`
  );
}

function formatRequestUpstreamKey(
  upstreamKey: ApiRequest["upstreamProviderKey"],
) {
  if (!upstreamKey) {
    return "-";
  }

  return `${displayUpstreamProviderKeyName(upstreamKey.name)} (${upstreamKey.keyPrefix})`;
}

function displayUpstreamProviderKeyName(name: string) {
  return name === "默认 Key" ? "key-1" : name;
}

function buildRequestProcess(
  request: ApiRequestDetail,
  failureSummary: string,
) {
  const failed = hasRequestError(request);
  const returnedNoticeText = getReturnedNoticeText(request);
  const manualTerminated = isManualTerminatedRequest(request);
  const compactFallback = getCompactFallbackTrace(request);
  const steps = [
    {
      title: "1. 网关接收请求",
      state: "完成",
      tone: "ok",
      detail: `${request.method ?? "POST"} ${request.endpoint} · ${dateTime(request.createdAt)} · IP ${request.clientIp ?? "-"}`,
    },
    {
      title: "2. 匹配用户、Key 和上游",
      state: request.upstreamProvider ? "完成" : "缺失",
      tone: request.upstreamProvider ? "ok" : "warn",
      detail: `${request.user?.email ?? "-"} · ${formatRequestApiKey(request.apiKey)} · ${request.upstreamProvider ?? "-"} · ${formatRequestUpstreamKey(request.upstreamProviderKey)}`,
    },
    ...(compactFallback
      ? [
          {
            title: "3. compact 处理",
            state:
              compactFallback.fallbackSucceeded === false
                ? request.status === "PENDING"
                  ? "处理中"
                  : "异常"
                : "完成",
            tone: compactFallback.fallbackSucceeded === false ? "warn" : "ok",
            detail: `这条调用发生过无感二次 compact，已用原始 compact 请求在当前渠道重新压缩并替换 ${formatNumber(Number(compactFallback.replacements ?? 0))} 处上下文 item。`,
          },
        ]
      : []),
    {
      title: compactFallback ? "4. 上游响应" : "3. 上游响应",
      state: request.httpStatus ? (failed ? "异常" : "完成") : "未返回",
      tone: manualTerminated
        ? "warn"
        : failed
          ? "error"
          : request.httpStatus
            ? "ok"
            : "warn",
      detail: manualTerminated
        ? `HTTP ${request.httpStatus ?? "-"} · 上游请求 ID ${request.upstreamRequestId ?? "-"} · 已被管理员终止 · 总时间 ${seconds(request.latencyMs)}`
        : `HTTP ${request.httpStatus ?? "-"} · 上游请求 ID ${request.upstreamRequestId ?? "-"} · 总时间 ${seconds(request.latencyMs)} · 首 token ${seconds(request.upstreamFirstChunkLatencyMs)}`,
    },
    {
      title: compactFallback ? "5. Usage 与扣费" : "4. Usage 与扣费",
      state: manualTerminated ? "中止" : failed ? "中断" : "完成",
      tone: manualTerminated ? "warn" : failed ? "warn" : "ok",
      detail: `总 token ${formatNumber(request.totalTokens)} · 用户扣费 $${money(request.chargedAmountUsd)} · 上游成本 $${money(request.upstreamCostUsd ?? "0")}`,
    },
    {
      title: compactFallback ? "6. 最终结果" : "5. 最终结果",
      state: returnedNoticeText
        ? "已提示"
        : manualTerminated
          ? "手动终止"
          : failed
            ? "失败"
            : request.status,
      tone: returnedNoticeText
        ? "warn"
        : manualTerminated
          ? "warn"
          : failed
            ? "error"
            : "ok",
      detail: returnedNoticeText
        ? isIpBanRequest(request)
          ? "这次调用命中了 IP 封禁规则，并已按公告式接口格式返回给用户。"
          : "这次失败已经按公告式接口格式返回给用户，后台保留原始失败原因。"
        : manualTerminated
          ? "管理员已终止这条仍在处理中的调用，并尝试中断上游请求。"
          : failed
            ? failureSummary
            : "调用成功完成，后台已记录用量与费用。",
    },
  ];

  return steps;
}

function describeRequestFailure(request: ApiRequestDetail) {
  const message = request.errorMessage?.trim() ?? "";
  const normalized = message.toLowerCase();
  const returnedNoticeText = getReturnedNoticeText(request);

  if (!hasRequestError(request)) {
    return "这条调用没有报错。";
  }

  if (isIpBanRequest(request)) {
    return returnedNoticeText
      ? "这条调用命中了 IP 封禁规则，网关没有转发到上游，并已把封禁内容按公告式提示返回给用户。"
      : "这条调用命中了 IP 封禁规则，网关没有转发到上游，已直接返回封禁报错。";
  }

  if (isManualTerminatedRequest(request)) {
    return "这条调用被管理员手动终止，网关已尝试中断上游请求并将记录标记为失败。";
  }

  if (returnedNoticeText) {
    return "这条失败已经转换成公告式提示返回给用户，下面保留的是后台记录的原始失败原因。";
  }

  if (
    normalized.includes("items are not persisted when store is set to false") ||
    (normalized.includes("item with id") &&
      normalized.includes("not found") &&
      normalized.includes("rs_"))
  ) {
    return "客户端复用了已经失效的 Responses 上下文 item。通常需要新建对话、清空上下文，或在客户端开启 store=true 后再跨轮复用 previous_response_id / rs_ item。";
  }

  if (
    normalized.includes("invalid_encrypted_content") ||
    normalized.includes("encrypted content could not be decrypted or parsed")
  ) {
    return "客户端传入了无效的 Responses encrypted_content，通常是把压缩摘要或普通文本误放进了上下文。";
  }

  if (
    normalized.includes(
      "upstream response did not include billable token usage",
    )
  ) {
    return "上游没有返回可计费 usage，网关无法安全扣费，所以这次调用被拦截为失败。";
  }

  if (
    normalized.includes("first token timeout") ||
    normalized.includes("timeout")
  ) {
    return "上游在超时时间内没有返回首 token 或完整响应，网关主动中止了这次调用。";
  }

  if (
    normalized.includes("aborted") ||
    normalized.includes("internal_error") ||
    normalized.includes("received from peer")
  ) {
    return "上游连接在响应过程中被中断，常见于上游流式连接异常、客户端上下文失效或上游临时波动。";
  }

  if (request.httpStatus === 401 || request.httpStatus === 403) {
    return "上游拒绝了请求，优先检查上游 Key 是否有效、模型权限是否开放、余额或地域限制是否触发。";
  }

  if (request.httpStatus === 404) {
    return "上游返回 404，常见原因是模型、接口路径或 Responses 上下文引用不存在。";
  }

  if (request.httpStatus && request.httpStatus >= 500) {
    return "上游返回 5xx，说明请求已到达上游但上游处理失败或服务异常。";
  }

  return message
    ? "上游或网关返回失败，完整原始错误如下。"
    : "后台只记录到失败状态，没有保存更详细的 errorMessage。";
}

function formatErrorForDisplay(message: string) {
  const trimmed = message.trim();
  const jsonStart = trimmed.search(/[\[{]/);

  if (jsonStart >= 0) {
    const prefix = trimmed.slice(0, jsonStart).trim();
    const jsonText = trimmed.slice(jsonStart);
    try {
      const formatted = JSON.stringify(JSON.parse(jsonText), null, 2);
      return prefix ? `${prefix}\n${formatted}` : formatted;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function formatJsonValue(value: unknown) {
  if (value === null || value === undefined) {
    return "暂无记录";
  }

  if (typeof value === "string") {
    return formatErrorForDisplay(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}


function Requests({
  requests,
  compact = false,
  showCost = false,
  ipBanRules = [],
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRequestTerminated,
}: {
  requests: ApiRequest[];
  compact?: boolean;
  showCost?: boolean;
  ipBanRules?: IpBanRule[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onRequestTerminated?: (request: ApiRequest) => void;
}) {
  const [selectedRequest, setSelectedRequest] =
    useState<ApiRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [terminatingRequestId, setTerminatingRequestId] = useState<
    string | null
  >(null);
  const bannedIpSet = new Set(ipBanRules.map((rule) => rule.ip));

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (!onLoadMore || !hasMore || loadingMore) {
      return;
    }

    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 180) {
      onLoadMore();
    }
  }

  async function openRequestDetail(item: ApiRequest) {
    setSelectedRequest(item);
    setDetailError(null);

    if (!showCost) {
      return;
    }

    const authToken = getToken();
    if (!authToken) {
      setDetailError("登录已失效，请重新登录后台。");
      return;
    }

    setDetailLoading(true);
    try {
      const result = await apiFetch<{ request: ApiRequestDetail }>(
        `/admin/requests/${item.id}`,
        {
          token: authToken,
        },
      );
      setSelectedRequest(result.request);
    } catch (error) {
      setDetailError(errorToText(error));
    } finally {
      setDetailLoading(false);
    }
  }

  async function terminateRequest(item: ApiRequest) {
    const confirmed = await confirmAdminAction({
      title: "终止 PENDING 调用",
      description: `${item.model} · ${dateTime(item.createdAt)}`,
      confirmText: "终止调用",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    const authToken = getToken();
    if (!authToken) {
      setDetailError("登录已失效，请重新登录后台。");
      return;
    }

    setTerminatingRequestId(item.id);
    setDetailError(null);
    try {
      const result = await apiFetch<{ request: ApiRequest }>(
        `/admin/requests/${item.id}/terminate`,
        {
          method: "POST",
          token: authToken,
        },
      );
      onRequestTerminated?.(result.request);
      setSelectedRequest((current) =>
        current?.id === result.request.id
          ? { ...current, ...result.request }
          : current,
      );
    } catch (error) {
      setDetailError(errorToText(error));
    } finally {
      setTerminatingRequestId(null);
    }
  }
  const auditRequestRows = requests.map((item) => ({
    id: item.id,
    trace: (
      <strong className="request-trace-code">
        {formatRequestTraceCode(item)}
      </strong>
    ),
    identity: (
      <div className="audit-stack">
        <strong>{item.user?.email ?? "-"}</strong>
        <span>API Key：{formatRequestApiKey(item.apiKey)}</span>
        <IpCell
          ip={item.clientIp}
          banned={Boolean(
            item.clientIp &&
              bannedIpSet.has(normalizeIpForCompare(item.clientIp)),
          )}
        />
      </div>
    ),
    request: (
      <div className="audit-stack">
        <strong>{item.model}</strong>
        <span>上游：{item.upstreamProvider ?? "-"}</span>
        <span>上游 Key：{formatRequestUpstreamKey(item.upstreamProviderKey)}</span>
        <span>
          推理：
          {formatReasoningEffortCell(
            item.reasoningEffort,
            item.reasoningEffortActual,
          )}
        </span>
      </div>
    ),
    status: (
      <div className="request-status-cell">
        <StatusPill status={getRequestStatusPillStatus(item)} />
        {getCompactRequestLabel(item) ? (
          <span className="request-compact-fallback-pill">
            {getCompactRequestLabel(item)}
          </span>
        ) : null}
        {getReturnedNoticeText(item) ? (
          <span className="request-notice-pill">已提示</span>
        ) : null}
        {hasRequestError(item) ? (
          <button
            className="request-detail-button"
            onClick={() => void openRequestDetail(item)}
            title="查看详细报错原因和过程"
            type="button"
          >
            <FileSearch size={13} />
            详情
          </button>
        ) : null}
      </div>
    ),
    tokens: (
      <div className="audit-metric-grid">
        <AuditMetric label="输入" value={formatNumber(item.inputTokens)} />
        <AuditMetric label="缓存" value={formatNumber(item.cachedInputTokens)} />
        <AuditMetric label="输出" value={formatNumber(item.outputTokens)} />
        <AuditMetric label="总计" value={formatNumber(item.totalTokens)} strong />
      </div>
    ),
    cost: (
      <div className="audit-metric-grid">
        <AuditMetric
          label="扣费"
          value={`$${money(item.chargedAmountUsd)}`}
          strong
        />
        <AuditMetric
          label="成本"
          value={`$${money(item.upstreamCostUsd ?? "0")}`}
        />
        <AuditMetric
          label="毛利"
          value={`$${money(Number(item.chargedAmountUsd) - Number(item.upstreamCostUsd ?? 0))}`}
        />
      </div>
    ),
    latency: (
      <div className="audit-stack">
        <span>总：{seconds(item.latencyMs)}</span>
        <span>首 token：{seconds(item.upstreamFirstChunkLatencyMs)}</span>
        <span>{dateTime(item.createdAt)}</span>
      </div>
    ),
    actions:
      item.status === "PENDING" ? (
        <button
          className="request-terminate-button"
          disabled={
            terminatingRequestId === item.id || isProtectedCompactRequest(item)
          }
          onClick={() => void terminateRequest(item)}
          title={
            isProtectedCompactRequest(item)
              ? "这条 compact 调用不受自动倒计时终止限制，也不允许手动终止"
              : "终止这条仍在处理中的调用"
          }
          type="button"
        >
          <CircleStop size={13} />
          {isProtectedCompactRequest(item) ? "保护中" : "终止"}
        </button>
      ) : (
        "-"
      ),
  }));
  const requestRows = requests.map((item) => ({
    id: item.id,
    trace: (
      <strong className="request-trace-code">
        {formatRequestTraceCode(item)}
      </strong>
    ),
    apiKey: formatRequestApiKey(item.apiKey),
    ip: (
      <IpCell
        ip={item.clientIp}
        banned={Boolean(
          item.clientIp && bannedIpSet.has(normalizeIpForCompare(item.clientIp)),
        )}
      />
    ),
    model: item.model,
    status: (
      <div className="request-status-cell">
        <StatusPill status={getRequestStatusPillStatus(item)} />
        {getReturnedNoticeText(item) ? (
          <span className="request-notice-pill">已提示</span>
        ) : null}
        {hasRequestError(item) ? (
          <button
            className="request-detail-button"
            onClick={() => void openRequestDetail(item)}
            title="查看详细报错原因和过程"
            type="button"
          >
            <FileSearch size={13} />
            详情
          </button>
        ) : null}
      </div>
    ),
    inputTokens: formatNumber(item.inputTokens),
    cachedInputTokens: formatNumber(item.cachedInputTokens),
    outputTokens: formatNumber(item.outputTokens),
    totalTokens: formatNumber(item.totalTokens),
    chargedAmount: `$${money(item.chargedAmountUsd)}`,
    reasoningEffort: formatReasoningEffortCell(
      item.reasoningEffort,
      item.reasoningEffortActual,
    ),
    latency: seconds(item.latencyMs),
    firstTokenLatency: seconds(item.upstreamFirstChunkLatencyMs),
    createdAt: dateTime(item.createdAt),
  }));

  return (
    <>
      <section
        className={
          showCost ? "card requests-card audit-card" : "card requests-card"
        }
      >
        <div className="requests-head">
          <h2 className="section-title">
            {compact ? "最近调用" : showCost ? "全站调用" : "调用记录"}
          </h2>
          {showCost ? (
            <span className="section-subtitle">
              已加载 {requests.length} 条
              {hasMore ? " · 向下滚动继续加载" : " · 已到底"}
            </span>
          ) : null}
        </div>
        {showCost ? (
          <AdminDataTable
              columns={[
                { accessorKey: "trace", header: "追踪编码" },
                { accessorKey: "identity", header: "标识" },
                { accessorKey: "request", header: "调用" },
                { accessorKey: "status", header: "状态" },
                { accessorKey: "tokens", header: "Token" },
                { accessorKey: "cost", header: "费用" },
                { accessorKey: "latency", header: "耗时" },
                { accessorKey: "actions", header: "操作" },
              ]}
              className="audit-table-wrap"
              data={auditRequestRows}
              empty="暂无调用记录"
              onScroll={handleScroll}
              tableClassName="audit-table"
            />
        ) : (
          <AdminDataTable
              columns={[
                { accessorKey: "trace", header: "编码" },
                { accessorKey: "apiKey", header: "API Key" },
                { accessorKey: "ip", header: "IP" },
                { accessorKey: "model", header: "模型" },
                { accessorKey: "status", header: "状态" },
                { accessorKey: "inputTokens", header: "输入" },
                { accessorKey: "cachedInputTokens", header: "缓存" },
                { accessorKey: "outputTokens", header: "输出" },
                { accessorKey: "totalTokens", header: "总 token" },
                { accessorKey: "chargedAmount", header: "扣费" },
                { accessorKey: "reasoningEffort", header: "思考强度" },
                { accessorKey: "latency", header: "总时间" },
                { accessorKey: "firstTokenLatency", header: "首 token" },
                { accessorKey: "createdAt", header: "时间" },
              ]}
              data={requestRows}
              empty="暂无调用记录"
              onScroll={handleScroll}
            />
        )}
        <div
          className={
            showCost
              ? "mobile-record-list audit-mobile-list"
              : "mobile-record-list"
          }
          onScroll={handleScroll}
        >
          {requests.map((item) => (
            <MobileRecord
              key={item.id}
              title={item.model}
              meta={dateTime(item.createdAt)}
              badges={
                <>
                  <StatusPill status={getRequestStatusPillStatus(item)} />
                  {getCompactRequestLabel(item) ? (
                    <span className="request-compact-fallback-pill">
                      {getCompactRequestLabel(item)}
                    </span>
                  ) : null}
                </>
              }
            >
              <MobileField label="追踪编码" wide>
                <strong className="request-trace-code">
                  {formatRequestTraceCode(item)}
                </strong>
              </MobileField>
              {showCost ? (
                <>
                  <MobileField label="用户" wide>
                    {item.user?.email ?? "-"}
                  </MobileField>
                  <MobileField label="上游" wide>
                    {item.upstreamProvider ?? "-"}
                  </MobileField>
                  <MobileField label="上游 Key" wide>
                    {formatRequestUpstreamKey(item.upstreamProviderKey)}
                  </MobileField>
                </>
              ) : null}
              <MobileField label="思考强度">
                {formatReasoningEffortCell(
                  item.reasoningEffort,
                  item.reasoningEffortActual,
                )}
              </MobileField>
              <MobileField label="API Key" wide>
                {formatRequestApiKey(item.apiKey)}
              </MobileField>
              <MobileField label="IP" wide>
                <IpCell
                  ip={item.clientIp}
                  banned={Boolean(
                    item.clientIp &&
                    bannedIpSet.has(normalizeIpForCompare(item.clientIp)),
                  )}
                />
              </MobileField>
              <MobileField label="输入">
                {formatNumber(item.inputTokens)}
              </MobileField>
              <MobileField label="缓存">
                {formatNumber(item.cachedInputTokens)}
              </MobileField>
              <MobileField label="输出">
                {formatNumber(item.outputTokens)}
              </MobileField>
              <MobileField label="总 token">
                {formatNumber(item.totalTokens)}
              </MobileField>
              <MobileField label="扣费">
                ${money(item.chargedAmountUsd)}
              </MobileField>
              {showCost ? (
                <>
                  <MobileField label="上游成本">
                    ${money(item.upstreamCostUsd ?? "0")}
                  </MobileField>
                  <MobileField label="毛利">
                    $
                    {money(
                      Number(item.chargedAmountUsd) -
                        Number(item.upstreamCostUsd ?? 0),
                    )}
                  </MobileField>
                </>
              ) : null}
              <MobileField label="总时间">
                {seconds(item.latencyMs)}
              </MobileField>
              <MobileField label="首 token">
                {seconds(item.upstreamFirstChunkLatencyMs)}
              </MobileField>
              {getReturnedNoticeText(item) ? (
                <MobileField label="用户返回" wide>
                  已返回公告式提示
                </MobileField>
              ) : null}
              {getCompactRequestLabel(item) ? (
                <MobileField label="网关处理" wide>
                  {getCompactRequestLabel(item)}
                </MobileField>
              ) : null}
              {isManualTerminatedRequest(item) ? (
                <MobileField label="终止说明" wide>
                  管理员手动终止
                </MobileField>
              ) : null}
              {hasRequestError(item) ? (
                <div className="mobile-actions">
                  <button
                    className="button secondary"
                    onClick={() => void openRequestDetail(item)}
                    type="button"
                  >
                    <FileSearch size={16} />
                    查看报错详情
                  </button>
                </div>
              ) : null}
              {showCost && item.status === "PENDING" ? (
                <div className="mobile-actions">
                  <button
                    className="button danger"
                    disabled={
                      terminatingRequestId === item.id ||
                      isProtectedCompactRequest(item)
                    }
                    onClick={() => void terminateRequest(item)}
                    title={
                      isProtectedCompactRequest(item)
                        ? "这条 compact 调用不受自动倒计时终止限制，也不允许手动终止"
                        : "终止这条仍在处理中的调用"
                    }
                    type="button"
                  >
                    <CircleStop size={16} />
                    {isProtectedCompactRequest(item)
                      ? "compact 保护中"
                      : "终止"}
                  </button>
                </div>
              ) : null}
            </MobileRecord>
          ))}
          {requests.length === 0 ? (
            <MobileEmpty>暂无调用记录</MobileEmpty>
          ) : null}
        </div>
        {showCost ? (
          <div className="audit-load-state">
            {loadingMore
              ? "加载更多调用记录..."
              : hasMore
                ? "继续向下滚动加载更多"
                : "已加载全部调用记录"}
          </div>
        ) : null}
      </section>
      {selectedRequest ? (
        <RequestDetailModal
          detailError={detailError}
          loading={detailLoading}
          onClose={() => {
            setSelectedRequest(null);
            setDetailError(null);
          }}
          request={selectedRequest}
        />
      ) : null}
    </>
  );
}

function IpCell({ ip, banned }: { ip?: string | null; banned: boolean }) {
  if (!ip) {
    return <span>-</span>;
  }

  return (
    <div className="ip-cell">
      <span>{ip}</span>
      {banned ? <span className="ip-ban-pill">已封禁</span> : null}
    </div>
  );
}

function AuditMetric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "audit-metric strong" : "audit-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RequestDetailModal({
  request,
  loading,
  detailError,
  onClose,
}: {
  request: ApiRequestDetail;
  loading: boolean;
  detailError: string | null;
  onClose: () => void;
}) {
  const failureSummary = describeRequestFailure(request);
  const processSteps = buildRequestProcess(request, failureSummary);
  const returnedNoticeText = getReturnedNoticeText(request);
  const reasoningEffort = getRequestReasoningEffort(request);
  const manualTerminated = isManualTerminatedRequest(request);
  const compactFallback = isCompactFallbackRequest(request);

  return (
    <ModalShell
      title="调用详情"
      description={`${request.model} · ${dateTime(request.createdAt)}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body request-detail-modal">
        {loading ? (
          <div className="info-box">正在加载完整调用记录...</div>
        ) : null}
        {detailError ? (
          <div className="error">详情加载失败：{detailError}</div>
        ) : null}
        <section className="request-detail-section">
          <div className="request-detail-section-head">
            <h3>失败原因</h3>
            <StatusPill status={getRequestStatusPillStatus(request)} />
          </div>
          {manualTerminated ? (
            <div className="request-returned-notice">这是手动终止记录。</div>
          ) : null}
          {compactFallback ? (
            <div className="request-returned-notice">
              这条调用是 compact，并且发生过无感二次 compact。
            </div>
          ) : null}
          <div
            className={
              hasRequestError(request)
                ? "request-reason-box failed"
                : "request-reason-box"
            }
          >
            {failureSummary}
          </div>
          {request.errorMessage ? (
            <pre className="request-error-pre">
              {formatErrorForDisplay(request.errorMessage)}
            </pre>
          ) : (
            <div className="info-box">这条记录没有保存 errorMessage。</div>
          )}
        </section>

        {returnedNoticeText ? (
          <section className="request-detail-section notice-returned-section">
            <div className="request-detail-section-head">
              <h3>已返回给用户的提示</h3>
              <span className="request-notice-pill">公告式提示</span>
            </div>
            <div className="request-returned-notice">{returnedNoticeText}</div>
          </section>
        ) : null}

        <section className="request-detail-section">
          <div className="request-detail-section-head">
            <h3>调用过程</h3>
            <span className="section-subtitle">按网关处理顺序还原</span>
          </div>
          <div className="request-process-list">
            {processSteps.map((step) => (
              <div className="request-process-step" key={step.title}>
                <span className={`request-process-badge ${step.tone}`}>
                  {step.state}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="request-detail-section">
          <div className="request-detail-section-head">
            <h3>基础信息</h3>
          </div>
          <div className="request-detail-grid">
            <RequestDetailField label="追踪编码">
              {formatRequestTraceCode(request)}
            </RequestDetailField>
            <RequestDetailField label="用户">
              {request.user?.email ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="API Key">
              {formatRequestApiKey(request.apiKey)}
            </RequestDetailField>
            <RequestDetailField label="客户端 IP">
              {request.clientIp ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="User-Agent" wide>
              {request.userAgent ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="接口">
              {request.method ?? "POST"} {request.endpoint}
            </RequestDetailField>
            <RequestDetailField label="模型">
              {request.model}
            </RequestDetailField>
            {reasoningEffort ? (
              <RequestDetailField label="推理强度">
                {formatReasoningEffortCell(
                  reasoningEffort,
                  request.reasoningEffortActual,
                )}
              </RequestDetailField>
            ) : null}
            <RequestDetailField label="上游">
              {request.upstreamProvider ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="上游 Key">
              {formatRequestUpstreamKey(request.upstreamProviderKey)}
            </RequestDetailField>
            <RequestDetailField label="HTTP 状态">
              {request.httpStatus ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="上游请求 ID">
              {request.upstreamRequestId ?? "-"}
            </RequestDetailField>
            <RequestDetailField label="总时间">
              {seconds(request.latencyMs)}
            </RequestDetailField>
            <RequestDetailField label="首 token">
              {seconds(request.upstreamFirstChunkLatencyMs)}
            </RequestDetailField>
            <RequestDetailField label="创建时间">
              {dateTime(request.createdAt)}
            </RequestDetailField>
            <RequestDetailField label="更新时间">
              {request.updatedAt ? dateTime(request.updatedAt) : "-"}
            </RequestDetailField>
            <RequestDetailField label="Token" wide>
              输入 {formatNumber(request.inputTokens)} · 缓存{" "}
              {formatNumber(request.cachedInputTokens)} · 输出{" "}
              {formatNumber(request.outputTokens)} · 总计{" "}
              {formatNumber(request.totalTokens)}
            </RequestDetailField>
            <RequestDetailField label="费用" wide>
              用户扣费 ${money(request.chargedAmountUsd)} · 上游成本 $
              {money(request.upstreamCostUsd ?? "0")} · 毛利 $
              {money(
                Number(request.chargedAmountUsd) -
                  Number(request.upstreamCostUsd ?? 0),
              )}
            </RequestDetailField>
          </div>
        </section>

        <section className="request-json-grid">
          <JsonPanel title="请求体快照" value={request.requestBody} />
          <JsonPanel title="Usage / 计费快照" value={request.responseUsage} />
        </section>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose} type="button">
          关闭
        </button>
      </div>
    </ModalShell>
  );
}

function RequestDetailField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={wide ? "request-detail-field wide" : "request-detail-field"}
    >
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="request-json-panel">
      <div className="request-detail-section-head">
        <h3>{title}</h3>
      </div>
      <pre>{formatJsonValue(value)}</pre>
    </div>
  );
}

function hasRequestError(item: ApiRequest) {
  return (
    item.status === "FAILED" ||
    Boolean(item.errorMessage) ||
    Boolean(item.httpStatus && item.httpStatus >= 400)
  );
}

function getReturnedNoticeText(item: Pick<ApiRequest, "responseUsage">) {
  const usage = item.responseUsage;

  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const source = typeof record.source === "string" ? record.source : "";
  if (
    source !== "gateway_recovery_notice" &&
    source !== "gateway_ip_ban_notice" &&
    source !== "gateway_temporary_ip_notice_ban" &&
    source !== "gateway_charity_service_disabled_notice" &&
    source !== "gateway_model_unavailable_notice"
  ) {
    return null;
  }

  if (record.returnedToUser !== true) {
    return null;
  }

  return typeof record.noticeText === "string" && record.noticeText.trim()
    ? record.noticeText
    : source === "gateway_ip_ban_notice" ||
        source === "gateway_temporary_ip_notice_ban"
      ? "当前 IP 已被网关封禁。"
      : "网关已把这次失败转换成公告式提示返回给用户。";
}

function isCompactFallbackRequest(item: Pick<ApiRequest, "responseUsage">) {
  return Boolean(getCompactFallbackTrace(item));
}

function isProtectedCompactRequest(
  item: Pick<ApiRequest, "endpoint" | "responseUsage" | "status">,
) {
  return Boolean(getCompactRequestLabel(item));
}

function getCompactRequestLabel(
  item: Pick<ApiRequest, "endpoint" | "responseUsage" | "status">,
) {
  if (item.endpoint === "/v1/responses/compact") {
    return "compact";
  }

  const usage = item.responseUsage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const fallback = isPlainRecord(record.compactFallback)
    ? record.compactFallback
    : record;
  const fallbackSucceeded =
    typeof fallback.fallbackSucceeded === "boolean"
      ? fallback.fallbackSucceeded
      : typeof record.fallbackSucceeded === "boolean"
        ? record.fallbackSucceeded
        : null;
  const showFallback =
    fallbackSucceeded === true ||
    (item.status === "PENDING" &&
      (record.gatewayCompactFallback === true ||
        record.gatewayCompactKind === "fallback"));

  if (
    showFallback &&
    (record.gatewayCompactFallback === true ||
      record.gatewayCompactKind === "fallback")
  ) {
    return fallback.targetCacheHit === true
      ? "compact · 二次复用"
      : "compact · 二次";
  }

  if (record.gatewayCompactKind === "normal") {
    return "compact";
  }

  return null;
}

function getCompactFallbackTrace(item: Pick<ApiRequest, "responseUsage">) {
  const usage = item.responseUsage;

  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  if (record.gatewayCompactFallback !== true) {
    return null;
  }

  const fallback = isPlainRecord(record.compactFallback)
    ? record.compactFallback
    : record;
  const fallbackSucceeded =
    typeof fallback.fallbackSucceeded === "boolean"
      ? fallback.fallbackSucceeded
      : typeof record.fallbackSucceeded === "boolean"
        ? record.fallbackSucceeded
        : null;

  return fallbackSucceeded === false ? null : fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isManualTerminatedRequest(
  item: Pick<ApiRequest, "responseUsage" | "errorMessage" | "httpStatus">,
) {
  const usage = item.responseUsage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const record = usage as Record<string, unknown>;
    if (record.source === "gateway_manual_termination") {
      return true;
    }
  }

  return item.httpStatus === 499 || item.errorMessage === "手动终止";
}

function getRequestStatusPillStatus(item: ApiRequest) {
  return isManualTerminatedRequest(item) ? "TERMINATED" : item.status;
}

function getRequestReasoningEffort(
  item: Pick<ApiRequestDetail, "requestBody" | "reasoningEffort">,
) {
  if (item.reasoningEffort?.trim()) {
    return item.reasoningEffort.trim();
  }

  const body = item.requestBody;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const direct =
    typeof record.reasoning_effort === "string"
      ? record.reasoning_effort.trim()
      : "";
  if (direct) {
    return direct;
  }

  const modelDirect =
    typeof record.model_reasoning_effort === "string"
      ? record.model_reasoning_effort.trim()
      : "";
  if (modelDirect) {
    return modelDirect;
  }

  const reasoning = record.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const nested = reasoning as Record<string, unknown>;
    const nestedEffort =
      typeof nested.effort === "string" ? nested.effort.trim() : "";
    if (nestedEffort) {
      return nestedEffort;
    }
  }

  return null;
}

function formatReasoningEffort(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
  };

  return labels[normalized] ?? value.trim();
}

function getEnabledReasoningRulesSummary(
  settings: ReasoningEffortTransformSettings | null,
) {
  const enabledRules = settings?.rules.filter((rule) => rule.enabled) ?? [];
  if (enabledRules.length === 0) {
    return "关";
  }

  if (enabledRules.length === 1) {
    const rule = enabledRules[0];
    return rule
      ? `${formatReasoningEffort(rule.from)} -> ${formatReasoningEffort(rule.to)}`
      : "关";
  }

  return `${enabledRules.length} 条`;
}

function formatReasoningEffortCell(
  value?: string | null,
  actualValue?: string | null,
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "-";
  }

  const actual = actualValue?.trim();
  const originalLabel = formatReasoningEffort(trimmed);
  if (actual && actual.toLowerCase() !== trimmed.toLowerCase()) {
    return `${originalLabel} -> ${formatReasoningEffort(actual)}`;
  }

  return originalLabel;
}

function toQueryString(
  filters: RequestFilters,
  extras: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams();
  if (filters.q.trim()) {
    params.set("q", filters.q.trim());
  }
  if (filters.userId) {
    params.set("userId", filters.userId);
  }
  if (filters.model.trim()) {
    params.set("model", filters.model.trim());
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.dateFrom) {
    params.set("dateFrom", new Date(filters.dateFrom).toISOString());
  }
  if (filters.dateTo) {
    params.set("dateTo", new Date(filters.dateTo).toISOString());
  }
  for (const key of advancedRequestFilterKeys) {
    const value = filters[key].trim();
    if (value) {
      params.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function mergeRequests(current: ApiRequest[], incoming: ApiRequest[]) {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];

  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      next.push(item);
    }
  }

  return next;
}

function isIpBanRequest(
  item: Pick<ApiRequest, "responseUsage" | "errorMessage">,
) {
  const usage = item.responseUsage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const source = (usage as Record<string, unknown>).source;
    if (
      source === "gateway_ip_ban_notice" ||
      source === "gateway_ip_ban_error"
    ) {
      return true;
    }
  }

  return Boolean(item.errorMessage?.toLowerCase().includes("ip banned"));
}


function RequestSummaryCards({ summary }: { summary: AdminRequestsSummary }) {
  return (
    <div className="request-summary-grid" aria-live="polite">
      <div className="request-summary-tile">
        <span>匹配记录</span>
        <strong>{formatNumber(summary.totalCount)}</strong>
        <small>
          成功 {formatNumber(summary.successCount)} · 失败{" "}
          {formatNumber(summary.failedCount)} · 待处理{" "}
          {formatNumber(summary.pendingCount)}
        </small>
      </div>
      <div className="request-summary-tile">
        <span>失败率</span>
        <strong>{formatPercent(summary.failureRate)}</strong>
        <small>按全部匹配记录计算</small>
      </div>
      <div className="request-summary-tile">
        <span>Token</span>
        <strong>{formatNumber(summary.totalTokens)}</strong>
        <small>
          输入 {formatNumber(summary.inputTokens)} · 缓存{" "}
          {formatNumber(summary.cachedInputTokens)} · 输出{" "}
          {formatNumber(summary.outputTokens)}
        </small>
      </div>
      <div className="request-summary-tile">
        <span>费用与毛利</span>
        <strong>${money(summary.grossProfitUsd)}</strong>
        <small>
          扣费 ${money(summary.chargedAmountUsd)} · 成本 $
          {money(summary.upstreamCostUsd)}
        </small>
      </div>
      <div className="request-summary-tile">
        <span>平均耗时</span>
        <strong>{seconds(summary.avgLatencyMs)}</strong>
        <small>首 token {seconds(summary.avgFirstTokenLatencyMs)}</small>
      </div>
    </div>
  );
}

function RangeFilter({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  step = "any",
}: {
  label: string;
  minValue: string;
  maxValue: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  step?: string;
}) {
  return (
    <div className="range-field">
      <span>{label}</span>
      <div className="range-inputs">
        <input
          aria-label={`${label} 最小值`}
          className="input"
          inputMode="decimal"
          onChange={(event) => onMinChange(event.target.value)}
          placeholder="最小"
          step={step}
          type="number"
          value={minValue}
        />
        <input
          aria-label={`${label} 最大值`}
          className="input"
          inputMode="decimal"
          onChange={(event) => onMaxChange(event.target.value)}
          placeholder="最大"
          step={step}
          type="number"
          value={maxValue}
        />
      </div>
    </div>
  );
}

export function AdminRequestsPage({ onError }: { onError: (error: string | null) => void }) {
  const [filters, setFilters] = useState<RequestFilters>(emptyRequestFilters);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [summary, setSummary] = useState<AdminRequestsSummary>(
    emptyAdminRequestsSummary,
  );
  const [ipBanRules, setIpBanRules] = useState<IpBanRule[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const loadedFiltersRef = useRef<RequestFilters>(filters);
  const users = useAdminResource<UsersResponse>("users", "/admin/users");
  const risk = useAdminResource<RiskCenterResponse>("riskCenter", "/admin/risk-center");

  useEffect(() => {
    if (risk.data) {
      setIpBanRules(risk.data.ipBanRules ?? []);
    }
  }, [risk.data]);

  useEffect(() => {
    const firstError = users.error ?? risk.error;
    onError(firstError ? errorToText(firstError) : null);
  }, [onError, risk.error, users.error]);

  useEffect(() => {
    void refreshRequests({ nextFilters: filters });
  }, []);

  async function refreshRequests({
    nextFilters = filters,
    append = false,
    cursor,
  }: {
    nextFilters?: RequestFilters;
    append?: boolean;
    cursor?: string | null;
  } = {}) {
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    if (append) {
      setLoadingMore(true);
    } else {
      loadedFiltersRef.current = nextFilters;
      setNextCursor(null);
      setHasMore(false);
    }

    try {
      const result = await apiFetch<AdminRequestsPage>(
        `/admin/requests${toQueryString(nextFilters, { cursor: cursor ?? undefined })}`,
      );
      setRequests((current) =>
        append ? mergeRequests(current, result.requests) : result.requests,
      );
      setSummary(result.summary ?? emptyAdminRequestsSummary);
      if (result.ipBanRules) {
        setIpBanRules(result.ipBanRules);
      }
      setNextCursor(result.nextCursor ?? null);
      setHasMore(result.hasMore);
      onError(null);
    } catch (error) {
      onError(`调用记录加载失败：${errorToText(error)}`);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }

  function loadMore() {
    if (!hasMore || !nextCursor || loadingMore) {
      return;
    }

    void refreshRequests({
      nextFilters: loadedFiltersRef.current,
      append: true,
      cursor: nextCursor,
    });
  }

  return (
    <AdminRequests
      requests={requests}
      summary={summary}
      ipBanRules={ipBanRules}
      users={users.data?.users ?? []}
      filters={filters}
      pendingAutoTerminateSettings={
        risk.data?.pendingAutoTerminateSettings ?? null
      }
      reasoningEffortTransformSettings={
        risk.data?.reasoningEffortTransformSettings ?? null
      }
      hasMore={hasMore}
      loadingMore={loadingMore}
      onFiltersChange={setFilters}
      onLoadMore={loadMore}
      onSearch={(nextFilters) => refreshRequests({ nextFilters })}
      onRulesChanged={setIpBanRules}
      onRequestTerminated={() =>
        refreshRequests({ nextFilters: loadedFiltersRef.current })
      }
      onPendingAutoTerminateSettingsChanged={() => void risk.refetch()}
      onReasoningEffortTransformSettingsChanged={() => void risk.refetch()}
    />
  );
}

function AdminRequests({
  requests,
  summary,
  ipBanRules,
  users,
  filters,
  pendingAutoTerminateSettings,
  reasoningEffortTransformSettings,
  hasMore,
  loadingMore,
  onFiltersChange,
  onLoadMore,
  onSearch,
  onRulesChanged,
  onRequestTerminated,
  onPendingAutoTerminateSettingsChanged,
  onReasoningEffortTransformSettingsChanged,
}: {
  requests: ApiRequest[];
  summary: AdminRequestsSummary;
  ipBanRules: IpBanRule[];
  users: AdminUser[];
  filters: RequestFilters;
  pendingAutoTerminateSettings: PendingAutoTerminateSettings | null;
  reasoningEffortTransformSettings: ReasoningEffortTransformSettings | null;
  hasMore: boolean;
  loadingMore: boolean;
  onFiltersChange: (filters: RequestFilters) => void;
  onLoadMore: () => void;
  onSearch: (filters: RequestFilters) => void;
  onRulesChanged: (rules: IpBanRule[]) => void;
  onRequestTerminated: () => void;
  onPendingAutoTerminateSettingsChanged: (
    settings: PendingAutoTerminateSettings,
  ) => void;
  onReasoningEffortTransformSettingsChanged: (
    settings: ReasoningEffortTransformSettings,
  ) => void;
}) {
  const [ipInput, setIpInput] = useState("");
  const [banMode, setBanMode] = useState<IpBanMode>("error");
  const [banMessage, setBanMessage] = useState(defaultIpBanMessage);
  const [banReason, setBanReason] = useState("");
  const [banBusyIp, setBanBusyIp] = useState<string | null>(null);
  const [banError, setBanError] = useState<string | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [temporaryIpNoticeBans, setTemporaryIpNoticeBans] = useState<
    TemporaryIpNoticeBan[]
  >([]);
  const [temporaryIpNoticeBanSettings, setTemporaryIpNoticeBanSettings] =
    useState<TemporaryIpNoticeBanSettings | null>(null);
  const [temporaryIpNoticeBanSeconds, setTemporaryIpNoticeBanSeconds] =
    useState("60");
  const [temporaryIpNoticeBanMessage, setTemporaryIpNoticeBanMessage] =
    useState("您的网络较差，请一分钟后再试");
  const [temporaryIpNoticeBanBusy, setTemporaryIpNoticeBanBusy] =
    useState(false);
  const [temporaryIpNoticeBanError, setTemporaryIpNoticeBanError] = useState<
    string | null
  >(null);
  const [autoTerminateModalOpen, setAutoTerminateModalOpen] = useState(false);
  const [reasoningTransformModalOpen, setReasoningTransformModalOpen] =
    useState(false);
  const [governanceModalOpen, setGovernanceModalOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoTerminateBusy, setAutoTerminateBusy] = useState(false);
  const [autoTerminateError, setAutoTerminateError] = useState<string | null>(
    null,
  );
  const [autoTerminateDraftEnabled, setAutoTerminateDraftEnabled] = useState(
    Boolean(pendingAutoTerminateSettings?.enabled),
  );
  const [autoTerminateDraftSeconds, setAutoTerminateDraftSeconds] = useState(
    String(pendingAutoTerminateSettings?.timeoutSeconds ?? 30),
  );
  const [reasoningTransformBusy, setReasoningTransformBusy] = useState(false);
  const [reasoningTransformError, setReasoningTransformError] = useState<
    string | null
  >(null);
  const [reasoningTransformDraft, setReasoningTransformDraft] = useState({
    rules: reasoningEffortTransformSettings?.rules ?? [
      { enabled: true, from: "high", to: "medium" },
    ],
  });
  const activeAdvancedCount = countAdvancedRequestFilters(filters);
  const minAutoTerminateSeconds =
    pendingAutoTerminateSettings?.minTimeoutSeconds ?? 5;
  const maxAutoTerminateSeconds =
    pendingAutoTerminateSettings?.maxTimeoutSeconds ?? 3600;
  const reasoningEffortOptions = ["low", "medium", "high", "xhigh"];
  const reasoningTransformConflict = detectReasoningRuleConflicts();

  useEffect(() => {
    if (pendingAutoTerminateSettings) {
      setAutoTerminateDraftEnabled(pendingAutoTerminateSettings.enabled);
      setAutoTerminateDraftSeconds(
        String(pendingAutoTerminateSettings.timeoutSeconds),
      );
    }
  }, [
    pendingAutoTerminateSettings?.enabled,
    pendingAutoTerminateSettings?.timeoutSeconds,
  ]);

  useEffect(() => {
    if (reasoningEffortTransformSettings) {
      setReasoningTransformDraft({
        rules: reasoningEffortTransformSettings.rules.length
          ? reasoningEffortTransformSettings.rules
          : [{ enabled: true, from: "high", to: "medium" }],
      });
    }
  }, [reasoningEffortTransformSettings?.rules]);

  useEffect(() => {
    if (banModalOpen) {
      void loadTemporaryIpNoticeBans();
    }
  }, [banModalOpen]);

  function update<K extends keyof RequestFilters>(
    key: K,
    value: RequestFilters[K],
  ) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function resetFilters() {
    const nextFilters = { ...emptyRequestFilters };
    onFiltersChange(nextFilters);
    onSearch(nextFilters);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(filters);
  }

  async function saveRule(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBanError(null);

    const normalizedIp = normalizeIpForCompare(ipInput);
    if (!normalizedIp) {
      setBanError("请填写有效 IP。");
      return;
    }

    setBanBusyIp(normalizedIp);
    try {
      const result = await apiFetch<{ rules: IpBanRule[] }>(
        "/admin/ip-ban-rules",
        {
          method: "POST",
          body: JSON.stringify({
            ip: normalizedIp,
            mode: banMode,
            message: banMessage.trim() || defaultIpBanMessage,
            reason: banReason.trim() || null,
          }),
        },
      );
      onRulesChanged(result.rules);
      setIpInput("");
      setBanReason("");
    } catch (error) {
      setBanError(errorToText(error));
    } finally {
      setBanBusyIp(null);
    }
  }

  function openBanModal(ip?: string) {
    if (ip) {
      const normalizedIp = normalizeIpForCompare(ip);
      if (!normalizedIp) {
        setBanError("这条记录没有有效 IP。");
      } else {
        setIpInput(normalizedIp);
        setBanReason((current) => current || "从全站调用记录封禁");
        setBanError(null);
      }
    } else {
      setBanError(null);
    }

    setBanModalOpen(true);
  }

  async function deleteRule(ip: string) {
    const confirmed = await confirmAdminAction({
      title: "解除 IP 封禁",
      description: `确定解除 IP「${ip}」的封禁吗？`,
      confirmText: "解除封禁",
    });
    if (!confirmed) {
      return;
    }

    setBanError(null);
    setBanBusyIp(ip);
    try {
      const result = await apiFetch<{ rules: IpBanRule[] }>(
        `/admin/ip-ban-rules/${encodeURIComponent(ip)}`,
        {
          method: "DELETE",
        },
      );
      onRulesChanged(result.rules);
    } catch (error) {
      setBanError(errorToText(error));
    } finally {
      setBanBusyIp(null);
    }
  }

  async function loadTemporaryIpNoticeBans() {
    setTemporaryIpNoticeBanError(null);
    try {
      const result = await apiFetch<{
        bans: TemporaryIpNoticeBan[];
        settings: TemporaryIpNoticeBanSettings;
      }>("/admin/temporary-ip-notice-bans");
      setTemporaryIpNoticeBans(result.bans);
      setTemporaryIpNoticeBanSettings(result.settings);
      setTemporaryIpNoticeBanSeconds(String(result.settings.banSeconds));
      setTemporaryIpNoticeBanMessage(result.settings.message);
    } catch (error) {
      setTemporaryIpNoticeBanError(errorToText(error));
    }
  }

  async function saveTemporaryIpNoticeBanSettings() {
    const banSeconds = Number(temporaryIpNoticeBanSeconds);
    if (!Number.isFinite(banSeconds)) {
      setTemporaryIpNoticeBanError("请填写有效封禁秒数。");
      return;
    }
    if (!temporaryIpNoticeBanMessage.trim()) {
      setTemporaryIpNoticeBanError("请填写自动封禁返回文案。");
      return;
    }

    const minBanSeconds = temporaryIpNoticeBanSettings?.minBanSeconds ?? 10;
    const maxBanSeconds = temporaryIpNoticeBanSettings?.maxBanSeconds ?? 3600;
    const normalizedBanSeconds = Math.min(
      maxBanSeconds,
      Math.max(minBanSeconds, Math.round(banSeconds)),
    );

    setTemporaryIpNoticeBanBusy(true);
    setTemporaryIpNoticeBanError(null);
    try {
      const result = await apiFetch<{
        bans: TemporaryIpNoticeBan[];
        settings: TemporaryIpNoticeBanSettings;
      }>("/admin/temporary-ip-notice-bans/settings", {
        method: "PUT",
        body: JSON.stringify({
          banSeconds: normalizedBanSeconds,
          message: temporaryIpNoticeBanMessage.trim(),
        }),
      });
      setTemporaryIpNoticeBans(result.bans);
      setTemporaryIpNoticeBanSettings(result.settings);
      setTemporaryIpNoticeBanSeconds(String(result.settings.banSeconds));
      setTemporaryIpNoticeBanMessage(result.settings.message);
    } catch (error) {
      setTemporaryIpNoticeBanError(errorToText(error));
    } finally {
      setTemporaryIpNoticeBanBusy(false);
    }
  }

  async function deleteTemporaryIpNoticeBan(ip: string) {
    setTemporaryIpNoticeBanBusy(true);
    setTemporaryIpNoticeBanError(null);
    try {
      const result = await apiFetch<{ bans: TemporaryIpNoticeBan[] }>(
        `/admin/temporary-ip-notice-bans/${encodeURIComponent(ip)}`,
        { method: "DELETE" },
      );
      setTemporaryIpNoticeBans(result.bans);
    } catch (error) {
      setTemporaryIpNoticeBanError(errorToText(error));
    } finally {
      setTemporaryIpNoticeBanBusy(false);
    }
  }

  async function savePendingAutoTerminateSettings(
    next?: Partial<PendingAutoTerminateSettings>,
  ) {
    const timeoutSeconds = Number(
      next?.timeoutSeconds ?? autoTerminateDraftSeconds,
    );
    const normalizedTimeoutSeconds = Math.min(
      maxAutoTerminateSeconds,
      Math.max(minAutoTerminateSeconds, Math.round(timeoutSeconds)),
    );

    if (!Number.isFinite(timeoutSeconds)) {
      setAutoTerminateError("请填写有效秒数。");
      return;
    }

    setAutoTerminateBusy(true);
    setAutoTerminateError(null);
    try {
      const result = await apiFetch<{ settings: PendingAutoTerminateSettings }>(
        "/admin/pending-auto-terminate-settings",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: next?.enabled ?? autoTerminateDraftEnabled,
            timeoutSeconds: normalizedTimeoutSeconds,
          }),
        },
      );
      setAutoTerminateDraftSeconds(String(result.settings.timeoutSeconds));
      onPendingAutoTerminateSettingsChanged(result.settings);
      setAutoTerminateModalOpen(false);
    } catch (error) {
      setAutoTerminateError(errorToText(error));
    } finally {
      setAutoTerminateBusy(false);
    }
  }

  function submitPendingAutoTerminateSettings(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void savePendingAutoTerminateSettings();
  }

  async function saveReasoningEffortTransformSettings(
    next?: Partial<ReasoningEffortTransformSettings>,
  ) {
    setReasoningTransformBusy(true);
    setReasoningTransformError(null);
    try {
      const result = await apiFetch<{
        settings: ReasoningEffortTransformSettings;
      }>("/admin/reasoning-effort-transform-settings", {
        method: "PUT",
        body: JSON.stringify({
          rules: next?.rules ?? reasoningTransformDraft.rules,
        }),
      });
      setReasoningTransformDraft({
        rules: result.settings.rules.length
          ? result.settings.rules
          : [{ enabled: true, from: "high", to: "medium" }],
      });
      onReasoningEffortTransformSettingsChanged(result.settings);
      setReasoningTransformModalOpen(false);
      onSearch(filters);
    } catch (error) {
      setReasoningTransformError(errorToText(error));
    } finally {
      setReasoningTransformBusy(false);
    }
  }

  function submitReasoningEffortTransformSettings(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void saveReasoningEffortTransformSettings();
  }

  function updateReasoningRule(
    index: number,
    patch: Partial<ReasoningEffortTransformRule>,
  ) {
    setReasoningTransformDraft((current) => ({
      rules: current.rules.map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  }

  function addReasoningRule() {
    setReasoningTransformDraft((current) => ({
      rules: [...current.rules, { enabled: true, from: "low", to: "medium" }],
    }));
  }

  function removeReasoningRule(index: number) {
    setReasoningTransformDraft((current) => {
      const nextRules = current.rules.filter(
        (_, currentIndex) => currentIndex !== index,
      );
      return {
        rules: nextRules.length
          ? nextRules
          : [{ enabled: true, from: "high", to: "medium" }],
      };
    });
  }

  function detectReasoningRuleConflicts() {
    const enabledRules = reasoningTransformDraft.rules.filter(
      (rule) => rule.enabled,
    );
    const duplicates = new Map<string, number>();
    for (const rule of enabledRules) {
      duplicates.set(rule.from, (duplicates.get(rule.from) ?? 0) + 1);
    }
    const duplicateSources = [...duplicates.entries()]
      .filter(([, count]) => count > 1)
      .map(([from]) => from);
    const selfTransforms = enabledRules.filter(
      (rule) => rule.from === rule.to,
    ).length;
    return {
      duplicateSources,
      selfTransforms,
      hasConflict: duplicateSources.length > 0 || selfTransforms > 0,
    };
  }

  return (
    <div className="grid admin-page admin-requests-page admin-operations-page">
      <section className="admin-requests-tools">
        <div className="admin-requests-tools-copy">
          <strong>治理工具</strong>
          <span>封禁、自动终止和推理转换集中在这里。</span>
        </div>
        <div className="admin-hero-actions">
          <button
            className="button"
            onClick={() => setGovernanceModalOpen(true)}
            type="button"
          >
            <Shield size={17} />
            调用治理
            <span className="button-count">{ipBanRules.length}</span>
          </button>
        </div>
      </section>
      <section className="card admin-request-filter-card admin-query-console">
        <div className="section-head">
          <div>
            <h2 className="section-title">账单与调用筛选</h2>
            <p className="section-subtitle">
              统计按全部匹配记录计算，列表继续分页加载。
            </p>
          </div>
          <div className="button-row">
            <button
              aria-expanded={advancedOpen}
              className={
                advancedOpen ? "button secondary active" : "button secondary"
              }
              onClick={() => setAdvancedOpen((open) => !open)}
              type="button"
            >
              <SlidersHorizontal size={17} />
              高级筛选
              {activeAdvancedCount > 0 ? (
                <span className="button-count">{activeAdvancedCount}</span>
              ) : null}
            </button>
            <button
              className="button secondary"
              onClick={resetFilters}
              type="button"
            >
              重置
            </button>
          </div>
        </div>
        <form className="admin-request-filter-form" onSubmit={submit}>
          <div className="filter-bar request-common-filter-bar">
            <label className="field">
              <span>关键词</span>
              <input
                className="input"
                value={filters.q}
                onChange={(event) => update("q", event.target.value)}
                placeholder="用户邮箱 / 模型 / 接口"
              />
            </label>
            <label className="field">
              <span>用户</span>
              <select
                className="input"
                value={filters.userId}
                onChange={(event) => update("userId", event.target.value)}
              >
                <option value="">全部用户</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>模型</span>
              <input
                className="input"
                value={filters.model}
                onChange={(event) => update("model", event.target.value)}
                placeholder="gpt-5.5"
              />
            </label>
            <label className="field">
              <span>状态</span>
              <select
                className="input"
                value={filters.status}
                onChange={(event) =>
                  update(
                    "status",
                    event.target.value as RequestFilters["status"],
                  )
                }
              >
                <option value="">全部状态</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILED">FAILED</option>
                <option value="PENDING">PENDING</option>
              </select>
            </label>
            <label className="field">
              <span>开始</span>
              <input
                className="input"
                value={filters.dateFrom}
                onChange={(event) => update("dateFrom", event.target.value)}
                type="datetime-local"
              />
            </label>
            <label className="field">
              <span>结束</span>
              <input
                className="input"
                value={filters.dateTo}
                onChange={(event) => update("dateTo", event.target.value)}
                type="datetime-local"
              />
            </label>
            <button className="button" type="submit">
              查询
            </button>
          </div>
          {advancedOpen ? (
            <div className="advanced-filter-panel">
              <div className="advanced-filter-grid">
                <label className="field">
                  <span>IP</span>
                  <input
                    className="input"
                    value={filters.clientIp}
                    onChange={(event) => update("clientIp", event.target.value)}
                    placeholder="203.0.113.10"
                  />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input
                    className="input"
                    value={filters.apiKey}
                    onChange={(event) => update("apiKey", event.target.value)}
                    placeholder="名称 / 前缀"
                  />
                </label>
                <label className="field">
                  <span>上游 Provider</span>
                  <input
                    className="input"
                    value={filters.upstreamProvider}
                    onChange={(event) =>
                      update("upstreamProvider", event.target.value)
                    }
                    placeholder="openai"
                  />
                </label>
                <label className="field">
                  <span>上游 Key</span>
                  <input
                    className="input"
                    value={filters.upstreamKey}
                    onChange={(event) =>
                      update("upstreamKey", event.target.value)
                    }
                    placeholder="名称 / 前缀"
                  />
                </label>
                <label className="field">
                  <span>接口 endpoint</span>
                  <input
                    className="input"
                    value={filters.endpoint}
                    onChange={(event) => update("endpoint", event.target.value)}
                    placeholder="/v1/chat/completions"
                  />
                </label>
                <label className="field">
                  <span>HTTP 状态</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    max={599}
                    min={100}
                    onChange={(event) =>
                      update("httpStatus", event.target.value)
                    }
                    placeholder="403"
                    step={1}
                    type="number"
                    value={filters.httpStatus}
                  />
                </label>
                <label className="field">
                  <span>返回类型</span>
                  <select
                    className="input"
                    value={filters.resultType}
                    onChange={(event) =>
                      update(
                        "resultType",
                        event.target.value as RequestFilters["resultType"],
                      )
                    }
                  >
                    <option value="">全部</option>
                    <option value="PROXIED_SUCCESS">转发成功</option>
                    <option value="UPSTREAM_ERROR">上游失败</option>
                    <option value="GATEWAY_NOTICE">网关公告</option>
                    <option value="IP_BAN">IP 封禁</option>
                    <option value="RATE_LIMITED">限流拒绝</option>
                    <option value="INSUFFICIENT_BALANCE">余额不足</option>
                    <option value="MANUAL_TERMINATED">手动终止</option>
                    <option value="AUTO_TERMINATED">自动终止</option>
                    <option value="BILLING_ERROR">计费异常</option>
                    <option value="CLIENT_CLOSED">客户端断开</option>
                    <option value="GATEWAY_ERROR">网关错误</option>
                    <option value="notice">兼容：已公告提示</option>
                    <option value="ip_ban">兼容：IP 封禁</option>
                    <option value="error">兼容：普通失败</option>
                  </select>
                </label>
                <RangeFilter
                  label="总 token"
                  minValue={filters.minTokens}
                  maxValue={filters.maxTokens}
                  onMinChange={(value) => update("minTokens", value)}
                  onMaxChange={(value) => update("maxTokens", value)}
                  step="1"
                />
                <RangeFilter
                  label="扣费 USD"
                  minValue={filters.minChargedUsd}
                  maxValue={filters.maxChargedUsd}
                  onMinChange={(value) => update("minChargedUsd", value)}
                  onMaxChange={(value) => update("maxChargedUsd", value)}
                />
                <RangeFilter
                  label="上游成本 USD"
                  minValue={filters.minUpstreamCostUsd}
                  maxValue={filters.maxUpstreamCostUsd}
                  onMinChange={(value) => update("minUpstreamCostUsd", value)}
                  onMaxChange={(value) => update("maxUpstreamCostUsd", value)}
                />
                <RangeFilter
                  label="毛利 USD"
                  minValue={filters.minGrossProfitUsd}
                  maxValue={filters.maxGrossProfitUsd}
                  onMinChange={(value) => update("minGrossProfitUsd", value)}
                  onMaxChange={(value) => update("maxGrossProfitUsd", value)}
                />
                <RangeFilter
                  label="总耗时 ms"
                  minValue={filters.minLatencyMs}
                  maxValue={filters.maxLatencyMs}
                  onMinChange={(value) => update("minLatencyMs", value)}
                  onMaxChange={(value) => update("maxLatencyMs", value)}
                  step="1"
                />
                <RangeFilter
                  label="首 token ms"
                  minValue={filters.minFirstTokenLatencyMs}
                  maxValue={filters.maxFirstTokenLatencyMs}
                  onMinChange={(value) =>
                    update("minFirstTokenLatencyMs", value)
                  }
                  onMaxChange={(value) =>
                    update("maxFirstTokenLatencyMs", value)
                  }
                  step="1"
                />
              </div>
            </div>
          ) : null}
        </form>
        <RequestSummaryCards summary={summary} />
      </section>
      <section className="admin-data-workbench">
        <Requests
          requests={requests}
          ipBanRules={ipBanRules}
          showCost
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          onRequestTerminated={onRequestTerminated}
        />
      </section>
      {governanceModalOpen ? (
        <ModalShell
          title="调用治理"
          description="封禁、自动终止和推理转换集中入口，避免占用请求列表空间。"
          onClose={() => setGovernanceModalOpen(false)}
          wide
        >
          <div className="modal-body admin-governance-grid">
            <button className="admin-action-card" onClick={() => openBanModal()} type="button">
              <div>
                <strong>IP 封禁</strong>
                <small>手动限制 IP，并查看当前规则数量。</small>
              </div>
              <div className="admin-action-card-side">
                <span className="button-count">{ipBanRules.length}</span>
                <Shield size={18} />
              </div>
            </button>
            <button className="admin-action-card" onClick={() => setAutoTerminateModalOpen(true)} type="button">
              <div>
                <strong>Pending 自动终止</strong>
                <small>
                  {pendingAutoTerminateSettings?.enabled
                    ? `超过 ${pendingAutoTerminateSettings.timeoutSeconds}s 自动终止`
                    : "当前关闭"}
                </small>
              </div>
              <div className="admin-action-card-side">
                <StatusPill status={pendingAutoTerminateSettings?.enabled ? "AUTO_TERMINATE_ON" : "AUTO_TERMINATE_OFF"} />
                <CircleStop size={18} />
              </div>
            </button>
            <button className="admin-action-card" onClick={() => setReasoningTransformModalOpen(true)} type="button">
              <div>
                <strong>推理转换</strong>
                <small>将高推理等级映射到更温和的请求参数。</small>
              </div>
              <div className="admin-action-card-side">
                <span className="button-count">{getEnabledReasoningRulesSummary(reasoningEffortTransformSettings)}</span>
                <SlidersHorizontal size={18} />
              </div>
            </button>
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setGovernanceModalOpen(false)} type="button">
              关闭
            </button>
          </div>
        </ModalShell>
      ) : null}
      {autoTerminateModalOpen ? (
        <ModalShell
          title="Pending 自动终止"
          description="超过设定秒数的 PENDING 会按手动终止处理。"
          onClose={() => setAutoTerminateModalOpen(false)}
        >
          <form className="form" onSubmit={submitPendingAutoTerminateSettings}>
            <div className="modal-body">
              {autoTerminateError ? (
                <div className="error compact-error">{autoTerminateError}</div>
              ) : null}
              <div className="settings-modal-status">
                <StatusPill
                  status={
                    autoTerminateDraftEnabled
                      ? "AUTO_TERMINATE_ON"
                      : "AUTO_TERMINATE_OFF"
                  }
                />
                <span>
                  {autoTerminateDraftEnabled
                    ? `超过 ${autoTerminateDraftSeconds || (pendingAutoTerminateSettings?.timeoutSeconds ?? 30)} 秒自动终止。`
                    : "自动终止已关闭。"}
                </span>
              </div>
              <label className="check-row">
                <input
                  checked={autoTerminateDraftEnabled}
                  disabled={!pendingAutoTerminateSettings || autoTerminateBusy}
                  onChange={(event) =>
                    setAutoTerminateDraftEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                启用 Pending 自动终止
              </label>
              <label className="field">
                <span>超过多少秒终止</span>
                <input
                  className="input"
                  disabled={!pendingAutoTerminateSettings || autoTerminateBusy}
                  inputMode="numeric"
                  max={maxAutoTerminateSeconds}
                  min={minAutoTerminateSeconds}
                  onChange={(event) =>
                    setAutoTerminateDraftSeconds(event.target.value)
                  }
                  type="number"
                  value={autoTerminateDraftSeconds}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setAutoTerminateModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={!pendingAutoTerminateSettings || autoTerminateBusy}
                type="submit"
              >
                <Save size={17} />
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
      {reasoningTransformModalOpen ? (
        <ModalShell
          title="推理强度转换"
          description="支持多条规则，命中后用户请求保持原样记录，上游实际请求会换成设定档位。"
          onClose={() => setReasoningTransformModalOpen(false)}
        >
          <form
            className="form"
            onSubmit={submitReasoningEffortTransformSettings}
          >
            <div className="modal-body">
              {reasoningTransformError ? (
                <div className="error compact-error">
                  {reasoningTransformError}
                </div>
              ) : null}
              <div className="settings-modal-status">
                <StatusPill
                  status={
                    reasoningTransformDraft.rules.some((rule) => rule.enabled)
                      ? "REASONING_TRANSFORM_ON"
                      : "REASONING_TRANSFORM_OFF"
                  }
                />
                <span>
                  {reasoningTransformDraft.rules.some((rule) => rule.enabled)
                    ? `${reasoningTransformDraft.rules.filter((rule) => rule.enabled).length} 条规则启用中`
                    : "推理强度转换已关闭。"}
                </span>
              </div>
              <label className="check-row">
                <input
                  checked={reasoningTransformDraft.rules.some(
                    (rule) => rule.enabled,
                  )}
                  disabled={
                    !reasoningEffortTransformSettings || reasoningTransformBusy
                  }
                  onChange={(event) =>
                    setReasoningTransformDraft((current) => ({
                      rules: current.rules.map((rule) => ({
                        ...rule,
                        enabled: event.target.checked,
                      })),
                    }))
                  }
                  type="checkbox"
                />
                启用推理强度转换
              </label>
              <div className="reasoning-transform-rule-list">
                {reasoningTransformDraft.rules.map((rule, index) => (
                  <div
                    className="reasoning-transform-rule"
                    key={`${index}-${rule.from}-${rule.to}`}
                  >
                    <label className="check-row reasoning-transform-rule-switch">
                      <input
                        checked={rule.enabled}
                        disabled={
                          !reasoningEffortTransformSettings ||
                          reasoningTransformBusy
                        }
                        onChange={(event) =>
                          updateReasoningRule(index, {
                            enabled: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      启用
                    </label>
                    <label className="field reasoning-transform-select">
                      <span>用户请求</span>
                      <select
                        className="input"
                        disabled={
                          !reasoningEffortTransformSettings ||
                          reasoningTransformBusy
                        }
                        onChange={(event) =>
                          updateReasoningRule(index, {
                            from: event.target.value,
                          })
                        }
                        value={rule.from}
                      >
                        {reasoningEffortOptions.map((option) => (
                          <option key={option} value={option}>
                            {formatReasoningEffort(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="reasoning-transform-arrow">→</span>
                    <label className="field reasoning-transform-select">
                      <span>实际上游</span>
                      <select
                        className="input"
                        disabled={
                          !reasoningEffortTransformSettings ||
                          reasoningTransformBusy
                        }
                        onChange={(event) =>
                          updateReasoningRule(index, { to: event.target.value })
                        }
                        value={rule.to}
                      >
                        {reasoningEffortOptions.map((option) => (
                          <option key={option} value={option}>
                            {formatReasoningEffort(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button secondary icon-button"
                      disabled={
                        !reasoningEffortTransformSettings ||
                        reasoningTransformBusy
                      }
                      onClick={() => removeReasoningRule(index)}
                      type="button"
                      title="删除规则"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="button secondary"
                disabled={
                  !reasoningEffortTransformSettings || reasoningTransformBusy
                }
                onClick={addReasoningRule}
                type="button"
              >
                <Plus size={16} />
                添加规则
              </button>
              {reasoningTransformConflict.hasConflict ? (
                <div className="notice warning">
                  {reasoningTransformConflict.duplicateSources.length > 0
                    ? `冲突：${reasoningTransformConflict.duplicateSources
                        .map((item) => formatReasoningEffort(item))
                        .join("、")} 被重复映射。`
                    : null}
                  {reasoningTransformConflict.selfTransforms > 0
                    ? " 不允许原档位和目标档位相同。"
                    : null}
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setReasoningTransformModalOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={
                  !reasoningEffortTransformSettings ||
                  reasoningTransformBusy ||
                  detectReasoningRuleConflicts().hasConflict
                }
                type="submit"
              >
                <Save size={17} />
                保存
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
      {banModalOpen ? (
        <ModalShell
          title="IP 封禁"
          description="只影响公开代理调用，后台登录和管理不受影响。"
          onClose={() => setBanModalOpen(false)}
          wide
        >
          <div className="modal-body ip-ban-modal-body">
            {banError ? (
              <div className="error compact-error">{banError}</div>
            ) : null}
            <form className="ip-ban-form" onSubmit={saveRule}>
              <label className="field">
                <span>IP</span>
                <input
                  className="input"
                  value={ipInput}
                  onChange={(event) => setIpInput(event.target.value)}
                  placeholder="例如 203.0.113.10"
                />
              </label>
              <label className="field">
                <span>返回方式</span>
                <select
                  className="input"
                  value={banMode}
                  onChange={(event) =>
                    setBanMode(event.target.value as IpBanMode)
                  }
                >
                  <option value="error">封禁报错</option>
                  <option value="notice">公告报错</option>
                </select>
              </label>
              <label className="field">
                <span>返回内容</span>
                <input
                  className="input"
                  value={banMessage}
                  onChange={(event) => setBanMessage(event.target.value)}
                  placeholder={defaultIpBanMessage}
                />
              </label>
              <label className="field">
                <span>备注</span>
                <input
                  className="input"
                  value={banReason}
                  onChange={(event) => setBanReason(event.target.value)}
                  placeholder="可选"
                />
              </label>
              <button
                className="button"
                disabled={Boolean(banBusyIp)}
                type="submit"
              >
                <Shield size={17} />
                {banBusyIp ? "处理中..." : "保存封禁"}
              </button>
            </form>
            <div className="ip-ban-rule-list">
              {ipBanRules.map((rule) => (
                <div className="ip-ban-rule" key={rule.ip}>
                  <div>
                    <strong>{rule.ip}</strong>
                    <p>{rule.reason || rule.message}</p>
                  </div>
                  <span
                    className={rule.mode === "notice" ? "pill ok" : "pill warn"}
                  >
                    {rule.mode === "notice" ? "公告报错" : "封禁报错"}
                  </span>
                  <button
                    className="button secondary"
                    disabled={banBusyIp === rule.ip}
                    onClick={() => void deleteRule(rule.ip)}
                    type="button"
                  >
                    解封
                  </button>
                </div>
              ))}
              {ipBanRules.length === 0 ? (
                <div className="empty-state compact">暂无封禁 IP</div>
              ) : null}
            </div>
            <div className="temporary-ip-ban-panel">
              <div className="temporary-ip-ban-head">
                <div>
                  <strong>自动公告封禁</strong>
                  <p>连续 2 次自动终止会临时封禁 IP，并按下方文案返回。</p>
                </div>
                <button
                  className="button secondary"
                  disabled={temporaryIpNoticeBanBusy}
                  onClick={() => void loadTemporaryIpNoticeBans()}
                  type="button"
                >
                  <RefreshCw size={16} />
                  刷新
                </button>
              </div>
              {temporaryIpNoticeBanError ? (
                <div className="error compact-error">
                  {temporaryIpNoticeBanError}
                </div>
              ) : null}
              <div className="temporary-ip-ban-settings">
                <label className="field">
                  <span>自动封禁时长（秒）</span>
                  <input
                    className="input"
                    disabled={
                      !temporaryIpNoticeBanSettings || temporaryIpNoticeBanBusy
                    }
                    inputMode="numeric"
                    max={temporaryIpNoticeBanSettings?.maxBanSeconds ?? 3600}
                    min={temporaryIpNoticeBanSettings?.minBanSeconds ?? 10}
                    onChange={(event) =>
                      setTemporaryIpNoticeBanSeconds(event.target.value)
                    }
                    type="number"
                    value={temporaryIpNoticeBanSeconds}
                  />
                </label>
                <label className="field temporary-ip-ban-message-field">
                  <span>返回文案</span>
                  <input
                    className="input"
                    disabled={
                      !temporaryIpNoticeBanSettings || temporaryIpNoticeBanBusy
                    }
                    onChange={(event) =>
                      setTemporaryIpNoticeBanMessage(event.target.value)
                    }
                    value={temporaryIpNoticeBanMessage}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={
                    !temporaryIpNoticeBanSettings || temporaryIpNoticeBanBusy
                  }
                  onClick={() => void saveTemporaryIpNoticeBanSettings()}
                  type="button"
                >
                  <Save size={16} />
                  保存时长
                </button>
              </div>
              <div className="temporary-ip-ban-list">
                {temporaryIpNoticeBans.map((ban) => (
                  <div className="temporary-ip-ban-item" key={ban.ip}>
                    <div>
                      <strong>{ban.ip}</strong>
                      <p>
                        剩余 {formatDuration(ban.ttlSeconds)} · {ban.message}
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      disabled={temporaryIpNoticeBanBusy}
                      onClick={() => void deleteTemporaryIpNoticeBan(ban.ip)}
                      type="button"
                    >
                      解封
                    </button>
                  </div>
                ))}
                {temporaryIpNoticeBans.length === 0 ? (
                  <div className="empty-state compact">暂无自动封禁 IP</div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setBanModalOpen(false)}
              type="button"
            >
              关闭
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
