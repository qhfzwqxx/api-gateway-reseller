"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Gem,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import {
  activateBalanceCurrency,
  createBalanceCurrency,
  getBalanceCurrencySettings,
  type BalanceCurrency,
} from "../../../lib/api/balance-currencies";

const currencyIcons = [
  { value: "zap", label: "闪电", icon: Zap },
  { value: "coins", label: "硬币", icon: Coins },
  { value: "sparkles", label: "闪光", icon: Sparkles },
  { value: "star", label: "星星", icon: Star },
  { value: "gem", label: "宝石", icon: Gem },
] as const;

const initialForm = {
  code: "",
  name: "",
  symbol: "",
  icon: "zap",
  unitsPerBase: "1",
};

export default function AdminBalanceCurrenciesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [notice, setNotice] = useState("");
  const [activateTarget, setActivateTarget] = useState<BalanceCurrency | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["admin", "balance-currencies"],
    queryFn: getBalanceCurrencySettings,
  });

  const createMutation = useMutation({
    mutationFn: createBalanceCurrency,
    onSuccess: (result) => {
      queryClient.setQueryData(["admin", "balance-currencies"], result);
      setForm(initialForm);
      setNotice(`余额货币“${result.currency.name}”已创建`);
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const activateMutation = useMutation({
    mutationFn: activateBalanceCurrency,
    onSuccess: (result) => {
      queryClient.setQueryData(["admin", "balance-currencies"], result);
      setActivateTarget(null);
      setNotice(
        `已启用“${result.target.name}”，迁移 ${result.convertedWallets}/${result.totalWallets} 个钱包`,
      );
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const settings = settingsQuery.data;
  const baseCurrency = useMemo(
    () => settings?.currencies.find((currency) => currency.isBase) ?? null,
    [settings],
  );

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    createMutation.mutate({
      ...form,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      symbol: form.symbol.trim(),
      unitsPerBase: form.unitsPerBase.trim(),
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Balance Currency</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">余额货币设置</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              基准货币只作为内部计价量纲，不直接作为用户余额。其他货币按相对基准货币的比例显示和结算。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void settingsQuery.refetch()}
            disabled={settingsQuery.isFetching}
            className={secondaryButton}
          >
            <RefreshCw
              className={`h-4 w-4 ${settingsQuery.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            刷新
          </button>
        </div>

        {notice ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
          >
            {notice}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <SummaryCard
          title="基准货币"
          value={baseCurrency ? `${baseCurrency.name} (${baseCurrency.code})` : "未配置"}
          description="固定计价单位，不会迁移到用户钱包。"
          icon={CircleDollarSign}
          tone="slate"
        />
        <SummaryCard
          title="当前余额货币"
          value={
            settings?.activeCurrency
              ? `${settings.activeCurrency.name} (${settings.activeCurrency.code})`
              : "未配置"
          }
          description={
            settings?.activeCurrency
              ? `1 基准单位 = ${formatRate(settings.activeCurrency.unitsPerBase)} ${settings.activeCurrency.symbol}`
              : "用户钱包尚未绑定可用货币。"
          }
          icon={Zap}
          tone="blue"
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950">货币列表</h3>
          <p className="mt-1 text-sm text-slate-500">
            启用新货币时会按汇率迁移全部用户余额；存在进行中的余额冻结请求时系统会拒绝切换。
          </p>
        </div>

        {settingsQuery.isLoading ? (
          <LoadingState />
        ) : settingsQuery.isError ? (
          <ErrorState
            message={errorToText(settingsQuery.error)}
            onRetry={() => void settingsQuery.refetch()}
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {(settings?.currencies ?? []).map((currency) => {
              const isActive = currency.code === settings?.activeCurrencyCode;
              const Icon = currencyIcon(currency.icon);
              return (
                <article
                  key={currency.code}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
                          isActive
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-slate-950">{currency.name}</h4>
                          <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                            {currency.code}
                          </span>
                          {currency.isBase ? <Badge tone="slate">基准</Badge> : null}
                          {isActive ? <Badge tone="blue">当前启用</Badge> : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          符号：{currency.symbol} · 1 基准单位 = {formatRate(currency.unitsPerBase)} {currency.symbol}
                        </p>
                      </div>
                    </div>

                    {!currency.isBase && !isActive ? (
                      <button
                        type="button"
                        onClick={() => setActivateTarget(currency)}
                        className={primaryButton}
                      >
                        启用
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <div className="flex h-10 items-center gap-2 px-2 text-sm font-medium text-slate-500">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        {currency.isBase ? "固定计价" : "使用中"}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-slate-950">创建余额货币</h3>
          <p className="mt-1 text-sm text-slate-500">
            创建只会增加货币定义，不会立即改变用户余额；需要再点击“启用”完成迁移。
          </p>
        </div>

        <form onSubmit={submitCreate} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="货币代码" hint="大写字母、数字或下划线，例如 POINTS">
            <input
              required
              minLength={2}
              maxLength={32}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              className={inputClass}
              placeholder="POINTS"
            />
          </Field>
          <Field label="显示名称">
            <input
              required
              maxLength={80}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={inputClass}
              placeholder="积分"
            />
          </Field>
          <Field label="显示符号">
            <input
              required
              maxLength={20}
              value={form.symbol}
              onChange={(event) => setForm({ ...form, symbol: event.target.value })}
              className={inputClass}
              placeholder="积分"
            />
          </Field>
          <Field label="图标">
            <select
              value={form.icon}
              onChange={(event) => setForm({ ...form, icon: event.target.value })}
              className={inputClass}
            >
              {currencyIcons.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="兑换比例" hint="填写 1 个基准单位等于多少新货币">
            <input
              required
              inputMode="decimal"
              value={form.unitsPerBase}
              onChange={(event) => setForm({ ...form, unitsPerBase: event.target.value })}
              className={inputClass}
              placeholder="1"
            />
          </Field>

          <div className="md:col-span-2 xl:col-span-5">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className={primaryButton}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              创建货币
            </button>
          </div>
        </form>
      </section>

      <ConfirmDialog
        open={Boolean(activateTarget)}
        title={`启用${activateTarget?.name ?? "余额货币"}`}
        description={
          activateTarget && baseCurrency
            ? `系统将按“1 ${baseCurrency.symbol} = ${formatRate(activateTarget.unitsPerBase)} ${activateTarget.symbol}”迁移全部用户的可用余额和冻结余额。迁移期间如果存在进行中的扣费冻结，请稍后重试。`
            : "系统将按配置比例迁移全部用户钱包。"
        }
        confirmText="确认迁移并启用"
        requireInputText={activateTarget?.code}
        loading={activateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setActivateTarget(null);
        }}
        onConfirm={() => {
          if (activateTarget) activateMutation.mutate(activateTarget.code);
        }}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Zap;
  tone: "blue" | "slate";
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
            tone === "blue"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-slate-200 bg-slate-100 text-slate-700"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
    </article>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "slate" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        tone === "blue" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"
      }`}
    >
      {children}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-32 items-center justify-center text-sm text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      正在读取货币设置
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 font-semibold underline underline-offset-4">
        重新加载
      </button>
    </div>
  );
}

function currencyIcon(icon: string) {
  return currencyIcons.find((option) => option.value === icon)?.icon ?? CircleDollarSign;
}

function formatRate(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8 }).format(parsed)
    : value;
}

function errorToText(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> }
      | undefined;
    if (data?.issues?.length) {
      return data.issues
        .map((issue) => (issue.path?.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
        .filter(Boolean)
        .join("；");
    }
    return data?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

const inputClass =
  "h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
