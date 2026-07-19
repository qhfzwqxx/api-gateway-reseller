"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  PackageCheck,
  RefreshCw,
  Ticket,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../../lib/api";
import type { UserSubscription } from "../../../lib/api/subscriptions";
import { dateTime, formatDuration, money, signedMoney } from "../../../lib/format";
import type {
  FrontPaginationMeta,
  FrontSelectableAccessTier,
  FrontTransaction,
  FrontUser,
  FrontWallet,
} from "../../../lib/types/front";
import { AccessTierCard } from "./access-tier-card";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontDataTable,
  FrontDialog,
  FrontEmptyState,
  FrontField,
  FrontPagination,
  FrontSkeleton,
  useFrontToast,
} from "./ui/front-ui";

const BILLING_PAGE_SIZE = 10;

export type Wallet = FrontWallet;
export type Transaction = FrontTransaction;

type RedeemResult =
  | { type: "BALANCE"; amount: string; currency?: string }
  | { type: "SUBSCRIPTION"; planName: string };

export function WalletManagement({
  user,
  wallet,
  accessTiers,
  accessTierLoading = false,
  switchingTierId,
  loading = false,
  refreshSignal = 0,
  onSelectTier,
  onChanged,
}: {
  user: FrontUser;
  wallet: FrontWallet | null;
  accessTiers: FrontSelectableAccessTier[];
  accessTierLoading?: boolean;
  switchingTierId: string | null;
  loading?: boolean;
  refreshSignal?: number;
  onSelectTier: (tier: FrontSelectableAccessTier) => Promise<void>;
  onChanged: () => Promise<void> | void;
}) {
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [activeSubscription, setActiveSubscription] = useState<UserSubscription | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null);
  const subscriptionRequestRef = useRef(0);
  const toast = useFrontToast();

  useEffect(() => {
    void loadSubscriptions();
  }, [refreshSignal]);

  async function loadSubscriptions() {
    const requestId = ++subscriptionRequestRef.current;
    setSubscriptionLoading(true);
    setSubscriptionError(null);
    try {
      const result = await apiFetch<{
        subscriptions: UserSubscription[];
        activeSubscription: UserSubscription | null;
      }>("/me/subscriptions");
      if (requestId !== subscriptionRequestRef.current) return;
      setSubscriptions(result.subscriptions);
      setActiveSubscription(result.activeSubscription);
    } catch (error) {
      if (requestId !== subscriptionRequestRef.current) return;
      setSubscriptionError(errorToText(error));
    } finally {
      if (requestId === subscriptionRequestRef.current) {
        setSubscriptionLoading(false);
      }
    }
  }

  const switchableSubscriptions = subscriptions.filter(
    (subscription) =>
      !subscription.active &&
      subscription.status !== "EXPIRED" &&
      subscription.status !== "DISABLED" &&
      subscription.remainingSeconds > 0,
  );

  async function refreshWalletAfterMutation(successMessage: string) {
    await loadSubscriptions();
    try {
      await onChanged();
      toast(successMessage);
    } catch (error) {
      toast(
        `${successMessage}，但钱包摘要刷新失败：${errorToText(error)}`,
        "error",
      );
    }
  }

  async function activateSelected() {
    if (!selectedSubscriptionId) return;
    setSwitchError(null);
    setActivatingId(selectedSubscriptionId);
    try {
      await apiFetch(`/me/subscriptions/${selectedSubscriptionId}/activate`, {
        method: "POST",
      });
      setSwitchOpen(false);
      setSelectedSubscriptionId(null);
      await refreshWalletAfterMutation("订阅已切换");
    } catch (error) {
      setSwitchError(errorToText(error));
    } finally {
      setActivatingId(null);
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim();
    setRedeemError(null);
    setRedeemResult(null);
    if (!normalizedCode) {
      setRedeemError("请输入兑换码");
      return;
    }
    setRedeeming(true);
    try {
      const result = await apiFetch<{
        redeemed: {
          type: "BALANCE" | "SUBSCRIPTION";
          amount?: string;
          currency?: string;
          subscriptionPlan?: { name: string; durationDays: number };
        };
      }>("/redeem-codes/redeem", {
        method: "POST",
        body: JSON.stringify({ code: normalizedCode }),
      });
      setCode("");
      if (result.redeemed.type === "SUBSCRIPTION") {
        setRedeemResult({
          type: "SUBSCRIPTION",
          planName: result.redeemed.subscriptionPlan?.name ?? "订阅套餐",
        });
      } else {
        setRedeemResult({
          type: "BALANCE",
          amount: result.redeemed.amount ?? "0",
          currency: result.redeemed.currency,
        });
      }
      await refreshWalletAfterMutation("兑换成功");
    } catch (error) {
      setRedeemError(errorToText(error));
    } finally {
      setRedeeming(false);
    }
  }

  const available = Math.max(
    0,
    Number(wallet?.balance ?? 0) - Number(wallet?.reservedBalance ?? 0),
  );
  const effectiveTier = activeSubscription?.tier ?? user.tier ?? null;

  return (
    <div className="front-page-stack">
      <section className="front-wallet-metrics">
        <WalletMetric
          label="当前访问等级"
          value={effectiveTier?.name ?? "默认等级"}
          hint={
            activeSubscription
              ? `由订阅「${activeSubscription.plan.name}」提供`
              : "账户基础权限，始终生效"
          }
          loading={accessTierLoading || subscriptionLoading}
          mono={false}
          featured
        />
        <WalletMetric
          label="可用余额"
          value={`$${money(available)}`}
          hint="可直接用于按量调用"
          loading={loading}
        />
        <WalletMetric
          label="总余额"
          value={`$${money(wallet?.balance ?? "0")}`}
          hint={`其中冻结 $${money(wallet?.reservedBalance ?? "0")}`}
          loading={loading}
        />
        <WalletMetric
          label="订阅权益"
          value={activeSubscription?.plan.name ?? "未启用"}
          hint={
            activeSubscription
              ? `提供 ${activeSubscription.tier.name} 等级与套餐额度`
              : "可选权益，不影响访问等级"
          }
          loading={subscriptionLoading}
          mono={false}
        />
      </section>

      <FrontAlert
        tone="info"
        title="访问等级是基础，订阅是可选权益"
        className="front-wallet-explainer"
      >
        访问等级决定默认可用模型、扣费倍率与运行限制，并且始终会有一个等级生效；订阅可以在有效期内提供新的访问等级或套餐额度。显示“未启用订阅”不代表访问等级没有生效。
      </FrontAlert>

      {subscriptionError ? (
        <FrontAlert tone="error" title="订阅信息加载失败">
          <div className="front-inline-retry">
            <span>{subscriptionError}</span>
            <FrontButton variant="secondary" onClick={() => void loadSubscriptions()}>
              重试
            </FrontButton>
          </div>
        </FrontAlert>
      ) : null}

      <section
        className="front-wallet-entitlement-grid"
        aria-label="访问等级与订阅权益"
      >
        <AccessTierCard
          currentTier={user.tier ?? null}
          tiers={accessTiers}
          switchingTierId={switchingTierId}
          loading={accessTierLoading}
          subscriptionLoading={subscriptionLoading}
          subscriptionError={subscriptionError}
          activeSubscription={activeSubscription}
          onSelect={onSelectTier}
        />

        <FrontCard className="front-subscription-card">
          <div className="front-page-section-head">
            <div>
              <h2>订阅权益</h2>
              <p>可提供临时访问等级或套餐额度；未订阅时继续使用基础等级和钱包余额。</p>
            </div>
            <div className="front-section-actions">
              <FrontBadge
                tone={
                  subscriptionLoading
                    ? "primary"
                    : subscriptionError
                      ? "warning"
                      : activeSubscription
                        ? "success"
                        : "neutral"
                }
              >
                {subscriptionLoading
                  ? "读取中"
                  : subscriptionError
                    ? "读取失败"
                    : activeSubscription
                      ? "生效中"
                      : "未启用"}
              </FrontBadge>
              {switchableSubscriptions.length > 0 ? (
                <FrontButton
                  variant="secondary"
                  onClick={() => {
                    setSelectedSubscriptionId(null);
                    setSwitchError(null);
                    setSwitchOpen(true);
                  }}
                >
                  切换订阅
                </FrontButton>
              ) : null}
            </div>
          </div>

          {subscriptionLoading ? (
            <div className="front-subscription-skeleton">
              <FrontSkeleton height={80} />
              <FrontSkeleton height={120} />
            </div>
          ) : subscriptionError ? (
            <FrontEmptyState
              icon={<PackageCheck aria-hidden="true" size={24} />}
              title="暂时无法确认订阅权益"
              description="请使用页面上方的重试按钮重新读取。访问等级状态会在订阅信息确认后同步显示。"
            />
          ) : activeSubscription ? (
            <SubscriptionOverview subscription={activeSubscription} />
          ) : (
            <FrontEmptyState
              icon={<PackageCheck aria-hidden="true" size={24} />}
              title="当前未启用订阅权益"
              description={`这不影响访问等级。「${effectiveTier?.name ?? "默认等级"}」仍在正常生效，调用会按该等级并使用钱包余额计费。`}
              action={
                <FrontButton variant="secondary" onClick={() => document.getElementById("front-redeem-code")?.focus()}>
                  <Ticket aria-hidden="true" size={17} />
                  兑换订阅权益
                </FrontButton>
              }
            />
          )}
        </FrontCard>
      </section>

      <FrontCard className="front-redeem-card">
        <div className="front-page-section-head">
          <div>
            <h2>兑换余额或订阅权益</h2>
            <p>粘贴已有兑换码，系统会自动识别类型。</p>
          </div>
          <Ticket aria-hidden="true" className="front-section-icon" size={20} />
        </div>
        <form className="front-redeem-form" onSubmit={redeem}>
          <FrontField
            label="兑换码"
            htmlFor="front-redeem-code"
            error={redeemError}
            hint="输入内容会自动去除首尾空格"
          >
            <div className="front-redeem-control-row">
              <input
                id="front-redeem-code"
                className="front-input front-input-mono"
                value={code}
                disabled={redeeming}
                onChange={(event) => {
                  setCode(event.target.value);
                  setRedeemError(null);
                  setRedeemResult(null);
                }}
                placeholder="rdm_..."
                autoComplete="off"
              />
              <FrontButton
                variant="secondary"
                type="button"
                disabled={redeeming}
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    setCode(text.trim());
                  } catch {
                    toast("无法读取剪贴板，请手动粘贴", "error");
                  }
                }}
              >
                <Copy aria-hidden="true" size={17} />
                粘贴
              </FrontButton>
              <FrontButton
                type="submit"
                loading={redeeming}
                disabled={!code.trim()}
              >
                {redeeming ? "兑换中" : "立即兑换"}
              </FrontButton>
            </div>
          </FrontField>
        </form>

        {redeemResult ? (
          <div className="front-redeem-result">
            <CheckCircle2 aria-hidden="true" size={22} />
            <div>
              <strong>兑换成功</strong>
              <p>
                {redeemResult.type === "SUBSCRIPTION"
                  ? `已获得订阅：${redeemResult.planName}`
                  : `已获得 $${money(redeemResult.amount)} ${redeemResult.currency ?? wallet?.currency ?? "USD"}`}
              </p>
            </div>
          </div>
        ) : null}
      </FrontCard>

      <FrontDialog
        open={switchOpen}
        onOpenChange={(open) => {
          setSwitchOpen(open);
          if (!open) {
            setSelectedSubscriptionId(null);
            setSwitchError(null);
          }
        }}
        title="切换订阅"
        description="先选择一个未过期套餐，再统一确认切换。"
        footer={
          <>
            <FrontButton variant="secondary" onClick={() => setSwitchOpen(false)}>
              取消
            </FrontButton>
            <FrontButton
              loading={Boolean(activatingId)}
              disabled={!selectedSubscriptionId}
              onClick={() => void activateSelected()}
            >
              {activatingId ? `正在切换 ${activatingId.slice(-6)}` : "确认切换"}
            </FrontButton>
          </>
        }
      >
        {switchError ? (
          <FrontAlert tone="error" title="订阅切换失败">
            {switchError}。请检查套餐状态后重试。
          </FrontAlert>
        ) : null}
        {switchableSubscriptions.length > 0 ? (
          <div className="front-subscription-options">
            {switchableSubscriptions.map((subscription) => (
              <label
                className={`front-subscription-option${selectedSubscriptionId === subscription.id ? " front-active" : ""}`}
                key={subscription.id}
              >
                <input
                  type="radio"
                  name="front-subscription"
                  checked={selectedSubscriptionId === subscription.id}
                  disabled={Boolean(activatingId)}
                  onChange={() => setSelectedSubscriptionId(subscription.id)}
                />
                <div>
                  <strong>{subscription.plan.name}</strong>
                  <span>{subscription.tier.name} · {formatQuota(subscription)}</span>
                  <span>剩余 {formatDuration(subscription.remainingSeconds)}</span>
                </div>
                {subscriptionStatusBadge(subscription.status)}
              </label>
            ))}
          </div>
        ) : (
          <FrontEmptyState
            icon={<PackageCheck aria-hidden="true" size={24} />}
            title="暂无可切换订阅"
            description="当前没有未过期且可启用的其他套餐。"
          />
        )}
      </FrontDialog>
    </div>
  );
}

function SubscriptionOverview({ subscription }: { subscription: UserSubscription }) {
  const usedPercent = quotaUsedPercent(subscription);
  return (
    <div className="front-subscription-overview">
      <div className="front-subscription-hero">
        <div>
          <FrontBadge tone="success">当前生效</FrontBadge>
          <h3>{subscription.plan.name}</h3>
          <p>订阅提供等级：{subscription.tier.name}</p>
        </div>
        <CreditCard aria-hidden="true" size={28} />
      </div>
      <div className="front-subscription-stats">
        <SubscriptionStat label="额度模式" value={quotaModeLabel(subscription.quotaMode)} />
        <SubscriptionStat label="已使用" value={`$${money(quotaUsed(subscription))}`} />
        <SubscriptionStat label="剩余额度" value={quotaRemaining(subscription)} />
        <SubscriptionStat label="到期时间" value={dateTime(subscription.endsAt)} />
        <SubscriptionStat label="剩余时间" value={formatDuration(subscription.remainingSeconds)} />
        <SubscriptionStat label="下次刷新" value={dateTime(subscription.nextQuotaRefreshAt)} />
      </div>
      {subscription.quotaMode === "UNLIMITED" ? (
        <FrontAlert tone="success">当前套餐为无限额度，不显示百分比进度。</FrontAlert>
      ) : (
        <div className="front-subscription-progress">
          <div>
            <span>已使用百分比</span>
            <strong>{usedPercent.toFixed(1)}%</strong>
          </div>
          <div
            className="front-progress-track"
            role="progressbar"
            aria-label="订阅额度已使用百分比"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(usedPercent.toFixed(1))}
          >
            <span style={{ width: `${usedPercent}%` }} />
          </div>
        </div>
      )}
      <div className="front-subscription-time-row">
        <span><Clock3 aria-hidden="true" size={16} /> 剩余 {formatDuration(subscription.remainingSeconds)}</span>
        {subscription.nextQuotaRefreshAt ? (
          <span><RefreshCw aria-hidden="true" size={16} /> 下次刷新 {dateTime(subscription.nextQuotaRefreshAt)}</span>
        ) : null}
      </div>
    </div>
  );
}

function WalletMetric({
  label,
  value,
  hint,
  loading,
  mono = true,
  featured = false,
}: {
  label: string;
  value: string;
  hint: string;
  loading: boolean;
  mono?: boolean;
  featured?: boolean;
}) {
  return (
    <FrontCard
      variant="metric"
      className={`front-wallet-metric${featured ? " front-featured" : ""}`}
    >
      <span>{label}</span>
      {loading ? (
        <FrontSkeleton height={28} width="65%" />
      ) : (
        <strong className={mono ? "front-data-number" : undefined}>{value}</strong>
      )}
      <small>{hint}</small>
    </FrontCard>
  );
}

function SubscriptionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="front-subscription-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MobileValue({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`front-mobile-value${wide ? " front-mobile-value-wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BillingDetails({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [rows, setRows] = useState<FrontTransaction[]>([]);
  const [pagination, setPagination] = useState<FrontPaginationMeta>({
    page: 1,
    pageSize: BILLING_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  async function loadPage(page = pagination.page) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        transactions: FrontTransaction[];
        pagination: FrontPaginationMeta;
      }>(`/wallet/transactions?page=${page}&pageSize=${BILLING_PAGE_SIZE}`);
      if (requestId !== requestIdRef.current) return;
      const totalPages = Math.max(1, result.pagination.totalPages || 1);
      if (result.pagination.page > totalPages) {
        await loadPage(totalPages);
        return;
      }
      setRows(result.transactions);
      setPagination({
        ...result.pagination,
        pageSize: BILLING_PAGE_SIZE,
        totalPages,
      });
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(errorToText(loadError));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadPage();
  }, [refreshSignal]);

  const columns = useMemo<ColumnDef<FrontTransaction, unknown>[]>(
    () => [
      { id: "type", header: "类型", cell: ({ row }) => transactionTypeBadge(row.original.type) },
      { id: "payment", header: "支付方式", cell: ({ row }) => paymentType(row.original) },
      {
        id: "charge",
        header: "花费",
        cell: ({ row }) => (
          <span className="front-money">{chargeDisplay(row.original)}</span>
        ),
      },
      {
        accessorKey: "amount",
        header: "余额变化",
        cell: ({ row }) => (
          <span className={`front-transaction-delta ${Number(row.original.amount) >= 0 ? "front-positive" : "front-negative"}`}>
            {signedMoney(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: "balanceAfter",
        header: "变化后余额",
        cell: ({ row }) => <span className="front-money">${money(row.original.balanceAfter)}</span>,
      },
      {
        accessorKey: "remark",
        header: "备注",
        cell: ({ row }) => <span className="front-remark" title={row.original.remark ?? ""}>{row.original.remark || "-"}</span>,
      },
      { accessorKey: "createdAt", header: "时间", cell: ({ row }) => dateTime(row.original.createdAt) },
    ],
    [],
  );

  return (
    <div className="front-page-stack">
      <FrontCard>
        <div className="front-page-section-head">
          <div>
            <h2>账单明细</h2>
            <p>共 {pagination.total} 条记录，每页固定 {BILLING_PAGE_SIZE} 条；余额变化正负号表示资金方向。</p>
          </div>
          <FrontButton variant="secondary" loading={loading} onClick={() => void loadPage()}>
            {loading ? null : <RefreshCw aria-hidden="true" size={17} />}
            刷新本页
          </FrontButton>
        </div>
        {error ? (
          <FrontAlert tone="error" title="账单加载失败">
            <div className="front-inline-retry"><span>{error}</span><FrontButton variant="secondary" onClick={() => void loadPage()}>重试本页</FrontButton></div>
          </FrontAlert>
        ) : null}
        <FrontDataTable
          key={`billing-table-${pagination.page}`}
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          loading={loading}
          empty={<FrontEmptyState icon={<WalletCards aria-hidden="true" size={24} />} title="暂无账单记录" description="充值、兑换或产生调用费用后，余额变化会显示在这里。" />}
          mobileRow={(transaction) => (
            <FrontCard className="front-mobile-record">
              <div className="front-mobile-record-head"><div><strong>{transactionTypeLabel(transaction.type)}</strong><span>{dateTime(transaction.createdAt)}</span></div>{transactionTypeBadge(transaction.type)}</div>
              <div className="front-mobile-record-grid">
                <MobileValue label="支付方式" value={paymentType(transaction)} />
                <MobileValue label="花费" value={chargeDisplay(transaction)} />
                <MobileValue label="余额变化" value={signedMoney(transaction.amount)} />
                <MobileValue label="变化后" value={`$${money(transaction.balanceAfter)}`} />
                <MobileValue label="之前余额" value={`$${money(transaction.balanceBefore)}`} wide />
                <MobileValue label="备注" value={transaction.remark || "-"} wide />
              </div>
            </FrontCard>
          )}
          className="front-billing-data-table front-fixed-page-data-table"
        />
        <FrontPagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          totalLabel={`共 ${pagination.total} 条 · 每页 ${BILLING_PAGE_SIZE} 条`}
          disabled={loading}
          onPageChange={(page) => void loadPage(page)}
        />
      </FrontCard>
    </div>
  );
}

function quotaUsedPercent(subscription: UserSubscription) {
  if (subscription.quotaMode === "UNLIMITED") return 0;
  const used = Number(
    subscription.quotaMode === "TOTAL" ? subscription.totalUsedUsd : subscription.todayUsedUsd,
  );
  const total =
    subscription.quotaMode === "TOTAL"
      ? used + Number(subscription.totalRemainingUsd ?? 0)
      : Number(subscription.quotaAmountUsd ?? 0);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function quotaUsed(subscription: UserSubscription) {
  return subscription.quotaMode === "TOTAL"
    ? subscription.totalUsedUsd
    : subscription.todayUsedUsd;
}

function quotaRemaining(subscription: UserSubscription) {
  if (subscription.quotaMode === "UNLIMITED") return "无限额度";
  const value = subscription.quotaMode === "TOTAL" ? subscription.totalRemainingUsd : subscription.todayRemainingUsd;
  return `$${money(value ?? "0")}`;
}

function quotaModeLabel(mode: UserSubscription["quotaMode"]) {
  if (mode === "UNLIMITED") return "无限额度";
  if (mode === "DAILY") return "每日额度";
  return "总额度";
}

function formatQuota(subscription: UserSubscription) {
  if (subscription.quotaMode === "UNLIMITED") return "无限额度";
  return `剩余 ${quotaRemaining(subscription)}`;
}

function subscriptionStatusBadge(status: string) {
  if (status === "ACTIVE") return <FrontBadge tone="success">可用</FrontBadge>;
  if (status === "QUEUED") return <FrontBadge tone="primary">待启用</FrontBadge>;
  if (status === "EXPIRED") return <FrontBadge tone="neutral">已过期</FrontBadge>;
  return <FrontBadge tone="warning">{status}</FrontBadge>;
}

function transactionTypeLabel(type: string) {
  if (type === "RECHARGE") return "充值";
  if (type === "CHARGE") return "消费";
  if (type === "REFUND") return "退款";
  if (type === "ADJUST") return "余额调整";
  return type;
}

function transactionTypeBadge(type: string) {
  const tone = type === "RECHARGE" || type === "REFUND" ? "success" : type === "CHARGE" ? "warning" : "neutral";
  return <FrontBadge tone={tone}>{transactionTypeLabel(type)}</FrontBadge>;
}

function chargeAmount(item: FrontTransaction) {
  if (item.type !== "CHARGE") return item.amount;
  return item.metadata?.chargedAmountUsd ?? item.apiRequest?.chargedAmountUsd ?? item.amount.replace(/^-/, "");
}

function chargeDisplay(item: FrontTransaction) {
  return item.type === "CHARGE" ? `$${money(chargeAmount(item))}` : "—";
}

function paymentType(item: FrontTransaction) {
  if (item.type !== "CHARGE") return "-";
  const subscription = Number(item.metadata?.subscriptionChargedAmountUsd ?? item.apiRequest?.subscriptionChargedAmountUsd ?? "0");
  const wallet = Number(item.metadata?.walletChargedAmountUsd ?? item.apiRequest?.walletChargedAmountUsd ?? item.amount.replace(/^-/, ""));
  if (subscription > 0 && wallet > 0) return "订阅 + 余额";
  if (subscription > 0 || item.source === "SUBSCRIPTION_ONLY") return "订阅";
  return "余额";
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
