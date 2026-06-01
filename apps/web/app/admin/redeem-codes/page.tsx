"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Edit3, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  createRedeemCodes,
  exportRedeemCodesCsv,
  getRedeemCodes,
  updateRedeemCode,
  type RedeemCode,
} from "../../../lib/api/operations";
import { getSubscriptionPlans } from "../../../lib/api/subscriptions";

const generateSchema = z
  .object({
    rewardType: z.enum(["BALANCE", "SUBSCRIPTION"]),
    amount: z.string().trim(),
    subscriptionPlanId: z.string().trim().optional(),
    count: z.coerce.number().int().min(1).max(100),
    maxRedemptions: z.coerce.number().int().min(1).max(1000),
    perUserLimit: z.coerce.number().int().min(1).max(1000),
    campaignName: z.string().trim().optional(),
    remark: z.string().trim().optional(),
  })
  .refine((value) => value.perUserLimit <= value.maxRedemptions, {
    message: "单用户限制不能大于最大兑换次数",
    path: ["perUserLimit"],
  })
  .refine(
    (value) => value.rewardType === "SUBSCRIPTION" || Number(value.amount) > 0,
    {
      message: "金额必须大于 0",
      path: ["amount"],
    },
  )
  .refine(
    (value) =>
      value.rewardType === "BALANCE" || Boolean(value.subscriptionPlanId),
    {
      message: "请选择订阅套餐",
      path: ["subscriptionPlanId"],
    },
  );
type GenerateInput = z.input<typeof generateSchema>;
type GenerateValues = z.output<typeof generateSchema>;

export default function AdminRedeemCodesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RedeemCode | null>(null);
  const [notice, setNotice] = useState("");
  const codesQuery = useQuery({
    queryKey: ["admin", "redeem-codes"],
    queryFn: getRedeemCodes,
  });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: RedeemCode["status"];
    }) => updateRedeemCode(id, { status }),
    onSuccess: () => {
      setEditing(null);
      setNotice("兑换码已更新");
      void queryClient.invalidateQueries({
        queryKey: ["admin", "redeem-codes"],
      });
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const exportMutation = useMutation({
    mutationFn: exportRedeemCodesCsv,
    onError: (error) => setNotice(errorToText(error)),
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Redeem Codes</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">
              兑换码
            </h2>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className={primaryButton}
            >
              <Plus className="h-4 w-4" />
              批量生成
            </button>
            <button
              type="button"
              onClick={() => exportMutation.mutate()}
              className={secondaryButton}
            >
              <Download className="h-4 w-4" />
              导出 CSV
            </button>
          </div>
        </div>
      </section>
      {notice ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {notice}
        </div>
      ) : null}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {codesQuery.isLoading ? (
          <SkeletonRows />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Prefix / 活动</th>
                  <th className="px-5 py-3">类型 / 内容</th>
                  <th className="px-5 py-3">状态</th>
                  <th className="px-5 py-3">兑换</th>
                  <th className="px-5 py-3">有效期</th>
                  <th className="px-5 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(codesQuery.data ?? []).map((code) => (
                  <tr key={code.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="font-mono font-semibold text-slate-950">
                        {code.codePrefix}...
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {code.campaignName ?? code.remark ?? "-"}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-semibold tabular-nums">
                      {code.rewardType === "SUBSCRIPTION"
                        ? `订阅：${code.subscriptionPlan?.name ?? "-"}`
                        : money(code.amount)}
                    </td>
                    <td className="px-5 py-4">
                      <Badge active={code.status === "ACTIVE"}>
                        {code.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {code.redeemedCount}/{code.maxRedemptions} · 单用户{" "}
                      {code.perUserLimit}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {code.expiresAt ? formatDate(code.expiresAt) : "永久"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(code)}
                        className={secondaryButton}
                      >
                        <Edit3 className="h-4 w-4" />
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <GenerateCodesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
      {editing ? (
        <EditModal
          code={editing}
          loading={updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(status) =>
            updateMutation.mutate({ id: editing.id, status })
          }
        />
      ) : null}
    </div>
  );
}

function GenerateCodesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [generated, setGenerated] = useState<RedeemCode[]>([]);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const plansQuery = useQuery({
    queryKey: ["admin", "subscription-plans"],
    queryFn: getSubscriptionPlans,
    enabled: open,
  });
  const form = useForm<GenerateInput, unknown, GenerateValues>({
    resolver: zodResolver(generateSchema),
    defaultValues: {
      rewardType: "BALANCE",
      amount: "10",
      subscriptionPlanId: "",
      count: 1,
      maxRedemptions: 1,
      perUserLimit: 1,
      campaignName: "",
      remark: "",
    },
  });
  const mutation = useMutation({
    mutationFn: createRedeemCodes,
    onSuccess: (codes) => {
      setGenerated(codes);
      void queryClient.invalidateQueries({
        queryKey: ["admin", "redeem-codes"],
      });
    },
  });
  useEffect(() => {
    if (open) {
      setGenerated([]);
      setCopiedCodeId(null);
      setCopiedAll(false);
      form.reset();
    }
  }, [form, open]);
  if (!open) return null;
  const rewardType = form.watch("rewardType");
  const activePlans = (plansQuery.data ?? []).filter(
    (plan) => plan.status === "ACTIVE",
  );

  async function copyOne(item: RedeemCode) {
    if (!item.code) return;
    await navigator.clipboard.writeText(item.code);
    setCopiedCodeId(item.id);
    window.setTimeout(() => setCopiedCodeId(null), 1200);
  }

  async function copyAll() {
    const codes = generated
      .map((item) => item.code)
      .filter(Boolean)
      .join("\n");
    if (!codes) return;
    await navigator.clipboard.writeText(codes);
    setCopiedAll(true);
    window.setTimeout(() => setCopiedAll(false), 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {generated.length ? "生成结果" : "批量生成兑换码"}
            </h2>
            {generated.length ? (
              <p className="mt-0.5 text-xs text-slate-500">
                余额和兑换码均永久有效，兑换次数用完即失效。
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {generated.length ? (
          <div className="p-6">
            <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 md:flex-row md:items-center md:justify-between">
              <span>明文兑换码仅在本次生成响应中返回，请立即复制保存。</span>
              <button
                type="button"
                onClick={copyAll}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-amber-100 px-3 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-200"
              >
                {copiedAll ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copiedAll ? "已复制全部" : "复制全部"}
              </button>
            </div>
            <div className="mt-4 max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-50/60">
              {generated.map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[2rem_1fr_2.5rem] items-center gap-3 border-b border-slate-200/80 bg-white px-4 py-3 last:border-0"
                >
                  <span className="text-xs font-semibold tabular-nums text-slate-400">
                    {index + 1}
                  </span>
                  <code className="break-all font-mono text-sm font-semibold text-slate-950">
                    {item.code}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyOne(item)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-700"
                    aria-label="复制兑换码"
                    title="复制兑换码"
                  >
                    {copiedCodeId === item.id ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <form
            className="grid gap-5 p-6"
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({
                ...values,
                amount: values.rewardType === "BALANCE" ? values.amount : "0",
                subscriptionPlanId:
                  values.rewardType === "SUBSCRIPTION"
                    ? values.subscriptionPlanId
                    : null,
                expiresAt: null,
                campaignName: values.campaignName || null,
              }),
            )}
          >
            <div className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => form.setValue("rewardType", "BALANCE")}
                className={`h-9 rounded-md transition-colors ${rewardType === "BALANCE" ? "bg-white text-blue-700 shadow-sm" : "hover:text-slate-950"}`}
              >
                余额码
              </button>
              <button
                type="button"
                onClick={() => form.setValue("rewardType", "SUBSCRIPTION")}
                className={`h-9 rounded-md transition-colors ${rewardType === "SUBSCRIPTION" ? "bg-white text-blue-700 shadow-sm" : "hover:text-slate-950"}`}
              >
                订阅码
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {rewardType === "BALANCE" ? (
                <Field label="金额">
                  <input className={inputClass} {...form.register("amount")} />
                </Field>
              ) : (
                <Field label="订阅套餐">
                  <select
                    className={inputClass}
                    {...form.register("subscriptionPlanId")}
                  >
                    <option value="">请选择套餐</option>
                    {activePlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {plan.durationDays} 天
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="生成数量（最多 100 个）">
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("count")}
                />
              </Field>
              <Field label="每个兑换码可兑换次数">
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("maxRedemptions")}
                />
              </Field>
              <Field label="同一用户最多兑换次数">
                <input
                  type="number"
                  className={inputClass}
                  {...form.register("perUserLimit")}
                />
              </Field>
            </div>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              余额码永久有效；订阅码会按套餐有效天数开通或顺延订阅。总兑换次数用完后，兑换码不可再使用。
            </p>
            <Field label="活动名">
              <input
                className={inputClass}
                {...form.register("campaignName")}
              />
            </Field>
            <Field label="备注">
              <textarea
                className={textareaClass}
                {...form.register("remark")}
              />
            </Field>
            {form.formState.errors.perUserLimit ? (
              <p className="-mt-3 text-sm font-medium text-rose-600">
                {form.formState.errors.perUserLimit.message}
              </p>
            ) : null}
            {form.formState.errors.amount ? (
              <p className="-mt-3 text-sm font-medium text-rose-600">
                {form.formState.errors.amount.message}
              </p>
            ) : null}
            {form.formState.errors.subscriptionPlanId ? (
              <p className="-mt-3 text-sm font-medium text-rose-600">
                {form.formState.errors.subscriptionPlanId.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={mutation.isPending}
              className={primaryButton}
            >
              {mutation.isPending ? "生成中" : "生成兑换码"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function EditModal({
  code,
  loading,
  onClose,
  onSubmit,
}: {
  code: RedeemCode;
  loading: boolean;
  onClose: () => void;
  onSubmit: (status: RedeemCode["status"]) => void;
}) {
  const [status, setStatus] = useState(code.status);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">编辑兑换码</h3>
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as RedeemCode["status"])
          }
          className={`mt-5 ${inputClass}`}
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="DISABLED">DISABLED</option>
        </select>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className={secondaryButton}>
            取消
          </button>
          <button
            disabled={loading}
            onClick={() => onSubmit(status)}
            className={primaryButton}
          >
            保存
          </button>
        </div>
      </div>
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
function money(value: string) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass =
  "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60";
const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
