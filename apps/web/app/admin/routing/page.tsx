"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  createAccessTier,
  deleteAccessTier,
  getAccessTiers,
  getDispatchSettings,
  simulateRoute,
  updateAccessTier,
  updateDispatchSettings,
  type AccessTier,
  type DispatchSettings,
  type RouteSimulatorInput,
} from "../../../lib/api/routing";
import { AdminScrollLock } from "../components/admin-scroll-lock";

const tabs = ["访问等级", "调度参数", "路由模拟器"] as const;
type Tab = (typeof tabs)[number];

const settingsSchema = z.object({
  stickyEnabled: z.boolean(),
  stickyTtlSeconds: z.coerce.number().int().min(60).max(86400),
  stickySlowUnbindEnabled: z.boolean(),
  slowFirstTokenMs: z.coerce.number().int().min(1000).max(300000),
  slowTotalLatencyMs: z.coerce.number().int().min(1000).max(600000),
  slowUnbindThreshold: z.coerce.number().int().min(1).max(100),
  penaltyEnabled: z.boolean(),
  penaltyFailureThreshold: z.coerce.number().int().min(1).max(100),
  penaltySeconds: z.coerce.number().int().min(1).max(86400),
  healthCheckIntervalSeconds: z.coerce.number().int().min(5).max(3600),
  speedRankPenalty: z.coerce.number().int().min(0).max(60000),
  stickyHitPenalty: z.coerce.number().int().min(0).max(60000),
  forceAvailableButtonEnabled: z.boolean(),
});

const simulatorSchema = z.object({
  userId: z.string().trim().min(1, "请输入 userId"),
  apiKeyId: z.string().trim().min(1, "请输入 apiKeyId"),
  clientIp: z.string().trim().optional(),
  model: z.string().trim().min(1, "请输入模型"),
});

type SettingsInput = z.input<typeof settingsSchema>;
type SettingsValues = z.output<typeof settingsSchema>;
type SimulatorValues = z.infer<typeof simulatorSchema>;

export default function AdminRoutingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("访问等级");
  const [notice, setNotice] = useState("");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <AdminScrollLock />
      <section className="shrink-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Routing Center</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">调度与访问等级</h2>
        <p className="mt-2 text-sm text-slate-500">配置访问等级、调度策略，并用模拟器验证最终路由路径。</p>
      </section>

      {notice ? <div className="shrink-0 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}

      <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        <div className="grid grid-cols-3 gap-1">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`h-10 rounded-md text-sm font-semibold transition-colors ${activeTab === tab ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "访问等级" ? <AccessTiersPanel onNotice={setNotice} /> : null}
        {activeTab === "调度参数" ? <DispatchSettingsPanel onNotice={setNotice} /> : null}
        {activeTab === "路由模拟器" ? <RouteSimulatorPanel onNotice={setNotice} /> : null}
      </div>
    </div>
  );
}

function AccessTiersPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [editingTier, setEditingTier] = useState<AccessTier | null | undefined>(undefined);
  const tiersQuery = useQuery({ queryKey: ["admin", "access-tiers"], queryFn: getAccessTiers });
  const saveMutation = useMutation({
    mutationFn: (values: AccessTierFormValues) =>
      editingTier
        ? updateAccessTier(editingTier.id, values)
        : createAccessTier(values),
    onSuccess: () => {
      setEditingTier(undefined);
      onNotice(editingTier ? "访问等级已保存" : "访问等级已创建");
      void queryClient.invalidateQueries({ queryKey: ["admin", "access-tiers"] });
    },
    onError: (error) => onNotice(errorToText(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ tier, status }: { tier: AccessTier; status: AccessTier["status"] }) => updateAccessTier(tier.id, { status }),
    onSuccess: () => {
      onNotice("访问等级已更新");
      void queryClient.invalidateQueries({ queryKey: ["admin", "access-tiers"] });
    },
    onError: (error) => onNotice(errorToText(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAccessTier,
    onSuccess: () => {
      onNotice("访问等级已删除");
      void queryClient.invalidateQueries({ queryKey: ["admin", "access-tiers"] });
    },
    onError: (error) => onNotice(errorToText(error)),
  });

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">访问等级</h3>
            <p className="mt-1 text-sm text-slate-500">standard 为系统标准等级，不允许删除、禁用或修改 code。</p>
          </div>
          <button type="button" onClick={() => setEditingTier(null)} className={primaryButton}>
            新建等级
          </button>
        </div>
      </div>
      {tiersQuery.isLoading ? <SkeletonRows /> : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="h-full overflow-y-auto">
            <table className="min-w-[1040px] w-full text-left">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
              <tr><th className="px-5 py-3">Code / 名称</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">排序</th><th className="px-5 py-3">扣费倍率</th><th className="px-5 py-3">钱包门槛</th><th className="px-5 py-3">关联数量</th><th className="px-5 py-3 text-right">操作</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(tiersQuery.data ?? []).map((tier) => {
                const isStandard = tier.code === "standard";
                return (
                  <tr key={tier.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4"><div className="font-semibold text-slate-950">{tier.code}</div><div className="mt-1 text-sm text-slate-500">{tier.name}</div></td>
                    <td className="px-5 py-4"><Badge active={tier.status === "ACTIVE"}>{tier.status}</Badge></td>
                    <td className="px-5 py-4 text-sm text-slate-600">{tier.sortOrder}</td>
                    <td className="px-5 py-4 text-sm font-semibold tabular-nums text-slate-700">× {formatMultiplier(tier.billingMultiplier)}</td>
                    <td className="px-5 py-4"><Badge active={tier.walletRequired}>{tier.walletRequired ? "需要余额" : "不要求余额"}</Badge></td>
                    <td className="px-5 py-4 text-sm text-slate-600">用户 {tier._count?.users ?? 0} · Key {tier._count?.apiKeys ?? 0} · 池 {tier._count?.modelPools ?? 0}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" disabled={saveMutation.isPending} onClick={() => setEditingTier(tier)} className={secondaryButton}>
                          编辑
                        </button>
                        <button type="button" disabled={isStandard || updateMutation.isPending} onClick={() => updateMutation.mutate({ tier, status: tier.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })} className={secondaryButton}>
                          {tier.status === "ACTIVE" ? "禁用" : "启用"}
                        </button>
                        <button type="button" disabled={isStandard || deleteMutation.isPending} onClick={() => deleteMutation.mutate(tier.id)} className={dangerButton}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
        </div>
      )}
      <AccessTierModal
        open={editingTier !== undefined}
        tier={editingTier ?? null}
        loading={saveMutation.isPending}
        onClose={() => setEditingTier(undefined)}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
    </section>
  );
}

type AccessTierFormValues = Pick<AccessTier, "code" | "name" | "status" | "sortOrder" | "billingMultiplier" | "walletRequired"> & { description?: string | null };

function AccessTierModal({
  open,
  tier,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  tier: AccessTier | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: AccessTierFormValues) => void;
}) {
  const isEdit = Boolean(tier);
  const isStandard = tier?.code === "standard";
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<AccessTier["status"]>("ACTIVE");
  const [sortOrder, setSortOrder] = useState("100");
  const [billingMultiplier, setBillingMultiplier] = useState("1");
  const [walletRequired, setWalletRequired] = useState(true);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode(tier?.code ?? "");
    setName(tier?.name ?? "");
    setStatus(tier?.status ?? "ACTIVE");
    setSortOrder(String(tier?.sortOrder ?? 100));
    setBillingMultiplier(tier?.billingMultiplier ?? "1");
    setWalletRequired(tier?.walletRequired ?? true);
    setDescription(tier?.description ?? "");
  }, [open, tier]);

  if (!open) return null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      code,
      name,
      status,
      sortOrder: Number(sortOrder),
      billingMultiplier,
      walletRequired,
      description: description.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <form onSubmit={submit} className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{isEdit ? "编辑访问等级" : "新建访问等级"}</h2>
          <p className="mt-1 text-sm text-slate-500">访问等级会影响用户、Key 和模型池的路由匹配。</p>
        </div>
        <div className="grid gap-4 p-6">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Code</span>
            <input required disabled={isStandard} value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} placeholder="vip" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">名称</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="VIP 等级" />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">状态</span>
              <select disabled={isStandard} value={status} onChange={(event) => setStatus(event.target.value as AccessTier["status"])} className={inputClass}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="DISABLED">DISABLED</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">排序</span>
              <input required type="number" min={1} max={10000} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className={inputClass} />
            </label>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">扣费倍率</span>
            <input required inputMode="decimal" value={billingMultiplier} onChange={(event) => setBillingMultiplier(event.target.value)} className={inputClass} placeholder="1" />
            <span className="text-xs leading-5 text-slate-500">最终扣费 = 现有计费结果 × 此倍率。1 为不调整，0.8 为八折，1.2 为加价 20%。</span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <input type="checkbox" checked={walletRequired} onChange={(event) => setWalletRequired(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300" />
            <span>
              <span className="block text-sm font-medium text-slate-700">要求钱包余额门槛</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">关闭后，该等级请求不会因为余额为 0 或不足预留金额而被拦截；最终扣费仍按倍率计算。</span>
            </span>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">描述</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full resize-y rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" disabled={loading} onClick={onClose} className={secondaryButton}>取消</button>
          <button type="submit" disabled={loading} className={primaryButton}>{loading ? "保存中" : "保存"}</button>
        </div>
      </form>
    </div>
  );
}

function DispatchSettingsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["admin", "dispatch-settings"], queryFn: getDispatchSettings });
  const form = useForm<SettingsInput, unknown, SettingsValues>({ resolver: zodResolver(settingsSchema) });
  useEffect(() => { if (settingsQuery.data?.settings) form.reset(settingsQuery.data.settings); }, [form, settingsQuery.data]);
  const mutation = useMutation({
    mutationFn: (values: Partial<DispatchSettings>) => updateDispatchSettings(values),
    onSuccess: () => {
      onNotice("调度参数已保存");
      void queryClient.invalidateQueries({ queryKey: ["admin", "dispatch-settings"] });
    },
    onError: (error) => onNotice(errorToText(error)),
  });

  if (settingsQuery.isLoading) return <SkeletonRows />;

  return (
    <form className="flex h-full min-h-0 flex-col gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-3">
        <SettingsCard title="粘性与解绑规则">
        <Toggle
          label="粘性规则开关"
          register={form.register("stickyEnabled")}
          hint="当 IP 首次调用成功，将触发 1 号规则粘住该上游 Key，有效期间（默认 10 分钟）内每次成功都会刷新该时间窗口。"
        />
        <NumberField label="粘性保持时长" register={form.register("stickyTtlSeconds")} error={form.formState.errors.stickyTtlSeconds?.message} />
        <Toggle
          label="慢请求解绑开关"
          register={form.register("stickySlowUnbindEnabled")}
          hint="开启 3 号规则：当粘性 IP 连续多次命中慢请求（2号规则），将自动解绑。依赖粘性开关的开启。"
        />
        <NumberField
          label="慢请求触发阈值"
          register={form.register("slowUnbindThreshold")}
          error={form.formState.errors.slowUnbindThreshold?.message}
          hint="连续慢请求多少次后触发解绑。"
        />
        <NumberField
          label="慢首 Token 阈值 ms"
          register={form.register("slowFirstTokenMs")}
          error={form.formState.errors.slowFirstTokenMs?.message}
          hint="定义 2 号规则标准（首 Token > 15秒或总时长 > 45秒视为慢请求，Compact相关请求免责）。"
        />
        <NumberField
          label="慢总耗时阈值 ms"
          register={form.register("slowTotalLatencyMs")}
          error={form.formState.errors.slowTotalLatencyMs?.message}
          hint="定义 2 号规则标准（首 Token > 15秒或总时长 > 45秒视为慢请求，Compact相关请求免责）。"
        />
      </SettingsCard>
        <SettingsCard title="惩罚与健康检测规则">
        <Toggle
          label="失败惩罚开关"
          register={form.register("penaltyEnabled")}
          hint="开启 9 号规则：IP 连续调用某上游失败达阈值，该上游即进入「惩罚中」状态。"
        />
        <NumberField
          label="惩罚触发阈值"
          register={form.register("penaltyFailureThreshold")}
          error={form.formState.errors.penaltyFailureThreshold?.message}
          hint="连续失败多少次后触发惩罚。"
        />
        <NumberField
          label="惩罚冷静期时长"
          register={form.register("penaltySeconds")}
          error={form.formState.errors.penaltySeconds?.message}
          hint="11号状态规则：上游在惩罚期内不可调用，过固定时间后自动触发 10号健康检测规则，全Key成功才可恢复「可调用」状态。"
        />
        <NumberField
          label="健康检测间隔"
          register={form.register("healthCheckIntervalSeconds")}
          error={form.formState.errors.healthCheckIntervalSeconds?.message}
          hint="系统每隔此时间自动对「可调用」上游发起健康检测。"
        />
        <Toggle
          label="强制可用按钮开关"
          register={form.register("forceAvailableButtonEnabled")}
          hint="控制模型池版面是否显示 12号规则的强制可用按钮。"
        />
      </SettingsCard>
        <SettingsCard title="熵值与负载均衡规则">
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
          4、7、8 号规则为系统底层默认标准，此处仅配置权重数字。
        </p>
        <NumberField
          label="粘性命中惩罚分"
          register={form.register("stickyHitPenalty")}
          error={form.formState.errors.stickyHitPenalty?.message}
          hint="上游每被一个IP粘住叠加的熵增参数。"
        />
        <NumberField
          label="速度排名惩罚分"
          register={form.register("speedRankPenalty")}
          error={form.formState.errors.speedRankPenalty?.message}
          hint="基于 10 号规则测出的首Token平均时间排名，排名越后叠加的熵增值越大。"
        />
      </SettingsCard>
      </div>
      <div className="shrink-0 flex justify-end"><button type="submit" disabled={mutation.isPending} className={primaryButton}><Save className="h-4 w-4" />保存调度参数</button></div>
    </form>
  );
}

function RouteSimulatorPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [result, setResult] = useState<unknown>(null);
  const form = useForm<SimulatorValues>({ resolver: zodResolver(simulatorSchema), defaultValues: { userId: "", apiKeyId: "", clientIp: "", model: "" } });
  const mutation = useMutation({
    mutationFn: (values: RouteSimulatorInput) => simulateRoute(values),
    onSuccess: setResult,
    onError: (error) => onNotice(errorToText(error)),
  });
  return (
    <section className="grid h-full min-h-0 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" onSubmit={form.handleSubmit((values) => mutation.mutate({ ...values, clientIp: values.clientIp || null }))}>
        <h3 className="text-base font-semibold text-slate-950">模拟入参</h3>
        <div className="mt-5 grid gap-4">
          <TextField label="User ID" register={form.register("userId")} error={form.formState.errors.userId?.message} />
          <TextField label="API Key ID" register={form.register("apiKeyId")} error={form.formState.errors.apiKeyId?.message} />
          <TextField label="Client IP" register={form.register("clientIp")} />
          <TextField label="Model" register={form.register("model")} error={form.formState.errors.model?.message} />
        </div>
        <button type="submit" disabled={mutation.isPending} className={`mt-6 ${primaryButton}`}><Play className="h-4 w-4" />运行模拟</button>
      </form>
      <div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">模拟结果</h3>
        <pre className="mt-4 min-h-0 flex-1 whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100"><code>{result ? JSON.stringify(result, null, 2) : "等待运行模拟器..."}</code></pre>
      </div>
    </section>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-h-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-base font-semibold text-slate-950">{title}</h3><div className="mt-4 grid gap-3">{children}</div></section>;
}
function NumberField({ label, register, error, hint }: { label: string; register: object; error?: string; hint?: string }) {
  return <label className="grid gap-1.5"><span className="text-sm font-medium text-slate-700">{label}</span><input type="number" className={inputClass} {...register} />{hint ? <span className="text-xs leading-4 text-slate-500">{hint}</span> : null}{error ? <span className="text-sm text-red-600">{error}</span> : null}</label>;
}
function TextField({ label, register, error }: { label: string; register: object; error?: string }) {
  return <label className="grid gap-2"><span className="text-sm font-medium text-slate-700">{label}</span><input className={inputClass} {...register} />{error ? <span className="text-sm text-red-600">{error}</span> : null}</label>;
}
function Toggle({ label, register, hint }: { label: string; register: object; hint?: string }) {
  return <label className="grid gap-1.5 rounded-md border border-slate-200 px-3 py-2"><span className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register} />{label}</span>{hint ? <span className="text-xs leading-4 text-slate-500">{hint}</span> : null}</label>;
}
function Badge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{children}</span>;
}
function SkeletonRows() { return <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />)}</div>; }
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
function formatMultiplier(value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "1";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton = "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60";
