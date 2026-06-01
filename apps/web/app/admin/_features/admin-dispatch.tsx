"use client";

import {
  Clock3,
  Gauge,
  GitBranch,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../_components/admin-confirm";
import { useAdminResource } from "../_components/admin-hooks";
import {
  AdminDataTable,
  ConsoleNavButton,
  SettingsConsoleLayout,
  StatusPill,
} from "../_components/admin-ui";

type DispatchSettings = {
  stickyEnabled: boolean;
  stickyTtlSeconds: number;
  stickySlowUnbindEnabled: boolean;
  slowFirstTokenMs: number;
  slowTotalLatencyMs: number;
  slowUnbindThreshold: number;
  penaltyEnabled: boolean;
  penaltyFailureThreshold: number;
  penaltySeconds: number;
  healthCheckIntervalSeconds: number;
  speedRankPenalty: number;
  stickyHitPenalty: number;
  forceAvailableButtonEnabled: boolean;
};

type AccessTier = {
  id: string;
  code: string;
  name: string;
  status: string;
  sortOrder?: number;
  billingMultiplier?: string;
  walletRequired?: boolean;
  description?: string | null;
  _count?: {
    users?: number;
    apiKeys?: number;
    modelPools?: number;
  };
};

type IpAccessTierRule = {
  id: string;
  cidrOrIp: string;
  tierId: string;
  status: "ACTIVE" | "DISABLED" | string;
  priority: number;
  remark?: string | null;
  tier?: AccessTier | null;
};

const emptySettings: DispatchSettings = {
  stickyEnabled: true,
  stickyTtlSeconds: 600,
  stickySlowUnbindEnabled: true,
  slowFirstTokenMs: 15000,
  slowTotalLatencyMs: 45000,
  slowUnbindThreshold: 3,
  penaltyEnabled: true,
  penaltyFailureThreshold: 2,
  penaltySeconds: 60,
  healthCheckIntervalSeconds: 30,
  speedRankPenalty: 300,
  stickyHitPenalty: 500,
  forceAvailableButtonEnabled: true,
};

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后再试。";
}

export function AdminDispatchPage({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const settingsQuery = useAdminResource<{ settings: DispatchSettings; defaults: DispatchSettings }>(
    "dispatchSettings",
    "/admin/dispatch-settings",
  );
  const tiersQuery = useAdminResource<{ tiers: AccessTier[] }>(
    "accessTiers",
    "/admin/access-tiers",
  );
  const ipRulesQuery = useAdminResource<{ rules: IpAccessTierRule[] }>(
    "ipAccessTiers",
    "/admin/ip-access-tiers",
  );
  const [draft, setDraft] = useState<DispatchSettings>(emptySettings);
  const [ipDraft, setIpDraft] = useState({
    cidrOrIp: "",
    tierId: "",
    priority: "100",
    remark: "",
  });
  const [tierDraft, setTierDraft] = useState({
    name: "",
    code: "",
    sortOrder: "100",
    billingMultiplier: "1",
    walletRequired: true,
    description: "",
  });
  const [editingTier, setEditingTier] = useState<AccessTier | null>(null);
  const [tierEditDraft, setTierEditDraft] = useState({
    name: "",
    code: "",
    sortOrder: "100",
    billingMultiplier: "1",
    walletRequired: true,
    description: "",
  });
  const [activePanel, setActivePanel] = useState<
    "sticky" | "slow" | "entropy" | "penalty" | "tiers" | "ip"
  >("sticky");
  const [busy, setBusy] = useState(false);

  const tiers = tiersQuery.data?.tiers ?? [];
  const standardTier = useMemo(
    () => tiers.find((tier) => tier.code === "standard") ?? null,
    [tiers],
  );
  const activeTiers = useMemo(
    () => tiers.filter((tier) => tier.status === "ACTIVE"),
    [tiers],
  );
  const defaultTierId =
    standardTier?.id ?? activeTiers[0]?.id ?? tiers[0]?.id ?? "";
  const rules = ipRulesQuery.data?.rules ?? [];
  const activeIpRuleCount = rules.filter((rule) => rule.status === "ACTIVE").length;

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setDraft(settingsQuery.data.settings);
    }
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    setIpDraft((current) => ({
      ...current,
      tierId: current.tierId || defaultTierId,
    }));
  }, [defaultTierId]);

  useEffect(() => {
    const error = settingsQuery.error ?? tiersQuery.error ?? ipRulesQuery.error;
    onError(error ? errorToText(error) : null);
  }, [settingsQuery.error, tiersQuery.error, ipRulesQuery.error, onError]);

  function setNumber(key: keyof DispatchSettings, value: string) {
    setDraft((current) => ({ ...current, [key]: Number(value) }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const result = await apiFetch<{ settings: DispatchSettings }>(
        "/admin/dispatch-settings",
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );
      setDraft(result.settings);
      void settingsQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function addIpRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ipDraft.cidrOrIp || !ipDraft.tierId) {
      onError("请填写 IP/CIDR 并选择等级。");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch("/admin/ip-access-tiers", {
        method: "POST",
        body: JSON.stringify({
          cidrOrIp: ipDraft.cidrOrIp,
          tierId: ipDraft.tierId,
          priority: Number(ipDraft.priority),
          remark: ipDraft.remark || null,
          status: "ACTIVE",
        }),
      });
      setIpDraft((current) => ({ ...current, cidrOrIp: "", remark: "" }));
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleIpRule(rule: IpAccessTierRule) {
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/ip-access-tiers/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: rule.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteIpRule(rule: IpAccessTierRule) {
    const confirmed = await confirmAdminAction({
      title: "删除 IP 等级规则",
      description: `确定删除 ${rule.cidrOrIp} 的等级规则吗？`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/ip-access-tiers/${rule.id}`, {
        method: "DELETE",
      });
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function addTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tierDraft.name.trim() || !tierDraft.code.trim()) {
      onError("请填写等级名称和代码。");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch("/admin/access-tiers", {
        method: "POST",
        body: JSON.stringify({
          name: tierDraft.name.trim(),
          code: tierDraft.code.trim(),
          sortOrder: Number(tierDraft.sortOrder),
          billingMultiplier: tierDraft.billingMultiplier || "1",
          walletRequired: tierDraft.walletRequired,
          description: tierDraft.description.trim() || null,
          status: "ACTIVE",
        }),
      });
      setTierDraft({
        name: "",
        code: "",
        sortOrder: "100",
        billingMultiplier: "1",
        walletRequired: true,
        description: "",
      });
      void tiersQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTier(tier: AccessTier) {
    if (tier.code === "standard" && tier.status === "ACTIVE") {
      onError("standard 是新用户和新 IP 的默认等级，不能停用。");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/access-tiers/${tier.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: tier.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        }),
      });
      void tiersQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  function beginEditTier(tier: AccessTier) {
    setEditingTier(tier);
    setTierEditDraft({
      name: tier.name,
      code: tier.code,
      sortOrder: String(tier.sortOrder ?? 100),
      billingMultiplier: tier.billingMultiplier ?? "1",
      walletRequired: tier.walletRequired ?? true,
      description: tier.description ?? "",
    });
  }

  async function saveTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTier) {
      return;
    }
    if (!tierEditDraft.name.trim() || !tierEditDraft.code.trim()) {
      onError("请填写等级名称和代码。");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/access-tiers/${editingTier.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: tierEditDraft.name.trim(),
          ...(editingTier.code === "standard"
            ? {}
            : { code: tierEditDraft.code.trim() }),
          sortOrder: Number(tierEditDraft.sortOrder),
          billingMultiplier: tierEditDraft.billingMultiplier || "1",
          walletRequired: tierEditDraft.walletRequired,
          description: tierEditDraft.description.trim() || null,
        }),
      });
      setEditingTier(null);
      void tiersQuery.refetch();
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTier(tier: AccessTier) {
    const confirmed = await confirmAdminAction({
      title: "删除等级预设",
      description: `确定删除等级「${tier.name}」吗？已被用户、Key 或模型池使用的等级不会被删除。`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/admin/access-tiers/${tier.id}`, {
        method: "DELETE",
      });
      void tiersQuery.refetch();
      void ipRulesQuery.refetch();
    } catch (error) {
      onError(errorToText(error));
    } finally {
      setBusy(false);
    }
  }

  const tierRows = tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    code: tier.code,
    sortOrder: tier.sortOrder ?? 0,
    billingMultiplier: `× ${formatMultiplier(tier.billingMultiplier ?? "1")}`,
    walletRequired: tier.walletRequired === false ? "不要求余额" : "需要余额",
    status: <StatusPill status={tier.status} />,
    defaultFlag:
      tier.code === "standard" ? (
        <span className="pill ok">新用户 / 新 IP 默认</span>
      ) : (
        "-"
      ),
    usage: `${tier._count?.users ?? 0} 用户 / ${tier._count?.apiKeys ?? 0} Key / ${tier._count?.modelPools ?? 0} 池`,
    description: tier.description ?? "-",
    actions: (
      <div className="button-row compact">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => beginEditTier(tier)}
          type="button"
        >
          <Pencil size={14} />
          编辑
        </button>
        <button
          className="button secondary"
          disabled={busy || (tier.code === "standard" && tier.status === "ACTIVE")}
          onClick={() => void toggleTier(tier)}
          type="button"
        >
          {tier.status === "ACTIVE" ? "停用" : "启用"}
        </button>
        <button
          className="button danger"
          disabled={busy}
          onClick={() => void deleteTier(tier)}
          type="button"
        >
          <Trash2 size={14} />
          删除
        </button>
      </div>
    ),
  }));

  const ruleRows = rules.map((rule) => ({
    id: rule.id,
    ip: rule.cidrOrIp,
    tier: rule.tier ? `${rule.tier.name} (${rule.tier.code})` : "-",
    priority: rule.priority,
    status: <StatusPill status={rule.status} />,
    remark: rule.remark ?? "-",
    actions: (
      <div className="button-row compact">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void toggleIpRule(rule)}
          type="button"
        >
          {rule.status === "ACTIVE" ? "停用" : "启用"}
        </button>
        <button
          className="button danger"
          disabled={busy}
          onClick={() => void deleteIpRule(rule)}
          type="button"
        >
          <Trash2 size={14} />
          删除
        </button>
      </div>
    ),
  }));

  return (
    <div className="admin-page admin-dispatch-page">
      <form className="dispatch-layout" onSubmit={saveSettings}>
        <SettingsConsoleLayout
          className="dispatch-settings-console"
          nav={
            <>
              <div className="console-side-head">
                <h2 className="section-title">调度与分发</h2>
                <p className="section-subtitle">按类别维护调度参数、等级和 IP 规则。</p>
              </div>
              {[
                ["sticky", "粘性策略", draft.stickyEnabled ? "开启" : "关闭"],
                ["slow", "慢请求解绑", draft.stickySlowUnbindEnabled && draft.stickyEnabled ? `${draft.slowUnbindThreshold} 次` : "关闭"],
                ["entropy", "熵值选择", `${draft.speedRankPenalty}/${draft.stickyHitPenalty}`],
                ["penalty", "惩罚与健康检测", draft.penaltyEnabled ? `${draft.penaltyFailureThreshold} 次` : "关闭"],
                ["tiers", "等级预设", `${activeTiers.length}/${tiers.length}`],
                ["ip", "IP 等级规则", `${activeIpRuleCount} 条`],
              ].map(([id, title, meta]) => (
                <ConsoleNavButton
                  key={id}
                  active={activePanel === id}
                  title={title}
                  meta={meta}
                  onClick={() => setActivePanel(id as typeof activePanel)}
                />
              ))}
            </>
          }
          summary={
            <>
              <RuleTitle
                icon={<Clock3 size={18} />}
                title="规则速览"
                subtitle="保存后调度服务立即读取新配置。"
              />
              <div className="dispatch-summary-list">
                <InfoPair label="粘性窗口" value={`${draft.stickyTtlSeconds}s`} />
                <InfoPair label="慢定义" value={`${draft.slowFirstTokenMs}ms / ${draft.slowTotalLatencyMs}ms`} />
                <InfoPair label="解绑阈值" value={draft.stickySlowUnbindEnabled && draft.stickyEnabled ? `${draft.slowUnbindThreshold} 次` : "关闭"} />
                <InfoPair label="惩罚阈值" value={draft.penaltyEnabled ? `${draft.penaltyFailureThreshold} 次` : "关闭"} />
                <InfoPair label="惩罚时长" value={`${draft.penaltySeconds}s`} />
                <InfoPair label="健康检测" value={`${draft.healthCheckIntervalSeconds}s`} />
                <InfoPair label="IP 等级规则" value={`${activeIpRuleCount} 条启用`} />
              </div>
              <button className="button dispatch-save-button" disabled={busy} type="submit">
                <Save size={16} />
                {busy ? "保存中..." : "保存调度设置"}
              </button>
            </>
          }
        >
        <div className="dispatch-main">
          {activePanel === "sticky" || activePanel === "slow" ? (
          <section className="card dispatch-rule-card">
            <RuleTitle
              icon={<GitBranch size={18} />}
              title={activePanel === "sticky" ? "粘性策略" : "慢请求解绑"}
              subtitle="成功后按 IP + 模型粘住上游；连续慢可自动解绑。"
              action={
                <label className="check-row">
                  <input
                    checked={draft.stickyEnabled}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        stickyEnabled: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  粘性开启
                </label>
              }
            />
            {activePanel === "sticky" ? (
            <div className="dispatch-field-grid two">
              <Field label="粘性时长（秒）" hint="成功调用后，IP 粘住同一上游 Key 的时间。">
                <input className="input" type="number" min={60} max={86400} value={draft.stickyTtlSeconds} onChange={(event) => setNumber("stickyTtlSeconds", event.target.value)} />
              </Field>
            </div>
            ) : (
            <>
            <div className="dispatch-field-grid">
              <Field label="首 token 慢阈值（毫秒）" hint="首 token 超过这个时间，就算本次调用慢。">
                <input className="input" type="number" min={1000} max={300000} value={draft.slowFirstTokenMs} onChange={(event) => setNumber("slowFirstTokenMs", event.target.value)} />
              </Field>
              <Field label="总时长慢阈值（毫秒）" hint="总时长超过这个值算慢；compact 请求跳过。">
                <input className="input" type="number" min={1000} max={600000} value={draft.slowTotalLatencyMs} onChange={(event) => setNumber("slowTotalLatencyMs", event.target.value)} />
              </Field>
              <Field label="连续慢几次解绑" hint="同一 IP 连续慢达到这个次数，就清除粘性。">
                <input className="input" type="number" min={1} max={100} value={draft.slowUnbindThreshold} onChange={(event) => setNumber("slowUnbindThreshold", event.target.value)} />
              </Field>
            </div>
            <label className="dispatch-inline-toggle">
              <input checked={draft.stickySlowUnbindEnabled} disabled={!draft.stickyEnabled} onChange={(event) => setDraft((current) => ({ ...current, stickySlowUnbindEnabled: event.target.checked }))} type="checkbox" />
              开启粘性解绑规则
              <span>关闭后即使连续慢，也不会解除 IP 粘性。</span>
            </label>
            </>
            )}
          </section>
          ) : null}

          {activePanel === "entropy" ? (
          <section className="card dispatch-rule-card">
            <RuleTitle
              icon={<Gauge size={18} />}
              title="熵值与标准选择"
              subtitle="系统会优先选负担更轻、健康检测更快的上游；这里只调加分力度。"
              action={<StatusPill status="ACTIVE" />}
            />
            <div className="dispatch-field-grid two">
              <Field label="慢上游避让力度" hint="健康检测越慢，越不容易被选中；数字越大，越偏向快的上游。">
                <input className="input" type="number" min={0} max={60000} value={draft.speedRankPenalty} onChange={(event) => setNumber("speedRankPenalty", event.target.value)} />
              </Field>
              <Field label="已粘住人数避让力度" hint="粘住某个上游或 Key 的 IP 越多，越少继续分配给它；数字越大，分散越明显。">
                <input className="input" type="number" min={0} max={60000} value={draft.stickyHitPenalty} onChange={(event) => setNumber("stickyHitPenalty", event.target.value)} />
              </Field>
            </div>
          </section>
          ) : null}

          {activePanel === "penalty" ? (
          <section className="card dispatch-rule-card">
            <RuleTitle
              icon={<ShieldCheck size={18} />}
              title="惩罚与健康检测"
              subtitle="真实调用连续失败才惩罚；健康检测始终开启。"
              action={
                <label className="check-row">
                  <input checked={draft.penaltyEnabled} onChange={(event) => setDraft((current) => ({ ...current, penaltyEnabled: event.target.checked }))} type="checkbox" />
                  惩罚开启
                </label>
              }
            />
            <div className="dispatch-field-grid">
              <Field label="连续失败几次惩罚" hint="同一 IP 连续调用同一上游失败达到次数后，渠道进入惩罚中。">
                <input className="input" type="number" min={1} max={100} value={draft.penaltyFailureThreshold} onChange={(event) => setNumber("penaltyFailureThreshold", event.target.value)} />
              </Field>
              <Field label="惩罚时长（秒）" hint="惩罚中不可调用，到期后触发健康检测。">
                <input className="input" type="number" min={1} max={86400} value={draft.penaltySeconds} onChange={(event) => setNumber("penaltySeconds", event.target.value)} />
              </Field>
              <Field label="健康检测间隔（秒）" hint="可调用渠道每隔多久检测一次所有 active Key。">
                <input className="input" type="number" min={5} max={3600} value={draft.healthCheckIntervalSeconds} onChange={(event) => setNumber("healthCheckIntervalSeconds", event.target.value)} />
              </Field>
              <Field label="强制可用按钮" hint="控制模型池页面是否允许管理员手动强制渠道可用。">
                <label className="check-row compact-check-row">
                  <input checked={draft.forceAvailableButtonEnabled} onChange={(event) => setDraft((current) => ({ ...current, forceAvailableButtonEnabled: event.target.checked }))} type="checkbox" />
                  允许使用
                </label>
              </Field>
            </div>
          </section>
          ) : null}
        </div>

      <div className="dispatch-data-grid">
        {activePanel === "tiers" ? (
        <section className="card dispatch-data-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">等级预设</h2>
              <p className="section-subtitle">
                standard 是新用户、新 IP 和未指定等级时的默认等级；名称、说明和显示位置可编辑，代码固定为 standard。
              </p>
            </div>
            <span className="pill ok">
              默认：{standardTier?.name ?? "Standard"}
            </span>
          </div>
          <form className="dispatch-add-row tier" onSubmit={addTier}>
            <input
              className="input"
              placeholder="等级名称，例如 VIP"
              value={tierDraft.name}
              onChange={(event) =>
                setTierDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <input
              className="input"
              placeholder="代码，例如 vip"
              value={tierDraft.code}
              onChange={(event) =>
                setTierDraft((current) => ({ ...current, code: event.target.value }))
              }
            />
            <input
              className="input"
              aria-label="显示位置，数字小的排前面"
              title="显示位置：数字小的排前面"
              placeholder="显示位置"
              type="number"
              min={1}
              max={10000}
              value={tierDraft.sortOrder}
              onChange={(event) =>
                setTierDraft((current) => ({ ...current, sortOrder: event.target.value }))
              }
            />
            <input
              className="input"
              aria-label="扣费倍率"
              title="扣费倍率：最终扣费会乘以此倍率"
              placeholder="扣费倍率"
              inputMode="decimal"
              value={tierDraft.billingMultiplier}
              onChange={(event) =>
                setTierDraft((current) => ({
                  ...current,
                  billingMultiplier: event.target.value,
                }))
              }
            />
            <input
              className="input"
              placeholder="说明"
              value={tierDraft.description}
              onChange={(event) =>
                setTierDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <label className="inline-field">
              <span>钱包门槛</span>
              <input
                checked={tierDraft.walletRequired}
                type="checkbox"
                onChange={(event) =>
                  setTierDraft((current) => ({
                    ...current,
                    walletRequired: event.target.checked,
                  }))
                }
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              <Plus size={16} />
              添加
            </button>
          </form>
          <AdminDataTable
            columns={[
              { accessorKey: "name", header: "名称" },
              { accessorKey: "code", header: "代码" },
              { accessorKey: "sortOrder", header: "显示位置" },
              { accessorKey: "billingMultiplier", header: "扣费倍率" },
              { accessorKey: "walletRequired", header: "钱包门槛" },
              { accessorKey: "defaultFlag", header: "默认" },
              { accessorKey: "status", header: "状态" },
              { accessorKey: "usage", header: "使用中" },
              { accessorKey: "actions", header: "操作" },
            ]}
            data={tierRows}
            empty="暂无等级预设"
          />
        </section>
        ) : null}

        {activePanel === "ip" ? (
        <section className="card dispatch-data-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">IP 等级规则</h2>
              <p className="section-subtitle">支持单 IP 和 IPv4 CIDR；优先级数字越小越先匹配。</p>
            </div>
            <span className="pill">{activeIpRuleCount} 条启用</span>
          </div>
          <form className="dispatch-add-row ip" onSubmit={addIpRule}>
            <input className="input" placeholder="1.2.3.4 或 1.2.3.0/24" value={ipDraft.cidrOrIp} onChange={(event) => setIpDraft((current) => ({ ...current, cidrOrIp: event.target.value }))} />
            <select className="input" value={ipDraft.tierId} onChange={(event) => setIpDraft((current) => ({ ...current, tierId: event.target.value }))}>
              {activeTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>{tier.name} ({tier.code})</option>
              ))}
            </select>
            <input className="input" aria-label="优先级" type="number" min={1} max={10000} value={ipDraft.priority} onChange={(event) => setIpDraft((current) => ({ ...current, priority: event.target.value }))} />
            <input className="input" placeholder="备注" value={ipDraft.remark} onChange={(event) => setIpDraft((current) => ({ ...current, remark: event.target.value }))} />
            <button className="button" disabled={busy || activeTiers.length === 0} type="submit">
              <Plus size={16} />
              添加
            </button>
          </form>
          <AdminDataTable
            columns={[
              { accessorKey: "ip", header: "IP/CIDR" },
              { accessorKey: "tier", header: "等级" },
              { accessorKey: "priority", header: "优先级" },
              { accessorKey: "status", header: "状态" },
              { accessorKey: "remark", header: "备注" },
              { accessorKey: "actions", header: "操作" },
            ]}
            data={ruleRows}
            empty="暂无 IP 等级规则"
          />
        </section>
        ) : null}
      </div>
        </SettingsConsoleLayout>
      </form>

      {editingTier ? (
        <div className="modal-backdrop" onClick={() => setEditingTier(null)}>
          <div
            className="form-modal config-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <form className="form" onSubmit={saveTier}>
              <div className="modal-head">
                <div>
                  <span className="eyebrow">Access Tier</span>
                  <h2>编辑等级预设</h2>
                  <p>名称和代码会显示在用户、Key、模型池和 IP 等级规则里。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setEditingTier(null)}
                  type="button"
                >
                  关闭
                </button>
              </div>
              <div className="modal-body">
                <div className="grid cols-2">
                  <label className="field">
                    <span>等级名称</span>
                    <input
                      className="input"
                      value={tierEditDraft.name}
                      onChange={(event) =>
                        setTierEditDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>等级代码</span>
                    <input
                      className="input"
                      disabled={editingTier.code === "standard"}
                      value={tierEditDraft.code}
                      onChange={(event) =>
                        setTierEditDraft((current) => ({
                          ...current,
                          code: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>扣费倍率</span>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={tierEditDraft.billingMultiplier}
                      onChange={(event) =>
                        setTierEditDraft((current) => ({
                          ...current,
                          billingMultiplier: event.target.value,
                        }))
                      }
                    />
                    <small className="muted">最终扣费 = 现有计费结果 × 此倍率。1 为不调整。</small>
                  </label>
                  <label className="field">
                    <span>钱包门槛</span>
                    <span className="inline-field">
                      <input
                        checked={tierEditDraft.walletRequired}
                        type="checkbox"
                        onChange={(event) =>
                          setTierEditDraft((current) => ({
                            ...current,
                            walletRequired: event.target.checked,
                          }))
                        }
                      />
                      要求余额检查和预留
                    </span>
                    <small className="muted">关闭后，该等级不会因余额为 0 或不足预留金额被拦截。</small>
                  </label>
                </div>
                <label className="field">
                  <span>显示位置</span>
                  <input
                    className="input"
                    min={1}
                    max={10000}
                    type="number"
                    value={tierEditDraft.sortOrder}
                    onChange={(event) =>
                      setTierEditDraft((current) => ({
                        ...current,
                        sortOrder: event.target.value,
                      }))
                    }
                  />
                  <small className="muted">数字小的排前面，只影响后台下拉和列表显示。</small>
                </label>
                <label className="field">
                  <span>说明</span>
                  <textarea
                    className="input textarea compact-textarea"
                    value={tierEditDraft.description}
                    onChange={(event) =>
                      setTierEditDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="modal-footer">
                <button
                  className="button secondary"
                  onClick={() => setEditingTier(null)}
                  type="button"
                >
                  取消
                </button>
                <button className="button" disabled={busy} type="submit">
                  <Save size={16} />
                  保存等级
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DispatchMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dispatch-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RuleTitle({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="dispatch-rule-title">
      <div className="dispatch-rule-icon">{icon}</div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action ? <div className="dispatch-rule-action">{action}</div> : null}
    </div>
  );
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="dispatch-info-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMultiplier(value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "1";
  }
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      <small className="muted">{hint}</small>
    </label>
  );
}
