"use client";

import { Plus, Send, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { confirmAdminAction } from "../_components/admin-confirm";
import { money } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import { AdminDataTable, Metric, StatusPill } from "../_components/admin-ui";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  allowedModels?: string[];
};

type AccessTierRef = { id: string; code: string; name: string };

type AccessTier = AccessTierRef & {
  status: "ACTIVE" | "DISABLED" | string;
  sortOrder: number;
  billingMultiplier?: string;
  walletRequired?: boolean;
  description?: string | null;
  _count?: { users: number; apiKeys: number; modelPools: number };
};

type AdminUser = {
  id: string;
  email: string;
  apiKeys?: ApiKey[];
};

type RouteSimulationPrice = {
  upstreamInputPer1MTok: string;
  upstreamOutputPer1MTok: string;
  customerInputPer1MTok: string;
  customerOutputPer1MTok: string;
  minimumChargeUsd: string;
};

type RouteSimulation = {
  user: { id: string; email: string; status: string; tier?: AccessTierRef | null };
  apiKey: { id: string; name: string; keyPrefix: string; status: string; tier?: AccessTierRef | null };
  policy: { tierId: string | null; tierCode: string };
  route: {
    fallbackToStandard: boolean;
    routeCandidates: Array<{
      id: string;
      upstreamProvider: string;
      effectiveStatus: string;
      activeKeys: Array<{ id: string; name: string; keyPrefix: string }>;
      price?: RouteSimulationPrice | null;
    }>;
    selectedCandidate?: { upstreamProvider: string; price?: RouteSimulationPrice | null } | null;
    unavailableReasons: string[];
  };
  steps: string[];
};

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

function formatMultiplier(value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "1";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function AdminRouting({
  users,
  onError,
}: {
  users: AdminUser[];
  onError: (error: string | null) => void;
}) {
  const tiersQuery = useAdminResource<{ tiers: AccessTier[] }>("accessTiers", "/admin/access-tiers");
  const accessTiers = tiersQuery.data?.tiers ?? [];
  const activeTiers = accessTiers.filter((tier) => tier.status === "ACTIVE");
  const firstUser = users[0];
  const firstUserKey = firstUser?.apiKeys?.[0];
  const [tierDraft, setTierDraft] = useState({
    code: "",
    name: "",
    sortOrder: "100",
    billingMultiplier: "1",
    walletRequired: true,
    description: "",
  });
  const [simulationDraft, setSimulationDraft] = useState({
    userId: firstUser?.id ?? "",
    apiKeyId: firstUserKey?.id ?? "",
    clientIp: "",
    model: "",
  });
  const [simulation, setSimulation] = useState<RouteSimulation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    onError(tiersQuery.error ? errorToText(tiersQuery.error) : null);
  }, [tiersQuery.error, onError]);

  useEffect(() => {
    setSimulationDraft((current) => ({
      ...current,
      userId: current.userId || firstUser?.id || "",
      apiKeyId: current.apiKeyId || firstUserKey?.id || "",
    }));
  }, [firstUser?.id, firstUserKey?.id]);

  const selectedSimulationUser = users.find(
    (item) => item.id === simulationDraft.userId,
  );
  const simulationUserKeys = selectedSimulationUser?.apiKeys ?? [];
  const simulationModels = Array.from(
    new Set([
      ...simulationUserKeys.flatMap((key) => key.allowedModels ?? []),
      ...users.flatMap((user) =>
        (user.apiKeys ?? []).flatMap((key) => key.allowedModels ?? []),
      ),
    ]),
  ).sort();
  const simulationStepRows =
    simulation?.steps.map((step, index) => ({
      id: `${step}:${index}`,
      step: `${index + 1}. ${step}`,
    })) ?? [];
  const simulationCandidateRows =
    simulation?.route.routeCandidates.map((candidate) => ({
      id: candidate.id,
      provider: candidate.upstreamProvider,
      status: <StatusPill status={candidate.effectiveStatus} />,
      activeKeys: candidate.activeKeys.length,
      customerPrice: candidate.price
        ? `$${money(candidate.price.customerInputPer1MTok)} / $${money(candidate.price.customerOutputPer1MTok)}`
        : "-",
      upstreamCost: candidate.price
        ? `$${money(candidate.price.upstreamInputPer1MTok)} / $${money(candidate.price.upstreamOutputPer1MTok)}`
        : "-",
      minimumCharge: candidate.price
        ? `$${money(candidate.price.minimumChargeUsd)}`
        : "-",
    })) ?? [];
  const accessTierRows = accessTiers.map((tier) => ({
    id: tier.id,
    tier: (
      <>
        <strong>{tier.name}</strong>
        <div className="muted">{tier.code}</div>
      </>
    ),
    status: <StatusPill status={tier.status} />,
    billingMultiplier: `× ${formatMultiplier(tier.billingMultiplier ?? "1")}`,
    walletRequired: tier.walletRequired === false ? "不要求余额" : "需要余额",
    references: (
      <span className="muted">
        用户 {tier._count?.users ?? 0} · Key {tier._count?.apiKeys ?? 0} · 池{" "}
        {tier._count?.modelPools ?? 0}
      </span>
    ),
    actions: (
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busyId === tier.id}
          onClick={() =>
            updateTier(tier, tier.status === "ACTIVE" ? "DISABLED" : "ACTIVE")
          }
          type="button"
        >
          {tier.status === "ACTIVE" ? "禁用" : "启用"}
        </button>
        <button
          className="icon-button danger"
          disabled={tier.code === "standard" || busyId === tier.id}
          onClick={() => deleteTier(tier)}
          title="删除等级"
          type="button"
        >
          <Trash2 size={16} />
        </button>
      </div>
    ),
  }));

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);

    try {
      const result = await apiFetch<{ simulation: RouteSimulation }>(
        "/admin/route-simulator",
        {
          method: "POST",
          body: JSON.stringify({
            userId: simulationDraft.userId,
            apiKeyId: simulationDraft.apiKeyId,
            clientIp: simulationDraft.clientIp || null,
            model: simulationDraft.model,
          }),
        },
      );
      setSimulation(result.simulation);
    } catch (error) {
      onError(errorToText(error));
    }
  }

  async function createTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    try {
      await apiFetch("/admin/access-tiers", {
        method: "POST",
        body: JSON.stringify({
          code: tierDraft.code,
          name: tierDraft.name,
          sortOrder: Number(tierDraft.sortOrder) || 100,
          billingMultiplier: tierDraft.billingMultiplier || "1",
          walletRequired: tierDraft.walletRequired,
          description: tierDraft.description || null,
          status: "ACTIVE",
        }),
      });
      setTierDraft({
        code: "",
        name: "",
        sortOrder: "100",
        billingMultiplier: "1",
        walletRequired: true,
        description: "",
      });
      await tiersQuery.refetch();
    } catch (createError) {
      onError(errorToText(createError));
    }
  }

  async function updateTier(tier: AccessTier, status: "ACTIVE" | "DISABLED") {
    onError(null);
    setBusyId(tier.id);
    try {
      await apiFetch(`/admin/access-tiers/${tier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await tiersQuery.refetch();
    } catch (updateError) {
      onError(errorToText(updateError));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteTier(tier: AccessTier) {
    if (
      !(await confirmAdminAction({
        title: "删除访问等级",
        description: `确定删除等级「${tier.name}」吗？`,
        confirmText: "删除等级",
        danger: true,
      }))
    ) {
      return;
    }

    onError(null);
    setBusyId(tier.id);
    try {
      await apiFetch(`/admin/access-tiers/${tier.id}`, {
        method: "DELETE",
      });
      await tiersQuery.refetch();
    } catch (deleteError) {
      onError(errorToText(deleteError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack admin-routing-workbench">
      <div className="routing-split">
        <div className="routing-side-panel">
          <section className="card">
            <div className="section-head">
              <div>
                <h2 className="section-title">路由模拟器</h2>
                <p className="section-subtitle">
                  不发真实请求、不扣费，只按当前配置推演用户最终会走哪个等级、模型池、上游和
                  Key。
                </p>
              </div>
              <StatusPill
                status={simulation?.route.selectedCandidate ? "READY" : "WAITING"}
              />
            </div>
            <form className="grid-form" onSubmit={runSimulation}>
              <label>
                用户
                <select
                  className="input"
                  onChange={(event) => {
                    const nextUser = users.find(
                      (item) => item.id === event.target.value,
                    );
                    setSimulationDraft((current) => ({
                      ...current,
                      userId: event.target.value,
                      apiKeyId: nextUser?.apiKeys?.[0]?.id ?? "",
                    }));
                  }}
                  required
                  value={simulationDraft.userId}
                >
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API Key
                <select
                  className="input"
                  onChange={(event) =>
                    setSimulationDraft((current) => ({
                      ...current,
                      apiKeyId: event.target.value,
                    }))
                  }
                  required
                  value={simulationDraft.apiKeyId}
                >
                  {simulationUserKeys.map((key) => (
                    <option key={key.id} value={key.id}>
                      {key.name} ({key.keyPrefix})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                来源 IP
                <input
                  className="input"
                  onChange={(event) =>
                    setSimulationDraft((current) => ({
                      ...current,
                      clientIp: event.target.value,
                    }))
                  }
                  placeholder="可留空；用于测试 IP 等级规则"
                  value={simulationDraft.clientIp}
                />
              </label>
              <label>
                模型
                <input
                  className="input"
                  list="routing-model-suggestions"
                  onChange={(event) =>
                    setSimulationDraft((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                  placeholder="例如 gpt-4o-mini"
                  required
                  value={simulationDraft.model}
                />
                <datalist id="routing-model-suggestions">
                  {simulationModels.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
              <div className="form-actions">
                <button className="button" type="submit">
                  <Send size={17} />
                  模拟路由
                </button>
              </div>
            </form>
            {simulation ? (
              <div className="route-simulation-result">
                <div className="metric-grid">
                  <Metric label="最终等级" value={simulation.policy.tierCode} />
                  <Metric
                    label="首选上游"
                    value={
                      simulation.route.selectedCandidate?.upstreamProvider ?? "-"
                    }
                  />
                  <Metric
                    label="候选渠道"
                    value={String(simulation.route.routeCandidates.length)}
                  />
                </div>
                <AdminDataTable
                  columns={[{ accessorKey: "step", header: "推演步骤" }]}
                  data={simulationStepRows}
                  empty="暂无推演步骤"
                />
                {simulation.route.unavailableReasons.length > 0 ? (
                  <div className="notice">
                    {simulation.route.unavailableReasons.join("；")}
                  </div>
                ) : null}
                {simulation.route.routeCandidates.length > 0 ? (
                  <AdminDataTable
                    columns={[
                      { accessorKey: "provider", header: "候选上游" },
                      { accessorKey: "status", header: "状态" },
                      { accessorKey: "activeKeys", header: "可用 Key" },
                      { accessorKey: "customerPrice", header: "客户价 / 1M" },
                      { accessorKey: "upstreamCost", header: "上游成本 / 1M" },
                      { accessorKey: "minimumCharge", header: "最低扣费" },
                    ]}
                    data={simulationCandidateRows}
                    empty="暂无候选渠道"
                  />
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="card routing-tier-panel">
            <div className="section-head">
              <div>
                <h2 className="section-title">访问等级</h2>
                <p className="section-subtitle">
                  用户、API Key 和 IP 等级规则都会解析到一个访问等级。
                </p>
              </div>
              <StatusPill
                status={activeTiers.length > 0 ? "ACTIVE" : "UNAVAILABLE"}
              />
            </div>
            <form className="grid-form" onSubmit={createTier}>
              <label>
                等级编码
                <input
                  className="input"
                  onChange={(event) =>
                    setTierDraft((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                  placeholder="premium"
                  required
                  value={tierDraft.code}
                />
              </label>
              <label>
                等级名称
                <input
                  className="input"
                  onChange={(event) =>
                    setTierDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Premium"
                  required
                  value={tierDraft.name}
                />
              </label>
              <label>
                排序
                <input
                  className="input"
                  min={1}
                  onChange={(event) =>
                    setTierDraft((current) => ({
                      ...current,
                      sortOrder: event.target.value,
                    }))
                  }
                  type="number"
                  value={tierDraft.sortOrder}
                />
              </label>
              <label>
                说明
                <input
                  className="input"
                  onChange={(event) =>
                    setTierDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  value={tierDraft.description}
                />
              </label>
              <label>
                扣费倍率
                <input
                  className="input"
                  inputMode="decimal"
                  onChange={(event) =>
                    setTierDraft((current) => ({
                      ...current,
                      billingMultiplier: event.target.value,
                    }))
                  }
                  placeholder="1"
                  value={tierDraft.billingMultiplier}
                />
              </label>
              <label>
                钱包门槛
                <span className="inline-field">
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
                  要求余额检查
                </span>
              </label>
              <div className="form-actions">
                <button className="button" type="submit">
                  <Plus size={17} />
                  新增等级
                </button>
              </div>
            </form>
            <AdminDataTable
              columns={[
                { accessorKey: "tier", header: "等级" },
                { accessorKey: "status", header: "状态" },
                { accessorKey: "billingMultiplier", header: "扣费倍率" },
                { accessorKey: "walletRequired", header: "钱包门槛" },
                { accessorKey: "references", header: "引用" },
                { accessorKey: "actions", header: "操作" },
              ]}
              data={accessTierRows}
              empty="暂无访问等级"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
