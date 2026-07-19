"use client";

import { ShieldCheck } from "lucide-react";
import type { UserSubscription } from "../../../lib/api/subscriptions";
import { dateTime } from "../../../lib/format";
import type { FrontSelectableAccessTier } from "../../../lib/types/front";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontEmptyState,
  FrontSkeleton,
  useFrontConfirm,
} from "./ui/front-ui";

type CurrentAccessTier = {
  id: string;
  code: string;
  name: string;
};

export function AccessTierCard({
  currentTier,
  tiers,
  switchingTierId,
  loading,
  subscriptionLoading,
  subscriptionError,
  activeSubscription,
  onSelect,
}: {
  currentTier: CurrentAccessTier | null;
  tiers: FrontSelectableAccessTier[];
  switchingTierId: string | null;
  loading: boolean;
  subscriptionLoading: boolean;
  subscriptionError: string | null;
  activeSubscription: UserSubscription | null;
  onSelect: (tier: FrontSelectableAccessTier) => Promise<void>;
}) {
  const confirm = useFrontConfirm();
  const effectiveTier = activeSubscription?.tier ?? currentTier;
  const currentTierSelectable = tiers.some(
    (tier) => tier.id === currentTier?.id,
  );
  const selectionLocked =
    subscriptionLoading ||
    Boolean(subscriptionError) ||
    Boolean(activeSubscription);

  async function select(tier: FrontSelectableAccessTier) {
    if (selectionLocked || tier.id === effectiveTier?.id) {
      return;
    }
    if (currentTier && !currentTierSelectable) {
      const accepted = await confirm({
        title: "切换管理员分配等级",
        description: `当前「${currentTier.name}」由管理员分配。切换后无法在前台自行恢复，确认切换到「${tier.name}」吗？`,
        confirmText: "确认切换",
      });
      if (!accepted) {
        return;
      }
    }
    await onSelect(tier);
  }

  return (
    <FrontCard className="front-access-tier-card">
      <div className="front-page-section-head">
        <div>
          <h2>访问等级</h2>
          <p>默认决定可用模型、扣费倍率与运行限制；没有订阅也会持续生效。</p>
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
          <FrontSkeleton height={96} />
          <FrontSkeleton height={96} />
        </div>
      ) : tiers.length > 0 ? (
        <div
          className="front-tier-grid"
          role="group"
          aria-label="可选择的访问等级"
        >
          {tiers.map((tier) => {
            const active = tier.id === effectiveTier?.id;
            const switching = tier.id === switchingTierId;
            const disabled =
              active || selectionLocked || Boolean(switchingTierId);
            const buttonLabel = active
              ? activeSubscription
                ? "订阅等级"
                : "已选择"
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
                    <FrontBadge
                      tone={activeSubscription ? "warning" : "success"}
                    >
                      {activeSubscription ? "订阅生效" : "当前等级"}
                    </FrontBadge>
                  ) : null}
                </div>
                {tier.description ? (
                  <p className="front-tier-option-description">
                    {tier.description}
                  </p>
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
                <div className="front-tier-option-foot">
                  <span className="front-data-number">
                    扣费倍率 × {formatMultiplier(tier.billingMultiplier)}
                  </span>
                  <FrontButton
                    variant={active ? "secondary" : "primary"}
                    loading={switching}
                    disabled={disabled}
                    onClick={() => void select(tier)}
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
  return value > 0 ? `${value.toLocaleString("zh-CN")} 路` : "无限制";
}
