"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  checkPoolChannel,
  createPoolChannel,
  deletePoolChannel,
  updatePoolChannel,
  type AvailableChannel,
  type ModelPool,
  type PoolChannelStatus,
} from "../../../../lib/api/routing";
import { ProviderGroupBadge } from "../../../../components/shared/provider-group-badge";
import type { HealthCheckRuntime } from "../page";

export function ChannelManagerDrawer({
  pool,
  healthCheck,
  nowMs,
  availableProviders,
  forceAvailableButtonEnabled,
  open,
  onClose,
}: {
  pool: ModelPool | null;
  healthCheck: HealthCheckRuntime | null;
  nowMs: number;
  availableProviders: Array<
    Pick<AvailableChannel, "upstreamProvider" | "providerGroupName">
  >;
  forceAvailableButtonEnabled: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState<PoolChannelStatus>("ACTIVE");
  const [notice, setNotice] = useState("");
  const existingProviders = useMemo(() => new Set(pool?.channels.map((channel) => channel.upstreamProvider) ?? []), [pool]);
  const selectableProviders = availableProviders.filter(
    (item) => !existingProviders.has(item.upstreamProvider),
  );

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "model-pools"] });
  const addMutation = useMutation({
    mutationFn: () => createPoolChannel(pool?.id ?? "", { upstreamProvider: provider, status }),
    onSuccess: () => {
      setProvider("");
      setNotice("渠道已添加");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: PoolChannelStatus }) => updatePoolChannel(id, { status: nextStatus }),
    onSuccess: () => {
      setNotice("渠道状态已更新");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const checkMutation = useMutation({
    mutationFn: checkPoolChannel,
    onSuccess: () => {
      setNotice("健康检测已完成");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deletePoolChannel,
    onSuccess: () => {
      setNotice("渠道已删除");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const checkingChannelId = checkMutation.isPending ? checkMutation.variables : undefined;
  const availableChannels = pool?.channels.filter((channel) => isAvailableChannel(channel, checkingChannelId)) ?? [];
  const unavailableChannels = pool?.channels.filter((channel) => !isAvailableChannel(channel, checkingChannelId)) ?? [];

  if (!open || !pool) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-[min(1120px,calc(100vw-24px))] flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">渠道管理</h2>
            <p className="text-sm text-slate-500">{pool.model} · {pool.tier?.name ?? "-"}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {notice ? <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-950">新增渠道</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
              <select value={provider} onChange={(event) => setProvider(event.target.value)} className={inputClass}>
                <option value="">选择上游 Provider</option>
                {selectableProviders.map((item) => <option value={item.upstreamProvider} key={item.upstreamProvider}>{item.upstreamProvider} · {item.providerGroupName ?? "未分组"}</option>)}
              </select>
              <select value={status} onChange={(event) => setStatus(event.target.value as PoolChannelStatus)} className={inputClass}>
                {channelStatuses.map((item) => <option value={item} key={item}>{channelStatusLabel(item)}</option>)}
              </select>
              <button type="button" disabled={!provider || addMutation.isPending} onClick={() => addMutation.mutate()} className={primaryButton}><Plus className="h-4 w-4" />新增</button>
            </div>
          </section>
          <ChannelSection
            title="可用区"
            channels={availableChannels}
            checkingChannelId={checkingChannelId}
            healthCheck={healthCheck}
            nowMs={nowMs}
            autoHealthCheckEnabled={pool.autoHealthCheckEnabled}
            forceAvailableButtonEnabled={forceAvailableButtonEnabled}
            updateStatus={(id, nextStatus) => updateMutation.mutate({ id, nextStatus })}
            checkChannel={(id) => checkMutation.mutate(id)}
            deleteChannel={(id) => deleteMutation.mutate(id)}
          />
          <ChannelSection
            title="不可用区"
            channels={unavailableChannels}
            checkingChannelId={checkingChannelId}
            healthCheck={healthCheck}
            nowMs={nowMs}
            autoHealthCheckEnabled={pool.autoHealthCheckEnabled}
            forceAvailableButtonEnabled={forceAvailableButtonEnabled}
            updateStatus={(id, nextStatus) => updateMutation.mutate({ id, nextStatus })}
            checkChannel={(id) => checkMutation.mutate(id)}
            deleteChannel={(id) => deleteMutation.mutate(id)}
          />
        </div>
      </aside>
    </div>
  );
}

const channelStatuses: PoolChannelStatus[] = ["ACTIVE", "FORCED_ACTIVE", "DISABLED", "UNAVAILABLE", "PENALIZED"];
function ChannelSection({
  title,
  channels,
  checkingChannelId,
  healthCheck,
  nowMs,
  autoHealthCheckEnabled,
  forceAvailableButtonEnabled,
  updateStatus,
  checkChannel,
  deleteChannel,
}: {
  title: string;
  channels: NonNullable<ModelPool["channels"]>;
  checkingChannelId?: string;
  healthCheck: HealthCheckRuntime | null;
  nowMs: number;
  autoHealthCheckEnabled: boolean;
  forceAvailableButtonEnabled: boolean;
  updateStatus: (id: string, nextStatus: PoolChannelStatus) => void;
  checkChannel: (id: string) => void;
  deleteChannel: (id: string) => void;
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr><th className="w-[270px] px-4 py-3">上游</th><th className="w-[90px] px-4 py-3">Priority</th><th className="w-[150px] px-4 py-3">Status</th><th className="w-[180px] px-4 py-3">健康</th><th className="w-[150px] px-4 py-3">下次检测</th><th className="w-[240px] px-4 py-3 text-right">操作</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {channels.length === 0 ? (
              <tr><td className="px-4 py-6 text-sm text-slate-500" colSpan={6}>暂无渠道</td></tr>
            ) : channels.map((channel) => {
              const checking = checkingChannelId === channel.id || Boolean(channel.isChecking);
              return (
                <tr key={channel.id}>
                  <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2"><div className="break-words font-semibold text-slate-950">{channel.upstreamProvider}</div><ProviderGroupBadge groupName={channel.providerGroupName} /></div><div className="mt-1 text-xs text-slate-500">{channel.effectiveStatusLabel ?? channelStatusLabel(channel.effectiveStatus ?? "-")}</div></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{channel.priority}</td>
                  <td className="px-4 py-3">
                    <div className="grid gap-2">
                      <ChannelStatusBadge status={channel.status} checking={checking} />
                      <select value={channel.status} onChange={(event) => updateStatus(channel.id, event.target.value as PoolChannelStatus)} className={inputClass}>
                        {channelStatuses.map((item) => <option value={item} key={item}>{channelStatusLabel(item)}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    <div>{checking ? "检测中" : channel.lastCheckStatus ?? "未检测"}{channel.lastLatencyMs ? ` · ${channel.lastLatencyMs}ms` : ""}</div>
                    <div className="mt-1 text-xs text-slate-400">上次：{channel.lastCheckedAt ? formatDateTime(channel.lastCheckedAt) : "尚未检测"}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium tabular-nums text-slate-700">
                    <div>{checking ? "检测中" : nextCheckCountdown(channel, healthCheck, nowMs, autoHealthCheckEnabled)}</div>
                    <div className="mt-1 text-xs text-slate-400">惩罚：{penaltyCountdown(channel, healthCheck, nowMs)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-nowrap justify-end gap-2">
                      {canManualCheckChannel(channel) ? <button type="button" onClick={() => checkChannel(channel.id)} className={secondaryButton}><RefreshCw className="h-4 w-4" />检测</button> : null}
                      {forceAvailableButtonEnabled && channel.status !== "FORCED_ACTIVE" ? (
                        <button
                          type="button"
                          title="管理员手动强制可调用；仍参与健康检测和速度排名，检测失败不会进入惩罚或不可用。"
                          onClick={() => updateStatus(channel.id, "FORCED_ACTIVE")}
                          className={forceButton}
                        >
                          <ShieldCheck className="h-4 w-4" />强制
                        </button>
                      ) : null}
                      <button type="button" onClick={() => deleteChannel(channel.id)} className={dangerButton}><Trash2 className="h-4 w-4" />删除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChannelStatusBadge({ status, checking }: { status: PoolChannelStatus; checking: boolean }) {
  const label = channelStatusLabel(status);
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${status === "PENALIZED" || status === "DISABLED" || status === "UNAVAILABLE" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
      {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {checking ? "检测中" : label}
    </span>
  );
}

function isAvailableChannel(channel: ModelPool["channels"][number], checkingChannelId?: string) {
  return channel.effectiveStatus === "READY" || channel.effectiveStatus === "FORCED_READY";
}

function canManualCheckChannel(channel: ModelPool["channels"][number]) {
  return channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE" || channel.status === "UNAVAILABLE";
}

function channelStatusLabel(status: string) {
  const labelMap: Record<string, string> = {
    ACTIVE: "可用",
    FORCED_ACTIVE: "强制可用",
    DISABLED: "停用",
    PENALIZED: "惩罚中",
    UNAVAILABLE: "不可用",
    READY: "可用",
    FORCED_READY: "强制可用",
  };
  return labelMap[status] ?? status;
}

function nextCheckCountdown(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number, autoHealthCheckEnabled = true) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, nowMs);
    return remaining === 0 ? "转不可用" : remaining === null ? "-" : `${remaining}s 后转不可用`;
  }
  if (channel.isChecking) return "检测中";
  if (!autoHealthCheckEnabled) return "未参与";
  const grace = successGraceRemainingSeconds(channel, healthCheck, nowMs);
  if (grace !== null && grace > 0) return `免检中 ${grace}s`;
  if (!healthCheck || channel.nextCheckRemainingSeconds === null || channel.nextCheckRemainingSeconds === undefined) return "-";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000));
  const remaining = Math.max(0, channel.nextCheckRemainingSeconds - elapsedSeconds);
  return remaining === 0 ? "等待检测" : `${remaining}s`;
}

function successGraceRemainingSeconds(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number) {
  if (channel.successGraceRemainingSeconds !== null && channel.successGraceRemainingSeconds !== undefined) {
    const elapsedSeconds = healthCheck ? Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000)) : 0;
    return Math.max(0, channel.successGraceRemainingSeconds - elapsedSeconds);
  }
  if (!channel.lastSuccessfulCallAt || !healthCheck) return null;
  return Math.max(0, Math.ceil((new Date(channel.lastSuccessfulCallAt).getTime() + healthCheck.successGraceSeconds * 1000 - nowMs) / 1000));
}

function penaltyRemainingSeconds(channel: ModelPool["channels"][number], nowMs: number) {
  if (!channel.penalizedUntil) return null;
  return Math.max(0, Math.ceil((new Date(channel.penalizedUntil).getTime() - nowMs) / 1000));
}

function penaltyCountdown(channel: ModelPool["channels"][number], _healthCheck: HealthCheckRuntime | null, nowMs: number) {
  if (channel.status !== "PENALIZED") return "-";
  const remaining = penaltyRemainingSeconds(channel, nowMs);
  return remaining === null ? "-" : remaining === 0 ? "到期" : `${remaining}s`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const forceButton = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100";
const dangerButton = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
