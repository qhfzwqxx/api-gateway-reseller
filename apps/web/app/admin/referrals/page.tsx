"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, RefreshCw, Save, Users } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import http from "../../../lib/http";
import { getSubscriptionPlans, type SubscriptionPlan } from "../../../lib/api/subscriptions";

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

const emptyReward: ReferralRewardSettings = {
  type: "NONE",
  amountUsd: "0",
  subscriptionPlanId: null,
};

export default function AdminReferralsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["admin", "referral-settings"],
    queryFn: getReferralSettings,
  });
  const invitesQuery = useQuery({
    queryKey: ["admin", "referrals"],
    queryFn: getReferralInvites,
  });
  const plansQuery = useQuery({
    queryKey: ["admin", "subscription-plans"],
    queryFn: getSubscriptionPlans,
  });

  const [enabled, setEnabled] = useState(true);
  const [inviteBaseUrl, setInviteBaseUrl] = useState("");
  const [inviterReward, setInviterReward] =
    useState<ReferralRewardSettings>(emptyReward);
  const [inviteeReward, setInviteeReward] =
    useState<ReferralRewardSettings>(emptyReward);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) return;
    setEnabled(settings.enabled);
    setInviteBaseUrl(settings.inviteBaseUrl);
    setInviterReward(settings.inviterReward);
    setInviteeReward(settings.inviteeReward);
  }, [settingsQuery.data]);

  const activePlans = (plansQuery.data ?? []).filter(
    (plan) => plan.status === "ACTIVE",
  );
  const invites = invitesQuery.data ?? [];
  const totals = useMemo(
    () => ({
      inviterRewards: invites.filter((invite) => invite.inviterRewardedAt).length,
      inviteeRewards: invites.filter((invite) => invite.inviteeRewardedAt).length,
    }),
    [invites],
  );

  const saveMutation = useMutation({
    mutationFn: updateReferralSettings,
    onSuccess: (settings) => {
      setNotice("邀请奖励配置已保存");
      queryClient.setQueryData(["admin", "referral-settings"], settings);
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    saveMutation.mutate({
      enabled,
      inviteBaseUrl,
      inviterReward,
      inviteeReward,
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Referral Rewards</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">
              邀请奖励
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              新用户通过邀请链接注册后，可分别给邀请人和新用户发放一次性奖励。
            </p>
          </div>
          <button
            className={secondaryButton}
            disabled={invitesQuery.isFetching}
            onClick={() => void invitesQuery.refetch()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            {invitesQuery.isFetching ? "刷新中" : "刷新记录"}
          </button>
        </div>
      </section>

      {notice ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="功能状态" value={enabled ? "已开启" : "已关闭"} />
        <Metric label="成功邀请" value={String(invites.length)} />
        <Metric label="邀请人奖励" value={String(totals.inviterRewards)} />
        <Metric label="新人奖励" value={String(totals.inviteeRewards)} />
      </section>

      <form
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        onSubmit={saveSettings}
      >
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">奖励配置</h3>
            <p className="mt-1 text-sm text-slate-500">
              双方奖励互相独立，可以设为无奖励、余额或订阅套餐。
            </p>
          </div>
          <button
            className={primaryButton}
            disabled={saveMutation.isPending || settingsQuery.isLoading}
            type="submit"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存配置
          </button>
        </div>

        <div className="mt-5 grid gap-5">
          <label className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
            <input
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            启用邀请奖励
          </label>

          <Field label="邀请链接基础地址">
            <input
              className={inputClass}
              onChange={(event) => setInviteBaseUrl(event.target.value)}
              placeholder="留空时使用当前站点"
              value={inviteBaseUrl}
            />
          </Field>

          <div className="grid gap-4 xl:grid-cols-2">
            <RewardEditor
              activePlans={activePlans}
              label="邀请人奖励"
              reward={inviterReward}
              onChange={setInviterReward}
            />
            <RewardEditor
              activePlans={activePlans}
              label="被邀请新用户奖励"
              reward={inviteeReward}
              onChange={setInviteeReward}
            />
          </div>
        </div>
      </form>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">邀请记录</h3>
            <p className="mt-1 text-sm text-slate-500">最近 200 条邀请注册记录。</p>
          </div>
        </div>
        {invitesQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : invites.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">邀请人</th>
                  <th className="px-5 py-3">被邀请新用户</th>
                  <th className="px-5 py-3">邀请码</th>
                  <th className="px-5 py-3">邀请人奖励</th>
                  <th className="px-5 py-3">新人奖励</th>
                  <th className="px-5 py-3">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {invites.map((invite) => (
                  <tr key={invite.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4 text-sm font-medium text-slate-950">
                      {invite.inviter.email}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {invite.invitee.email}
                    </td>
                    <td className="px-5 py-4 font-mono text-sm text-slate-700">
                      {invite.code}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {rewardLabel(invite.inviterRewardType, invite.inviterRewardAmount, invite.inviterRewardPlanId, activePlans)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {rewardLabel(invite.inviteeRewardType, invite.inviteeRewardAmount, invite.inviteeRewardPlanId, activePlans)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500">
                      {formatDate(invite.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-sm text-slate-500">
            <Users className="h-5 w-5" />
            暂无邀请记录
          </div>
        )}
      </section>
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
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center gap-2">
        <Gift className="h-4 w-4 text-blue-700" />
        <h4 className="font-semibold text-slate-950">{label}</h4>
      </div>
      <div className="grid gap-4">
        <Field label="奖励类型">
          <select
            className={inputClass}
            onChange={(event) =>
              onChange({ ...reward, type: event.target.value as RewardType })
            }
            value={reward.type}
          >
            <option value="NONE">无奖励</option>
            <option value="BALANCE">余额</option>
            <option value="SUBSCRIPTION">订阅套餐</option>
          </select>
        </Field>
        {reward.type === "BALANCE" ? (
          <Field label="余额金额 USD">
            <input
              className={inputClass}
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...reward, amountUsd: event.target.value })
              }
              value={reward.amountUsd}
            />
          </Field>
        ) : null}
        {reward.type === "SUBSCRIPTION" ? (
          <Field label="订阅套餐">
            <select
              className={inputClass}
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
          </Field>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
    </section>
  );
}

async function getReferralSettings() {
  const response = await http.get<{ settings: ReferralSettings }>(
    "/admin/referral-settings",
  );
  return response.data.settings;
}

async function updateReferralSettings(input: ReferralSettings) {
  const response = await http.put<{ settings: ReferralSettings }>(
    "/admin/referral-settings",
    input,
  );
  return response.data.settings;
}

async function getReferralInvites() {
  const response = await http.get<{ invites: ReferralInvite[] }>(
    "/admin/referrals",
  );
  return response.data.invites;
}

function rewardLabel(
  type: RewardType,
  amount: string,
  planId: string | null,
  plans: SubscriptionPlan[],
) {
  if (type === "NONE") return "无";
  if (type === "BALANCE") return `$${Number(amount || 0).toFixed(8)}`;
  return plans.find((plan) => plan.id === planId)?.name ?? "订阅套餐";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试。";
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60";
const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60";
