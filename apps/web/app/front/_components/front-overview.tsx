"use client";

import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Coins,
  KeyRound,
  Layers3,
  Route,
  Send,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { apiV1BaseUrl } from "../../../lib/api";
import { formatNumber, money } from "../../../lib/format";
import type {
  FrontAvailableModel,
  FrontUsageSummary,
  FrontWallet,
} from "../../../lib/types/front";
import type { ApiKey } from "./frontend-keys";
import type { FrontTab } from "./front-app-shell";
import {
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontCopyButton,
  FrontEmptyState,
  FrontSkeleton,
} from "./ui/front-ui";

export function FrontOverview({
  wallet,
  summary,
  apiKeys,
  availableModels,
  loading,
  onNavigate,
}: {
  wallet: FrontWallet | null;
  summary: FrontUsageSummary | null;
  apiKeys: ApiKey[];
  availableModels: FrontAvailableModel[];
  loading: {
    wallet: boolean;
    summary: boolean;
    keys: boolean;
    models: boolean;
  };
  onNavigate: (tab: FrontTab) => void;
}) {
  const activeKeys = apiKeys.filter((key) => key.status === "ACTIVE").length;
  const available = availableBalance(wallet);

  return (
    <div className="front-page-stack front-overview">
      <FrontCard className="front-overview-summary-card">
        <div className="front-overview-summary-head">
          <div>
            <h2>数据总览</h2>
            <p>余额、调用与 Token 使用情况。</p>
          </div>
        </div>

        <div className="front-overview-summary-main">
          <section className="front-overview-balance-panel" aria-label="账户余额">
            <div className="front-overview-balance-label">
              <WalletCards aria-hidden="true" size={18} />
              <span>可用余额</span>
            </div>
            {loading.wallet ? (
              <FrontSkeleton height={34} width="68%" />
            ) : (
              <strong className="front-overview-balance-value front-data-number">
                ${money(available)}
              </strong>
            )}
            {loading.wallet ? (
              <FrontSkeleton height={46} />
            ) : (
              <div className="front-overview-balance-details">
                <span>
                  <small>总余额</small>
                  <strong className="front-data-number">${money(wallet?.balance ?? "0")}</strong>
                </span>
                <span>
                  <small>冻结金额</small>
                  <strong className="front-data-number">${money(wallet?.reservedBalance ?? "0")}</strong>
                </span>
              </div>
            )}
          </section>

          <div className="front-overview-stat-grid">
            <OverviewStat
              icon={<Route aria-hidden="true" size={17} />}
              label="累计请求"
              value={formatNumber(summary?.totals.requests ?? 0)}
              loading={loading.summary}
            />
            <OverviewStat
              icon={<Coins aria-hidden="true" size={17} />}
              label="累计扣费"
              value={`$${money(summary?.totals.chargedAmountUsd ?? 0)}`}
              loading={loading.summary}
            />
            <OverviewStat
              icon={<KeyRound aria-hidden="true" size={17} />}
              label="活跃 API Key"
              value={String(activeKeys)}
              loading={loading.keys}
              action={
                <button
                  aria-label="管理 API Key"
                  className="front-overview-stat-action"
                  onClick={() => onNavigate("keys")}
                  type="button"
                >
                  管理 <ArrowRight aria-hidden="true" size={13} />
                </button>
              }
            />
            <OverviewStat
              icon={<Layers3 aria-hidden="true" size={17} />}
              label="累计 Token"
              value={formatNumber(summary?.totals.totalTokens ?? 0)}
              loading={loading.summary}
            />
          </div>
        </div>

        <div className="front-overview-token-strip" aria-label="Token 使用明细">
          <OverviewTokenDetail
            label="输入 Token"
            value={summary?.totals.inputTokens ?? 0}
            loading={loading.summary}
          />
          <OverviewTokenDetail
            label="缓存 Token"
            value={summary?.totals.cachedInputTokens ?? 0}
            loading={loading.summary}
          />
          <OverviewTokenDetail
            label="输出 Token"
            value={summary?.totals.outputTokens ?? 0}
            loading={loading.summary}
          />
        </div>
      </FrontCard>

      <section className="front-overview-primary-grid">
        <QuickAccessCard />
        <QuickStartCard
          hasKey={activeKeys > 0}
          hasRequest={(summary?.totals.requests ?? 0) > 0}
          onNavigate={onNavigate}
        />
      </section>

      <AvailableModelsCard models={availableModels} loading={loading.models} />

    </div>
  );
}

function OverviewStat({
  icon,
  label,
  value,
  loading,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="front-overview-stat">
      <div className="front-overview-stat-head">
        <span className="front-overview-stat-label">
          {icon}
          {label}
        </span>
        {action}
      </div>
      {loading ? (
        <FrontSkeleton height={26} width="64%" />
      ) : (
        <strong className="front-data-number">{value}</strong>
      )}
    </div>
  );
}

function OverviewTokenDetail({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <div className="front-overview-token-item">
      <span>{label}</span>
      {loading ? (
        <FrontSkeleton height={18} width="58%" />
      ) : (
        <strong className="front-data-number">{formatNumber(value)}</strong>
      )}
    </div>
  );
}

function QuickAccessCard() {
  const endpoints = [
    { label: "Base URL", value: apiV1BaseUrl },
    { label: "Responses", value: `${apiV1BaseUrl}/responses` },
    {
      label: "Chat Completions",
      value: `${apiV1BaseUrl}/chat/completions`,
    },
  ];

  return (
    <FrontCard className="front-quick-access-card">
      <div className="front-page-section-head">
        <div>
          <h2>快速接入</h2>
          <p>复制网关地址后替换 SDK 的 Base URL。</p>
        </div>
        <Route aria-hidden="true" className="front-section-icon" size={20} />
      </div>
      <div className="front-endpoint-list">
        {endpoints.map((endpoint) => (
          <div className="front-endpoint-row" key={endpoint.label}>
            <span>{endpoint.label}</span>
            <code>{endpoint.value}</code>
            <FrontCopyButton value={endpoint.value} label={`复制 ${endpoint.label}`} compact />
          </div>
        ))}
      </div>
    </FrontCard>
  );
}

function QuickStartCard({
  hasKey,
  hasRequest,
  onNavigate,
}: {
  hasKey: boolean;
  hasRequest: boolean;
  onNavigate: (tab: FrontTab) => void;
}) {
  const steps = [
    {
      title: "创建 API Key",
      description: "生成一枚用于服务端调用的密钥。",
      done: hasKey,
      action: () => onNavigate("keys"),
      actionLabel: hasKey ? "查看密钥" : "创建密钥",
    },
    {
      title: "复制 Base URL",
      description: "将 SDK 地址替换为 APIshare 网关地址。",
      done: true,
      action: undefined,
      actionLabel: "已就绪",
    },
    {
      title: "发送测试请求",
      description: "使用调用测试确认模型链路可用。",
      done: hasRequest,
      action: () => onNavigate("test"),
      actionLabel: hasRequest ? "再次测试" : "开始测试",
    },
  ];

  return (
    <FrontCard className="front-quick-start-card">
      <div className="front-page-section-head">
        <div>
          <h2>三步完成接入</h2>
          <p>按照状态逐步完成首次网关调用。</p>
        </div>
        <Send aria-hidden="true" className="front-section-icon" size={20} />
      </div>
      <div className="front-quick-steps">
        {steps.map((step, index) => (
          <div className={`front-quick-step${step.done ? " front-done" : ""}`} key={step.title}>
            <span className="front-quick-step-index">
              {step.done ? <CheckCircle2 aria-hidden="true" size={18} /> : index + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </div>
            {step.action ? (
              <FrontButton variant="ghost" onClick={step.action}>
                {step.actionLabel}
                <ArrowRight aria-hidden="true" size={14} />
              </FrontButton>
            ) : (
              <FrontBadge tone="success">已就绪</FrontBadge>
            )}
          </div>
        ))}
      </div>
    </FrontCard>
  );
}

function AvailableModelsCard({
  models,
  loading,
}: {
  models: FrontAvailableModel[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleModels = expanded ? models : models.slice(0, 8);

  return (
    <FrontCard className="front-models-card">
      <div className="front-page-section-head">
        <div>
          <h2>可用模型</h2>
          <p>当前访问等级下已就绪的模型。</p>
        </div>
        <FrontBadge tone={models.length > 0 ? "success" : "neutral"}>
          <Layers3 aria-hidden="true" size={14} />
          {models.length} 个
        </FrontBadge>
      </div>
      {loading ? (
        <div className="front-model-list">
          <FrontSkeleton height={36} />
          <FrontSkeleton height={36} />
          <FrontSkeleton height={36} />
        </div>
      ) : models.length > 0 ? (
        <>
          <div className="front-model-list">
            {visibleModels.map((model) => (
              <div className="front-model-row" key={model.model} title={model.model}>
                <Circle aria-hidden="true" fill="currentColor" size={8} />
                <code>{model.model}</code>
              </div>
            ))}
          </div>
          {models.length > 8 ? (
            <FrontButton variant="ghost" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "收起模型" : `展开全部 ${models.length} 个模型`}
            </FrontButton>
          ) : null}
        </>
      ) : (
        <FrontEmptyState
          icon={<Layers3 aria-hidden="true" size={24} />}
          title="暂无可用模型"
          description="当前访问等级还没有就绪模型，请稍后刷新或联系管理员。"
        />
      )}
    </FrontCard>
  );
}

function availableBalance(wallet: FrontWallet | null) {
  return Math.max(
    0,
    Number(wallet?.balance ?? 0) - Number(wallet?.reservedBalance ?? 0),
  );
}
