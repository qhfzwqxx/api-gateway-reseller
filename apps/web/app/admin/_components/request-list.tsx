"use client";

import { CircleStop, FileSearch } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { apiFetch, getToken } from "../../../lib/api";
import { Pagination } from "../../front/_components/Pagination";
import { confirmAdminAction } from "./admin-confirm";
import { dateTime, formatNumber, money, seconds } from "./admin-format";
import { AdminDataTable, MobileEmpty, MobileField, MobileRecord, ModalShell, StatusPill } from "./admin-ui";

export type ApiRequest = {
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
  subscriptionChargedAmountUsd?: string | null;
  walletChargedAmountUsd?: string | null;
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

type IpBanRule = { ip: string; mode: "error" | "notice"; message: string; reason?: string | null; createdAt: string; updatedAt: string };

function errorToText(error: unknown) { return error instanceof Error ? error.message : "未知错误"; }

type ReasoningEffortTransformSettings = {
  rules: Array<{ enabled: boolean; from: string; to: string }>;
};

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

function displayUpstreamProviderKeyName(name: string) {
  return name === "默认 Key" ? "key-1" : name;
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

export function Requests({
  requests,
  compact = false,
  paginated = false,
  showCost = false,
  ipBanRules = [],
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRequestTerminated,
}: {
  requests: ApiRequest[];
  compact?: boolean;
  paginated?: boolean;
  showCost?: boolean;
  ipBanRules?: IpBanRule[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onRequestTerminated?: (request: ApiRequest) => void;
}) {
  const showInternalFields = showCost;
  const [selectedRequest, setSelectedRequest] =
    useState<ApiRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [terminatingRequestId, setTerminatingRequestId] = useState<
    string | null
  >(null);
  const bannedIpSet = new Set(ipBanRules.map((rule) => rule.ip));
  const [pageSize, setPageSize] = useState(18);
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = paginated
    ? Math.max(1, Math.ceil(requests.length / pageSize))
    : 1;
  const activePage = Math.min(currentPage, pageCount);
  const visibleRequests = paginated
    ? requests.slice((activePage - 1) * pageSize, activePage * pageSize)
    : requests;

  useEffect(() => {
    setCurrentPage(1);
  }, [requests, pageSize]);

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
  const auditRequestRows = visibleRequests.map((item) => ({
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
          label="订阅"
          value={`$${money(item.subscriptionChargedAmountUsd ?? "0")}`}
        />
        <AuditMetric
          label="钱包"
          value={`$${money(item.walletChargedAmountUsd ?? item.chargedAmountUsd)}`}
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
  const requestRows = visibleRequests.map((item) => ({
    id: item.id,
    apiKey: formatRequestApiKey(item.apiKey),
    model: item.model,
    inputTokens: formatNumber(item.inputTokens),
    cachedInputTokens: formatNumber(item.cachedInputTokens),
    outputTokens: formatNumber(item.outputTokens),
    totalTokens: formatNumber(item.totalTokens),
    chargedAmount: `$${money(item.chargedAmountUsd)}`,
    firstTokenLatency: seconds(item.upstreamFirstChunkLatencyMs),
    latency: seconds(item.latencyMs),
    createdAt: dateTime(item.createdAt),
  }));

  return (
    <>
      <section
        className={
          showCost
            ? "card requests-card audit-card"
            : compact
              ? "card requests-card front-requests-card front-requests-card-compact"
              : paginated
                ? "card requests-card front-requests-card front-requests-card-paged front-records-card front-usage-requests-card"
              : "card requests-card front-requests-card"
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
                { accessorKey: "apiKey", header: "Key" },
                { accessorKey: "model", header: "模型 ID" },
                { accessorKey: "inputTokens", header: "输入" },
                { accessorKey: "cachedInputTokens", header: "缓存" },
                { accessorKey: "outputTokens", header: "输出" },
                { accessorKey: "totalTokens", header: "总 token" },
                { accessorKey: "chargedAmount", header: "花费" },
                { accessorKey: "firstTokenLatency", header: "首 token 时间" },
                { accessorKey: "latency", header: "总耗时" },
                { accessorKey: "createdAt", header: "请求时间" },
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
          {visibleRequests.map((item) => (
            <MobileRecord
              key={item.id}
              title={item.model}
              meta={dateTime(item.createdAt)}
              badges={
                showCost ? (
                  <>
                    <StatusPill status={getRequestStatusPillStatus(item)} />
                    {getCompactRequestLabel(item) ? (
                      <span className="request-compact-fallback-pill">
                        {getCompactRequestLabel(item)}
                      </span>
                    ) : null}
                  </>
                ) : undefined
              }
            >
              {showCost ? (
                <>
                  <MobileField label="追踪编码" wide>
                    <strong className="request-trace-code">
                      {formatRequestTraceCode(item)}
                    </strong>
                  </MobileField>
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
              <MobileField label="Key" wide>
                {formatRequestApiKey(item.apiKey)}
              </MobileField>
              {showCost ? (
                <MobileField label="IP" wide>
                  <IpCell
                    ip={item.clientIp}
                    banned={Boolean(
                      item.clientIp &&
                      bannedIpSet.has(normalizeIpForCompare(item.clientIp)),
                    )}
                  />
                </MobileField>
              ) : null}
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
              <MobileField label="花费">
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
              <MobileField label="首 token 时间">
                {seconds(item.upstreamFirstChunkLatencyMs)}
              </MobileField>
              <MobileField label="总耗时">{seconds(item.latencyMs)}</MobileField>
              {showCost ? (
                <>
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
                  {item.status === "PENDING" ? (
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
                </>
              ) : null}
            </MobileRecord>
          ))}
          {visibleRequests.length === 0 ? (
            <MobileEmpty>暂无调用记录</MobileEmpty>
          ) : null}
        </div>
        {paginated && !showCost ? (
          <Pagination
            className="front-requests-pagination"
            currentPage={activePage}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSize={pageSize}
            pageSizeOptions={[12, 16, 18]}
            totalPages={pageCount}
          />
        ) : null}
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
          showInternalFields={showInternalFields}
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
  showInternalFields,
  onClose,
}: {
  request: ApiRequestDetail;
  loading: boolean;
  detailError: string | null;
  showInternalFields: boolean;
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
            {showInternalFields && reasoningEffort ? (
              <RequestDetailField label="推理强度">
                {formatReasoningEffortCell(
                  reasoningEffort,
                  request.reasoningEffortActual,
                )}
              </RequestDetailField>
            ) : null}
            {showInternalFields ? (
              <>
                <RequestDetailField label="上游">
                  {request.upstreamProvider ?? "-"}
                </RequestDetailField>
                <RequestDetailField label="上游 Key">
                  {formatRequestUpstreamKey(request.upstreamProviderKey)}
                </RequestDetailField>
              </>
            ) : null}
            <RequestDetailField label="HTTP 状态">
              {request.httpStatus ?? "-"}
            </RequestDetailField>
            {showInternalFields ? (
              <RequestDetailField label="上游请求 ID">
                {request.upstreamRequestId ?? "-"}
              </RequestDetailField>
            ) : null}
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
              {showInternalFields ? (
                <>
                  用户扣费 ${money(request.chargedAmountUsd)} · 上游成本 $
                  {money(request.upstreamCostUsd ?? "0")} · 毛利 $
                  {money(
                    Number(request.chargedAmountUsd) -
                      Number(request.upstreamCostUsd ?? 0),
                  )}
                  <br />
                  订阅抵扣 ${money(request.subscriptionChargedAmountUsd ?? "0")} ·
                  钱包扣费 $
                  {money(
                    request.walletChargedAmountUsd ?? request.chargedAmountUsd,
                  )}
                </>
              ) : (
                <>用户扣费 ${money(request.chargedAmountUsd)}</>
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
