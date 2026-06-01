"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Search, ShieldAlert, Square } from "lucide-react";
import { useMemo, useState } from "react";

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
import { AdminScrollLock } from "../components/admin-scroll-lock";
import { RequestDetailDrawer } from "./components/request-detail-drawer";

const defaultFilters = {
  q: "",
  status: "",
  resultType: "",
  dateFrom: "",
  dateTo: "",
  model: "",
  clientIp: "",
  take: 120,
};

export default function AdminRequestsPage() {
  const queryClient = useQueryClient();
  const { filters, setFilters, resetFilters } = useUrlFilters(defaultFilters);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [terminatingRequest, setTerminatingRequest] = useState<ApiRequestRecord | null>(null);
  const [notice, setNotice] = useState("");

  const requestParams = useMemo<GetRequestsParams>(
    () => ({
      q: filters.q,
      status: filters.status as ApiRequestStatus | undefined,
      resultType: filters.resultType as ApiRequestResultType | undefined,
      dateFrom: toIsoDateTime(filters.dateFrom, "start"),
      dateTo: toIsoDateTime(filters.dateTo, "end"),
      model: filters.model,
      clientIp: filters.clientIp,
      take: filters.take,
    }),
    [filters],
  );

  const requestsQuery = useInfiniteQuery({
    queryKey: ["admin", "requests", requestParams],
    queryFn: ({ pageParam }) => getRequests({ ...requestParams, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    refetchInterval: 2000,
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
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Summary label="总数" value={firstPage?.summary.total ?? 0} />
            <Summary label="成功" value={firstPage?.summary.success ?? 0} />
            <Summary label="失败" value={firstPage?.summary.failed ?? 0} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="grid gap-2 xl:col-span-2">
            <span className="text-sm font-medium text-slate-700">搜索</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.q}
                onChange={(event) => setFilters({ q: event.target.value })}
                placeholder="Trace / 模型 / 端点 / IP / 邮箱"
                className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </label>

          <Select label="状态" value={filters.status} onChange={(status) => setFilters({ status })}>
            <option value="">全部</option>
            <option value="PENDING">PENDING</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
          </Select>

          <Select label="结果类型" value={filters.resultType} onChange={(resultType) => setFilters({ resultType })}>
            <option value="">全部</option>
            <option value="PROXIED_SUCCESS">PROXIED_SUCCESS</option>
            <option value="UPSTREAM_ERROR">UPSTREAM_ERROR</option>
            <option value="RATE_LIMITED">RATE_LIMITED</option>
            <option value="MANUAL_TERMINATED">MANUAL_TERMINATED</option>
            <option value="error">普通错误</option>
          </Select>

          <TextInput label="模型" value={filters.model} onChange={(model) => setFilters({ model })} />
          <TextInput label="客户端 IP" value={filters.clientIp} onChange={(clientIp) => setFilters({ clientIp })} />
          <DateInput label="开始日期" value={filters.dateFrom} onChange={(dateFrom) => setFilters({ dateFrom })} />
          <DateInput label="结束日期" value={filters.dateTo} onChange={(dateTo) => setFilters({ dateTo })} />

          <div className="flex items-end gap-3 xl:col-span-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              重置筛选
            </button>
          </div>
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
            <div className="min-h-0 flex-1 overflow-x-auto">
              <div className="h-full overflow-y-auto">
                <table className="min-w-[1580px] w-full text-left">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <th className="px-5 py-3">ID / Trace</th>
                    <th className="px-5 py-3">时间</th>
                    <th className="px-5 py-3">模型</th>
                    <th className="px-5 py-3">用户信息</th>
                    <th className="px-5 py-3">耗时 / 思考</th>
                    <th className="px-5 py-3">Token 明细</th>
                    <th className="px-5 py-3">状态</th>
                    <th className="px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => setSelectedRequestId(item.id)}
                          className="font-mono text-xs font-semibold text-blue-700 hover:text-blue-800"
                        >
                          {item.traceCode ?? item.id}
                        </button>
                        <div className="mt-1 font-mono text-xs text-slate-400">{item.id}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">{formatDate(item.createdAt)}</td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-950">{item.model}</div>
                        <div className="mt-1 text-xs text-slate-500">等级：{formatAccessTier(item.accessTier)}</div>
                        <div className="mt-1 text-xs text-slate-500">上游渠道：{item.upstreamProvider ?? "-"}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.method} {item.endpoint}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">
                        <div className="font-medium text-slate-900">{item.user?.email ?? "-"}</div>
                        <div className="mt-1">Key：{formatRef(item.apiKey)}</div>
                        <div className="mt-1">IP：{item.clientIp ?? "-"}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">
                        <div>总时间：{seconds(item.latencyMs)}</div>
                        <div className="mt-1">首 token：{seconds(item.upstreamFirstChunkLatencyMs)}</div>
                        <div className="mt-1">思考强度：{formatReasoningEffortCell(item.reasoningEffort, item.reasoningEffortActual)}</div>
                      </td>
                      <td className="px-5 py-4">
                        <TokenBreakdown request={item} />
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                        {item.httpStatus ? <div className="mt-2 text-xs text-slate-500">HTTP {item.httpStatus}</div> : null}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedRequestId(item.id)}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                            详情
                          </button>
                          {item.status === "PENDING" ? (
                            <button
                              type="button"
                              onClick={() => setTerminatingRequest(item)}
                              className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                            >
                              <Square className="h-3 w-3" aria-hidden="true" />
                              强制终止
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
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

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{formatInteger(value)}</p>
    </div>
  );
}

function TokenBreakdown({ request }: { request: ApiRequestRecord }) {
  const items = [
    { label: "输入", value: request.inputTokens ?? 0 },
    { label: "缓存", value: request.cachedInputTokens ?? 0 },
    { label: "输出", value: request.outputTokens ?? 0 },
  ];

  return (
    <div className="w-64 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-white px-2 py-2 ring-1 ring-slate-200">
            <div className="text-[11px] font-medium text-slate-500">{item.label}</div>
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-950">
              {formatInteger(item.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md bg-slate-900 px-3 py-2 text-white">
        <span className="text-xs font-medium text-slate-300">总计</span>
        <strong className="font-mono text-sm tabular-nums">{formatInteger(request.totalTokens ?? 0)}</strong>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} />
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
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
  if (!original) return "-";
  const actual = formatReasoningEffort(actualValue);
  return actual && actual !== original ? `${original} -> ${actual}` : original;
}

function formatReasoningEffort(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";
  const labels: Record<string, string> = {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
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

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
