"use client";

import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import type { UserSubscription } from "../../../lib/api/subscriptions";
import { dateTime } from "../../../lib/format";
import type {
  FrontConfiguredAccessTier,
  FrontSelectableAccessTier,
} from "../../../lib/types/front";
import { CurrencyAmount } from "./currency-amount";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontEmptyState,
  FrontSkeleton,
  useFrontConfirm,
} from "./ui/front-ui";

export function AccessTierCard({
  currentTier,
  tiers,
  switchingTierId,
  loading,
  subscriptionLoading,
  subscriptionError,
  activeSubscription,
  onSelect,
  onPreferenceChanged,
}: {
  currentTier: FrontConfiguredAccessTier | null;
  tiers: FrontSelectableAccessTier[];
  switchingTierId: string | null;
  loading: boolean;
  subscriptionLoading: boolean;
  subscriptionError: string | null;
  activeSubscription: UserSubscription | null;
  onSelect: (tier: FrontSelectableAccessTier) => Promise<void>;
  onPreferenceChanged: () => void | Promise<void>;
}) {
  const confirm = useFrontConfirm();
  const effectiveTier = activeSubscription?.tier ?? currentTier;
  const currentTierSelectable = tiers.some(
    (tier) => tier.id === currentTier?.id,
  );
  const displayedTiers: FrontConfiguredAccessTier[] = currentTier
    ? [currentTier, ...tiers.filter((tier) => tier.id !== currentTier.id)]
    : tiers;
  const selectionLocked =
    subscriptionLoading ||
    Boolean(subscriptionError) ||
    Boolean(activeSubscription);

  async function select(tier: FrontSelectableAccessTier) {
    if (selectionLocked || tier.id === effectiveTier?.id) return;
    if (currentTier && !currentTierSelectable) {
      const accepted = await confirm({
        title: "切换管理员分配等级",
        description: `当前「${currentTier.name}」由管理员分配。切换后只能联系管理员恢复，确认继续吗？`,
        confirmText: "确认切换",
      });
      if (!accepted) return;
    }
    await onSelect(tier);
  }

  return (
    <FrontCard className="front-access-tier-card">
      <div className="front-page-section-head">
        <div>
          <h2>访问等级与扣款顺序</h2>
          <p>访问等级持续生效；每个等级可以单独设置余额货币优先级。</p>
        </div>
        <FrontBadge tone={activeSubscription ? "warning" : "primary"}>
          <ShieldCheck aria-hidden="true" size={14} />
          当前生效 · {effectiveTier?.name ?? "默认等级"}
        </FrontBadge>
      </div>

      {activeSubscription ? (
        <FrontAlert tone="info" title="订阅正在临时覆盖基础等级">
          当前订阅「{activeSubscription.plan.name}」提供「
          {activeSubscription.tier.name}」等级，有效至{" "}
          {dateTime(activeSubscription.endsAt)}。有效期内不能手动切换；结束后会恢复账户基础等级「
          {currentTier?.name ?? "默认等级"}」。
        </FrontAlert>
      ) : subscriptionError ? (
        <FrontAlert tone="warning" title="暂时无法确认订阅状态">
          请先重试订阅信息；确认成功前，访问等级切换暂不可用。
        </FrontAlert>
      ) : subscriptionLoading ? (
        <FrontAlert tone="info">
          正在确认订阅状态，访问等级切换暂不可用。
        </FrontAlert>
      ) : currentTier && !currentTierSelectable ? (
        <FrontAlert tone="warning">
          当前等级由管理员分配；切换后只能联系管理员恢复。
        </FrontAlert>
      ) : null}

      {loading ? (
        <div className="front-tier-grid">
          <FrontSkeleton height={180} />
          <FrontSkeleton height={180} />
        </div>
      ) : displayedTiers.length > 0 ? (
        <div className="front-tier-grid" role="group" aria-label="可选择的访问等级">
          {displayedTiers.map((tier) => {
            const selectableTier = tiers.find((item) => item.id === tier.id);
            const active = tier.id === effectiveTier?.id;
            const switching = tier.id === switchingTierId;
            const description = formatTierDescription(tier.description);
            const disabled =
              active ||
              !selectableTier ||
              selectionLocked ||
              Boolean(switchingTierId);
            const buttonLabel = active
              ? activeSubscription
                ? "订阅等级"
                : "已选择"
              : !selectableTier
                ? "管理员分配"
              : activeSubscription
                ? "订阅期间不可切换"
                : selectionLocked
                  ? "暂不可切换"
                  : switching
                    ? "切换中"
                    : "切换等级";

            return (
              <div
                className={`front-tier-option${active ? " front-active" : ""}`}
                key={tier.id}
              >
                <div className="front-tier-option-head">
                  <strong>{tier.name}</strong>
                  {active ? (
                    <FrontBadge tone={activeSubscription ? "warning" : "success"}>
                      {activeSubscription ? "订阅生效" : "当前等级"}
                    </FrontBadge>
                  ) : null}
                </div>
                {description ? (
                  <p className="front-tier-option-description">{description}</p>
                ) : null}
                <dl className="front-tier-limit-grid">
                  <div>
                    <dt>RPM</dt>
                    <dd>{formatRateLimit(tier.rateLimitPerMinute)}</dd>
                  </div>
                  <div>
                    <dt>并发</dt>
                    <dd>{formatConcurrencyLimit(tier.concurrencyLimit)}</dd>
                  </div>
                </dl>

                <TierCurrencyPreference
                  tier={tier}
                  onChanged={onPreferenceChanged}
                />

                <div className="front-tier-option-foot">
                  <span className="front-data-number">
                    扣费倍率 × {formatMultiplier(tier.billingMultiplier)}
                  </span>
                  <FrontButton
                    variant={active ? "secondary" : "primary"}
                    loading={switching}
                    disabled={disabled}
                    onClick={() => {
                      if (selectableTier) void select(selectableTier);
                    }}
                  >
                    {buttonLabel}
                  </FrontButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <FrontEmptyState
          icon={<ShieldCheck aria-hidden="true" size={24} />}
          title="暂无可选等级"
          description="当前没有开放给用户自行选择的访问等级。"
        />
      )}
    </FrontCard>
  );
}

function TierCurrencyPreference({
  tier,
  onChanged,
}: {
  tier: FrontConfiguredAccessTier;
  onChanged: () => void | Promise<void>;
}) {
  const [orderedCodes, setOrderedCodes] = useState(tier.currencyPreference);
  const [draggedCode, setDraggedCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currencyByCode = new Map(
    tier.currencies.map((currency) => [currency.code, currency]),
  );

  useEffect(() => {
    setOrderedCodes(tier.currencyPreference);
  }, [tier.currencyPreference]);

  function move(code: string, offset: -1 | 1) {
    setOrderedCodes((current) => {
      const index = current.indexOf(code);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
    setMessage(null);
  }

  function dropBefore(targetCode: string) {
    if (!draggedCode || draggedCode === targetCode) return;
    setOrderedCodes((current) => {
      const next = current.filter((code) => code !== draggedCode);
      next.splice(next.indexOf(targetCode), 0, draggedCode);
      return next;
    });
    setDraggedCode(null);
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/me/access-tiers/${tier.id}/currency-preference`, {
        method: "PUT",
        body: JSON.stringify({ currencyCodes: orderedCodes }),
      });
      setMessage("扣款顺序已保存");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  if (orderedCodes.length === 0) {
    return (
      <div className="front-tier-currency-empty">
        该等级尚未绑定可用货币，当前无法进行按量扣款。
      </div>
    );
  }

  const changed = orderedCodes.join("|") !== tier.currencyPreference.join("|");

  return (
    <section className="front-tier-currency-panel" aria-label={`${tier.name}货币扣款优先级`}>
      <div className="front-tier-currency-title">
        <div>
          <strong>货币扣款优先级</strong>
          <span>{tier.preferenceSource === "USER" ? "使用你的个人顺序" : "使用管理员默认顺序"}</span>
        </div>
        <FrontBadge tone="primary">首选 {orderedCodes[0]}</FrontBadge>
      </div>
      <div className="front-tier-currency-list">
        {orderedCodes.map((code, index) => {
          const currency = currencyByCode.get(code);
          if (!currency) return null;
          const available = Math.max(
            0,
            Number(currency.balance) - Number(currency.reservedBalance),
          );
          return (
            <div
              className={`front-tier-currency-row${draggedCode === code ? " front-dragging" : ""}`}
              draggable
              key={code}
              onDragEnd={() => setDraggedCode(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setDraggedCode(code)}
              onDrop={() => dropBefore(code)}
            >
              <GripVertical aria-hidden="true" className="front-tier-currency-grip" size={17} />
              <span className="front-tier-currency-index">{index + 1}</span>
              <div className="front-tier-currency-name">
                <strong>{currency.name}</strong>
                <span>{currency.code}</span>
              </div>
              <strong className="front-data-number front-tier-currency-balance">
                <CurrencyAmount value={available} currency={currency} />
              </strong>
              <div className="front-tier-currency-controls">
                <button
                  aria-label={`上移 ${currency.name}`}
                  className="front-tier-currency-move"
                  disabled={index === 0 || saving}
                  onClick={() => move(code, -1)}
                  type="button"
                >
                  <ChevronUp aria-hidden="true" size={16} />
                </button>
                <button
                  aria-label={`下移 ${currency.name}`}
                  className="front-tier-currency-move"
                  disabled={index === orderedCodes.length - 1 || saving}
                  onClick={() => move(code, 1)}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="front-tier-currency-actions">
        <span aria-live="polite">{message}</span>
        <FrontButton
          variant="secondary"
          disabled={!changed || saving}
          loading={saving}
          onClick={() => void save()}
        >
          <Save aria-hidden="true" size={15} />
          保存扣款顺序
        </FrontButton>
      </div>
    </section>
  );
}

function formatMultiplier(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("zh-CN", { maximumFractionDigits: 8 })
    : value;
}

function formatRateLimit(value: number) {
  return value > 0 ? `${value.toLocaleString("zh-CN")} 次/分钟` : "无限制";
}

function formatConcurrencyLimit(value: number) {
  return value > 0 ? value.toLocaleString("zh-CN") : "无限制";
}

function formatTierDescription(value: string | null) {
  const description = value?.trim();
  return description?.toLowerCase() === "default access tier"
    ? null
    : description || null;
}
