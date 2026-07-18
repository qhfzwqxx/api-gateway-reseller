"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Save, Users } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { adminFetch, adminQueryKeys } from "../_components/admin-api";
import { dateTime, money } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import {
  AdminDataTable,
  AdminPanel,
  MobileEmpty,
  StatusPill,
  StatusTile,
} from "../_components/admin-ui";

type RewardType = "NONE" | "BALANCE" | "SUBSCRIPTION";

type ReferralRewardSettings = {
  type: RewardType;
  amountUsd: string;
  subscriptionPlanId: string | null;
};

type ReferralSettings = {
  enabled: boolean;
  inviteBaseUrl: string;
  inviterReward: ReferralRewardSettings;
  inviteeReward: ReferralRewardSettings;
};

type SubscriptionPlan = {
  id: string;
  name: string;
  status: string;
  durationDays: number;
};

type ReferralInvite = {
  id: string;
  code: string;
  status: "REWARDED" | "SKIPPED";
  inviterRewardType: RewardType;
  inviterRewardAmount: string;
  inviterRewardPlanId: string | null;
  inviteeRewardType: RewardType;
  inviteeRewardAmount: string;
  inviteeRewardPlanId: string | null;
  inviterRewardedAt: string | null;
  inviteeRewardedAt: string | null;
  createdAt: string;
  inviter: { id: string; email: string };
  invitee: { id: string; email: string; createdAt: string };
};

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminReferrals({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const { data: settingsData, error: settingsError, isFetching: loadingSettings } =
    useAdminResource<{ settings: ReferralSettings }>(
      "referralSettings",
      "/admin/referral-settings",
    );
  const { data: invitesData, error: invitesError, isFetching: loadingInvites, refetch } =
    useAdminResource<{ invites: ReferralInvite[] }>(
      "referrals",
      "/admin/referrals",
    );
  const { data: plansData } = useAdminResource<{ plans: SubscriptionPlan[] }>(
    "subscriptionPlans",
    "/admin/subscription-plans",
  );

  const settings = settingsData?.settings ?? null;
  const invites = invitesData?.invites ?? [];
  const activePlans = (plansData?.plans ?? []).filter(
    (plan) => plan.status === "ACTIVE",
  );

  const [enabled, setEnabled] = useState(true);
  const [inviteBaseUrl, setInviteBaseUrl] = useState("");
  const [inviterReward, setInviterReward] = useState<ReferralRewardSettings>({
    type: "NONE",
    amountUsd: "0",
    subscriptionPlanId: null,
  });
  const [inviteeReward, setInviteeReward] = useState<ReferralRewardSettings>({
    type: "NONE",
    amountUsd: "0",
    subscriptionPlanId: null,
  });

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setInviteBaseUrl(settings.inviteBaseUrl);
    setInviterReward(settings.inviterReward);
    setInviteeReward(settings.inviteeReward);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (payload: ReferralSettings) =>
      adminFetch<{ settings: ReferralSettings }>("/admin/referral-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.resource(
          "referralSettings",
          "/admin/referral-settings",
        ),
      });
    },
    onError: (saveError) => onError(errorToText(saveError)),
  });

  const totals = useMemo(() => {
    const inviterRewards = invites.filter(
      (invite) => invite.inviterRewardedAt,
    ).length;
    const inviteeRewards = invites.filter(
      (invite) => invite.inviteeRewardedAt,
    ).length;
    return { inviterRewards, inviteeRewards };
  }, [invites]);

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    saveMutation.mutate({
      enabled,
      inviteBaseUrl,
      inviterReward,
      inviteeReward,
    });
  }

  const columns = [
    {
      header: "邀请人",
      cell: ({ row }: { row: { original: ReferralInvite } }) =>
        row.original.inviter.email,
    },
    {
      header: "被邀请人",
      cell: ({ row }: { row: { original: ReferralInvite } }) => (
        <>
          <strong>{row.original.invitee.email}</strong>
          <span className="muted">{dateTime(row.original.invitee.createdAt)}</span>
        </>
      ),
    },
    {
      header: "邀请码",
      cell: ({ row }: { row: { original: ReferralInvite } }) =>
        row.original.code,
    },
    {
      header: "邀请人奖励",
      cell: ({ row }: { row: { original: ReferralInvite } }) =>
        rewardLabel(row.original.inviterRewardType, row.original.inviterRewardAmount, row.original.inviterRewardPlanId, activePlans),
    },
    {
      header: "新人奖励",
      cell: ({ row }: { row: { original: ReferralInvite } }) =>
        rewardLabel(row.original.inviteeRewardType, row.original.inviteeRewardAmount, row.original.inviteeRewardPlanId, activePlans),
    },
    {
      header: "状态",
      cell: ({ row }: { row: { original: ReferralInvite } }) => (
        <StatusPill status={row.original.status} />
      ),
    },
    {
      header: "时间",
      cell: ({ row }: { row: { original: ReferralInvite } }) =>
        dateTime(row.original.createdAt),
    },
  ];

  if (settingsError) {
    return <div className="error compact-error">{errorToText(settingsError)}</div>;
  }

  return (
    <div className="grid admin-page">
      <section className="admin-hero-panel">
        <div>
          <span className="eyebrow">Referral Rewards</span>
          <h2>邀请奖励</h2>
          <p>新用户通过专属邀请链接注册后，按这里的配置给双方发放一次性奖励。</p>
        </div>
        <div className="admin-hero-actions">
          <button
            className="button secondary"
            disabled={loadingInvites}
            onClick={() => void refetch()}
            type="button"
          >
            <RefreshCw size={16} />
            <span>{loadingInvites ? "刷新中..." : "刷新记录"}</span>
          </button>
        </div>
      </section>

      <div className="status-grid">
        <StatusTile
          label="邀请功能"
          ok={settings?.enabled}
          value={settings?.enabled ? "开启" : "关闭"}
        />
        <StatusTile
          label="成功邀请"
          ok={undefined}
          value={`${invites.length}`}
        />
        <StatusTile
          label="邀请人奖励"
          ok={undefined}
          value={`${totals.inviterRewards}`}
        />
        <StatusTile
          label="新人奖励"
          ok={undefined}
          value={`${totals.inviteeRewards}`}
        />
      </div>

      <form className="form" onSubmit={saveSettings}>
        <AdminPanel
          title="奖励配置"
          description="双方奖励互相独立，可选择无奖励、余额或订阅套餐。"
          actions={
            <button
              className="button"
              disabled={saveMutation.isPending || loadingSettings}
              type="submit"
            >
              <Save size={16} />
              <span>{saveMutation.isPending ? "保存中..." : "保存配置"}</span>
            </button>
          }
        >
          <div className="form-grid">
            <label className="field checkbox-field">
              <input
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>启用邀请奖励</span>
            </label>
            <label className="field">
              <span>邀请链接基础地址</span>
              <input
                className="input"
                onChange={(event) => setInviteBaseUrl(event.target.value)}
                placeholder="留空时使用当前站点"
                value={inviteBaseUrl}
              />
            </label>
          </div>
          <div className="grid two-col-grid">
            <RewardEditor
              activePlans={activePlans}
              label="邀请人奖励"
              reward={inviterReward}
              onChange={setInviterReward}
            />
            <RewardEditor
              activePlans={activePlans}
              label="被邀请人奖励"
              reward={inviteeReward}
              onChange={setInviteeReward}
            />
          </div>
        </AdminPanel>
      </form>

      <AdminPanel
        title="邀请记录"
        description="展示最近 200 条通过邀请链接创建的新用户。"
      >
        {invitesError ? (
          <div className="error compact-error">{errorToText(invitesError)}</div>
        ) : invites.length ? (
          <AdminDataTable data={invites} columns={columns} />
        ) : (
          <MobileEmpty>
            <Users size={18} />
            暂无邀请记录
          </MobileEmpty>
        )}
      </AdminPanel>
    </div>
  );
}

function RewardEditor({
  activePlans,
  label,
  reward,
  onChange,
}: {
  activePlans: SubscriptionPlan[];
  label: string;
  reward: ReferralRewardSettings;
  onChange: (reward: ReferralRewardSettings) => void;
}) {
  return (
    <section className="admin-panel-subsection">
      <div className="section-head">
        <div>
          <h3 className="section-title">{label}</h3>
          <p className="section-subtitle">新用户注册成功后立即发放。</p>
        </div>
      </div>
      <label className="field">
        <span>奖励类型</span>
        <select
          className="input"
          onChange={(event) =>
            onChange({
              ...reward,
              type: event.target.value as RewardType,
            })
          }
          value={reward.type}
        >
          <option value="NONE">无奖励</option>
          <option value="BALANCE">余额</option>
          <option value="SUBSCRIPTION">订阅套餐</option>
        </select>
      </label>
      {reward.type === "BALANCE" ? (
        <label className="field">
          <span>余额金额 USD</span>
          <input
            className="input"
            inputMode="decimal"
            onChange={(event) =>
              onChange({ ...reward, amountUsd: event.target.value })
            }
            value={reward.amountUsd}
          />
        </label>
      ) : null}
      {reward.type === "SUBSCRIPTION" ? (
        <label className="field">
          <span>订阅套餐</span>
          <select
            className="input"
            onChange={(event) =>
              onChange({
                ...reward,
                subscriptionPlanId: event.target.value || null,
              })
            }
            value={reward.subscriptionPlanId ?? ""}
          >
            <option value="">请选择套餐</option>
            {activePlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {plan.durationDays} 天
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}

function rewardLabel(
  type: RewardType,
  amount: string,
  planId: string | null,
  plans: SubscriptionPlan[],
) {
  if (type === "NONE") return "无";
  if (type === "BALANCE") return `$${money(amount)}`;
  return plans.find((plan) => plan.id === planId)?.name ?? "订阅套餐";
}
