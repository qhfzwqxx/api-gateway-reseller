"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AdminUser, AdjustUserBalanceInput } from "../../../../lib/api/users";

const balanceSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "请输入调整金额")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) !== 0, "金额必须为非零数字"),
  remark: z.string().trim().max(200, "备注不能超过 200 个字符").optional(),
});

type BalanceFormValues = z.infer<typeof balanceSchema>;

interface BalanceAdjustModalProps {
  open: boolean;
  user: AdminUser | null;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (values: AdjustUserBalanceInput) => void | Promise<void>;
}

export function BalanceAdjustModal({ open, user, loading = false, onClose, onSubmit }: BalanceAdjustModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<BalanceFormValues>({
    resolver: zodResolver(balanceSchema),
    defaultValues: {
      amount: "",
      remark: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({ amount: "", remark: "" });
    }
  }, [open, reset]);

  if (!open || !user) {
    return null;
  }

  const currentBalance = Number(user.wallet?.balance ?? 0);

  async function submit(values: BalanceFormValues) {
    const amount = Number(values.amount);
    if (currentBalance + amount < 0) {
      setError("amount", { message: "调整后余额不能小于 0" });
      return;
    }

    await onSubmit({
      amount: values.amount,
      remark: values.remark || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">调整余额</h2>
            <p className="text-sm text-slate-500">{user.email}</p>
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

        <form className="p-6" onSubmit={handleSubmit(submit)}>
          <div className="mb-5 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            当前余额：
            <span className="font-semibold tabular-nums">
              {formatBalance(currentBalance, user.wallet?.balanceCurrency)}
            </span>
          </div>

          <div className="grid gap-5">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">调整金额</span>
              <input
                inputMode="decimal"
                placeholder="正数充值，负数扣减"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                {...register("amount")}
              />
              {errors.amount ? <span className="text-sm text-red-600">{errors.amount.message}</span> : null}
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">备注</span>
              <textarea
                rows={4}
                placeholder="请输入本次调账原因"
                className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                {...register("remark")}
              />
              {errors.remark ? <span className="text-sm text-red-600">{errors.remark.message}</span> : null}
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "提交中" : "确认调整"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatBalance(
  value: number,
  currency?: NonNullable<AdminUser["wallet"]>["balanceCurrency"],
) {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(value);
  if (!currency || currency.symbol === "$") {
    return `$${formatted}`;
  }
  return `${formatted} ${currency.symbol || currency.name}`;
}
