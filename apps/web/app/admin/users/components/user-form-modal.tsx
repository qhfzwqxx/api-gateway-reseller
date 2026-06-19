"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AdminUser, UpsertAdminUserInput } from "../../../../lib/api/users";
import type { AccessTierSummary } from "../../../../lib/api/routing";

const userFormSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱"),
  role: z.enum(["USER", "ADMIN"]),
  status: z.enum(["ACTIVE", "DISABLED", "SUSPENDED", "TRIAL", "RISK_REVIEW"]),
  rateLimitPerMinute: z.coerce.number().int("必须是整数").min(0, "不能小于 0"),
  concurrencyLimit: z.coerce.number().int("必须是整数").min(0, "不能小于 0"),
  displayGroup: z.string().trim().min(1, "请填写用户分组").max(32, "不能超过 32 个字符"),
  tierId: z.string().trim().optional(),
  initialBalance: z.string().trim().optional(),
  allowedModelsText: z.string().trim().optional(),
  charityEnabled: z.boolean(),
  charityDisplayName: z.string().trim().optional(),
  charityKey: z.string().trim().optional(),
  charityIpRateLimitEnabled: z.boolean(),
  charityIpRateLimitPerMinute: z.coerce.number().int("必须是整数").min(0, "不能小于 0").max(10000, "不能超过 10000"),
});

type UserFormInput = z.input<typeof userFormSchema>;
type UserFormValues = z.output<typeof userFormSchema>;

interface UserFormModalProps {
  open: boolean;
  user?: AdminUser | null;
  loading?: boolean;
  tiers?: AccessTierSummary[];
  onClose: () => void;
  onSubmit: (values: UpsertAdminUserInput) => void | Promise<void>;
}

export function UserFormModal({ open, user, loading = false, tiers = [], onClose, onSubmit }: UserFormModalProps) {
  const isEdit = Boolean(user);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UserFormInput, unknown, UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: getDefaultValues(user),
  });

  useEffect(() => {
    if (open) {
      reset(getDefaultValues(user));
    }
  }, [open, reset, user]);

  if (!open) {
    return null;
  }

  async function submit(values: UserFormValues) {
    await onSubmit({
      email: values.email,
      role: values.role,
      status: values.status,
      rateLimitPerMinute: values.rateLimitPerMinute,
      concurrencyLimit: values.concurrencyLimit,
      displayGroup: values.displayGroup,
      tierId: values.tierId || null,
      initialBalance: !isEdit && values.initialBalance ? values.initialBalance : undefined,
      allowedModels: splitModelList(values.allowedModelsText),
      charityEnabled: values.charityEnabled,
      charityDisplayName: values.charityDisplayName || null,
      charityKey: values.charityKey || null,
      charityIpRateLimitEnabled: values.charityEnabled && values.charityIpRateLimitEnabled,
      charityIpRateLimitPerMinute: values.charityIpRateLimitPerMinute,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{isEdit ? "编辑用户" : "新建用户"}</h2>
            <p className="text-sm text-slate-500">{isEdit ? "更新账号权限与运行限制" : "创建新用户并可初始化钱包余额"}</p>
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

        <form className="flex-1 overflow-y-auto p-6" onSubmit={handleSubmit(submit)}>
          <div className="grid gap-5">
            <Field label="邮箱" error={errors.email?.message}>
              <input className={inputClass} placeholder="user@example.com" {...register("email")} />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="角色" error={errors.role?.message}>
                <select className={inputClass} {...register("role")}>
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </Field>

              <Field label="状态" error={errors.status?.message}>
                <select className={inputClass} {...register("status")}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="TRIAL">TRIAL</option>
                  <option value="RISK_REVIEW">RISK_REVIEW</option>
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="每分钟限额" error={errors.rateLimitPerMinute?.message} hint="0 表示不限制">
                <input type="number" min={0} className={inputClass} {...register("rateLimitPerMinute")} />
              </Field>

              <Field label="并发限制" error={errors.concurrencyLimit?.message} hint="0 表示不限制">
                <input type="number" min={0} className={inputClass} {...register("concurrencyLimit")} />
              </Field>
            </div>

            <Field
              label="用户分组"
              error={errors.displayGroup?.message}
              hint="仅用于用户管理页面展示和批量管理，不参与访问等级、路由或计费。"
            >
              <input className={inputClass} placeholder="普通用户组" {...register("displayGroup")} />
            </Field>

            <Field
              label="访问等级"
              error={errors.tierId?.message}
              hint="用户等级会参与路由匹配；Key 也可以单独设置等级。"
            >
              <select className={inputClass} {...register("tierId")}>
                <option value="">默认 standard</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({tier.code})
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="模型白名单"
              error={errors.allowedModelsText?.message}
              hint="留空表示不限模型；每行或逗号分隔一个模型。"
            >
              <textarea
                rows={5}
                className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder={"gpt-4o\ngpt-4.1-mini"}
                {...register("allowedModelsText")}
              />
            </Field>

            {!isEdit ? (
              <Field label="初始化余额" error={errors.initialBalance?.message} hint="可选，不填则不传">
                <input inputMode="decimal" className={inputClass} placeholder="0.00000000" {...register("initialBalance")} />
              </Field>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-950">公益账号</h3>
                <p className="mt-1 text-xs text-slate-500">开启后会进入公益公开统计，公开 Key 会显示在公益页。</p>
              </div>
              <div className="grid gap-4">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register("charityEnabled")} />
                  纳入公益公开统计
                </label>
                <Field label="公益展示名称" error={errors.charityDisplayName?.message}>
                  <input className={inputClass} placeholder="APIshare Free" {...register("charityDisplayName")} />
                </Field>
                <Field label="公开页 API Key" error={errors.charityKey?.message}>
                  <input className={inputClass} placeholder="sk_live_..." {...register("charityKey")} />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register("charityIpRateLimitEnabled")} />
                    启用单 IP 限流
                  </label>
                  <Field label="单 IP 每分钟限制" error={errors.charityIpRateLimitPerMinute?.message} hint="0 表示不限制，最大 10000">
                    <input type="number" min={0} max={10000} className={inputClass} {...register("charityIpRateLimitPerMinute")} />
                  </Field>
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 mt-8 flex justify-end gap-3 border-t border-slate-200 bg-white pt-5">
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
              {loading ? "保存中" : "保存"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function getDefaultValues(user?: AdminUser | null): UserFormValues {
  return {
    email: user?.email ?? "",
    role: user?.role ?? "USER",
    status: user?.status ?? "ACTIVE",
    rateLimitPerMinute: user?.rateLimitPerMinute ?? 0,
    concurrencyLimit: user?.concurrencyLimit ?? 0,
    displayGroup: user?.displayGroup ?? defaultDisplayGroup(user),
    tierId: user?.tierId ?? "",
    initialBalance: "",
    allowedModelsText: (user?.allowedModels ?? []).join("\n"),
    charityEnabled: user?.charityEnabled ?? false,
    charityDisplayName: user?.charityDisplayName ?? "",
    charityKey: user?.charityKey ?? "",
    charityIpRateLimitEnabled: user?.charityIpRateLimitEnabled ?? false,
    charityIpRateLimitPerMinute: user?.charityIpRateLimitPerMinute ?? 0,
  };
}

function defaultDisplayGroup(user?: AdminUser | null) {
  if (!user) return "普通用户组";
  if (user.role === "ADMIN") return "管理员组";
  if (user.charityEnabled) return "公益组";
  if (user.status === "RISK_REVIEW") return "风控组";
  if (user.status === "DISABLED" || user.status === "SUSPENDED") return "受限组";
  return "普通用户组";
}

function splitModelList(value?: string) {
  return Array.from(
    new Set(
      (value ?? "")
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
