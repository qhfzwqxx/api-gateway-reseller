"use client";

import { Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { UnifiedPriceInput } from "../../../../lib/api/supply-chain";
import type { ModelPriceGroup } from "../page";

type Draft = Omit<UnifiedPriceInput, "model" | "enabled">;

export function UnifiedPriceModal({
  open,
  groups,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  groups: ModelPriceGroup[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (updates: UnifiedPriceInput[]) => Promise<unknown>;
}) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  useEffect(() => {
    if (!open) return;
    setEnabled(Object.fromEntries(groups.map((group) => [group.model, Boolean(group.setting?.enabled)])));
    setDrafts(Object.fromEntries(groups.map((group) => [group.model, draftFromGroup(group)])));
  }, [groups, open]);

  if (!open) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(groups.map((group) => ({
      model: group.model,
      enabled: enabled[group.model] ?? false,
      ...(drafts[group.model] ?? draftFromGroup(group)),
    })));
  }

  function updateDraft(model: string, field: keyof Draft, value: string) {
    setDrafts((current) => ({
      ...current,
      [model]: {
        ...(current[model] ?? draftFromGroup(groups.find((group) => group.model === model))),
        [field]: value,
      },
    }));
  }

  function pricingModeLabel(mode?: string) {
    return mode === "request" ? "按次" : "按 Token";
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <aside className="flex h-full w-full max-w-5xl flex-col bg-white shadow-xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">统一价格模式</h2>
            <p className="text-sm text-slate-500">按模型启用统一站点售价；不会修改各渠道原始价格，关闭后恢复普通模式。</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              统一模式生效后，同一模型下所有 Provider 对用户展示同一套客户价；上游成本仍按各渠道自己的配置计算。
            </div>
            <div className="grid gap-4">
              {groups.map((group) => {
                const draft = drafts[group.model] ?? draftFromGroup(group);
                const selected = enabled[group.model] ?? false;
                const requestMode = draft.pricingMode === "request";
                return (
                  <section key={group.model} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="font-semibold text-slate-950">{group.model}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {group.prices.length} 个渠道 · {group.prices.filter((price) => price.enabled).length} 个启用
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                          <input type="checkbox" checked={selected} onChange={(event) => setEnabled((current) => ({ ...current, [group.model]: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                          统一模式
                        </label>
                        <span className={selected ? activeBadge : neutralBadge}>{selected ? "已开启" : "普通模式"}</span>
                        <span className={neutralBadge}>{pricingModeLabel(draft.pricingMode)}</span>
                        {group.hasDifferentOriginalCustomerPricing ? <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">原价有差异</span> : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <Field label="价格模式"><select disabled={!selected} value={draft.pricingMode ?? "token"} onChange={(event) => updateDraft(group.model, "pricingMode", event.target.value)} className={inputClass}><option value="token">按 Token</option><option value="request">按次</option></select></Field>
                      {requestMode ? (
                        <Field label="下游每次 USD"><input disabled={!selected} value={draft.perRequestUsd ?? "0"} onChange={(event) => updateDraft(group.model, "perRequestUsd", event.target.value)} className={inputClass} inputMode="decimal" /></Field>
                      ) : (
                        <>
                          <Field label="统一 Input / 1M"><input disabled={!selected} value={draft.customerInputPer1MTok} onChange={(event) => updateDraft(group.model, "customerInputPer1MTok", event.target.value)} className={inputClass} inputMode="decimal" /></Field>
                          <Field label="统一缓存 / 1M"><input disabled={!selected} value={draft.customerCachedInputPer1MTok ?? "0"} onChange={(event) => updateDraft(group.model, "customerCachedInputPer1MTok", event.target.value)} className={inputClass} inputMode="decimal" /></Field>
                          <Field label="统一 Output / 1M"><input disabled={!selected} value={draft.customerOutputPer1MTok} onChange={(event) => updateDraft(group.model, "customerOutputPer1MTok", event.target.value)} className={inputClass} inputMode="decimal" /></Field>
                        </>
                      )}
                      <Field label="客户倍率"><input disabled={!selected} value={draft.customerPriceMultiplier ?? "1"} onChange={(event) => updateDraft(group.model, "customerPriceMultiplier", event.target.value)} className={inputClass} inputMode="decimal" /></Field>
                    </div>
                  </section>
                );
              })}
              {groups.length === 0 ? <div className="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500">暂无已有模型价格</div> : null}
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button type="button" onClick={onClose} disabled={loading} className={secondaryButton}>取消</button>
            <button type="submit" disabled={loading || groups.length === 0} className={primaryButton}><Save className="h-4 w-4" />{loading ? "保存中" : "保存模式"}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function draftFromGroup(group?: ModelPriceGroup): Draft {
  const first = group?.prices[0];
  return {
    pricingMode: group?.setting?.pricingMode ?? first?.pricingMode ?? "token",
    customerInputPer1MTok: group?.setting?.customerInputPer1MTok ?? first?.customerInputPer1MTok ?? "0",
    customerCachedInputPer1MTok: group?.setting?.customerCachedInputPer1MTok ?? first?.customerCachedInputPer1MTok ?? "0",
    customerOutputPer1MTok: group?.setting?.customerOutputPer1MTok ?? first?.customerOutputPer1MTok ?? "0",
    customerPriceMultiplier: group?.setting?.customerPriceMultiplier ?? first?.customerPriceMultiplier ?? "1",
    perRequestUsd: group?.setting?.perRequestUsd ?? first?.perRequestUsd ?? "0",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2"><span className="text-sm font-medium text-slate-700">{label}</span>{children}</label>;
}

const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton = "inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex h-10 items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const activeBadge = "rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700";
const neutralBadge = "rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600";
