"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SecretInput } from "../../../components/shared/secret-input";
import { SettingCard } from "../../../components/shared/setting-card";
import {
  getAuthSettings,
  getReasoningEffortTransformSettings,
  testAuthEmail,
  updateAuthSettings,
  updateReasoningEffortTransformSettings,
  type AuthSettingsInput,
  type ReasoningEffortTransformRule,
  type ReasoningEffortTransformSettings,
} from "../../../lib/api/settings";

const authSchema = z.object({
  emailCodeLoginEnabled: z.boolean(),
  emailCodeAutoRegisterEnabled: z.boolean(),
  newUserBonusUsd: z.string().trim().min(1),
  emailCodeTtlSeconds: z.coerce.number().int().min(60).max(3600),
  emailCodeCooldownSeconds: z.coerce.number().int().min(10).max(600),
  smtpHost: z.string().trim().max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(255),
  smtpPassword: z.string().optional().or(z.literal("")),
  smtpFrom: z.string().trim().max(255),
  testEmail: z.string().trim().email("请输入测试邮箱"),
});
const reasoningSchema = z.object({
  rules: z.array(z.object({
    enabled: z.boolean(),
    from: z.enum(["low", "medium", "high", "xhigh"]),
    to: z.enum(["low", "medium", "high", "xhigh"]),
  })),
});

type AuthInput = z.input<typeof authSchema>;
type AuthValues = z.output<typeof authSchema>;
type ReasoningValues = z.output<typeof reasoningSchema>;

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const authQuery = useQuery({ queryKey: ["admin", "auth-settings"], queryFn: getAuthSettings });
  const reasoningQuery = useQuery({ queryKey: ["admin", "reasoning-effort-transform-settings"], queryFn: getReasoningEffortTransformSettings });

  const authForm = useForm<AuthInput, unknown, AuthValues>({ resolver: zodResolver(authSchema) });
  const reasoningForm = useForm<ReasoningValues>({ resolver: zodResolver(reasoningSchema), defaultValues: { rules: [] } });

  useEffect(() => {
    if (!authQuery.data) return;
    authForm.reset({ ...authQuery.data, smtpPassword: "", testEmail: authQuery.data.smtpUser || "" });
  }, [authForm, authQuery.data]);
  useEffect(() => { if (reasoningQuery.data) reasoningForm.reset({ rules: reasoningQuery.data.settings.rules }); }, [reasoningForm, reasoningQuery.data]);

  const authMutation = useMutation({ mutationFn: updateAuthSettings, onSuccess: () => { setNotice("Auth & SMTP 设置已保存"); void queryClient.invalidateQueries({ queryKey: ["admin", "auth-settings"] }); }, onError: (error) => setNotice(errorToText(error)) });
  const testMutation = useMutation({ mutationFn: testAuthEmail, onSuccess: () => setNotice("测试邮件已发送"), onError: (error) => setNotice(errorToText(error)) });
  const reasoningMutation = useMutation({ mutationFn: updateReasoningEffortTransformSettings, onSuccess: () => { setNotice("推理强度转换规则已保存"); void queryClient.invalidateQueries({ queryKey: ["admin", "reasoning-effort-transform-settings"] }); }, onError: (error) => setNotice(errorToText(error)) });

  function applyTencentExmailPreset() {
    const currentUser = authForm.getValues("smtpUser")?.trim() ?? "";
    const currentFrom = authForm.getValues("smtpFrom")?.trim() ?? "";
    authForm.setValue("smtpHost", "smtp.exmail.qq.com", { shouldDirty: true });
    authForm.setValue("smtpPort", 465, { shouldDirty: true });
    authForm.setValue("smtpSecure", true, { shouldDirty: true });
    if (!currentFrom && currentUser) {
      authForm.setValue("smtpFrom", currentUser, { shouldDirty: true });
    }
    if (!currentUser && currentFrom) {
      authForm.setValue("smtpUser", currentFrom, { shouldDirty: true });
    }
    setNotice("已切换为腾讯企业邮箱 SMTP：smtp.exmail.qq.com / SSL 465");
  }

  function applyCustomSmtpPreset() {
    setNotice("已切换为自定义 SMTP，可手动填写 Host、端口与 SSL。");
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-blue-700">System Settings</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">系统设置</h2>
        <p className="mt-2 text-sm text-slate-500">登录、SMTP 与推理强度转换配置。公益设置已拆分为独立页面。</p>
      </section>
      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}
      <section className="grid gap-5 xl:grid-cols-2">
        <SettingCard title="Auth & SMTP 设置" description="SMTP 密码留空表示不覆盖旧密码。" form={authForm} loading={authMutation.isPending} onSubmit={(values) => authMutation.mutate(cleanAuth(values))} footer={<button type="button" onClick={() => authForm.handleSubmit((values) => testMutation.mutate({ ...cleanAuth(values), testEmail: values.testEmail }))()} className={secondaryButton}><Send className="h-4 w-4" />测试邮件</button>}>
          <Toggle label="启用邮箱验证码登录" register={authForm.register("emailCodeLoginEnabled")} />
          <Toggle label="验证码自动注册" register={authForm.register("emailCodeAutoRegisterEnabled")} />
          <TextInput label="新用户赠送余额" register={authForm.register("newUserBonusUsd")} />
          <NumberInput label="验证码 TTL 秒" register={authForm.register("emailCodeTtlSeconds")} />
          <NumberInput label="验证码冷却秒" register={authForm.register("emailCodeCooldownSeconds")} />
          <div className="grid gap-2">
            <span className={labelClass}>发信模式</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={applyTencentExmailPreset} className={secondaryButton}>
                腾讯企业邮箱
              </button>
              <button type="button" onClick={applyCustomSmtpPreset} className={secondaryButton}>
                自定义 SMTP
              </button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              腾讯企业邮箱使用 smtp.exmail.qq.com，SSL 端口 465。SMTP User 和 SMTP From 一般填写完整企业邮箱地址，Password 填邮箱客户端专用密码或授权码。
            </p>
          </div>
          <TextInput label="SMTP Host" register={authForm.register("smtpHost")} />
          <NumberInput label="SMTP Port" register={authForm.register("smtpPort")} />
          <Toggle label="SMTP SSL/TLS" register={authForm.register("smtpSecure")} />
          <TextInput label="SMTP User" register={authForm.register("smtpUser")} />
          <label className="grid gap-2"><span className={labelClass}>SMTP Password</span><SecretInput {...authForm.register("smtpPassword")} /></label>
          <TextInput label="SMTP From" register={authForm.register("smtpFrom")} />
          <TextInput label="测试邮箱" register={authForm.register("testEmail")} />
        </SettingCard>

        <SettingCard
          title="推理强度转换配置"
          description="用选项配置 from/to 转换规则，保存前会由后端校验重复来源和自转换。"
          form={reasoningForm}
          loading={reasoningMutation.isPending}
          onSubmit={(values) => reasoningMutation.mutate(values)}
          footer={
            <button type="button" onClick={() => addReasoningRule(reasoningForm.getValues("rules"), (rules) => reasoningForm.setValue("rules", rules, { shouldDirty: true }))} className={secondaryButton}>
              <Plus className="h-4 w-4" />新增规则
            </button>
          }
        >
          <ReasoningRulesEditor
            rules={reasoningForm.watch("rules")}
            options={reasoningQuery.data?.options ?? ["low", "medium", "high", "xhigh"]}
            onChange={(rules) => reasoningForm.setValue("rules", rules, { shouldDirty: true })}
          />
        </SettingCard>
      </section>
    </div>
  );
}

function cleanAuth(values: AuthValues): AuthSettingsInput {
  const { smtpPassword, testEmail: _testEmail, ...rest } = values;
  return smtpPassword?.trim() ? { ...rest, smtpPassword } : rest;
}
function TextInput({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input className={inputClass} {...register} /></label>; }
function NumberInput({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input type="number" className={inputClass} {...register} /></label>; }
function TextArea({ label, register, rows = 4 }: { label: string; register: object; rows?: number }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><textarea rows={rows} className={textareaClass} {...register} /></label>; }
function Toggle({ label, register }: { label: string; register: object }) { return <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register} />{label}</label>; }
function ReasoningRulesEditor({
  rules,
  options,
  onChange,
}: {
  rules: ReasoningEffortTransformRule[];
  options: ReasoningEffortTransformRule["from"][];
  onChange: (rules: ReasoningEffortTransformRule[]) => void;
}) {
  const currentRules = rules ?? [];
  return (
    <div className="grid gap-3">
      {currentRules.map((rule, index) => (
        <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 xl:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={rule.enabled} onChange={(event) => updateReasoningRule(currentRules, index, { enabled: event.target.checked }, onChange)} className="h-4 w-4 rounded border-slate-300" />
            启用
          </label>
          <label className="grid gap-2">
            <span className={labelClass}>From</span>
            <select value={rule.from} onChange={(event) => updateReasoningRule(currentRules, index, { from: event.target.value as ReasoningEffortTransformRule["from"] }, onChange)} className={inputClass}>
              {options.map((option) => <option key={option} value={option}>{effortLabel(option)}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className={labelClass}>To</span>
            <select value={rule.to} onChange={(event) => updateReasoningRule(currentRules, index, { to: event.target.value as ReasoningEffortTransformRule["to"] }, onChange)} className={inputClass}>
              {options.map((option) => <option key={option} value={option}>{effortLabel(option)}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => onChange(currentRules.filter((_, ruleIndex) => ruleIndex !== index))} className={dangerButton}>
              <Trash2 className="h-4 w-4" />删除
            </button>
          </div>
        </div>
      ))}
      {currentRules.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">暂无转换规则，点击下方“新增规则”添加。</div> : null}
    </div>
  );
}
function addReasoningRule(rules: ReasoningEffortTransformRule[], onChange: (rules: ReasoningEffortTransformRule[]) => void) {
  onChange([...(rules ?? []), { enabled: true, from: "high", to: "medium" }]);
}
function updateReasoningRule(rules: ReasoningEffortTransformRule[], index: number, patch: Partial<ReasoningEffortTransformRule>, onChange: (rules: ReasoningEffortTransformRule[]) => void) {
  onChange(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
}
function effortLabel(value: ReasoningEffortTransformRule["from"]) {
  const labels = { low: "low 低", medium: "medium 中", high: "high 高", xhigh: "xhigh 极高" };
  return labels[value];
}
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const dangerButton = "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
