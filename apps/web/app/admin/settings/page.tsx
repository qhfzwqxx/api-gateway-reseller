"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SecretInput } from "../../../components/shared/secret-input";
import { SettingCard } from "../../../components/shared/setting-card";
import {
  getAuthSettings,
  getImageGenerationToolSettings,
  getImageProxySettings,
  getRequestBodyRetentionSettings,
  getReasoningEffortTransformSettings,
  checkImageProxySettings,
  testAuthEmail,
  updateAuthSettings,
  updateImageGenerationToolSettings,
  updateImageProxySettings,
  updateRequestBodyRetentionSettings,
  updateReasoningEffortTransformSettings,
  type AuthSettingsInput,
  type ImageProxyHealthCheck,
  type ImageProxySettings,
  type ImageGenerationToolSettings,
  type ReasoningEffortTransformRule,
  type ReasoningEffortTransformSettings,
  type RequestBodyRetentionSettings,
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
    from: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
    to: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  })),
  gpt56Force: z.object({
    enabled: z.boolean(),
    effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  }),
});
const requestBodyRetentionSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.coerce.number().int().min(1).max(3650),
});
const imageGenerationToolSchema = z.object({
  routingModel: z.string().trim().min(1, "请输入转接模型"),
});
const imageProxySchema = z.object({
  mode: z.enum(["direct", "tencent_cos"]),
  enabledModelsText: z.string(),
});

type AuthInput = z.input<typeof authSchema>;
type AuthValues = z.output<typeof authSchema>;
type ReasoningValues = z.output<typeof reasoningSchema>;
type RequestBodyRetentionInput = z.input<typeof requestBodyRetentionSchema>;
type RequestBodyRetentionValues = z.output<typeof requestBodyRetentionSchema>;
type ImageGenerationToolValues = z.output<typeof imageGenerationToolSchema>;
type ImageProxyValues = z.output<typeof imageProxySchema>;

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const authQuery = useQuery({ queryKey: ["admin", "auth-settings"], queryFn: getAuthSettings });
  const reasoningQuery = useQuery({ queryKey: ["admin", "reasoning-effort-transform-settings"], queryFn: getReasoningEffortTransformSettings });
  const requestBodyRetentionQuery = useQuery({ queryKey: ["admin", "request-body-retention-settings"], queryFn: getRequestBodyRetentionSettings });
  const imageGenerationToolQuery = useQuery({ queryKey: ["admin", "image-generation-tool-settings"], queryFn: getImageGenerationToolSettings });
  const imageProxyQuery = useQuery({ queryKey: ["admin", "image-proxy-settings"], queryFn: getImageProxySettings });

  const authForm = useForm<AuthInput, unknown, AuthValues>({ resolver: zodResolver(authSchema) });
  const reasoningForm = useForm<ReasoningValues>({
    resolver: zodResolver(reasoningSchema),
    defaultValues: {
      rules: [],
      gpt56Force: { enabled: false, effort: "medium" },
    },
  });
  const requestBodyRetentionForm = useForm<
    RequestBodyRetentionInput,
    unknown,
    RequestBodyRetentionValues
  >({
    resolver: zodResolver(requestBodyRetentionSchema),
    defaultValues: { enabled: true, retentionDays: 300 },
  });
  const imageGenerationToolForm = useForm<ImageGenerationToolValues>({
    resolver: zodResolver(imageGenerationToolSchema),
    defaultValues: { routingModel: "gpt-image-2" },
  });
  const imageProxyForm = useForm<ImageProxyValues>({
    resolver: zodResolver(imageProxySchema),
    defaultValues: {
      mode: "tencent_cos",
      enabledModelsText: "gpt-image-2",
    },
  });
  const [imageProxyCheck, setImageProxyCheck] = useState<ImageProxyHealthCheck | null>(null);

  useEffect(() => {
    if (!authQuery.data) return;
    authForm.reset({ ...authQuery.data, smtpPassword: "", testEmail: authQuery.data.smtpUser || "" });
  }, [authForm, authQuery.data]);
  useEffect(() => {
    if (reasoningQuery.data) {
      reasoningForm.reset(reasoningQuery.data.settings);
    }
  }, [reasoningForm, reasoningQuery.data]);
  useEffect(() => {
    if (requestBodyRetentionQuery.data) {
      requestBodyRetentionForm.reset(requestBodyRetentionQuery.data.settings);
    }
  }, [requestBodyRetentionForm, requestBodyRetentionQuery.data]);
  useEffect(() => {
    if (imageGenerationToolQuery.data) {
      imageGenerationToolForm.reset(imageGenerationToolQuery.data.settings);
    }
  }, [imageGenerationToolForm, imageGenerationToolQuery.data]);
  useEffect(() => {
    if (!imageProxyQuery.data) return;
    imageProxyForm.reset(toImageProxyValues(imageProxyQuery.data.settings));
  }, [imageProxyForm, imageProxyQuery.data]);

  const authMutation = useMutation({ mutationFn: updateAuthSettings, onSuccess: () => { setNotice("Auth & SMTP 设置已保存"); void queryClient.invalidateQueries({ queryKey: ["admin", "auth-settings"] }); }, onError: (error) => setNotice(errorToText(error)) });
  const testMutation = useMutation({ mutationFn: testAuthEmail, onSuccess: () => setNotice("测试邮件已发送"), onError: (error) => setNotice(errorToText(error)) });
  const reasoningMutation = useMutation({ mutationFn: updateReasoningEffortTransformSettings, onSuccess: () => { setNotice("推理强度转换规则已保存"); void queryClient.invalidateQueries({ queryKey: ["admin", "reasoning-effort-transform-settings"] }); }, onError: (error) => setNotice(errorToText(error)) });
  const requestBodyRetentionMutation = useMutation({
    mutationFn: updateRequestBodyRetentionSettings,
    onSuccess: () => {
      setNotice("Request Body 保留策略已保存，过期正文将在后台分批清理");
      void queryClient.invalidateQueries({ queryKey: ["admin", "request-body-retention-settings"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const imageGenerationToolMutation = useMutation({
    mutationFn: (values: ImageGenerationToolValues) =>
      updateImageGenerationToolSettings(toImageGenerationToolSettings(values)),
    onSuccess: () => {
      setNotice("Responses 生图工具桥接设置已保存");
      void queryClient.invalidateQueries({ queryKey: ["admin", "image-generation-tool-settings"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const imageProxyMutation = useMutation({
    mutationFn: (values: ImageProxyValues) => updateImageProxySettings(fromImageProxyValues(values)),
    onSuccess: () => {
      setNotice("生图云函数/COS 设置已保存");
      void queryClient.invalidateQueries({ queryKey: ["admin", "image-proxy-settings"] });
    },
    onError: (error) => setNotice(errorToText(error)),
  });
  const imageProxyCheckMutation = useMutation({
    mutationFn: checkImageProxySettings,
    onSuccess: (result) => {
      setImageProxyCheck(result);
      setNotice(result.ok ? "云函数/COS 服务验证通过" : "云函数/COS 服务验证未通过，请查看检查项");
    },
    onError: (error) => setNotice(errorToText(error)),
  });

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
        <p className="mt-2 text-sm text-slate-500">登录、SMTP、推理强度与调用记录保留策略。公益设置已拆分为独立页面。</p>
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

        <SettingCard<RequestBodyRetentionInput, RequestBodyRetentionValues>
          title="Request Body 保留策略"
          description="按请求创建时间自动清空过期调用记录的 requestBody，降低 PostgreSQL 大字段空间增长。"
          form={requestBodyRetentionForm}
          loading={requestBodyRetentionMutation.isPending}
          onSubmit={(values) => requestBodyRetentionMutation.mutate(values)}
        >
          <Toggle
            label="启用 Request Body 自动清理"
            register={requestBodyRetentionForm.register("enabled")}
          />
          <label className="grid gap-2 sm:max-w-sm">
            <span className={labelClass}>Request Body 保留天数</span>
            <input
              type="number"
              min={requestBodyRetentionQuery.data?.limits.minRetentionDays ?? 1}
              max={requestBodyRetentionQuery.data?.limits.maxRetentionDays ?? 3650}
              className={inputClass}
              aria-describedby="request-body-retention-help"
              {...requestBodyRetentionForm.register("retentionDays")}
            />
          </label>
          <p id="request-body-retention-help" className="text-xs leading-5 text-slate-500">
            例如填写 300，表示请求创建超过 300 天后，后台清理器会把该记录的 requestBody 设置为空。关闭自动清理时仍可预先保存保留天数。
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            此操作不可恢复，且只清空 requestBody。请求 ID、用户、模型、推理强度、状态、Token、费用、耗时、错误信息、responseUsage 与时间字段都会永久保留。清理器每小时最多分批处理 5,000 条，避免一次性更新大量记录。清理后的空间会由 PostgreSQL 优先复用，系统磁盘剩余空间不会立即增加。
          </div>
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
          <div className="grid gap-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-900">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                {...reasoningForm.register("gpt56Force.enabled")}
              />
              强制 GPT-5.6 系列使用指定推理强度
            </label>
            <div className="grid gap-2 sm:max-w-sm">
              <label htmlFor="gpt56-force-effort" className={labelClass}>强制等级</label>
              <select
                id="gpt56-force-effort"
                className={inputClass}
                aria-describedby="gpt56-force-help"
                {...reasoningForm.register("gpt56Force.effort")}
              >
                {(reasoningQuery.data?.options ?? ["none", "low", "medium", "high", "xhigh", "max"]).map((option) => (
                  <option key={option} value={option}>{effortLabel(option)}</option>
                ))}
              </select>
            </div>
            <p id="gpt56-force-help" className="text-xs leading-5 text-slate-600">
              开启后，仅对 Responses API 的 GPT-5.6 系列模型生效。无论客户端是否传入 reasoning.effort，网关都会在转发前覆盖为所选等级；关闭时仍可预先选择下次启用的等级。
            </p>
          </div>
          <ReasoningRulesEditor
            rules={reasoningForm.watch("rules")}
            options={reasoningQuery.data?.options ?? ["none", "low", "medium", "high", "xhigh", "max"]}
            onChange={(rules) => reasoningForm.setValue("rules", rules, { shouldDirty: true })}
          />
        </SettingCard>

        <SettingCard
          title="Responses 生图工具桥接"
          description="Codex 内置 image_generation 工具请求会转接到这里配置的模型，并按该模型的模型池选择上游。"
          form={imageGenerationToolForm}
          loading={imageGenerationToolMutation.isPending}
          onSubmit={(values) => imageGenerationToolMutation.mutate(values)}
        >
          <TextInput label="转接模型" register={imageGenerationToolForm.register("routingModel")} />
          <p className="text-xs leading-5 text-slate-500">
            例如 gpt-image-2。普通文字 Responses 请求不受影响；只有带 image_generation 内置工具的请求才会走这个模型的模型池。
          </p>
        </SettingCard>

        <SettingCard
          title="生图云函数/COS 设置"
          description="控制图片接口是否经腾讯云函数上传 COS，或恢复普通网关直连上游模式。"
          form={imageProxyForm}
          loading={imageProxyMutation.isPending}
          onSubmit={(values) => imageProxyMutation.mutate(values)}
          footer={
            <button
              type="button"
              onClick={() => imageProxyCheckMutation.mutate()}
              className={secondaryButton}
              disabled={imageProxyCheckMutation.isPending}
            >
              {imageProxyCheckMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              验证服务
            </button>
          }
        >
          <div className="grid gap-2">
            <span className={labelClass}>生图调用模式</span>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={choiceClass}>
                <input type="radio" value="tencent_cos" {...imageProxyForm.register("mode")} />
                <span>
                  <strong>云函数 + COS</strong>
                  <small>生成后返回公网图片 URL</small>
                </span>
              </label>
              <label className={choiceClass}>
                <input type="radio" value="direct" {...imageProxyForm.register("mode")} />
                <span>
                  <strong>直连上游</strong>
                  <small>恢复普通网关代理模式</small>
                </span>
              </label>
            </div>
          </div>
          <ImageProxyModelSelector
            models={imageProxyQuery.data?.models ?? []}
            value={imageProxyForm.watch("enabledModelsText")}
            onChange={(value) => imageProxyForm.setValue("enabledModelsText", value, { shouldDirty: true })}
          />
          {imageProxyCheck ? <ImageProxyCheckResult result={imageProxyCheck} /> : null}
        </SettingCard>
      </section>
    </div>
  );
}

function cleanAuth(values: AuthValues): AuthSettingsInput {
  const { smtpPassword, testEmail: _testEmail, ...rest } = values;
  return smtpPassword?.trim() ? { ...rest, smtpPassword } : rest;
}
function toImageGenerationToolSettings(values: ImageGenerationToolValues): ImageGenerationToolSettings {
  return { routingModel: values.routingModel.trim() };
}
function toImageProxyValues(settings: ImageProxySettings): ImageProxyValues {
  return {
    mode: settings.mode,
    enabledModelsText: settings.enabledModels.join("\n"),
  };
}
function fromImageProxyValues(values: ImageProxyValues): ImageProxySettings {
  return {
    mode: values.mode,
    enabledModels: parseModelsText(values.enabledModelsText),
  };
}
function parseModelsText(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}
function TextInput({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input className={inputClass} {...register} /></label>; }
function NumberInput({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input type="number" className={inputClass} {...register} /></label>; }
function TextArea({ label, register, rows = 4 }: { label: string; register: object; rows?: number }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><textarea rows={rows} className={textareaClass} {...register} /></label>; }
function Toggle({ label, register }: { label: string; register: object }) { return <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register} />{label}</label>; }
function ImageProxyModelSelector({
  models,
  value,
  onChange,
}: {
  models: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = new Set(parseModelsText(value));
  function toggleModel(model: string) {
    const next = new Set(selected);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    onChange([...next].join("\n"));
  }
  return (
    <div className="grid gap-2">
      <span className={labelClass}>走云函数/COS 的生图模型</span>
      {models.length ? (
        <div className="flex flex-wrap gap-2">
          {models.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => toggleModel(model)}
              className={selected.has(model) ? selectedPillButton : secondaryButton}
            >
              {model}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        rows={4}
        className={textareaClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="gpt-image-2&#10;另一个生图模型"
      />
      <p className="text-xs leading-5 text-slate-500">每行或逗号分隔一个模型。留空表示所有生图模型都走云函数/COS。</p>
    </div>
  );
}
function ImageProxyCheckResult({ result }: { result: ImageProxyHealthCheck }) {
  return (
    <div className={`grid gap-2 rounded-md border p-3 ${result.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        {result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-amber-600" />}
        {result.ok ? "验证通过" : "验证未通过"}
      </div>
      <div className="grid gap-2">
        {result.checks.map((check) => (
          <div key={check.name} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
            {check.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />}
            <span>{check.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
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
  const labels = {
    none: "none 无推理",
    low: "low 低",
    medium: "medium 中",
    high: "high 高",
    xhigh: "xhigh 极高",
    max: "max 最高",
  };
  return labels[value];
}
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const secondaryButton = "inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";
const selectedPillButton = "inline-flex h-10 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100";
const dangerButton = "inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100";
const choiceClass = "flex min-h-20 cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 [&_input]:mt-1 [&_small]:mt-1 [&_small]:block [&_small]:text-xs [&_small]:font-normal [&_small]:text-slate-500 [&_strong]:block [&_strong]:font-semibold [&_strong]:text-slate-900";
