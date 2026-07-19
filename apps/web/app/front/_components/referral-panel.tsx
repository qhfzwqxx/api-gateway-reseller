"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Gift, Link2, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { dateTime, money } from "../../../lib/format";
import {
  FrontAlert,
  FrontBadge,
  FrontButton,
  FrontCard,
  FrontCopyButton,
  FrontDataTable,
  FrontEmptyState,
  FrontSkeleton,
} from "./ui/front-ui";

type RewardType = "NONE" | "BALANCE" | "SUBSCRIPTION";
type RewardSettings = {
  type: RewardType;
  amountUsd: string;
  subscriptionPlanId: string | null;
};
type ReferralInvite = {
  id: string;
  status: string;
  inviterRewardType: RewardType;
  inviteeRewardType: RewardType;
  inviterRewardedAt: string | null;
  inviteeRewardedAt: string | null;
  createdAt: string;
  invitee: { id: string; email: string; createdAt: string };
};
type ReferralDashboard = {
  profile: {
    code: string;
    status: "ACTIVE" | "DISABLED";
    successfulInvites: number;
    rewardedInvites: number;
  };
  inviteLink: string;
  settings: {
    enabled: boolean;
    inviterReward: RewardSettings;
    inviteeReward: RewardSettings;
  };
  invites: ReferralInvite[];
};

export function ReferralPanel({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReferral = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<ReferralDashboard>("/me/referral"));
    } catch (loadError) {
      setError(errorToText(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReferral();
  }, [loadReferral, refreshSignal]);

  const columns = useMemo<ColumnDef<ReferralInvite, unknown>[]>(
    () => [
      {
        accessorKey: "invitee.email",
        header: "新用户",
        cell: ({ row }) => <span className="front-break-anywhere">{row.original.invitee.email}</span>,
      },
      { accessorKey: "createdAt", header: "注册时间", cell: ({ row }) => dateTime(row.original.createdAt) },
      {
        id: "reward",
        header: "奖励状态",
        cell: ({ row }) => rewardStatusBadge(row.original),
      },
    ],
    [],
  );

  if (loading && !data) {
    return (
      <div className="front-page-stack">
        <FrontSkeleton height={230} />
        <FrontSkeleton height={260} />
      </div>
    );
  }

  if (!data) {
    return (
      <FrontCard>
        <FrontEmptyState
          icon={<Gift aria-hidden="true" size={24} />}
          title="邀请信息暂不可用"
          description={error ?? "无法读取邀请活动，请稍后重试。"}
          action={
            <FrontButton variant="secondary" onClick={() => void loadReferral()}>
              重试
            </FrontButton>
          }
        />
      </FrontCard>
    );
  }

  return (
    <div className="front-page-stack">
      {error ? <FrontAlert tone="error">{error}</FrontAlert> : null}
      {!data.settings.enabled ? (
        <FrontAlert tone="warning" title="邀请活动已关闭">
          当前继续分享链接不会产生新奖励；历史邀请记录仍然保留。
        </FrontAlert>
      ) : null}

      <FrontCard className="front-referral-hero">
        <div className="front-referral-hero-copy">
          <FrontBadge tone={data.settings.enabled ? "success" : "neutral"}>
            {data.settings.enabled ? "活动进行中" : "活动已关闭"}
          </FrontBadge>
          <h2>邀请新用户加入 APIshare</h2>
          <p>
            邀请人奖励：{rewardDescription(data.settings.inviterReward)}；新用户奖励：
            {rewardDescription(data.settings.inviteeReward)}。
          </p>
        </div>
        <Gift aria-hidden="true" size={48} />
      </FrontCard>

      <FrontCard>
        <div className="front-page-section-head">
          <div>
            <h2>专属邀请链接</h2>
            <p>链接仅展示一次，复制后可直接分享给新用户。</p>
          </div>
          <FrontButton variant="secondary" loading={loading} onClick={() => void loadReferral()}>
            {loading ? null : <RefreshCw aria-hidden="true" size={17} />}
            {loading ? "刷新中" : "刷新"}
          </FrontButton>
        </div>
        <div className="front-referral-link">
          <Link2 aria-hidden="true" size={18} />
          <code>{data.inviteLink}</code>
          <FrontCopyButton value={data.inviteLink} label="复制邀请链接" />
        </div>
        <div className="front-referral-metrics">
          <ReferralMetric label="成功邀请" value={String(data.profile.successfulInvites)} />
          <ReferralMetric label="奖励记录" value={String(data.profile.rewardedInvites)} />
          <ReferralMetric label="邀请码" value={data.profile.code} mono />
        </div>
      </FrontCard>

      <FrontCard>
        <div className="front-page-section-head">
          <div>
            <h2>最近邀请</h2>
            <p>展示注册用户、注册时间和奖励发放状态。</p>
          </div>
          <FrontBadge tone="neutral">{data.invites.length} 条</FrontBadge>
        </div>
        <FrontDataTable
          columns={columns}
          data={data.invites}
          getRowId={(row) => row.id}
          loading={loading}
          empty={
            <FrontEmptyState
              icon={<Users aria-hidden="true" size={24} />}
              title="还没有邀请记录"
              description="复制上方链接分享给朋友，新用户完成注册后会出现在这里。"
              action={<FrontCopyButton value={data.inviteLink} label="复制邀请链接" />}
            />
          }
          mobileRow={(invite) => (
            <FrontCard className="front-mobile-record">
              <div className="front-mobile-record-head">
                <div><strong>{invite.invitee.email}</strong><span>{dateTime(invite.createdAt)}</span></div>
                {rewardStatusBadge(invite)}
              </div>
            </FrontCard>
          )}
        />
      </FrontCard>
    </div>
  );
}

function ReferralMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="front-referral-metric">
      <span>{label}</span>
      <strong className={mono ? "front-mono" : undefined}>{value}</strong>
    </div>
  );
}

function rewardDescription(reward: RewardSettings) {
  if (reward.type === "BALANCE") return `$${money(reward.amountUsd)} 余额`;
  if (reward.type === "SUBSCRIPTION") return "订阅套餐";
  return "无额外奖励";
}

function rewardStatusBadge(invite: ReferralInvite) {
  const rewarded = Boolean(invite.inviterRewardedAt || invite.inviteeRewardedAt);
  if (rewarded) return <FrontBadge tone="success">已发放</FrontBadge>;
  if (invite.status === "SUCCESS") return <FrontBadge tone="warning">待发放</FrontBadge>;
  return <FrontBadge tone="neutral">{invite.status}</FrontBadge>;
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "邀请信息加载失败";
}
