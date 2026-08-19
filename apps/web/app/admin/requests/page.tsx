"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Search, ShieldAlert, SlidersHorizontal, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { useUrlFilters } from "../../../hooks/use-url-filters";
import {
  getRequests,
  terminateRequest,
  type ApiRequestRecord,
  type ApiRequestResultType,
  type ApiRequestStatus,
  type GetRequestsParams,
} from "../../../lib/api/requests";
import { getAdminUsers } from "../../../lib/api/users";
import { AdminScrollLock } from "../components/admin-scroll-lock";
import { RequestDetailDrawer } from "./components/request-detail-drawer";

const defaultFilters = {
  q: "",
  userId: "",
  status: "",
  resultType: "",
  dateFrom: "",
  dateTo: "",
  model: "",
  clientIp: "",
  apiKey: "",
  upstreamProvider: "",
  upstreamKey: "",
  endpoint: "",
  httpStatus: "",
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
  take: 120,
};

const advancedFilterKeys = [
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
] as const;

export default function AdminRequestsPage() {
  const queryClient = useQueryClient();
  const { filters, setFilters, resetFilters } = useUrlFilters(defaultFilters);
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [terminatingRequest, setTerminatingRequest] = useState<ApiRequestRecord | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin", "users", "request-filter"],
    queryFn: getAdminUsers,
    staleTime: 60_000,
  });

  const hasActiveFilters = useMemo(() => hasActiveRequestFilters(filters), [filters]);
  const requestParams = useMemo<GetRequestsParams>(
    () => ({
      q: filters.q,
      userId: filters.userId,
      status: filters.status as ApiRequestStatus | undefined,
      resultType: filters.resultType as ApiRequestResultType | undefined,
      dateFrom: toIsoDateTime(filters.dateFrom, "start"),
      dateTo: toIsoDateTime(filters.dateTo, "end"),
      model: filters.model,
      clientIp: filters.clientIp,
      apiKey: filters.apiKey,
      upstreamProvider: filters.upstreamProvider,
      upstreamKey: filters.upstreamKey,
      endpoint: filters.endpoint,
      httpStatus: filters.httpStatus,
      minTokens: filters.minTokens,
      maxTokens: filters.maxTokens,
      minChargedUsd: filters.minChargedUsd,
      maxChargedUsd: filters.maxChargedUsd,
      minUpstreamCostUsd: filters.minUpstreamCostUsd,
      maxUpstreamCostUsd: filters.maxUpstreamCostUsd,
      minGrossProfitUsd: filters.minGrossProfitUsd,
      maxGrossProfitUsd: filters.maxGrossProfitUsd,
      minLatencyMs: filters.minLatencyMs,
      maxLatencyMs: filters.maxLatencyMs,
      minFirstTokenLatencyMs: filters.minFirstTokenLatencyMs,
      maxFirstTokenLatencyMs: filters.maxFirstTokenLatencyMs,
      take: filters.take,
      summaryMode: hasActiveFilters ? "page" : "full",
    }),
    [filters, hasActiveFilters],
  );

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    const normalizedSearch = normalizeRequestSearch(searchDraft);
    if (normalizedSearch === filters.q) return;
    const timer = window.setTimeout(() => {
      setFilters({ q: normalizedSearch });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [filters.q, searchDraft, setFilters]);

  const requestsQuery = useInfiniteQuery({
    queryKey: ["admin", "requests", requestParams],
    queryFn: ({ pageParam }) => getRequests({ ...requestParams, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    refetchInterval: hasActiveFilters ? false : 15_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const terminateMutation = useMutation({
    mutationFn: terminateRequest,
    onSuccess: () => {
      setTerminatingRequest(null);
      setNotice("请求已终止");
      void queryClient.invalidateQueries({ queryKey: ["admin", "requests"] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "终止失败，请稍后重试。"),
  });

  const rows = requestsQuery.data?.pages.flatMap((page) => page.requests) ?? [];
  const firstPage = requestsQuery.data?.pages[0];
  const activeAdvancedCount = countActiveAdvancedFilters(filters);
  const users = usersQuery.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AdminScrollLock />
      <div className="shrink-0 space-y-4 pb-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Request Logs</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">调用记录</h2>
            <p className="mt-2 text-sm text-slate-500">联合筛选、游标分页与敏感报文审计。</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 xl:grid-cols-6">
            <Summary label={hasActiveFilters ? "已加载" : "总数"} value={hasActiveFilters ? rows.length : (firstPage?.summary.totalCount ?? 0)} />
            <Summary label="成功" value={firstPage?.summary.successCount ?? 0} />
            <Summary label="失败" value={firstPage?.summary.failedCount ?? 0} />
            <Summary label="Token" value={firstPage?.summary.totalTokens ?? 0} />
            <Summary label="平均总耗时" value={seconds(firstPage?.summary.avgLatencyMs)} />
            <Summary label="平均首 token" value={seconds(firstPage?.summary.avgFirstTokenLatencyMs)} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.5fr)_minmax(160px,1fr)_120px_minmax(130px,1fr)_145px_145px_auto] xl:items-end">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-700">搜索</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Trace / 模型 / 端点 / IP / 邮箱"
                  className={inputClassName("pl-9")}
                />
              </div>
            </label>

            <Select label="用户" value={filters.userId} onChange={(userId) => setFilters({ userId })} compact>
              <option value="">全部用户</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email}
                </option>
              ))}
            </Select>

            <Select label="状态" value={filters.status} onChange={(status) => setFilters({ status })} compact>
              <option value="">全部状态</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="PENDING">PENDING</option>
            </Select>

            <TextInput label="模型" value={filters.model} onChange={(model) => setFilters({ model })} placeholder="gpt-5.5" compact />
            <DateInput label="开始时间" value={filters.dateFrom} onChange={(dateFrom) => setFilters({ dateFrom })} compact />
            <DateInput label="结束时间" value={filters.dateTo} onChange={(dateTo) => setFilters({ dateTo })} compact />

            <div className="flex gap-2 xl:justify-end">
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                高级筛选
                {activeAdvancedCount > 0 ? (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {activeAdvancedCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                重置筛选
              </button>
            </div>
          </div>

          {advancedOpen ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <TextInput label="客户端 IP" value={filters.clientIp} onChange={(clientIp) => setFilters({ clientIp })} placeholder="203.0.113.10" />
                <TextInput label="API Key" value={filters.apiKey} onChange={(apiKey) => setFilters({ apiKey })} placeholder="名称 / 前缀" />
                <TextInput label="上游 Provider" value={filters.upstreamProvider} onChange={(upstreamProvider) => setFilters({ upstreamProvider })} placeholder="openai" />
                <TextInput label="上游 Key" value={filters.upstreamKey} onChange={(upstreamKey) => setFilters({ upstreamKey })} placeholder="名称 / 前缀" />
                <TextInput label="Endpoint" value={filters.endpoint} onChange={(endpoint) => setFilters({ endpoint })} placeholder="/v1/responses" />
                <TextInput label="HTTP 状态" value={filters.httpStatus} onChange={(httpStatus) => setFilters({ httpStatus })} placeholder="429" type="number" />

                <Select label="结果类型" value={filters.resultType} onChange={(resultType) => setFilters({ resultType })}>
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
                  <option value="notice">兼容：公告</option>
                  <option value="ip_ban">兼容：IP 封禁</option>
                  <option value="error">兼容：普通错误</option>
                </Select>

                <RangeInput label="Token" min={filters.minTokens} max={filters.maxTokens} onMinChange={(minTokens) => setFilters({ minTokens })} onMaxChange={(maxTokens) => setFilters({ maxTokens })} />
                <RangeInput label="扣费 USD" min={filters.minChargedUsd} max={filters.maxChargedUsd} onMinChange={(minChargedUsd) => setFilters({ minChargedUsd })} onMaxChange={(maxChargedUsd) => setFilters({ maxChargedUsd })} />
                <RangeInput label="上游成本 USD" min={filters.minUpstreamCostUsd} max={filters.maxUpstreamCostUsd} onMinChange={(minUpstreamCostUsd) => setFilters({ minUpstreamCostUsd })} onMaxChange={(maxUpstreamCostUsd) => setFilters({ maxUpstreamCostUsd })} />
                <RangeInput label="毛利 USD" min={filters.minGrossProfitUsd} max={filters.maxGrossProfitUsd} onMinChange={(minGrossProfitUsd) => setFilters({ minGrossProfitUsd })} onMaxChange={(maxGrossProfitUsd) => setFilters({ maxGrossProfitUsd })} />
                <RangeInput label="总耗时 ms" min={filters.minLatencyMs} max={filters.maxLatencyMs} onMinChange={(minLatencyMs) => setFilters({ minLatencyMs })} onMaxChange={(maxLatencyMs) => setFilters({ maxLatencyMs })} />
                <RangeInput label="首 token ms" min={filters.minFirstTokenLatencyMs} max={filters.maxFirstTokenLatencyMs} onMinChange={(minFirstTokenLatencyMs) => setFilters({ minFirstTokenLatencyMs })} onMaxChange={(maxFirstTokenLatencyMs) => setFilters({ maxFirstTokenLatencyMs })} />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {notice ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {notice}
        </div>
      ) : null}
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="shrink-0 flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-950">请求列表</h3>
          <span className="text-sm text-slate-500">已加载 {rows.length} 条</span>
        </div>

        {requestsQuery.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : requestsQuery.isError ? (
          <div className="p-4 text-sm font-medium text-red-600">调用记录加载失败，请检查筛选条件后重试。</div>
        ) : (
          <>
            <div className="admin-request-desktop-table min-h-0 flex-1 overflow-hidden">
              <div className="h-full overflow-y-auto">
                <table className="w-full table-fixed text-left">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[19%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[17%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <th className="px-2 py-2.5">ID / Trace</th>
                    <th className="px-2 py-2.5">调用信息</th>
                    <th className="px-2 py-2.5">用户信息</th>
                    <th className="px-2 py-2.5">用量 / 耗时</th>
                    <th className="px-2 py-2.5">费用</th>
                    <th className="px-2 py-2.5 text-right">状态 / 操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => setSelectedRequestId(item.id)}
                          className="block max-w-full truncate font-mono text-xs font-semibold text-blue-700 hover:text-blue-800"
                        >
                          {item.traceCode ?? item.id}
                        </button>
                        <div className="mt-1 truncate font-mono text-[11px] text-slate-400">{item.id}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(item.createdAt)}</div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="truncate font-medium text-slate-950" title={item.model}>{item.model}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">等级：{formatAccessTier(item.accessTier)}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500" title={`${item.method} ${item.endpoint}`}>{item.method} {item.endpoint}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">上游：{item.upstreamProvider ?? "-"}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-500" title={formatRef(item.upstreamProviderKey)}>上游 Key：{formatRef(item.upstreamProviderKey)}</div>
                      </td>
                      <td className="px-2 py-2 align-top text-sm text-slate-600">
                        <div className="truncate font-medium text-slate-900" title={item.user?.email ?? "-"}>{item.user?.email ?? "-"}</div>
                        <div className="mt-0.5 truncate text-xs">Key：{formatRef(item.apiKey)}</div>
                        <div className="mt-0.5 truncate text-xs">IP：{item.clientIp ?? "-"}</div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <TokenBreakdown request={item} />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <CostBreakdown request={item} />
                      </td>
                      <td className="px-2 py-2 text-right align-middle">
                        <div className="flex min-h-[96px] flex-col items-end justify-center gap-2">
                        <div>
                          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                          {item.httpStatus ? <div className="mt-1 text-xs text-slate-500">HTTP {item.httpStatus}</div> : null}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedRequestId(item.id)}
                            className="inline-flex h-8 w-[86px] items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                            详情
                          </button>
                          {item.status === "PENDING" ? (
                            <button
                              type="button"
                              onClick={() => setTerminatingRequest(item)}
                              className="inline-flex h-8 w-[86px] items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                            >
                              <Square className="h-3 w-3" aria-hidden="true" />
                              终止
                            </button>
                          ) : (
                            <span aria-hidden="true" className="inline-flex h-8 w-[86px]" />
                          )}
                        </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>

            <div className="admin-request-mobile-list">
              {rows.map((item) => (
                <MobileRequestCard
                  key={item.id}
                  request={item}
                  onOpen={() => setSelectedRequestId(item.id)}
                  onTerminate={() => setTerminatingRequest(item)}
                />
              ))}
              {rows.length === 0 ? (
                <div className="admin-request-mobile-empty">暂无调用记录</div>
              ) : null}
            </div>

            <div className="shrink-0 flex justify-center border-t border-slate-200 p-3">
              {requestsQuery.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => requestsQuery.fetchNextPage()}
                  disabled={requestsQuery.isFetchingNextPage}
                  className="inline-flex h-10 items-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {requestsQuery.isFetchingNextPage ? "加载中" : "加载下一页"}
                </button>
              ) : (
                <span className="text-sm text-slate-500">没有更多数据</span>
              )}
            </div>
          </>
        )}
      </section>

      <RequestDetailDrawer requestId={selectedRequestId} onClose={() => setSelectedRequestId(null)} />

      <ConfirmDialog
        open={Boolean(terminatingRequest)}
        title="强制终止 PENDING 请求"
        description={`即将终止 ${terminatingRequest?.model ?? ""} 的进行中请求。该操作会将请求标记为失败，并可能影响用户体验。`}
        confirmText="确认终止"
        loading={terminateMutation.isPending}
        onOpenChange={(open) => !open && setTerminatingRequest(null)}
        onConfirm={async () => {
          if (!terminatingRequest) return;
          await terminateMutation.mutateAsync(terminatingRequest.id);
        }}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
        {typeof value === "number" ? formatInteger(value) : value}
      </p>
    </div>
  );
}

function TokenBreakdown({ request }: { request: ApiRequestRecord }) {
  const items = [
    { label: "输入", value: request.inputTokens ?? 0 },
    { label: "缓存", value: request.cachedInputTokens ?? 0 },
    { label: "输出", value: request.outputTokens ?? 0 },
    { label: "总计", value: request.totalTokens ?? 0, strong: true },
    { label: "总耗时", value: seconds(request.latencyMs), text: true },
    { label: "首 token", value: seconds(request.upstreamFirstChunkLatencyMs), text: true },
  ];

  return (
    <div className="w-full rounded-md border border-slate-200 bg-slate-50 p-1.5">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-white px-1.5 py-1 ring-1 ring-slate-200">
            <div className="text-[11px] font-medium text-slate-500">{item.label}</div>
            <div
              className={
                item.strong
                  ? "mt-1 font-mono text-sm font-bold tabular-nums text-slate-950"
                  : "mt-1 font-mono text-sm font-semibold tabular-nums text-slate-950"
              }
            >
              {item.text ? item.value : formatInteger(Number(item.value))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 truncate text-xs text-slate-500">
        思考：{formatReasoningEffortCell(request.reasoningEffort, request.reasoningEffortActual)}
      </div>
    </div>
  );
}

function CostBreakdown({ request }: { request: ApiRequestRecord }) {
  const chargedAmount = Number(request.chargedAmountUsd ?? 0);
  const upstreamCost = Number(request.upstreamCostUsd ?? 0);
  const grossProfit = chargedAmount - upstreamCost;
  const items = [
    { label: "账单", value: request.chargedAmountUsd, strong: true },
    { label: "订阅", value: request.subscriptionChargedAmountUsd ?? "0" },
    { label: "钱包", value: request.walletChargedAmountUsd ?? request.chargedAmountUsd },
    { label: "成本", value: request.upstreamCostUsd },
    { label: "毛利", value: Number.isFinite(grossProfit) ? String(grossProfit) : "0" },
  ];

  return (
    <div className="w-full rounded-md border border-slate-200 bg-slate-50 p-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-white px-1.5 py-1 ring-1 ring-slate-200">
            <div className="text-[11px] font-medium text-slate-500">{item.label}</div>
            <div
              className={
                item.strong
                  ? "mt-1 font-mono text-sm font-bold tabular-nums text-slate-950"
                  : "mt-1 font-mono text-xs font-semibold tabular-nums text-slate-700"
              }
            >
              {formatMoney(item.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "grid gap-1.5" : "grid gap-2"}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  compact?: boolean;
}) {
  return (
    <label className={compact ? "grid gap-1.5" : "grid gap-2"}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        placeholder={placeholder}
        type={type}
      />
    </label>
  );
}

function RangeInput({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  label: string;
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <input
          value={min}
          onChange={(event) => onMinChange(event.target.value)}
          className={inputClass}
          inputMode="decimal"
          placeholder="最小"
        />
        <span className="text-sm text-slate-400">-</span>
        <input
          value={max}
          onChange={(event) => onMaxChange(event.target.value)}
          className={inputClass}
          inputMode="decimal"
          placeholder="最大"
        />
      </div>
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "grid gap-1.5" : "grid gap-2"}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} />
    </label>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "amber" | "red" | "slate" }) {
  const styles = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

function MobileRequestCard({
  request,
  onOpen,
  onTerminate,
}: {
  request: ApiRequestRecord;
  onOpen: () => void;
  onTerminate: () => void;
}) {
  const userLabel = request.user?.email ?? "未知用户";
  const modelLabel = request.model || "未标记模型";
  const traceLabel = request.traceCode ?? request.id;

  return (
    <article className="admin-request-mobile-card">
      <div className="admin-request-mobile-card-head">
        <div className="admin-request-mobile-title-wrap">
          <strong title={modelLabel}>{modelLabel}</strong>
          <span title={userLabel}>{userLabel}</span>
        </div>
        <Badge tone={statusTone(request.status)}>{request.status}</Badge>
      </div>

      <div className="admin-request-mobile-meta">
        <span>{formatDate(request.createdAt)}</span>
        <button type="button" onClick={onOpen} title={traceLabel}>
          {traceLabel}
        </button>
      </div>

      <div className="admin-request-mobile-route" title={`${request.method} ${request.endpoint}`}>
        <span>{request.method}</span>
        <b>{request.endpoint}</b>
        <em>{request.upstreamProvider ?? "未分配上游"}</em>
      </div>

      <div className="admin-request-mobile-summary">
        <div className="admin-request-mobile-stats">
          <div>
            <span>Token</span>
            <strong>{formatInteger(request.totalTokens ?? 0)}</strong>
          </div>
          <div>
            <span>费用</span>
            <strong>{formatMoney(request.chargedAmountUsd)}</strong>
          </div>
          <div>
            <span>耗时</span>
            <strong>{seconds(request.latencyMs)}</strong>
          </div>
        </div>

        <div className="admin-request-mobile-actions">
          <button type="button" className="button secondary" onClick={onOpen} title="查看请求详情">
            <Eye className="h-4 w-4" aria-hidden="true" />
            详情
          </button>
          {request.status === "PENDING" ? (
            <button
              type="button"
              className="button danger"
              onClick={onTerminate}
              title="终止这条请求"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
              终止
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function statusTone(status: ApiRequestStatus) {
  if (status === "SUCCESS") return "green";
  if (status === "PENDING") return "amber";
  if (status === "FAILED") return "red";
  return "slate";
}

function toIsoDateTime(value: string, edge: "start" | "end") {
  if (!value) return undefined;
  return `${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`;
}

function formatRef(ref: ApiRequestRecord["apiKey"]) {
  if (!ref) return "-";
  return `${ref.name || "未命名"} · ${ref.keyPrefix}`;
}

function formatAccessTier(tier: ApiRequestRecord["accessTier"]) {
  if (!tier) return "-";
  return `${tier.name || "未命名"} (${tier.code})`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
}

function seconds(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${(numeric / 1000).toFixed(3)}s`;
}

function formatReasoningEffortCell(
  value?: string | null,
  actualValue?: string | null,
) {
  const original = formatReasoningEffort(value);
  const actual = formatReasoningEffort(actualValue);
  if (!original) return actual || "-";
  return actual && actual !== original ? `${original} -> ${actual}` : original;
}

function formatReasoningEffort(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";
  const labels: Record<string, string> = {
    none: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  return labels[normalized] ?? value?.trim() ?? "";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function countActiveAdvancedFilters(filters: typeof defaultFilters) {
  return advancedFilterKeys.filter((key) => String(filters[key] ?? "").trim()).length;
}

function hasActiveRequestFilters(filters: typeof defaultFilters) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === "take") return false;
    return String(value ?? "").trim() !== "";
  });
}

function normalizeRequestSearch(value: string) {
  const text = value.trim();
  return text.length >= 2 ? text : "";
}

function inputClassName(extraClassName = "") {
  return `${inputClass} ${extraClassName}`.trim();
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
