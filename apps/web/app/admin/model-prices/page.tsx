"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { ProviderGroupBadge } from "../../../components/shared/provider-group-badge";
import {
  createModelPrice,
  deleteModelPriceGroup,
  deleteModelPrice,
  getModelPrices,
  getUpstreamProviders,
  updateModelPrice,
  updateUnifiedPrices,
  type ModelPrice,
  type ModelPriceInput,
  type UpstreamProvider,
  type UnifiedPriceSetting,
} from "../../../lib/api/supply-chain";
import { UnifiedPriceModal } from "./components/unified-price-modal";

const priceSchema = z.object({
  model: z.string().trim().min(1, "请输入模型名").max(120),
  upstreamProvider: z.string().trim().min(1, "请选择 Provider").max(80),
  upstreamEndpoint: z.enum(["responses", "chat_completions", "images_generations"]).default("responses"),
  pricingMode: z.enum(["token", "request"]).default("token"),
  currency: z.string().trim().min(1).default("USD"),
  upstreamInputPer1MTok: z.string().trim().default("0"),
  upstreamOutputPer1MTok: z.string().trim().default("0"),
  upstreamCachedInputPer1MTok: z.string().trim().default("0"),
  upstreamPriceMultiplier: z.string().trim().default("1"),
  upstreamPerRequestUsd: z.string().trim().default("0"),
  customerInputPer1MTok: z.string().trim().default("0"),
  customerOutputPer1MTok: z.string().trim().default("0"),
  customerCachedInputPer1MTok: z.string().trim().default("0"),
  customerPriceMultiplier: z.string().trim().default("1"),
  minimumChargeUsd: z.string().trim().default("0"),
  perRequestUsd: z.string().trim().default("0"),
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
  const [deletingGroup, setDeletingGroup] = useState<ModelPriceGroup | null>(null);
  const [selectedGroupModel, setSelectedGroupModel] = useState<string | null>(null);
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const pricesQuery = useQuery({ queryKey: ["admin", "model-prices"], queryFn: getModelPrices });
  const providersQuery = useQuery({ queryKey: ["admin", "upstream-providers"], queryFn: getUpstreamProviders });

  const prices = pricesQuery.data?.modelPrices ?? [];
  const unifiedSettings = pricesQuery.data?.unifiedPriceSettings ?? [];
  const providers = providersQuery.data ?? [];
  const providerGroups = useMemo(
    () => new Map(providers.map((provider) => [provider.name, provider.groupName])),
    [providers],
  );
  const visiblePrices = prices.filter((price) =>
    price.model.toLowerCase().includes(modelFilter.toLowerCase()) &&
    (price.upstreamProvider.toLowerCase().includes(providerFilter.toLowerCase()) ||
      (providerGroups.get(price.upstreamProvider) ?? "")
        .toLowerCase()
        .includes(providerFilter.toLowerCase())),
  );
  const groupedPrices = useMemo(
    () => buildPriceGroups(visiblePrices, unifiedSettings),
    [visiblePrices, unifiedSettings],
  );
  const selectedGroup = selectedGroupModel
    ? groupedPrices.find((group) => group.model === selectedGroupModel) ?? null
    : null;

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

  const deleteGroupMutation = useMutation({
    mutationFn: deleteModelPriceGroup,
    onSuccess: (result) => {
      setDeletingGroup(null);
      setSelectedGroupModel(null);
      setNotice(`模型价格卡片已删除：${result.deletedPrices} 条价格，${result.deletedChannels} 条模型池渠道引用`);
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
          <Field label="按 Provider / 分组过滤"><input value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className={inputClass} placeholder="openai 或 官方渠道" /></Field>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {pricesQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-lg bg-slate-100" />)}</div>
        ) : pricesQuery.isError ? (
          <div className="p-5 text-sm font-medium text-red-600">模型价格加载失败。</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groupedPrices.map((group) => (
              <article key={group.model} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-950">{group.model}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {group.prices.length} 条渠道价格 · {group.prices.filter((price) => price.enabled).length} 条启用
                    </p>
                  </div>
                  <Badge active={Boolean(group.setting?.enabled)}>{group.setting?.enabled ? "统一模式" : "普通模式"}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <ModelPriceCardMetric label="渠道" value={`${group.prices.length}`} />
                  <ModelPriceCardMetric label="启用" value={`${group.prices.filter((price) => price.enabled).length}`} />
                  <ModelPriceCardMetric label="币种" value={group.prices[0]?.currency ?? "USD"} />
                </div>
                {group.hasDifferentOriginalCustomerPricing ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">渠道原价有差异</div>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setSelectedGroupModel(group.model)} className={secondaryButton}>
                    查看 / 编辑渠道价格
                  </button>
                  <button type="button" onClick={() => setDeletingGroup(group)} className={dangerButton}>
                    <Trash2 className="h-4 w-4" /> 删除卡片
                  </button>
                </div>
              </article>
            ))}
            {groupedPrices.length === 0 ? <div className="col-span-full p-8 text-center text-sm text-slate-500">暂无模型价格</div> : null}
          </div>
        )}
      </section>

      <ModelPriceGroupModal
        group={selectedGroup}
        providerGroups={providerGroups}
        onClose={() => setSelectedGroupModel(null)}
        onDelete={setDeletingPrice}
        onEdit={setEditingPrice}
        onUnifiedMode={() => setUnifiedOpen(true)}
      />

      <PriceModal
        enabledUnifiedModels={unifiedSettings
          .filter((setting) => setting.enabled)
          .map((setting) => setting.model)}
        open={editingPrice !== undefined}
        price={editingPrice ?? null}
        providers={providers}
        loading={saveMutation.isPending}
        onClose={() => setEditingPrice(undefined)}
        onSubmit={(values) => saveMutation.mutateAsync(values)}
      />
      <UnifiedPriceModal open={unifiedOpen} groups={buildPriceGroups(prices, unifiedSettings)} loading={unifiedBatchMutation.isPending} onClose={() => setUnifiedOpen(false)} onSubmit={(updates) => unifiedBatchMutation.mutateAsync({ updates })} />
      <ConfirmDialog open={Boolean(deletingPrice)} title="删除模型价格" description={`删除 ${deletingPrice?.upstreamProvider ?? ""} / ${deletingPrice?.model ?? ""} 的价格配置。`} confirmText="确认删除" requireInputText="确认删除" loading={deleteMutation.isPending} onOpenChange={(open) => !open && setDeletingPrice(null)} onConfirm={async () => { if (deletingPrice) await deleteMutation.mutateAsync(deletingPrice.id); }} />
      <ConfirmDialog open={Boolean(deletingGroup)} title="删除模型价格卡片" description={`删除 ${deletingGroup?.model ?? ""} 会删除该模型下全部 ${deletingGroup?.prices.length ?? 0} 条渠道价格，并清理关联模型池渠道引用。此操作不可撤销。`} confirmText="确认删除" requireInputText="确认删除" loading={deleteGroupMutation.isPending} onOpenChange={(open) => !open && setDeletingGroup(null)} onConfirm={async () => { if (deletingGroup) await deleteGroupMutation.mutateAsync(deletingGroup.model); }} />
    </div>
  );
}

function ModelPriceCardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ModelPriceGroupModal({
  group,
  providerGroups,
  onClose,
  onEdit,
  onDelete,
  onUnifiedMode,
}: {
  group: ModelPriceGroup | null;
  providerGroups: ReadonlyMap<string, string | null>;
  onClose: () => void;
  onEdit: (price: ModelPrice) => void;
  onDelete: (price: ModelPrice) => void;
  onUnifiedMode: () => void;
}) {
  if (!group) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-5">
      <section className="flex max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="truncate text-lg font-semibold text-slate-950">{group.model}</h2>
              <Badge active={Boolean(group.setting?.enabled)}>{group.setting?.enabled ? "统一模式" : "普通模式"}</Badge>
              {group.hasDifferentOriginalCustomerPricing ? <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">渠道原价有差异</span> : null}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {group.prices.length} 条渠道价格 · {group.prices.filter((price) => price.enabled).length} 条启用
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onUnifiedMode} className={secondaryButton}>管理统一模式</button>
            <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] text-left">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
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
                  <td className="px-5 py-4"><div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-950">{price.upstreamProvider}</div><ProviderGroupBadge groupName={providerGroups.get(price.upstreamProvider)} /></div><div className="mt-1 text-xs text-slate-500">{endpointLabel(price.upstreamEndpoint)} · {price.pricingMode === "request" ? "按次" : "按 Token"} · {price.currency} · {price.priceVersion}</div></td>
                  <td className="px-5 py-4 text-sm tabular-nums text-slate-700">{price.pricingMode === "request" ? <div>每次：{money(price.upstreamPerRequestUsd)}</div> : <><div>Input：{money(price.upstreamInputPer1MTok)}</div><div className="mt-1">Output：{money(price.upstreamOutputPer1MTok)}</div></>}</td>
                  <td className="px-5 py-4 text-sm tabular-nums text-slate-700">{price.pricingMode === "request" ? <div>每次：{money(price.perRequestUsd ?? "0")}</div> : <><div>Input：{money(price.customerInputPer1MTok)}</div><div className="mt-1">Output：{money(price.customerOutputPer1MTok)}</div></>}</td>
                  <td className="px-5 py-4 text-sm font-semibold tabular-nums text-slate-950">{effectivePricingMode(price, group.setting) === "request" ? <div>每次：{money(effectiveCustomerPerRequest(price, group.setting))}</div> : <><div>Input：{money(effectiveCustomerInput(price, group.setting))}</div><div className="mt-1">Output：{money(effectiveCustomerOutput(price, group.setting))}</div></>}</td>
                  <td className="px-5 py-4 text-sm text-slate-700"><div>上游：{price.upstreamPriceMultiplier}</div><div className="mt-1">客户：{group.setting?.enabled ? group.setting.customerPriceMultiplier : price.customerPriceMultiplier}</div><div className="mt-1">最低：{money(price.minimumChargeUsd)}</div></td>
                  <td className="px-5 py-4"><Badge active={price.enabled}>{price.enabled ? "ENABLED" : "DISABLED"}</Badge></td>
                  <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => onEdit(price)} className={secondaryButton}><Edit3 className="h-4 w-4" /> 编辑</button><button type="button" onClick={() => onDelete(price)} className={dangerButton}><Trash2 className="h-4 w-4" /> 删除</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
  providers: Array<Pick<UpstreamProvider, "name" | "groupName">>;
  enabledUnifiedModels: string[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: ModelPriceInput) => Promise<unknown>;
}) {
  const form = useForm<PriceFormInput, unknown, PriceValues>({ resolver: zodResolver(priceSchema), defaultValues: defaultPrice(price, providers[0]?.name) });
  const watchedModel = form.watch("model");
  const pricingMode = form.watch("pricingMode");
  const unifiedModelMatch = enabledUnifiedModels.find(
    (model) => model.toLowerCase() === watchedModel.trim().toLowerCase(),
  );
  useEffect(() => { if (open) form.reset(defaultPrice(price, providers[0]?.name)); }, [form, open, price, providers]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-4xl flex-col bg-slate-50 shadow-xl">
        <div className="flex min-h-20 items-center justify-between gap-4 border-b border-slate-200 bg-white px-7 py-5">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-950">{price ? "编辑价格" : "新增价格配置"}</h2>
            <p className="mt-1 text-sm text-slate-500">唯一键：upstreamProvider + model</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <form className="flex-1 overflow-y-auto px-7 py-6" onSubmit={form.handleSubmit((values) => onSubmit(values))}>
          <div className="grid gap-5">
            {unifiedModelMatch ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                <span className="font-semibold">提示：</span>
                {unifiedModelMatch} 已启用统一价格模式；保存渠道价格后，客户生效价会按统一价格展示。
              </div>
            ) : null}

            <PriceFormSection title="基础信息" description="定义模型、上游渠道和接口类型。">
              <div className="grid gap-4 lg:grid-cols-2">
              <Field
                label="模型"
                error={form.formState.errors.model?.message}
              >
                <input className={inputClass} {...form.register("model")} />
              </Field>
              <Field label="Provider" error={form.formState.errors.upstreamProvider?.message}><input list="provider-options" className={inputClass} {...form.register("upstreamProvider")} /><datalist id="provider-options">{providers.map((provider) => <option value={provider.name} label={provider.groupName ? `分组：${provider.groupName}` : "未分组"} key={provider.name} />)}</datalist></Field>
              <Field label="上游接口">
                <select className={inputClass} {...form.register("upstreamEndpoint")}>
                  <option value="responses">Responses API</option>
                  <option value="chat_completions">Chat Completions API</option>
                  <option value="images_generations">Image Generations API</option>
                </select>
              </Field>
              <Field label="价格模式">
                <select className={inputClass} {...form.register("pricingMode")}>
                  <option value="token">按 Token</option>
                  <option value="request">按次</option>
                </select>
              </Field>
              <Field label="价格版本"><input className={inputClass} {...form.register("priceVersion")} /></Field>
              </div>
            </PriceFormSection>

            <div className="grid gap-5 xl:grid-cols-2">
              <PriceFormSection title="上游成本" description="用于利润和成本报表，不影响客户扣费。">
                <div className="grid gap-4 md:grid-cols-2">
              {pricingMode === "request" ? (
                <Field label="上游每次 USD"><input className={inputClass} inputMode="decimal" {...form.register("upstreamPerRequestUsd")} /></Field>
              ) : (
                <>
                  <Field label="上游 Input / 1M" error={form.formState.errors.upstreamInputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("upstreamInputPer1MTok")} /></Field>
                  <Field label="上游 Output / 1M" error={form.formState.errors.upstreamOutputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("upstreamOutputPer1MTok")} /></Field>
                  <Field label="上游缓存 Input"><input className={inputClass} inputMode="decimal" {...form.register("upstreamCachedInputPer1MTok")} /></Field>
                </>
              )}
              <Field label="上游倍率"><input className={inputClass} inputMode="decimal" {...form.register("upstreamPriceMultiplier")} /></Field>
                </div>
              </PriceFormSection>

              <PriceFormSection title="客户售价" description="用于客户实际扣费；统一价格开启时会被统一配置覆盖展示。">
                <div className="grid gap-4 md:grid-cols-2">
              {pricingMode === "request" ? (
                <Field label="下游每次 USD"><input className={inputClass} inputMode="decimal" {...form.register("perRequestUsd")} /></Field>
              ) : (
                <>
                  <Field label="客户 Input / 1M" error={form.formState.errors.customerInputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("customerInputPer1MTok")} /></Field>
                  <Field label="客户 Output / 1M" error={form.formState.errors.customerOutputPer1MTok?.message}><input className={inputClass} inputMode="decimal" {...form.register("customerOutputPer1MTok")} /></Field>
                  <Field label="客户缓存 Input"><input className={inputClass} inputMode="decimal" {...form.register("customerCachedInputPer1MTok")} /></Field>
                </>
              )}
              <Field label="客户倍率"><input className={inputClass} inputMode="decimal" {...form.register("customerPriceMultiplier")} /></Field>
                </div>
              </PriceFormSection>
            </div>

            <PriceFormSection title="计费控制" description="设置币种、最低收费和是否参与路由计费。">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="币种"><input className={inputClass} {...form.register("currency")} /></Field>
                <Field label="最低收费"><input className={inputClass} inputMode="decimal" {...form.register("minimumChargeUsd")} /></Field>
                <label className="flex min-h-10 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...form.register("enabled")} />
                  启用价格
                </label>
              </div>
            </PriceFormSection>
          </div>
          <div className="sticky bottom-0 -mx-7 mt-6 flex justify-end gap-3 border-t border-slate-200 bg-white px-7 py-4"><button type="button" onClick={onClose} disabled={loading} className={secondaryButton}>取消</button><button type="submit" disabled={loading} className={primaryButton}>{loading ? "保存中" : "保存"}</button></div>
        </form>
      </aside>
    </div>
  );
}

function PriceFormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function defaultPrice(price: ModelPrice | null, provider?: string): PriceValues {
  return {
    model: price?.model ?? "",
    upstreamProvider: price?.upstreamProvider ?? provider ?? "default",
    upstreamEndpoint: price?.upstreamEndpoint ?? "responses",
    pricingMode: price?.pricingMode ?? "token",
    currency: price?.currency ?? "USD",
    upstreamInputPer1MTok: price?.upstreamInputPer1MTok ?? "0",
    upstreamOutputPer1MTok: price?.upstreamOutputPer1MTok ?? "0",
    upstreamCachedInputPer1MTok: price?.upstreamCachedInputPer1MTok ?? "0",
    upstreamPriceMultiplier: price?.upstreamPriceMultiplier ?? "1",
    upstreamPerRequestUsd: price?.upstreamPerRequestUsd ?? "0",
    customerInputPer1MTok: price?.customerInputPer1MTok ?? "0",
    customerOutputPer1MTok: price?.customerOutputPer1MTok ?? "0",
    customerCachedInputPer1MTok: price?.customerCachedInputPer1MTok ?? "0",
    customerPriceMultiplier: price?.customerPriceMultiplier ?? "1",
    minimumChargeUsd: price?.minimumChargeUsd ?? "0",
    perRequestUsd: price?.perRequestUsd ?? "0",
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
  if (value === "chat_completions") {
    return "Chat Completions";
  }
  if (value === "images_generations") {
    return "Image Generations";
  }
  return "Responses";
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
    Number(left.customerPriceMultiplier) === Number(right.customerPriceMultiplier) &&
    Number(left.perRequestUsd ?? "0") === Number(right.perRequestUsd ?? "0") &&
    left.pricingMode === right.pricingMode
  );
}

function effectivePricingMode(price: ModelPrice, setting?: UnifiedPriceSetting) {
  return setting?.enabled ? setting.pricingMode : price.pricingMode;
}

function effectiveCustomerInput(price: ModelPrice, setting?: UnifiedPriceSetting) {
  return multiplyPrice(setting?.enabled ? setting.customerInputPer1MTok : price.customerInputPer1MTok, setting?.enabled ? setting.customerPriceMultiplier : price.customerPriceMultiplier);
}

function effectiveCustomerOutput(price: ModelPrice, setting?: UnifiedPriceSetting) {
  return multiplyPrice(setting?.enabled ? setting.customerOutputPer1MTok : price.customerOutputPer1MTok, setting?.enabled ? setting.customerPriceMultiplier : price.customerPriceMultiplier);
}

function effectiveCustomerPerRequest(price: ModelPrice, setting?: UnifiedPriceSetting) {
  return multiplyPrice(setting?.enabled ? setting.perRequestUsd : price.perRequestUsd, setting?.enabled ? setting.customerPriceMultiplier : price.customerPriceMultiplier);
}

function multiplyPrice(value: string, multiplier: string) {
  return Number(value || 0) * Number(multiplier || 1);
}

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButton = "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
