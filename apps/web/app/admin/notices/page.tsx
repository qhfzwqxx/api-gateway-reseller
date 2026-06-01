"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, KeyRound, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { getAccessTiers } from "../../../lib/api/routing";
import {
  getCharityAnnouncementSettings,
  updateCharityAnnouncementSettings,
  type CharityAnnouncementSettings,
} from "../../../lib/api/settings";
import {
  getAdminCharityUsers,
  updateAdminUser,
  type AdminUser,
  type UpsertAdminUserInput,
} from "../../../lib/api/users";
import { UserFormModal } from "../users/components/user-form-modal";

const charitySchema = z.object({
  serviceEnabled: z.boolean(),
  serviceDisabledMessage: z.string().trim().min(1),
  enabled: z.boolean(),
  frequency: z.enum(["every_visit", "interval"]),
  intervalHours: z.coerce.number().int().min(1),
  title: z.string().trim().max(80),
  content: z.string().trim().max(2000),
});

type CharityInput = z.input<typeof charitySchema>;
type CharityValues = z.output<typeof charitySchema>;

export default function AdminNoticesPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const charityQuery = useQuery({ queryKey: ["admin", "charity-announcement-settings"], queryFn: getCharityAnnouncementSettings });
  const charityUsersQuery = useQuery({
    queryKey: ["admin", "users", "charity"],
    queryFn: getAdminCharityUsers,
    staleTime: 30_000,
  });
  const tiersQuery = useQuery({
    queryKey: ["admin", "access-tiers"],
    queryFn: getAccessTiers,
    staleTime: 60_000,
  });
  const charityForm = useForm<CharityInput, unknown, CharityValues>({ resolver: zodResolver(charitySchema) });
  const charityMutation = useMutation({
    mutationFn: updateCharityAnnouncementSettings,
    onSuccess: () => {
      setNotice("公益设置已保存");
      void queryClient.invalidateQueries({ queryKey: ["admin", "charity-announcement-settings"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const userMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Omit<UpsertAdminUserInput, "initialBalance"> }) =>
      updateAdminUser(id, values),
    onSuccess: () => {
      setEditingUserId(null);
      setNotice("公益账号已更新");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "users", "charity"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });

  useEffect(() => {
    if (charityQuery.data) {
      charityForm.reset(charityQuery.data);
    }
  }, [charityForm, charityQuery.data]);

  const editingUser = editingUserId
    ? (charityUsersQuery.data ?? []).find((user) => user.id === editingUserId) ?? null
    : null;

  return (
    <div className="admin-notices-page space-y-5">
      <section className="admin-notices-hero rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Charity Settings</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">公益设置</h2>
            <p className="mt-2 text-sm text-slate-500">集中管理公益入口服务状态、公告频率、展示内容和公益账号。</p>
          </div>
          <button
            type="submit"
            form="charity-settings-form"
            disabled={charityMutation.isPending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {charityMutation.isPending ? "保存中" : "保存公益设置"}
          </button>
        </div>
      </section>

      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="公益服务" value={charityForm.watch("serviceEnabled") ? "可用" : "关闭"} />
        <Metric label="公告弹窗" value={charityForm.watch("enabled") ? "开启" : "关闭"} />
        <Metric label="公益账号" value={`${charityUsersQuery.data?.length ?? 0}`} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(520px,1.35fr)_minmax(300px,0.85fr)]">
        <form
          id="charity-settings-form"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          onSubmit={charityForm.handleSubmit((values) => charityMutation.mutate(values as CharityAnnouncementSettings))}
        >
          <div className="mb-5">
            <h3 className="text-base font-semibold text-slate-950">公益公告设置</h3>
            <p className="mt-1 text-sm text-slate-500">控制公益入口服务状态、公告频率和展示内容。</p>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="公益服务可用" register={charityForm.register("serviceEnabled")} />
              <Toggle label="启用公告" register={charityForm.register("enabled")} />
            </div>
            <TextArea label="服务关闭提示" register={charityForm.register("serviceDisabledMessage")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2"><span className={labelClass}>频率</span><select className={inputClass} {...charityForm.register("frequency")}><option value="every_visit">every_visit</option><option value="interval">interval</option></select></label>
              <NumberInput label="间隔小时" register={charityForm.register("intervalHours")} />
            </div>
            <TextInput label="标题" register={charityForm.register("title")} />
            <TextArea label="内容" register={charityForm.register("content")} rows={10} />
          </div>
        </form>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <h3 className="text-base font-semibold text-slate-950">公益账号</h3>
              <p className="mt-1 text-sm text-slate-500">显示真实公益用户账号，可编辑等级、限流和公益 Key。</p>
            </div>
            <a href="/admin/users" className={tableActionButton}>
              <KeyRound className="h-4 w-4" /> Key/余额
            </a>
          </div>
          <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">账号</th>
                    <th className="px-5 py-3">状态</th>
                    <th className="px-5 py-3">公益展示</th>
                    <th className="px-5 py-3">公开 Key</th>
                    <th className="px-5 py-3">限制</th>
                    <th className="px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {charityUsersQuery.isLoading ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">公益账号加载中...</td></tr>
                  ) : (charityUsersQuery.data ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">暂无公益账号</td></tr>
                  ) : (charityUsersQuery.data ?? []).map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4"><div className="font-medium text-slate-950">{user.email}</div><div className="mt-1 text-xs text-slate-500">{user.tier ? `${user.tier.name} (${user.tier.code})` : "默认等级"}</div></td>
                      <td className="px-5 py-4"><span className={user.status === "ACTIVE" ? badgeGreen : badgeSlate}>{user.status}</span></td>
                      <td className="px-5 py-4 text-sm text-slate-600"><div>{user.charityEnabled ? user.charityDisplayName || "已公开" : "待配置"}</div><div className="mt-1 text-xs text-slate-400">{user.charityEnabled ? "已纳入公益统计" : "未纳入公益统计"}</div></td>
                      <td className="px-5 py-4"><code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{user.charityKey || "未填写"}</code></td>
                      <td className="px-5 py-4 text-sm text-slate-600"><div>账号 RPM：{limitText(user.rateLimitPerMinute)}</div><div className="mt-1">公益 IP：{user.charityIpRateLimitEnabled ? `${limitText(user.charityIpRateLimitPerMinute)}/min` : "未启用"}</div></td>
                      <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingUserId(user.id)} className={tableActionButton}><Edit3 className="h-4 w-4" />编辑</button><a href="/admin/users" className={tableActionButton}><KeyRound className="h-4 w-4" />Key/余额</a></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        </section>

        <aside className="grid content-start gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-950">展示预览</h3>
              <p className="mt-1 text-sm text-slate-500">公益页访问者看到的公告弹窗内容。</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-950">{charityForm.watch("title") || "公告标题"}</div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{charityForm.watch("content") || "公告内容会显示在这里。"}</p>
            </div>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-950">运行摘要</h3>
            <div className="mt-4 grid gap-3 text-sm text-slate-600">
              <InfoRow label="公益服务" value={charityForm.watch("serviceEnabled") ? "可用" : "关闭"} />
              <InfoRow label="公告弹窗" value={charityForm.watch("enabled") ? "开启" : "关闭"} />
              <InfoRow label="弹窗频率" value={charityForm.watch("frequency") === "interval" ? `${charityForm.watch("intervalHours") || 0} 小时` : "每次访问"} />
              <InfoRow label="公益账号" value={`${charityUsersQuery.data?.length ?? 0} 个`} />
            </div>
          </section>
        </aside>
      </section>

      <UserFormModal
        open={editingUserId !== null}
        user={editingUser}
        loading={userMutation.isPending}
        tiers={tiersQuery.data ?? []}
        onClose={() => setEditingUserId(null)}
        onSubmit={async (values) => {
          if (!editingUserId) return;
          await userMutation.mutateAsync({ id: editingUserId, values });
        }}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</p></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-2"><span>{label}</span><strong className="font-semibold text-slate-950">{value}</strong></div>; }
function TextInput({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input className={inputClass} {...register} /></label>; }
function NumberInput({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input type="number" className={inputClass} {...register} /></label>; }
function TextArea({ label, register, rows = 4 }: { label: string; register: object; rows?: number }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><textarea rows={rows} className={textareaClass} {...register} /></label>; }
function Toggle({ label, register }: { label: string; register: object }) { return <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register} />{label}</label>; }
function errorToText(error: unknown) {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> } | undefined;
    const issue = data?.issues?.[0];
    if (issue?.message) {
      const field = issue.path?.length ? `${issue.path.join(".")}: ` : "";
      return `${field}${issue.message}`;
    }
    if (data?.message) {
      return data.message;
    }
  }

  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
function limitText(value: number | null | undefined) { const numeric = Number(value ?? 0); return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "不限"; }

const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const badgeGreen = "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700";
const badgeSlate = "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600";
const tableActionButton = "inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const primaryActionButton = "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryActionButton = "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50";
