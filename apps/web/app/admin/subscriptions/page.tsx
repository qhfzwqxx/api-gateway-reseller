"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Plus, Save, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { getAccessTiers, type AccessTier } from "../../../lib/api/routing";
import {
  createSubscriptionPlan,
  getSubscriptionPlans,
  updateSubscriptionPlan,
  type SubscriptionPlan,
  type UpsertSubscriptionPlanInput,
} from "../../../lib/api/subscriptions";

const blankForm: UpsertSubscriptionPlanInput = {
  code: "",
  name: "",
  status: "ACTIVE",
  tierId: "",
  durationDays: 30,
  quotaMode: "DAILY",
  quotaAmountUsd: "0",
  sortOrder: 100,
  remark: "",
};

export default function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const plansQuery = useQuery({
    queryKey: ["admin", "subscription-plans"],
    queryFn: getSubscriptionPlans,
  });
  const tiersQuery = useQuery({
    queryKey: ["admin", "access-tiers"],
    queryFn: getAccessTiers,
  });

  const createMutation = useMutation({
    mutationFn: createSubscriptionPlan,
    onSuccess: () => {
      setModalOpen(false);
      setNotice("订阅套餐已创建");
      void queryClient.invalidateQueries({
        queryKey: ["admin", "subscription-plans"],
      });
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: UpsertSubscriptionPlanInput;
    }) => updateSubscriptionPlan(id, values),
    onSuccess: () => {
      setModalOpen(false);
      setEditing(null);
      setNotice("订阅套餐已更新");
      void queryClient.invalidateQueries({
        queryKey: ["admin", "subscription-plans"],
      });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const plans = plansQuery.data ?? [];
  const tiers = tiersQuery.data ?? [];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Subscriptions</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">
              订阅管理
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              配置可通过兑换码开通的访问等级订阅套餐。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className={primaryButton}
          >
            <Plus className="h-4 w-4" />
            新建套餐
          </button>
        </div>
      </section>

      {notice ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {notice}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {plansQuery.isLoading ? (
          <SkeletonRows />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">套餐</th>
                  <th className="px-5 py-3">访问等级</th>
                  <th className="px-5 py-3">有效期</th>
                  <th className="px-5 py-3">额度</th>
                  <th className="px-5 py-3">状态</th>
                  <th className="px-5 py-3">使用</th>
                  <th className="px-5 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-950">
                        {plan.name}
                      </div>
                      <div className="mt-1 font-mono text-sm text-slate-500">
                        {plan.code}
                      </div>
                      {plan.remark ? (
                        <div className="mt-1 text-sm text-slate-500">
                          {plan.remark}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {plan.tier.name}{" "}
                      <span className="text-slate-400">({plan.tier.code})</span>
                    </td>
                    <td className="px-5 py-4 font-semibold tabular-nums">
                      {plan.durationDays} 天
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {plan.quotaMode === "UNLIMITED"
                        ? "无限"
                        : `${plan.quotaMode === "DAILY" ? "每日" : "总额"} ${formatMoney(plan.quotaAmountUsd)}`}
                    </td>
                    <td className="px-5 py-4">
                      <Badge active={plan.status === "ACTIVE"}>
                        {plan.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      订阅 {plan._count?.userSubscriptions ?? 0} · 兑换码{" "}
                      {plan._count?.redeemCodes ?? 0}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(plan);
                          setModalOpen(true);
                        }}
                        className={secondaryButton}
                      >
                        <Edit3 className="h-4 w-4" />
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {plans.length === 0 ? (
                  <tr>
                    <td
                      className="px-5 py-10 text-center text-sm text-slate-500"
                      colSpan={7}
                    >
                      暂无订阅套餐
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen ? (
        <PlanModal
          tiers={tiers}
          plan={editing}
          loading={createMutation.isPending || updateMutation.isPending}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSubmit={(values) => {
            setNotice("");
            if (editing) {
              updateMutation.mutate({ id: editing.id, values });
              return;
            }
            createMutation.mutate(values);
          }}
        />
      ) : null}
    </div>
  );
}

function PlanModal({
  tiers,
  plan,
  loading,
  onClose,
  onSubmit,
}: {
  tiers: AccessTier[];
  plan: SubscriptionPlan | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: UpsertSubscriptionPlanInput) => void;
}) {
  const [form, setForm] = useState<UpsertSubscriptionPlanInput>(blankForm);

  useEffect(() => {
    setForm(
      plan
        ? {
            code: plan.code,
            name: plan.name,
            status: plan.status,
            tierId: plan.tierId,
            durationDays: plan.durationDays,
            quotaMode: plan.quotaMode,
            quotaAmountUsd: plan.quotaAmountUsd,
            sortOrder: plan.sortOrder,
            remark: plan.remark ?? "",
          }
        : { ...blankForm, tierId: tiers[0]?.id ?? "" },
    );
  }, [plan, tiers]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      ...form,
      code: form.code.trim(),
      name: form.name.trim(),
      durationDays: Number(form.durationDays),
      quotaAmountUsd: form.quotaAmountUsd,
      sortOrder: Number(form.sortOrder),
      remark: form.remark?.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <h2 className="text-lg font-semibold text-slate-950">
            {plan ? "编辑订阅套餐" : "新建订阅套餐"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="套餐名称">
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
              />
            </Field>
            <Field label="套餐编码">
              <input
                className={inputClass}
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
                required
              />
            </Field>
            <Field label="访问等级">
              <select
                className={inputClass}
                value={form.tierId}
                onChange={(event) =>
                  setForm({ ...form, tierId: event.target.value })
                }
                required
              >
                <option value="">请选择访问等级</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({tier.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="有效天数">
              <input
                type="number"
                min={1}
                max={3650}
                className={inputClass}
                value={form.durationDays}
                onChange={(event) =>
                  setForm({ ...form, durationDays: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="额度模式">
              <select
                className={inputClass}
                value={form.quotaMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    quotaMode: event.target.value as UpsertSubscriptionPlanInput["quotaMode"],
                  })
                }
              >
                <option value="DAILY">DAILY</option>
                <option value="TOTAL">TOTAL</option>
                <option value="UNLIMITED">UNLIMITED</option>
              </select>
            </Field>
            <Field label="额度金额 USD">
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
                value={form.quotaAmountUsd}
                onChange={(event) =>
                  setForm({ ...form, quotaAmountUsd: event.target.value })
                }
              />
            </Field>
            <Field label="排序">
              <input
                type="number"
                min={1}
                max={10000}
                className={inputClass}
                value={form.sortOrder}
                onChange={(event) =>
                  setForm({ ...form, sortOrder: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="状态">
              <select
                className={inputClass}
                value={form.status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.target.value as SubscriptionPlan["status"],
                  })
                }
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DISABLED">DISABLED</option>
              </select>
            </Field>
          </div>
          <Field label="备注">
            <textarea
              className={textareaClass}
              value={form.remark ?? ""}
              onChange={(event) =>
                setForm({ ...form, remark: event.target.value })
              }
            />
          </Field>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={secondaryButton}>
              取消
            </button>
            <button type="submit" disabled={loading} className={primaryButton}>
              <Save className="h-4 w-4" />
              保存
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
function Badge({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}
    >
      {children}
    </span>
  );
}
function SkeletonRows() {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-md bg-slate-100"
        />
      ))}
    </div>
  );
}
function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function formatMoney(value: string) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  })}`;
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass =
  "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60";
const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
