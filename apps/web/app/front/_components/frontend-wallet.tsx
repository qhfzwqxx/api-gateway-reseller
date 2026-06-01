"use client";

import { Clock3, RefreshCw, Ticket } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import type { UserSubscription } from "../../../lib/api/subscriptions";
import { dateTime, money } from "../../admin/_components/admin-format";
import {
  AdminDataTable,
  Metric,
  MobileEmpty,
  MobileField,
  MobileRecord,
  ModalShell,
} from "../../admin/_components/admin-ui";
import { Pagination } from "./Pagination";

export type Wallet = {
  id: string;
  balance: string;
  reservedBalance?: string;
  currency: string;
};

export type Transaction = {
  id: string;
  type: string;
  source?: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  remark?: string | null;
  metadata?: {
    chargedAmountUsd?: string;
    subscriptionChargedAmountUsd?: string;
    walletChargedAmountUsd?: string;
  } | null;
  apiRequest?: {
    chargedAmountUsd?: string;
    subscriptionChargedAmountUsd?: string;
    walletChargedAmountUsd?: string;
  } | null;
  createdAt: string;
};

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

export function WalletView({
  wallet,
  transactions,
  onChanged,
  onError,
}: {
  wallet: Wallet | null;
  transactions: Transaction[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  return (
    <WalletManagement
      wallet={wallet}
      transactions={transactions}
      onChanged={onChanged}
      onError={onError}
    />
  );
}

export function WalletManagement({
  wallet,
  transactions,
  onChanged,
  onError,
}: {
  wallet: Wallet | null;
  transactions: Transaction[];
  onChanged: () => void;
  onError: (error: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [activeSubscription, setActiveSubscription] =
    useState<UserSubscription | null>(null);
  const [switchModalOpen, setSwitchModalOpen] = useState(false);

  async function loadSubscriptions() {
    const result = await apiFetch<{
      subscriptions: UserSubscription[];
      activeSubscription: UserSubscription | null;
    }>("/me/subscriptions");
    setSubscriptions(result.subscriptions);
    setActiveSubscription(result.activeSubscription);
  }

  useEffect(() => {
    void loadSubscriptions().catch((error) => onError(errorToText(error)));
  }, []);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setMessage(null);
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
        body: JSON.stringify({ code }),
      });
      setCode("");
      setMessage(
        result.redeemed.type === "SUBSCRIPTION"
          ? `已兑换订阅：${result.redeemed.subscriptionPlan?.name ?? "订阅套餐"}`
          : `已兑换 $${money(result.redeemed.amount ?? "0")} ${result.redeemed.currency}`,
      );
      await loadSubscriptions();
      onChanged();
    } catch (redeemError) {
      onError(errorToText(redeemError));
    }
  }

  const switchableSubscriptions = subscriptions.filter(
    (subscription) =>
      !subscription.active &&
      subscription.status !== "EXPIRED" &&
      subscription.status !== "DISABLED" &&
      subscription.remainingSeconds > 0,
  );

  async function activateSubscription(subscriptionId: string) {
    await apiFetch(`/me/subscriptions/${subscriptionId}/activate`, {
      method: "POST",
    });
    setSwitchModalOpen(false);
    await loadSubscriptions();
    onChanged();
  }

  return (
    <div className="user-wallet-page">
      <div className="user-wallet-hero">
        <Metric label="余额" value={`$${money(wallet?.balance ?? "0")}`} />
        <Metric label="币种" value={wallet?.currency ?? "USD"} />
        <Metric label="流水数量" value={String(transactions.length)} />
      </div>
      <section className="card user-redeem-card">
        {activeSubscription ? (
          <div className="subscription-overview">
            <div className="subscription-overview-head">
              <div>
                <h2 className="section-title">订阅状态</h2>
                <div className="subscription-plan-title">
                  {activeSubscription.plan.name}
                </div>
                <div className="subscription-tier">
                  访问等级：{activeSubscription.tier.name}
                </div>
              </div>
              {switchableSubscriptions.length > 0 ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setSwitchModalOpen(true)}
                >
                  切换
                </button>
              ) : null}
            </div>
            <div className="subscription-metrics">
              <SubscriptionStat
                label="本周期已用"
                value={formatMoney(activeSubscription.todayUsedUsd)}
              />
              <SubscriptionStat
                label="剩余额度"
                value={formatQuotaRemaining(activeSubscription)}
              />
              <SubscriptionStat
                label="剩余时间"
                value={formatRemaining(activeSubscription.remainingSeconds)}
              />
              <SubscriptionStat
                label="到期时间"
                value={dateTime(activeSubscription.endsAt)}
              />
            </div>
            <div className="subscription-current-card">
              <div className="subscription-current-main">
                <div className="subscription-current-top">
                  <div>
                    <div className="subscription-current-label">当前套餐</div>
                    <div className="subscription-current-name">
                      {activeSubscription.plan.name}
                    </div>
                  </div>
                </div>
                <div className="subscription-progress">
                  <div className="subscription-progress-head">
                    <span>本周期额度</span>
                    <span>
                      {formatMoney(activeSubscription.todayUsedUsd)} /{" "}
                      {activeSubscription.quotaMode === "DAILY"
                        ? formatMoney(activeSubscription.quotaAmountUsd)
                        : formatQuotaRemaining(activeSubscription)}
                    </span>
                  </div>
                  <div className="subscription-progress-track">
                    <div
                      className="subscription-progress-value"
                      style={{
                        width: `${quotaRemainingPercent(activeSubscription)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="subscription-time-row">
                  <div>
                    <Clock3 size={15} />
                    <span>
                      剩余 {formatRemaining(activeSubscription.remainingSeconds)}
                    </span>
                  </div>
                  {activeSubscription.nextQuotaRefreshAt ? (
                    <div>
                      <RefreshCw size={15} />
                      <span>
                        下次刷新：
                        {dateTime(activeSubscription.nextQuotaRefreshAt)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <h2 className="section-title">订阅状态</h2>
            <div className="subscription-empty">当前未订阅</div>
          </>
        )}
        {switchModalOpen ? (
          <ModalShell
            title="切换订阅"
            description="选择一个未过期的订阅套餐作为当前生效套餐。"
            onClose={() => setSwitchModalOpen(false)}
          >
            <div className="grid gap-2">
              {switchableSubscriptions.map((subscription) => (
                <div
                  key={subscription.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{subscription.plan.name}</div>
                    <div className="muted">
                      剩余 {formatRemaining(subscription.remainingSeconds)}
                    </div>
                    <div className="muted">
                      {subscription.quotaMode === "UNLIMITED"
                        ? "无限额度"
                        : subscription.quotaMode === "DAILY"
                          ? `今日 ${formatMoney(subscription.todayUsedUsd)} / ${formatMoney(subscription.todayRemainingUsd ?? "0")}`
                          : `总额 ${formatMoney(subscription.totalUsedUsd)} / ${formatMoney(subscription.totalRemainingUsd ?? "0")}`}
                    </div>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void activateSubscription(subscription.id)}
                  >
                    启用
                  </button>
                </div>
              ))}
            </div>
          </ModalShell>
        ) : null}
      </section>
      <section className="card user-redeem-card">
        <h2 className="section-title">兑换码</h2>
        <form className="form inline-form" onSubmit={redeem}>
          <label className="field">
            <span>兑换码</span>
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="rdm_..."
            />
          </label>
          <button className="button" type="submit">
            <Ticket size={17} />
            兑换
          </button>
        </form>
        {message ? <div className="success">{message}</div> : null}
      </section>
    </div>
  );
}

function SubscriptionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="subscription-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRemaining(seconds: number) {
  if (seconds <= 0) return "已用完";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${Math.max(1, minutes)} 分钟`;
}

function formatMoney(value: string) {
  return money(value);
}

function formatQuotaRemaining(subscription: UserSubscription) {
  if (subscription.quotaMode === "UNLIMITED") return "∞";
  if (subscription.quotaMode === "DAILY") {
    return formatMoney(subscription.todayRemainingUsd ?? "0");
  }
  return formatMoney(subscription.totalRemainingUsd ?? "0");
}

function quotaRemainingPercent(subscription: UserSubscription) {
  if (subscription.quotaMode === "UNLIMITED") return 100;
  const used = Number(subscription.todayUsedUsd || "0");
  const total =
    subscription.quotaMode === "DAILY"
      ? Number(subscription.quotaAmountUsd || "0")
      : used + Number(subscription.totalRemainingUsd || "0");
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((total - used) / total) * 100));
}

function transactionChargeAmount(item: Transaction) {
  if (item.type !== "CHARGE") return item.amount;
  return (
    item.metadata?.chargedAmountUsd ??
    item.apiRequest?.chargedAmountUsd ??
    item.amount.replace(/^-/, "")
  );
}

function transactionBalanceDelta(item: Transaction) {
  return item.amount;
}

function transactionPaymentType(item: Transaction) {
  if (item.type !== "CHARGE") return "-";
  const subscriptionAmount = Number(
    item.metadata?.subscriptionChargedAmountUsd ??
      item.apiRequest?.subscriptionChargedAmountUsd ??
      "0",
  );
  const walletAmount = Number(
    item.metadata?.walletChargedAmountUsd ??
      item.apiRequest?.walletChargedAmountUsd ??
      item.amount.replace(/^-/, ""),
  );

  if (subscriptionAmount > 0 && walletAmount > 0) return "订阅+余额";
  if (subscriptionAmount > 0 || item.source === "SUBSCRIPTION_ONLY") {
    return "订阅";
  }
  if (walletAmount > 0 || item.source === "API_CHARGE") return "余额";
  return "-";
}

export function BillingDetails({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const [pageSize, setPageSize] = useState(18);
  const [currentPage, setCurrentPage] = useState(1);
  const [serverTransactions, setServerTransactions] =
    useState<Transaction[]>(transactions);
  const [totalTransactions, setTotalTransactions] = useState(
    transactions.length,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(totalTransactions / pageSize));
  const activePage = Math.min(currentPage, pageCount);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void apiFetch<{
      transactions: Transaction[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    }>(`/wallet/transactions?page=${activePage}&pageSize=${pageSize}`)
      .then((result) => {
        if (cancelled) return;
        setServerTransactions(result.transactions);
        setTotalTransactions(result.pagination.total);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(errorToText(error));
        setServerTransactions(transactions);
        setTotalTransactions(transactions.length);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePage, pageSize, transactions]);

  const transactionRows = serverTransactions.map((item) => ({
    id: item.id,
    type: item.type,
    paymentType: transactionPaymentType(item),
    chargeAmount: money(transactionChargeAmount(item)),
    balanceDelta: money(transactionBalanceDelta(item)),
    balanceBefore: money(item.balanceBefore),
    balanceAfter: money(item.balanceAfter),
    remark: item.remark,
    createdAt: dateTime(item.createdAt),
  }));

  return (
    <div className="user-wallet-page">
      <section className="card requests-card front-requests-card front-requests-card-paged front-records-card front-billing-card">
        <div className="requests-head">
          <h2 className="section-title">账单明细</h2>
        </div>
        <AdminDataTable
          columns={[
            { accessorKey: "type", header: "类型" },
            { accessorKey: "paymentType", header: "支付方式" },
            { accessorKey: "chargeAmount", header: "花费" },
            { accessorKey: "balanceDelta", header: "余额变动" },
            { accessorKey: "balanceBefore", header: "之前" },
            { accessorKey: "balanceAfter", header: "之后" },
            { accessorKey: "remark", header: "备注" },
            { accessorKey: "createdAt", header: "时间" },
          ]}
          data={transactionRows}
          empty={loading ? "正在加载账本流水..." : "暂无账本流水"}
        />
        {loadError ? <div className="notice">{loadError}</div> : null}
        <Pagination
          className="front-requests-pagination"
          currentPage={activePage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          pageSize={pageSize}
          pageSizeOptions={[18, 30, 50, 100]}
          totalPages={pageCount}
          totalLabel={`共 ${totalTransactions} 条`}
        />
        <div className="mobile-record-list">
          {serverTransactions.map((item) => (
            <MobileRecord
              key={item.id}
              title={item.type}
              meta={dateTime(item.createdAt)}
              badges={
                <span className="pill strong">
                  ${money(transactionChargeAmount(item))}
                </span>
              }
            >
              <MobileField label="支付方式">
                {transactionPaymentType(item)}
              </MobileField>
              <MobileField label="余额变动">
                ${money(transactionBalanceDelta(item))}
              </MobileField>
              <MobileField label="之前">${money(item.balanceBefore)}</MobileField>
              <MobileField label="之后">${money(item.balanceAfter)}</MobileField>
              <MobileField label="备注" wide>
                {item.remark || "-"}
              </MobileField>
            </MobileRecord>
          ))}
          {serverTransactions.length === 0 ? (
            <MobileEmpty>暂无账本流水</MobileEmpty>
          ) : null}
        </div>
      </section>
    </div>
  );
}
