"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

import { getRequestDetail, type ApiRequestRecord } from "../../../../lib/api/requests";

interface RequestDetailDrawerProps {
  requestId: string | null;
  onClose: () => void;
}

export function RequestDetailDrawer({ requestId, onClose }: RequestDetailDrawerProps) {
  const [showSensitiveBody, setShowSensitiveBody] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["admin", "request-detail", requestId],
    queryFn: () => getRequestDetail(requestId as string),
    enabled: Boolean(requestId),
  });

  if (!requestId) {
    return null;
  }

  const request = detailQuery.data;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-950">调用详情</h2>
            <p className="truncate font-mono text-xs text-slate-500">{request?.traceCode ?? requestId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {detailQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
              ))}
            </div>
          ) : detailQuery.isError ? (
            <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
              详情加载失败，请稍后重试。
            </div>
          ) : request ? (
            <div className="space-y-5">
              <section className="grid gap-3 md:grid-cols-2">
                <Info label="状态" value={request.status} />
                <Info label="HTTP 状态" value={request.httpStatus ?? "-"} />
                <Info label="模型" value={request.model} />
                <Info label="端点" value={`${request.method} ${request.endpoint}`} />
                <Info label="用户" value={request.user?.email ?? "-"} />
                <Info label="API Key" value={formatRef(request.apiKey)} />
                <Info label="上游" value={request.upstreamProvider ?? "-"} />
                <Info label="总时间" value={seconds(request.latencyMs)} />
                <Info label="首 token" value={seconds(request.upstreamFirstChunkLatencyMs)} />
                <Info label="思考强度" value={formatReasoningEffortCell(request.reasoningEffort, request.reasoningEffortActual)} />
                <Info label="计费" value={formatMoney(request.chargedAmountUsd)} />
                <Info label="成本" value={formatMoney(request.upstreamCostUsd)} />
                <Info label="创建时间" value={formatDate(request.createdAt)} />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-950">Token 明细</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <TokenInfo label="输入 Token" value={request.inputTokens ?? 0} />
                  <TokenInfo label="缓存 Token" value={request.cachedInputTokens ?? 0} />
                  <TokenInfo label="输出 Token" value={request.outputTokens ?? 0} />
                  <TokenInfo label="总 Token" value={request.totalTokens ?? 0} strong />
                </div>
              </section>

              {request.errorMessage ? (
                <section className="rounded-lg border border-red-100 bg-red-50 p-4">
                  <h3 className="text-sm font-semibold text-red-700">错误信息</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-red-600">{request.errorMessage}</p>
                </section>
              ) : null}

              <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">敏感数据查看提示</h3>
                    <p className="mt-1 text-sm leading-6 text-amber-800">
                      requestBody 可能包含用户输入、对话内容或业务敏感信息。请仅在排障、审计或合规需要时查看。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSensitiveBody((current) => !current)}
                  className="mt-4 inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                >
                  {showSensitiveBody ? "折叠 requestBody" : "查看敏感 requestBody"}
                </button>
              </section>

              {showSensitiveBody ? <JsonBlock title="requestBody" value={request.requestBody} /> : null}
              <JsonBlock title="responseUsage" value={request.responseUsage} />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function TokenInfo({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? "rounded-md bg-slate-900 px-4 py-3 text-white" : "rounded-md border border-slate-200 bg-slate-50 px-4 py-3"}>
      <p className={strong ? "text-xs font-medium text-slate-300" : "text-xs font-medium text-slate-500"}>{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatInteger(value)}</p>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-950">
      <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">{title}</div>
      <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-6 text-slate-100">
        <code>{formatJson(value)}</code>
      </pre>
    </section>
  );
}

function formatJson(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  return JSON.stringify(value, null, 2);
}

function formatRef(ref: ApiRequestRecord["apiKey"]) {
  if (!ref) return "-";
  return `${ref.name || "未命名"} · ${ref.keyPrefix}`;
}

function formatMoney(value: string | null) {
  const numeric = Number(value ?? 0);
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(Number.isFinite(numeric) ? numeric : 0)}`;
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
