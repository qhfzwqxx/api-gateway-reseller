"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import {
  createModelPrice,
  deleteModelPrice,
  getModelPrices,
  getUpstreamProviders,
  updateModelPrice,
  updateUnifiedPrices,
  type ModelPrice,
  type ModelPriceInput,
  type UnifiedPriceSetting,
} from "../../../lib/api/supply-chain";
import { UnifiedPriceModal } from "./components/unified-price-modal";

const priceSchema = z.object({
  model: z.string().trim().min(1, "请输入模型名").max(120),
  upstreamProvider: z.string().trim().min(1, "请选择 Provider").max(80),
  upstreamEndpoint: z.enum(["responses", "chat_completions"]).default("responses"),
  currency: z.string().trim().min(1).default("USD"),
  upstreamInputPer1MTok: z.string().trim().min(1),
  upstreamOutputPer1MTok: z.string().trim().min(1),
  upstreamCachedInputPer1MTok: z.string().trim().default("0"),
  upstreamPriceMultiplier: z.string().trim().default("1"),
  customerInputPer1MTok: z.string().trim().min(1),
  customerOutputPer1MTok: z.string().trim().min(1),
  customerCachedInputPer1MTok: z.string().trim().default("0"),
  customerPriceMultiplier: z.string().trim().default("1"),
  minimumChargeUsd: z.string().trim().default("0"),
  enabled: z.boolean(),
  priceVersion: z.string().trim().min(1).default("v1"),
});

type PriceFormInput = z.input<typeof priceSchema>;
type PriceValues = z.output<typeof priceSchema>;

export default function AdminModelPricesPage() {
  const queryClient = useQueryClient();
  const [modelFilter, setModelFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [editingPrice, setEditingPrice] = useState<ModelPrice | null | undefined>(undefined);
  const [deletingPrice, setDeletingPrice] = useState<ModelPrice | null>(null);
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const pricesQuery = useQuery({ queryKey: ["admin", "model-prices"], queryFn: getModelPrices });
  const providersQuery = useQuery({ queryKey: ["admin", "upstream-providers"], queryFn: getUpstreamProviders });

  const prices = pricesQuery.data?.modelPrices ?? [];
  const unifiedSettings = pricesQuery.data?.unifiedPriceSettings ?? [];
  const providers = providersQuery.data ?? [];
  const visiblePrices = prices.filter((price) =>
    price.model.toLowerCase().includes(modelFilter.toLowerCase()) &&
    price.upstreamProvider.toLowerCase().includes(providerFilter.toLowerCase()),
  );
  const groupedPrices = useMemo(
    () => buildPriceGroups(visiblePrices, unifiedSettings),
    [visiblePrices, unifiedSettings],
  );

  const refreshPrices = () => void queryClient.invalidateQueries({ queryKey: ["admin", "model-prices"] });

  const saveMutation = useMutation({
    mutationFn: (values: PriceValues) => editingPrice ? updateModelPrice(editingPrice.id, values) : createModelPrice(values),
    onSuccess: () => {
      setEditingPrice(undefined);
      setNotice("模型价格已保存");
      refreshPrices();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteModelPrice,
    onSuccess: () => {
      setDeletingPrice(null);
      setNotice("模型价格已删除");
      refreshPrices();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  const unifiedBatchMutation = useMutation({
    mutationFn: updateUnifiedPrices,
    onSuccess: (result) => {
      setUnifiedOpen(false);
      setNotice(`统一价格模式已保存，更新 ${result.models} 个模型`);
      refreshPrices();
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Model Pricing</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">模型价格</h2>
            <p className="mt-2 text-sm text-slate-500">按模型分组管理各渠道上游成本、客户售价与统一价格模式。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditingPrice(null)} className={primaryButton}><Plus className="h-4 w-4" /> 新增价格配置</button>
            <button type="button" onClick={() => setUnifiedOpen(true)} className={secondaryButton}>统一价格模式</button>
          </div>
        </div>
      </section>

      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="按模型过滤"><input value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} className={inputClass} placeholder="gpt-4.1-mini" /></Field>
          <Field label="按 Provider 过滤"><input value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className={inputClass} placeholder="openai" /></Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {pricesQuery.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-md bg-slate-100" />)}</div>
        ) : pricesQuery.isError ? (
          <div className="p-5 text-sm font-medium text-red-600">模型价格加载失败。</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1180px] divide-y divide-slate-200">
              {groupedPrices.map((group) => (
                <section key={group.model}>
                  <div className="flex items-center justify-between bg-slate-50 px-5 py-3">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-slate-950">{group.model}</h3>
                        <Badge active={Boolean(group.setting?.enabled)}>{group.setting?.enabled ? "统一模式" : "普通模式"}</Badge>
                        {group.hasDifferentOriginalCustomerPricing ? <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">渠道原价有差异</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {group.prices.length} 条渠道价格 · {group.prices.filter((price) => price.enabled).length} 条启用
                      </p>
                    </div>
                    <button type="button" onClick={() => setUnifiedOpen(true)} className={secondaryButton}>管理统一模式</button>
                  </div>
                  <table className="w-full text-left">
                    <thead className="bg-white text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3">渠道</th>
                        <th className="px-5 py-3">上游成本</th>
                        <th className="px-5 py-3">客户售价</th>
                        <th className="px-5 py-3">生效客户价</th>
                        <th className="px-5 py-3">倍率 / 最低收费</th>
                        <th className="px-5 py-3">状态</th>
                        <th className="px-5 py-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.prices.map((price) => (
                        <tr key={price.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4"><div className="font-semibold text-slate-950">{price.upstreamProvider}</div><div className="mt-1 text-xs text-slate-500">{endpointLabel(price.upstreamEndpoint)} · {price.currency} · {price.priceVersion}</div></td>
                          <td className="px-5 py-4 text-sm tabular-nums text-slate-700"><div>Input：{money(price.upstreamInputPer1MTok)}</div><div className="mt-1">Output：{money(price.upstreamOutputPer1MTok)}</div></td>
                          <td className="px-5 py-4 text-sm tabular-nums text-slate-700"><div>Input：{money(price.customerInputPer1MTok)}</div><div className="mt-1">Output：{money(price.customerOutputPer1MTok)}</div></td>
                          <td className="px-5 py-4 text-sm font-semibold tabular-nums text-slate-950"><div>Input：{money(effectiveCustomerInput(price, group.setting))}</div><div className="mt-1">Output：{money(effectiveCustomerOutput(price, group.setting))}</div></td>
                          <td className="px-5 py-4 text-sm text-slate-700"><div>上游：{price.upstreamPriceMultiplier}</div><div className="mt-1">客户：{group.setting?.enabled ? group.setting.customerPriceMultiplier : price.customerPriceMultiplier}</div><div className="mt-1">最低：{money(price.minimumChargeUsd)}</div></td>
                          <td className="px-5 py-4"><Badge active={price.enabled}>{price.enabled ? "ENABLED" : "DISABLED"}</Badge></td>
                          <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingPrice(price)} className={secondaryButton}><Edit3 className="h-4 w-4" /> 编辑</button><button type="button" onClick={() => setDeletingPrice(price)} className={dangerButton}><Trash2 className="h-4 w-4" /> 删除</button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
              {groupedPrices.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">暂无模型价格</div> : null}
            </div>
          </div>
        )}
      </section>

      <PriceModal
        enabledUnifiedModels={unifiedSettings
          .filter((setting) => setting.enabled)
          .map((setting) => setting.model)}
        open={editingPrice !== undefined}
        price={editingPrice ?? null}
        providers={providers.map((provider) => provider.name)}
        loading={saveMutation.isPending}
        onClose={() => setEditingPrice(undefined)}
        onSubmit={(values) => saveMutation.mutateAsync(values)}
      />
      <UnifiedPriceModal open={unifiedOpen} groups={buildPriceGroups(prices, unifiedSettings)} loading={unifiedBatchMutation.isPending} onClose={() => setUnifiedOpen(false)} onSubmit={(updates) => unifiedBatchMutation.mutateAsync({ updates })} />
      <ConfirmDialog open={Boolean(deletingPrice)} title="删除模型价格" description={`删除 ${deletingPrice?.upstreamProvider ?? ""} / ${deletingPrice?.model ?? ""} 的价格配置。`} confirmText="确认删除" requireInputText="确认删除" loading={deleteMutation.isPending} onOpenChange={(open) => !open && setDeletingPrice(null)} onConfirm={async () => { if (deletingPrice) await deleteMutation.mutateAsync(deletingPrice.id); }} />
    </div>
  );
}

function PriceModal({
  open,
  price,
  providers,
  enabledUnifiedModels,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  price: ModelPrice | null;
  providers: string[];
  enabledUnifiedModels: string[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: ModelPriceInput) => Promise<unknown>;
}) {
  const form = useForm<PriceFormInput, unknown, PriceValues>({ resolver: zodResolver(priceSchema), defaultValues: defaultPrice(price, providers[0]) });
  const watchedModel = form.watch("model");
  const unifiedModelMatch = enabledUnifiedModels.find(
    (model) => model.toLowerCase() === watchedModel.trim().toLowerCase(),
  );
  useEffect(() => { if (open) form.reset(defaultPrice(price, providers[0])); }, [form, open, price, providers]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6"><div><h2 className="text-lg font-semibold text-slate-950">{price ? "编辑价格" : "新增价格配置"}</h2><p className="text-sm text-slate-500">唯一键：upstreamProvider + model</p></div><button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <form className="flex-1 overflow-y-auto p-6" onSubmit={form.handleSubmit((values) => onSubmit(values))}>
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="模型"
                error={form.formState.errors.model?.message}
                hint={
                  unifiedModelMatch
                    ? `提示：${unifiedModelMatch} 已在统一名称价格里面启用；保存此渠道价格后，客户生效价会按统一价格模式展示。`
                    : undefined
                }
                hintTone={unifiedModelMatch ? "warning" : "default"}
              >
                <input className={inputClass} {...form.register("model")} />
              </Field>
              <Field label="Provider" error={form.formState.errors.upstreamProvider?.message}><input list="provider-options" className={inputClass} {...form.register("upstreamProvider")} /><datalist id="provider-options">{providers.map((provider) => <option value={provider} key={provider} />)}</datalist></Field>
              <Field label="上游接口">
                <select className={inputClass} {...form.register("upstreamEndpoint")}>
                  <option value="responses">Responses API</option>
                  <option value="chat_completions">Chat Completions API</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="上游 Input / 1M" error={form.formState.errors.upstreamInputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("upstreamInputPer1MTok")} /></Field>
              <Field label="上游 Output / 1M" error={form.formState.errors.upstreamOutputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("upstreamOutputPer1MTok")} /></Field>
              <Field label="客户 Input / 1M" error={form.formState.errors.customerInputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("customerInputPer1MTok")} /></Field>
              <Field label="客户 Output / 1M" error={form.formState.errors.customerOutputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("customerOutputPer1MTok")} /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="币种"><input className={inputClass} {...form.register("currency")} /></Field>
              <Field label="最低收费"><input className={inputClass} inputMode="decimal" {...form.register("minimumChargeUsd")} /></Field>
              <Field label="价格版本"><input className={inputClass} {...form.register("priceVersion")} /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="上游缓存 Input"><input className={inputClass} inputMode="decimal" {...form.register("upstreamCachedInputPer1MTok")} /></Field>
              <Field label="客户缓存 Input"><input className={inputClass} inputMode="decimal" {...form.register("customerCachedInputPer1MTok")} /></Field>
              <Field label="上游倍率"><input className={inputClass} inputMode="decimal" {...form.register("upstreamPriceMultiplier")} /></Field>
              <Field label="客户倍率"><input className={inputClass} inputMode="decimal" {...form.register("customerPriceMultiplier")} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...form.register("enabled")} />启用价格</label>
          </div>
          <div className="mt-8 flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" onClick={onClose} disabled={loading} className={secondaryButton}>取消</button><button type="submit" disabled={loading} className={primaryButton}>{loading ? "保存中" : "保存"}</button></div>
        </form>
      </aside>
    </div>
  );
}

function defaultPrice(price: ModelPrice | null, provider?: string): PriceValues {
  return {
    model: price?.model ?? "",
    upstreamProvider: price?.upstreamProvider ?? provider ?? "default",
    upstreamEndpoint: price?.upstreamEndpoint ?? "responses",
    currency: price?.currency ?? "USD",
    upstreamInputPer1MTok: price?.upstreamInputPer1MTok ?? "",
    upstreamOutputPer1MTok: price?.upstreamOutputPer1MTok ?? "",
    upstreamCachedInputPer1MTok: price?.upstreamCachedInputPer1MTok ?? "0",
    upstreamPriceMultiplier: price?.upstreamPriceMultiplier ?? "1",
    customerInputPer1MTok: price?.customerInputPer1MTok ?? "",
    customerOutputPer1MTok: price?.customerOutputPer1MTok ?? "",
    customerCachedInputPer1MTok: price?.customerCachedInputPer1MTok ?? "0",
    customerPriceMultiplier: price?.customerPriceMultiplier ?? "1",
    minimumChargeUsd: price?.minimumChargeUsd ?? "0",
    enabled: price?.enabled ?? true,
    priceVersion: price?.priceVersion ?? "v1",
  };
}

function Field({
  label,
  error,
  hint,
  hintTone = "default",
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  hintTone?: "default" | "warning";
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? (
        <span
          className={
            hintTone === "warning"
              ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
              : "text-xs leading-5 text-slate-500"
          }
        >
          {hint}
        </span>
      ) : null}
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </label>
  );
}
function Badge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{children}</span>;
}
function money(value: string | number) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
}
function endpointLabel(value: ModelPrice["upstreamEndpoint"]) {
  return value === "chat_completions" ? "Chat Completions" : "Responses";
}
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }

export interface ModelPriceGroup {
  model: string;
  prices: ModelPrice[];
  providerNames: string[];
  setting?: UnifiedPriceSetting;
  hasDifferentOriginalCustomerPricing: boolean;
}

function buildPriceGroups(prices: ModelPrice[], settings: UnifiedPriceSetting[]): ModelPriceGroup[] {
  const settingsByModel = new Map(settings.map((setting) => [setting.model, setting]));
  const groups = new Map<string, ModelPrice[]>();

  for (const price of prices) {
    groups.set(price.model, [...(groups.get(price.model) ?? []), price]);
  }

  return Array.from(groups.entries())
    .map(([model, modelPrices]) => ({
      model,
      prices: modelPrices.sort((left, right) => left.upstreamProvider.localeCompare(right.upstreamProvider)),
      providerNames: Array.from(new Set(modelPrices.map((price) => price.upstreamProvider))).sort(),
      setting: settingsByModel.get(model),
      hasDifferentOriginalCustomerPricing: modelPrices.some((price) => !sameCustomerPrice(price, modelPrices[0])),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

function sameCustomerPrice(left: ModelPrice, right?: ModelPrice) {
  if (!right) return true;
  return (
    Number(left.customerInputPer1MTok) === Number(right.customerInputPer1MTok) &&
    Number(left.customerCachedInputPer1MTok) === Number(right.customerCachedInputPer1MTok) &&
    Number(left.customerOutputPer1MTok) === Number(right.customerOutputPer1MTok) &&
    Number(left.customerPriceMultiplier) === Number(right.customerPriceMultiplier)
  );
}

function effectiveCustomerInput(price: ModelPrice, setting?: UnifiedPriceSetting) {
  return multiplyPrice(setting?.enabled ? setting.customerInputPer1MTok : price.customerInputPer1MTok, setting?.enabled ? setting.customerPriceMultiplier : price.customerPriceMultiplier);
}

function effectiveCustomerOutput(price: ModelPrice, setting?: UnifiedPriceSetting) {
  return multiplyPrice(setting?.enabled ? setting.customerOutputPer1MTok : price.customerOutputPer1MTok, setting?.enabled ? setting.customerPriceMultiplier : price.customerPriceMultiplier);
}

function multiplyPrice(value: string, multiplier: string) {
  return Number(value || 0) * Number(multiplier || 1);
}

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton = "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
