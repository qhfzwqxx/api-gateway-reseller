"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Coins,
  Gem,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  WalletCards,
  Zap,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createBalanceCurrency,
  getBalanceCurrencySettings,
  setBalanceCurrencyAccessTiers,
  setBalanceCurrencyEnabled,
  setBalanceCurrencyOrder,
  type BalanceCurrency,
  type BalanceCurrencySettings,
} from "../../../lib/api/balance-currencies";
import { getAccessTiers } from "../../../lib/api/routing";

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
  const [orderedCodes, setOrderedCodes] = useState<string[]>([]);
  const [draggedCode, setDraggedCode] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["admin", "balance-currencies"],
    queryFn: getBalanceCurrencySettings,
  });
  const tiersQuery = useQuery({
    queryKey: ["admin", "access-tiers"],
    queryFn: getAccessTiers,
  });

  const settings = settingsQuery.data;
  const baseCurrency = useMemo(
    () => settings?.currencies.find((currency) => currency.isBase) ?? null,
    [settings],
  );
  const nonBaseCurrencies = useMemo(
    () => settings?.currencies.filter((currency) => !currency.isBase) ?? [],
    [settings],
  );

  useEffect(() => {
    setOrderedCodes(nonBaseCurrencies.map((currency) => currency.code));
  }, [nonBaseCurrencies]);

  function updateSettings(data: BalanceCurrencySettings) {
    queryClient.setQueryData(["admin", "balance-currencies"], data);
  }

  const createMutation = useMutation({
    mutationFn: createBalanceCurrency,
    onSuccess: (result) => {
      updateSettings(result);
      setForm(initialForm);
      setNotice(`余额货币“${result.currency.name}”已创建，默认停用且未绑定访问等级`);
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const enabledMutation = useMutation({
    mutationFn: ({ code, enabled }: { code: string; enabled: boolean }) =>
      setBalanceCurrencyEnabled(code, enabled),
    onSuccess: (result) => {
      updateSettings(result);
      setNotice(
        result.currency.enabled
          ? `余额货币“${result.currency.name}”已启用，不会迁移任何钱包余额`
          : `余额货币“${result.currency.name}”已停用，历史余额仍保留`,
      );
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const orderMutation = useMutation({
    mutationFn: setBalanceCurrencyOrder,
    onSuccess: (result) => {
      updateSettings(result);
      setNotice("管理员默认扣款顺序已保存");
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const accessTierMutation = useMutation({
    mutationFn: ({ code, accessTierIds }: { code: string; accessTierIds: string[] }) =>
      setBalanceCurrencyAccessTiers(code, accessTierIds),
    onSuccess: (result) => {
      updateSettings(result);
      setNotice("货币可用访问等级已保存");
    },
    onError: (error) => setNotice(errorToText(error)),
  });

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

  function moveCurrency(code: string, offset: -1 | 1) {
    setOrderedCodes((current) => {
      const index = current.indexOf(code);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  }

  function dropCurrency(targetCode: string) {
    if (!draggedCode || draggedCode === targetCode) return;
    setOrderedCodes((current) => {
      const next = current.filter((code) => code !== draggedCode);
      next.splice(next.indexOf(targetCode), 0, draggedCode);
      return next;
    });
    setDraggedCode(null);
  }

  const orderChanged =
    orderedCodes.join("|") !== nonBaseCurrencies.map((currency) => currency.code).join("|");

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Multi-currency Wallet</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">余额货币设置</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              启用货币只改变可用状态，不迁移余额。每种货币独立记账，并通过严格白名单绑定允许扣款的访问等级。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void Promise.all([settingsQuery.refetch(), tiersQuery.refetch()])}
            disabled={settingsQuery.isFetching || tiersQuery.isFetching}
            className={secondaryButton}
          >
            <RefreshCw className={`h-4 w-4 ${settingsQuery.isFetching ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </section>

      {notice ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="基准货币"
          value={baseCurrency ? `${baseCurrency.name} (${baseCurrency.code})` : "未配置"}
          description="仅用于内部计价，不能创建用户钱包"
          icon={CircleDollarSign}
          tone="slate"
        />
        <SummaryCard
          title="已启用余额货币"
          value={String(nonBaseCurrencies.filter((currency) => currency.enabled).length)}
          description={`共 ${nonBaseCurrencies.length} 种非基准货币`}
          icon={Zap}
          tone="blue"
        />
        <SummaryCard
          title="钱包记录"
          value={String(nonBaseCurrencies.reduce((sum, currency) => sum + currency.walletCount, 0))}
          description="按用户与币种分别保存"
          icon={WalletCards}
          tone="slate"
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="border-b border-slate-200 pb-4">
          <h3 className="text-lg font-semibold text-slate-950">新增余额货币</h3>
          <p className="mt-1 text-sm text-slate-500">新货币默认停用，不绑定等级，也不会创建用户钱包。</p>
        </div>
        <form className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={submitCreate}>
          <Field label="货币代码" hint="大写字母、数字或下划线">
            <input className={inputClass} value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="BONUS" required />
          </Field>
          <Field label="显示名称">
            <input className={inputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="赠送积分" required />
          </Field>
          <Field label="单位符号">
            <input className={inputClass} value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} placeholder="积分" required />
          </Field>
          <Field label="1 基准单位可兑换">
            <input className={inputClass} inputMode="decimal" value={form.unitsPerBase} onChange={(event) => setForm((current) => ({ ...current, unitsPerBase: event.target.value }))} required />
          </Field>
          <Field label="图标">
            <select className={inputClass} value={form.icon} onChange={(event) => setForm((current) => ({ ...current, icon: event.target.value }))}>
              {currencyIcons.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <div className="md:col-span-2 xl:col-span-5">
            <button className={primaryButton} disabled={createMutation.isPending} type="submit">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              创建货币
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">管理员默认扣款顺序</h3>
            <p className="mt-1 text-sm text-slate-500">用户未保存个人顺序时使用；可拖拽或使用上下按钮。</p>
          </div>
          <button className={secondaryButton} disabled={!orderChanged || orderMutation.isPending} onClick={() => orderMutation.mutate(orderedCodes)} type="button">
            {orderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存顺序
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {orderedCodes.map((code, index) => {
            const currency = nonBaseCurrencies.find((item) => item.code === code);
            if (!currency) return null;
            return (
              <div
                className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 ${draggedCode === code ? "border-blue-400 bg-blue-50 opacity-70" : "border-slate-200 bg-slate-50"}`}
                draggable
                key={code}
                onDragEnd={() => setDraggedCode(null)}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggedCode(code)}
                onDrop={() => dropCurrency(code)}
              >
                <GripVertical className="h-4 w-4 text-slate-400" />
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-slate-950">{currency.name}</strong>
                  <span className="text-xs text-slate-500">{currency.code} · {currency.enabled ? "已启用" : "已停用"}</span>
                </div>
                <button aria-label={`上移 ${currency.name}`} className={iconButton} disabled={index === 0} onClick={() => moveCurrency(code, -1)} type="button"><ChevronUp className="h-4 w-4" /></button>
                <button aria-label={`下移 ${currency.name}`} className={iconButton} disabled={index === orderedCodes.length - 1} onClick={() => moveCurrency(code, 1)} type="button"><ChevronDown className="h-4 w-4" /></button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">货币与访问等级</h3>
          <p className="mt-1 text-sm text-slate-500">未绑定任何等级的货币不能用于 API 扣款。</p>
        </div>
        {settingsQuery.isLoading || tiersQuery.isLoading ? (
          <LoadingState />
        ) : settingsQuery.isError || tiersQuery.isError ? (
          <ErrorState message={errorToText(settingsQuery.error ?? tiersQuery.error)} onRetry={() => void Promise.all([settingsQuery.refetch(), tiersQuery.refetch()])} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {settings?.currencies.map((currency) => (
              <CurrencyCard
                key={currency.code}
                currency={currency}
                tiers={tiersQuery.data ?? []}
                enabledPending={enabledMutation.isPending}
                accessTierPending={accessTierMutation.isPending}
                onEnabledChange={(enabled) => enabledMutation.mutate({ code: currency.code, enabled })}
                onAccessTiersSave={(accessTierIds) => accessTierMutation.mutate({ code: currency.code, accessTierIds })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CurrencyCard({
  currency,
  tiers,
  enabledPending,
  accessTierPending,
  onEnabledChange,
  onAccessTiersSave,
}: {
  currency: BalanceCurrency;
  tiers: Array<{ id: string; code: string; name: string; status: string }>;
  enabledPending: boolean;
  accessTierPending: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onAccessTiersSave: (tierIds: string[]) => void;
}) {
  const [selectedTierIds, setSelectedTierIds] = useState(
    currency.accessTiers.map((tier) => tier.id),
  );
  useEffect(() => {
    setSelectedTierIds(currency.accessTiers.map((tier) => tier.id));
  }, [currency.accessTiers]);
  const Icon = currencyIcon(currency.icon);
  const tierChanged =
    selectedTierIds.slice().sort().join("|") !==
    currency.accessTiers.map((tier) => tier.id).sort().join("|");

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${currency.enabled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-slate-950">{currency.name}</h4>
            <Badge tone={currency.enabled ? "blue" : "slate"}>{currency.enabled ? "已启用" : "已停用"}</Badge>
            {currency.isBase ? <Badge tone="slate">基准货币</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">{currency.code} · 1 基准单位 = {formatRate(currency.unitsPerBase)} {currency.symbol}</p>
        </div>
        {!currency.isBase ? (
          <button className={currency.enabled ? dangerButton : primaryButton} disabled={enabledPending} onClick={() => onEnabledChange(!currency.enabled)} type="button">
            {currency.enabled ? "停用" : "启用"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-4">
        <Stat label="钱包数" value={String(currency.walletCount)} />
        <Stat label="余额" value={`${formatRate(currency.balance)} ${currency.symbol}`} />
        <Stat label="冻结" value={`${formatRate(currency.reservedBalance)} ${currency.symbol}`} />
        <Stat label="基准价值" value={`$${formatRate(currency.balanceBase)}`} />
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h5 className="text-sm font-semibold text-slate-900">允许扣款的访问等级</h5>
            <p className="mt-1 text-xs text-slate-500">严格白名单；未勾选的等级不能使用该货币。</p>
          </div>
          {!currency.isBase ? (
            <button className={secondaryButton} disabled={!tierChanged || accessTierPending} onClick={() => onAccessTiersSave(selectedTierIds)} type="button">
              <Save className="h-4 w-4" /> 保存绑定
            </button>
          ) : null}
        </div>
        {currency.isBase ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">基准货币不能绑定访问等级。</div>
        ) : tiers.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {tiers.map((tier) => (
              <label className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm text-slate-700" key={tier.id}>
                <input
                  checked={selectedTierIds.includes(tier.id)}
                  onChange={(event) => setSelectedTierIds((current) => event.target.checked ? [...current, tier.id] : current.filter((id) => id !== tier.id))}
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate">{tier.name}</span>
                <span className="text-xs text-slate-400">{tier.code}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">暂无访问等级。</p>
        )}
      </div>
    </article>
  );
}

function SummaryCard({ title, value, description, icon: Icon, tone }: { title: string; value: string; description: string; icon: typeof Zap; tone: "blue" | "slate" }) {
  return <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-4"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-100 text-slate-700"}`}><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="text-sm font-medium text-slate-500">{title}</p><p className="mt-1 truncate text-lg font-semibold text-slate-950">{value}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div></div></article>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="space-y-2"><span className="block text-sm font-medium text-slate-700">{label}</span>{children}{hint ? <span className="block text-xs leading-5 text-slate-500">{hint}</span> : null}</label>;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "slate" }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone === "blue" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`}>{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-xs text-slate-500">{label}</span><strong className="mt-1 block truncate text-slate-900">{value}</strong></div>;
}

function LoadingState() {
  return <div className="flex min-h-32 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取货币设置</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{message}</p><button type="button" onClick={onRetry} className="mt-3 font-semibold underline underline-offset-4">重新加载</button></div>;
}

function currencyIcon(icon: string) {
  return currencyIcons.find((option) => option.value === icon)?.icon ?? CircleDollarSign;
}

function formatRate(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8 }).format(parsed) : value;
}

function errorToText(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> } | undefined;
    if (data?.issues?.length) return data.issues.map((issue) => issue.path?.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message).filter(Boolean).join("；");
    return data?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

const inputClass = "h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton = "inline-flex min-h-10 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60";
const iconButton = "inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40";
