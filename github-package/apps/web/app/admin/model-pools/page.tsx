"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Layers3, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  checkPoolChannel,
  createModelPool,
  deleteModelPool,
  deletePoolChannel,
  getModelPools,
  updateModelPoolHealthCheck,
  updatePoolChannel,
  type ModelPool,
  type PoolChannelStatus,
} from "../../../lib/api/routing";
import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { ChannelManagerDrawer } from "./components/channel-manager-drawer";

const poolSchema = z.object({
  model: z.string().trim().min(1, "请输入模型"),
  tierId: z.string().trim().min(1, "请选择访问等级"),
  status: z.enum(["ACTIVE", "DISABLED"]),
  autoHealthCheckEnabled: z.boolean(),
  healthCheckEndpoint: z.enum(["responses", "chat.completions"]),
});

const channelStatuses: PoolChannelStatus[] = ["ACTIVE", "FORCED_ACTIVE", "DISABLED", "UNAVAILABLE", "PENALIZED"];

export default function AdminModelPoolsPage() {
  const queryClient = useQueryClient();
  const [tierFilter, setTierFilter] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const [selectedPool, setSelectedPool] = useState<ModelPool | null>(null);
  const [deletingPool, setDeletingPool] = useState<ModelPool | null>(null);
  const [notice, setNotice] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [healthReceivedAtMs, setHealthReceivedAtMs] = useState(Date.now());
  const [healthDraft, setHealthDraft] = useState({
    intervalSeconds: "30",
    successGraceSeconds: "0",
    penaltySeconds: "60",
  });
  const [editingHealthField, setEditingHealthField] = useState<
    "intervalSeconds" | "successGraceSeconds" | "penaltySeconds" | null
  >(null);

  const poolsQuery = useQuery({ queryKey: ["admin", "model-pools"], queryFn: getModelPools, refetchInterval: 10_000 });
  const data = poolsQuery.data;
  const healthCheck = data?.healthCheck ? { ...data.healthCheck, receivedAtMs: healthReceivedAtMs } : null;
  const pools = data?.modelPools ?? [];
  const tiers = data?.accessTiers ?? [];
  const availableProviders = useMemo(() => Array.from(new Set((data?.availableChannels ?? []).map((item) => item.upstreamProvider))).sort(), [data]);
  const pricedModels = useMemo(() => new Set((data?.availableChannels ?? []).map((item) => item.model)), [data]);
  const modelGroups = useMemo(() => buildModelGroups(pools), [pools]);
  const selectedModelName = selectedModel || modelGroups[0]?.model || "";
  const modelPools = modelGroups.find((group) => group.model === selectedModelName)?.pools ?? [];
  const selectedModelPools = tierFilter ? modelPools.filter((pool) => pool.tierId === tierFilter) : modelPools;
  const activePool = selectedModelPools.find((pool) => pool.id === selectedPoolId) ?? selectedModelPools[0] ?? null;
  const activePools = pools.filter((pool) => pool.status === "ACTIVE").length;
  const readyPools = pools.filter((pool) => pool.readyChannelCount > 0).length;
  const totalChannels = pools.reduce((sum, pool) => sum + pool.channels.length, 0);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "model-pools"] });

  useEffect(() => {
    if (data?.healthCheck && !editingHealthField) {
      setHealthReceivedAtMs(Date.now());
      setHealthDraft({
        intervalSeconds: String(data.healthCheck.intervalSeconds),
        successGraceSeconds: String(data.healthCheck.successGraceSeconds),
        penaltySeconds: String(data.healthCheck.penaltySeconds),
      });
    }
  }, [data?.healthCheck, editingHealthField]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!healthCheck) return;
    const hasDueChannel = pools.some((pool) =>
      pool.channels.some((channel) => nextCheckState(channel, healthCheck, nowMs, pool.autoHealthCheckEnabled).isWaitingForResult),
    );
    if (!hasDueChannel || poolsQuery.isFetching) return;
    const timer = window.setTimeout(refresh, 1200);
    return () => window.clearTimeout(timer);
  }, [healthCheck, nowMs, pools, poolsQuery.isFetching]);
  const form = useForm<z.infer<typeof poolSchema>>({
    resolver: zodResolver(poolSchema),
    defaultValues: { model: "", tierId: "", status: "ACTIVE", autoHealthCheckEnabled: true, healthCheckEndpoint: "responses" },
  });

  const createMutation = useMutation({
    mutationFn: createModelPool,
    onSuccess: () => {
      form.reset({ model: "", tierId: tiers[0]?.id ?? "", status: "ACTIVE", autoHealthCheckEnabled: true, healthCheckEndpoint: "responses" });
      setNotice("模型池已创建或更新");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const updateChannelMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PoolChannelStatus }) => updatePoolChannel(id, { status }),
    onSuccess: () => {
      setNotice("渠道状态已更新");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const checkChannelMutation = useMutation({
    mutationFn: checkPoolChannel,
    onSuccess: () => {
      setNotice("健康检测已完成");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const checkingChannelId = checkChannelMutation.isPending ? checkChannelMutation.variables : undefined;
  const deleteChannelMutation = useMutation({
    mutationFn: deletePoolChannel,
    onSuccess: () => {
      setNotice("渠道已删除");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const deletePoolMutation = useMutation({
    mutationFn: deleteModelPool,
    onSuccess: () => {
      setDeletingPool(null);
      setSelectedPool(null);
      setSelectedPoolId("");
      setNotice("模型池已删除");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const updateHealthMutation = useMutation({
    mutationFn: updateModelPoolHealthCheck,
    onSuccess: (healthCheck) => {
      setEditingHealthField(null);
      setHealthReceivedAtMs(Date.now());
      setHealthDraft({
        intervalSeconds: String(healthCheck.intervalSeconds),
        successGraceSeconds: String(healthCheck.successGraceSeconds),
        penaltySeconds: String(healthCheck.penaltySeconds),
      });
      setNotice("健康检测参数已保存");
      refresh();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  useEffect(() => {
    if (!selectedModel && modelGroups[0]?.model) {
      setSelectedModel(modelGroups[0].model);
    }
  }, [modelGroups, selectedModel]);

  useEffect(() => {
    if (selectedModelPools.length > 0 && !selectedModelPools.some((pool) => pool.id === selectedPoolId)) {
      setSelectedPoolId(selectedModelPools[0]?.id ?? "");
    }
  }, [selectedModelPools, selectedPoolId]);
  function submitPool(values: z.infer<typeof poolSchema>) {
    if (!pricedModels.has(values.model)) {
      setNotice("该模型还没有任何上游价格，请先在模型价格中配置后再创建模型池。");
      return;
    }
    createMutation.mutate(values);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Model Pools</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">模型池</h2>
            <p className="mt-2 text-sm text-slate-500">按访问等级管理模型池、渠道状态与自动健康检测节奏。</p>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[520px]">
            <HealthFact label="可调用池" value={`${readyPools}/${pools.length}`} />
            <HealthFact label="活跃池" value={`${activePools}`} />
            <HealthFact label="渠道数" value={`${totalChannels}`} />
            <EditableHealthFact
              label="自动检测"
              value={healthDraft.intervalSeconds}
              min={healthCheck?.minIntervalSeconds ?? 5}
              max={healthCheck?.maxIntervalSeconds ?? 3600}
              disabled={!healthCheck || updateHealthMutation.isPending}
              onFocus={() => setEditingHealthField("intervalSeconds")}
              onChange={(value) => setHealthDraft((current) => ({ ...current, intervalSeconds: value }))}
              onSave={() => {
                updateHealthMutation.mutate({ intervalSeconds: Number(healthDraft.intervalSeconds) });
              }}
            />
            <EditableHealthFact
              label="成功免检"
              value={healthDraft.successGraceSeconds}
              min={healthCheck?.minSuccessGraceSeconds ?? 0}
              max={healthCheck?.maxSuccessGraceSeconds ?? 86400}
              disabled={!healthCheck || updateHealthMutation.isPending}
              onFocus={() => setEditingHealthField("successGraceSeconds")}
              onChange={(value) => setHealthDraft((current) => ({ ...current, successGraceSeconds: value }))}
              onSave={() => {
                updateHealthMutation.mutate({ successGraceSeconds: Number(healthDraft.successGraceSeconds) });
              }}
            />
            <EditableHealthFact
              label="惩罚期"
              value={healthDraft.penaltySeconds}
              min={healthCheck?.minPenaltySeconds ?? 1}
              max={healthCheck?.maxPenaltySeconds ?? 86400}
              disabled={!healthCheck || updateHealthMutation.isPending}
              onFocus={() => setEditingHealthField("penaltySeconds")}
              onChange={(value) => setHealthDraft((current) => ({ ...current, penaltySeconds: value }))}
              onSave={() => {
                updateHealthMutation.mutate({ penaltySeconds: Number(healthDraft.penaltySeconds) });
              }}
            />
          </div>
        </div>
      </section>

      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <form className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_220px_150px_190px_auto_auto]" onSubmit={form.handleSubmit(submitPool)}>
          <label className="grid gap-2"><span className="text-sm font-medium text-slate-700">模型</span><input list="priced-models" className={inputClass} {...form.register("model")} /><datalist id="priced-models">{Array.from(pricedModels).map((model) => <option value={model} key={model} />)}</datalist>{form.formState.errors.model ? <span className="text-sm text-red-600">{form.formState.errors.model.message}</span> : null}</label>
          <label className="grid gap-2"><span className="text-sm font-medium text-slate-700">访问等级</span><select className={inputClass} {...form.register("tierId")}><option value="">选择等级</option>{tiers.map((tier) => <option value={tier.id} key={tier.id}>{tier.name}</option>)}</select></label>
          <label className="grid gap-2"><span className="text-sm font-medium text-slate-700">状态</span><select className={inputClass} {...form.register("status")}><option value="ACTIVE">ACTIVE</option><option value="DISABLED">DISABLED</option></select></label>
          <label className="grid gap-2"><span className="text-sm font-medium text-slate-700">检测接口</span><select className={inputClass} {...form.register("healthCheckEndpoint")}><option value="responses">responses</option><option value="chat.completions">chat.completions</option></select></label>
          <label className="flex h-full min-h-[64px] items-end gap-2 pb-2 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...form.register("autoHealthCheckEnabled")} />自动检测</label>
          <div className="flex items-end"><button type="submit" disabled={createMutation.isPending} className={primaryButton}><Plus className="h-4 w-4" />创建/更新池</button></div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid min-h-[620px] lg:grid-cols-[150px_150px_minmax(0,1fr)] xl:grid-cols-[160px_160px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 p-2 lg:border-b-0 lg:border-r">
            <div className="mb-2">
              <h3 className="text-sm font-semibold text-slate-950">1. 选择模型</h3>
              <p className="mt-0.5 text-xs text-slate-500">{modelGroups.length} 个模型</p>
            </div>
            <div className="grid gap-1.5">
              {modelGroups.map((group) => (
                <button key={group.model} type="button" onClick={() => { setSelectedModel(group.model); setTierFilter(""); setSelectedPoolId(""); }} className={group.model === selectedModelName ? selectedCompactStepButton : compactStepButton}>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate font-semibold">{group.model}</span>
                    <span className="text-xs tabular-nums">{group.readyPools}/{group.pools.length}</span>
                  </div>
                  <div className="mt-0.5 truncate text-left text-[11px] opacity-75">{group.channelCount} 个渠道</div>
                </button>
              ))}
              {modelGroups.length === 0 ? <div className="rounded-md border border-slate-200 p-4 text-sm text-slate-500">暂无模型池</div> : null}
            </div>
          </aside>

          <aside className="border-b border-slate-200 p-2 lg:border-b-0 lg:border-r">
            <div className="mb-2 grid gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">2. 选择等级</h3>
                <p className="mt-0.5 truncate text-xs text-slate-500">模型 {selectedModelName || "-"}</p>
              </div>
              <select value={tierFilter} onChange={(event) => setTierFilter(event.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-500">
                <option value="">全部</option>
                {tiers.map((tier) => <option value={tier.id} key={tier.id}>{tier.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              {selectedModelPools.map((pool) => (
                <button key={pool.id} type="button" onClick={() => setSelectedPoolId(pool.id)} className={pool.id === activePool?.id ? selectedCompactStepButton : compactStepButton}>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate font-semibold">{pool.tier?.name ?? "Standard"}</span>
        <Badge active={pool.status === "ACTIVE"}>{modelPoolStatusLabel(pool.status)}</Badge>
                  </div>
                  <div className="mt-1 grid grid-cols-1 gap-0.5 text-[11px]">
                    <span>可用 {pool.readyChannelCount}/{pool.channels.length}</span>
                    <span>{pool.autoHealthCheckEnabled ? "自检开" : "自检关"}</span>
                    <span className="truncate">{pool.healthCheckEndpoint}</span>
                    <span className="truncate">{poolNextCheckText(pool, healthCheck, nowMs)}</span>
                  </div>
                </button>
              ))}
              {selectedModelPools.length === 0 ? <div className="rounded-md border border-slate-200 p-4 text-sm text-slate-500">当前模型没有匹配等级</div> : null}
            </div>
          </aside>

          <main className="min-w-0 p-2">
            {activePool ? (
              <PoolChannelBoard
                pool={activePool}
                healthCheck={healthCheck}
                nowMs={nowMs}
                checkingChannelId={checkingChannelId}
                forceAvailableButtonEnabled={Boolean(data?.dispatchSettings.forceAvailableButtonEnabled)}
                onOpenManager={() => setSelectedPool(activePool)}
                onDeletePool={() => setDeletingPool(activePool)}
                onCheck={(id) => checkChannelMutation.mutate(id)}
                onDelete={(id) => deleteChannelMutation.mutate(id)}
                onSetStatus={(id, status) => updateChannelMutation.mutate({ id, status })}
              />
            ) : (
              <div className="flex h-full min-h-[420px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500">请选择模型和等级</div>
            )}
          </main>
        </div>
      </section>

      <ChannelManagerDrawer
        open={Boolean(selectedPool)}
        pool={selectedPool}
        healthCheck={healthCheck}
        nowMs={nowMs}
        availableProviders={availableProviders}
        forceAvailableButtonEnabled={Boolean(data?.dispatchSettings.forceAvailableButtonEnabled)}
        onClose={() => setSelectedPool(null)}
      />
      <ConfirmDialog
        open={Boolean(deletingPool)}
        title="删除模型池"
        description={`删除 ${deletingPool?.model ?? ""} / ${deletingPool?.tier?.name ?? "Standard"} 模型池会同时移除池内渠道，用户将不能通过这个等级调用该池。此操作不可撤销。`}
        confirmText="确认删除"
        requireInputText="确认删除"
        loading={deletePoolMutation.isPending}
        onOpenChange={(open) => !open && setDeletingPool(null)}
        onConfirm={async () => {
          if (deletingPool) await deletePoolMutation.mutateAsync(deletingPool.id);
        }}
      />
    </div>
  );
}

function Badge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{children}</span>;
}
function HealthFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 flex items-center gap-1 font-semibold tabular-nums text-slate-950"><Clock3 className="h-3.5 w-3.5 text-blue-600" />{value}</div></div>;
}
function EditableHealthFact({
  label,
  value,
  min,
  max,
  disabled,
  onFocus,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <Clock3 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold tabular-nums text-slate-950 outline-none focus:border-blue-500"
        />
        <span className="text-xs font-semibold text-slate-500">s</span>
        <button
          type="button"
          disabled={disabled || !isNumericInputInRange(value, min, max)}
          onClick={onSave}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          title="保存"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
function isNumericInputInRange(value: string, min: number, max: number) {
  const numeric = Number(value);
  return value.trim() !== "" && Number.isFinite(numeric) && numeric >= min && numeric <= max;
}
function SkeletonRows() { return <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />)}</div>; }
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }

function PoolChannelBoard({
  pool,
  healthCheck,
  nowMs,
  checkingChannelId,
  forceAvailableButtonEnabled,
  onOpenManager,
  onDeletePool,
  onCheck,
  onDelete,
  onSetStatus,
}: {
  pool: ModelPool;
  healthCheck: HealthCheckRuntime | null;
  nowMs: number;
  checkingChannelId?: string;
  forceAvailableButtonEnabled: boolean;
  onOpenManager: () => void;
  onDeletePool: () => void;
  onCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStatus: (id: string, status: PoolChannelStatus) => void;
}) {
  const availableChannels = pool.channels.filter((channel) => isAvailableChannel(channel, checkingChannelId));
  const unavailableChannels = pool.channels.filter((channel) => !isAvailableChannel(channel, checkingChannelId));

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-semibold text-slate-950">{pool.model}</h3>
              <Badge active={pool.status === "ACTIVE"}>{modelPoolStatusLabel(pool.status)}</Badge>
              <Badge active={pool.readyChannelCount > 0}>{pool.readyChannelCount > 0 ? "可调用" : "不可用"}</Badge>
              <Badge active={pool.autoHealthCheckEnabled}>{pool.autoHealthCheckEnabled ? "AUTO" : "MANUAL"}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              等级 {pool.tier?.name ?? "Standard"} · 检测接口 {pool.healthCheckEndpoint} · 已定价 {pool.pricedChannelCount} · 已加入 {pool.channels.length} · 下次 {poolNextCheckText(pool, healthCheck, nowMs)}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onOpenManager} className={secondaryButton}>添加/管理渠道</button>
            <button type="button" onClick={onDeletePool} className={dangerButton}><Trash2 className="h-4 w-4" />删除池</button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 gap-2 2xl:grid-cols-2">
        <ChannelCardSection
          title="可用区"
          tone="available"
          channels={availableChannels}
          pool={pool}
          healthCheck={healthCheck}
          nowMs={nowMs}
          checkingChannelId={checkingChannelId}
          forceAvailableButtonEnabled={forceAvailableButtonEnabled}
          onCheck={onCheck}
          onDelete={onDelete}
          onSetStatus={onSetStatus}
        />
        <ChannelCardSection
          title="不可用区"
          tone="unavailable"
          channels={unavailableChannels}
          pool={pool}
          healthCheck={healthCheck}
          nowMs={nowMs}
          checkingChannelId={checkingChannelId}
          forceAvailableButtonEnabled={forceAvailableButtonEnabled}
          onCheck={onCheck}
          onDelete={onDelete}
          onSetStatus={onSetStatus}
        />
      </div>
    </div>
  );
}

function ChannelCardSection({
  title,
  tone,
  channels,
  pool,
  healthCheck,
  nowMs,
  checkingChannelId,
  forceAvailableButtonEnabled,
  onCheck,
  onDelete,
  onSetStatus,
}: {
  title: string;
  tone: "available" | "unavailable";
  channels: ModelPool["channels"];
  pool: ModelPool;
  healthCheck: HealthCheckRuntime | null;
  nowMs: number;
  checkingChannelId?: string;
  forceAvailableButtonEnabled: boolean;
  onCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStatus: (id: string, status: PoolChannelStatus) => void;
}) {
  return (
    <section className={tone === "available" ? availableSectionClass : unavailableSectionClass}>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold tabular-nums text-slate-600">{channels.length}</span>
      </div>
      <div className="grid grid-cols-3 content-start gap-1.5 overflow-y-auto p-2">
        {channels.map((channel, index) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            pool={pool}
            rank={tone === "available" ? index + 1 : undefined}
            healthCheck={healthCheck}
            nowMs={nowMs}
            checking={checkingChannelId === channel.id || Boolean(channel.isChecking)}
            forceAvailableButtonEnabled={forceAvailableButtonEnabled}
            onCheck={onCheck}
            onDelete={onDelete}
            onSetStatus={onSetStatus}
          />
        ))}
        {channels.length === 0 ? <div className="rounded-md border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">暂无渠道</div> : null}
      </div>
    </section>
  );
}

function ChannelCard({
  channel,
  pool,
  rank,
  healthCheck,
  nowMs,
  checking,
  forceAvailableButtonEnabled,
  onCheck,
  onDelete,
  onSetStatus,
}: {
  channel: ModelPool["channels"][number];
  pool: ModelPool;
  rank?: number;
  healthCheck: HealthCheckRuntime | null;
  nowMs: number;
  checking: boolean;
  forceAvailableButtonEnabled: boolean;
  onCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStatus: (id: string, status: PoolChannelStatus) => void;
}) {
  const errorText = formatChannelError(channel.lastError);
  const priceStatus = channel.hasPrice && channel.priceEnabled ? "已开" : channel.hasPrice ? "停用" : "缺失";
  return (
    <article className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <div className="grid gap-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {rank ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">#{rank}</span> : null}
            <h5 className="truncate text-xs font-semibold text-slate-950">{channel.upstreamProvider}</h5>
            <span className={statusDotClass(channel.effectiveStatus)} aria-hidden="true" />
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <CompactStatus label="通道" value={channel.effectiveStatusLabel ?? compactStatusLabel(channel.effectiveStatus ?? "-")} />
            <CompactStatus label="调度" value={channel.statusLabel ?? channelStatusLabel(channel.status)} />
            <CompactStatus label="定价" value={priceStatus} />
            <CompactStatus label="上游" value={channel.providerStatus ?? "-"} />
          </div>
        </div>
        <select value={channel.status} onChange={(event) => onSetStatus(channel.id, event.target.value as PoolChannelStatus)} className="h-7 min-w-0 rounded-md border border-slate-200 px-1.5 text-[11px] outline-none focus:border-blue-500">
          {channelStatuses.map((status) => <option key={status} value={status}>{channelStatusLabel(status)}</option>)}
        </select>
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1">
        <Fact label="免检" value={successGraceCountdownText(channel, healthCheck, nowMs)} />
        <Fact label="下次检测" value={checking ? "检测中" : nextCheckCountdown(channel, healthCheck, nowMs, pool.autoHealthCheckEnabled)} />
        <Fact label="惩罚" value={penaltyCountdown(channel, healthCheck, nowMs)} />
        <Fact label="ACTIVE Key" value={String(channel.activeKeyCount ?? 0)} />
        <Fact label="优先级" value={String(channel.priority)} />
        <Fact label="连续失败" value={String(channel.consecutiveFailures)} />
        <Fact label="恢复" value={`${channel.recoverySuccesses}/2`} />
        <Fact label="平均首字" value={secondsText(channel.lastFirstTokenLatencyMs)} />
        <Fact label="平均总耗" value={secondsText(channel.lastLatencyMs)} />
      </div>

      {errorText ? <div className="mt-1.5 line-clamp-2 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-[11px] text-red-700"><span className="font-semibold">错误：</span>{errorText}</div> : null}
      {channel.unavailableReasons?.length ? <div className="mt-1.5 line-clamp-2 rounded-md border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"><span className="font-semibold">不可用：</span>{channel.unavailableReasons.join("；")}</div> : null}

      <div className="mt-1.5 flex flex-wrap justify-end gap-1">
        {canManualCheckChannel(channel) ? <button type="button" onClick={() => onCheck(channel.id)} className={smallButton}><RefreshCw className="h-4 w-4" />检测</button> : null}
        {forceAvailableButtonEnabled && channel.status !== "FORCED_ACTIVE" ? <button type="button" onClick={() => onSetStatus(channel.id, "FORCED_ACTIVE")} className={forceSmallButton}><ShieldCheck className="h-4 w-4" />强制可用</button> : null}
        <button type="button" onClick={() => onDelete(channel.id)} className={dangerSmallButton}><Trash2 className="h-4 w-4" />删除</button>
      </div>
    </article>
  );
}

function CompactStatus({ label, value }: { label: string; value: string }) {
  return <span className="grid min-w-0 gap-0 rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] leading-tight text-slate-500"><span className="truncate">{label}</span><strong className="truncate text-[10px] text-slate-800">{compactStatusLabel(value)}</strong></span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded border border-slate-200 bg-slate-50 px-1 py-0.5"><div className="truncate text-[9px] text-slate-500">{label}</div><div className="truncate text-[10px] font-semibold tabular-nums text-slate-950">{value}</div></div>;
}

export type HealthCheckRuntime = {
  intervalSeconds: number;
  penaltySeconds: number;
  successGraceSeconds: number;
  serverNow: string;
  receivedAtMs: number;
};

function poolNextCheckText(pool: ModelPool, healthCheck: HealthCheckRuntime | null, nowMs: number) {
  const texts = pool.channels
    .map((channel) => nextCheckCountdown(channel, healthCheck, nowMs, pool.autoHealthCheckEnabled))
    .filter((text) => text !== "-" && text !== "未参与");
  return texts[0] ?? (pool.autoHealthCheckEnabled ? "-" : "未参与");
}

function nextCheckState(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number, autoHealthCheckEnabled = true) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
    return { secondsUntilNext: remaining === 0 ? 0 : null, isWaitingForResult: remaining === 0 };
  }
  if (channel.isChecking) {
    return { secondsUntilNext: 0, isWaitingForResult: true };
  }
  if (!autoHealthCheckEnabled || !healthCheck) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }
  const secondsUntilNext = channel.nextCheckRemainingSeconds;
  if (secondsUntilNext === null || secondsUntilNext === undefined) {
    return { secondsUntilNext: null, isWaitingForResult: false };
  }
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000));
  const displayedSecondsUntilNext = Math.max(0, secondsUntilNext - elapsedSeconds);
  return { secondsUntilNext: displayedSecondsUntilNext, isWaitingForResult: displayedSecondsUntilNext === 0 };
}

function nextCheckCountdown(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number, autoHealthCheckEnabled = true) {
  if (channel.status === "PENALIZED") {
    const remaining = penaltyRemainingSeconds(channel, healthCheck, nowMs);
    return remaining === 0 ? "转不可用" : remaining === null ? "-" : `${remaining}s 后转不可用`;
  }
  if (channel.isChecking) return "检测中";
  if (!autoHealthCheckEnabled) return "未参与";
  const grace = successGraceRemainingSeconds(channel, healthCheck, nowMs);
  if (grace !== null && grace > 0) return `免检中 ${grace}s`;
  const state = nextCheckState(channel, healthCheck, nowMs, autoHealthCheckEnabled);
  if (state.secondsUntilNext === null) return "-";
  return state.isWaitingForResult ? "等待检测" : `${state.secondsUntilNext}s`;
}

function successGraceCountdownText(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number) {
  const remaining = successGraceRemainingSeconds(channel, healthCheck, nowMs);
  if (remaining === null) return "-";
  return remaining > 0 ? `${remaining}s` : "结束";
}

function successGraceRemainingSeconds(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number) {
  if (channel.successGraceRemainingSeconds !== null && channel.successGraceRemainingSeconds !== undefined) {
    const elapsedSeconds = healthCheck ? Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000)) : 0;
    return Math.max(0, channel.successGraceRemainingSeconds - elapsedSeconds);
  }
  if (!channel.lastSuccessfulCallAt || !healthCheck) return null;
  return Math.max(0, Math.ceil((new Date(channel.lastSuccessfulCallAt).getTime() + healthCheck.successGraceSeconds * 1000 - nowMs) / 1000));
}

function penaltyRemainingSeconds(channel: ModelPool["channels"][number], healthCheck: HealthCheckRuntime | null, nowMs: number) {
  if (channel.penaltyRemainingSeconds !== null && channel.penaltyRemainingSeconds !== undefined) {
    const elapsedSeconds = healthCheck ? Math.max(0, Math.floor((nowMs - healthCheck.receivedAtMs) / 1000)) : 0;
    return Math.max(0, channel.penaltyRemainingSeconds - elapsedSeconds);
  }
  if (!channel.penalizedUntil) return null;
  return Math.max(0, Math.ceil((new Date(channel.penalizedUntil).getTime() - nowMs) / 1000));
}

function penaltyCountdown(channel: ModelPool["channels"][number], _healthCheck: HealthCheckRuntime | null, nowMs: number) {
  if (channel.status !== "PENALIZED") return "-";
  const remaining = penaltyRemainingSeconds(channel, null, nowMs);
  return remaining === null ? "-" : remaining === 0 ? "到期" : `${remaining}s`;
}

function isAvailableChannel(channel: ModelPool["channels"][number], checkingChannelId?: string) {
  return channel.effectiveStatus === "READY" || channel.effectiveStatus === "FORCED_READY";
}

function canManualCheckChannel(channel: ModelPool["channels"][number]) {
  return channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE" || channel.status === "UNAVAILABLE";
}

function buildModelGroups(pools: ModelPool[]) {
  const groups = new Map<string, ModelPool[]>();
  for (const pool of pools) {
    groups.set(pool.model, [...(groups.get(pool.model) ?? []), pool]);
  }
  return Array.from(groups.entries())
    .map(([model, modelPools]) => ({
      model,
      pools: modelPools.sort((left, right) => (left.tier?.name ?? "").localeCompare(right.tier?.name ?? "")),
      readyPools: modelPools.filter((pool) => pool.readyChannelCount > 0).length,
      channelCount: modelPools.reduce((sum, pool) => sum + pool.channels.length, 0),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

function compactStatusLabel(status: string) {
  const labelMap: Record<string, string> = {
    ACTIVE: "可用",
    AUTO: "自检",
    DISABLED: "停用",
    FORCED_ACTIVE: "强制可用",
    FORCED_READY: "强制可用",
    MISSING: "缺失",
    PENALIZED: "惩罚中",
    READY: "可用",
    UNAVAILABLE: "不可用",
  };
  return labelMap[status] ?? status;
}

function channelStatusLabel(status: string) {
  return compactStatusLabel(status);
}

function modelPoolStatusLabel(status: string) {
  return status === "ACTIVE" ? "可用" : status === "DISABLED" ? "停用" : status;
}

function statusDotClass(status?: string | null) {
  return status === "READY" || status === "FORCED_READY"
    ? "h-2.5 w-2.5 rounded-full bg-emerald-500"
    : "h-2.5 w-2.5 rounded-full bg-red-500";
}

function secondsText(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return `${(value / 1000).toFixed(3)}s`;
}

function formatChannelError(value?: string | null) {
  const text = value?.trim();
  if (!text) return "";
  const normalized = text.toLowerCase();
  if ((normalized.includes("operation") && normalized.includes("abort")) || normalized.includes("aborterror") || normalized.includes("aborted")) {
    return "健康检测超时：上游没有及时返回，网关已主动中止这次检测。";
  }
  return text;
}

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const dangerButton = "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60";
const stepButton = "w-full rounded-lg border border-slate-200 bg-white p-3 text-left text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50/50";
const selectedStepButton = "w-full rounded-lg border border-blue-200 bg-blue-50 p-3 text-left text-blue-800 shadow-sm";
const compactStepButton = "w-full min-w-0 rounded-md border border-slate-200 bg-white p-2 text-left text-xs text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50/50";
const selectedCompactStepButton = "w-full min-w-0 rounded-md border border-blue-200 bg-blue-50 p-2 text-left text-xs text-blue-800 shadow-sm";
const availableSectionClass = "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50/30";
const unavailableSectionClass = "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-red-200 bg-red-50/30";
const smallButton = "inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50";
const forceSmallButton = "inline-flex h-6 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100";
const dangerSmallButton = "inline-flex h-6 items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-100";
