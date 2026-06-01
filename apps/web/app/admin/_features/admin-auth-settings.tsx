"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Send } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { z } from "zod";
import { adminFetch, adminQueryKeys } from "../_components/admin-api";
import { money } from "../_components/admin-format";
import { useAdminResource } from "../_components/admin-hooks";
import {
  ConsoleNavButton,
  InfoLine,
  SettingsConsoleLayout,
  StatusPill,
} from "../_components/admin-ui";

type AuthSettings = {
  emailCodeLoginEnabled: boolean;
  emailCodeAutoRegisterEnabled: boolean;
  newUserBonusUsd: string;
  emailCodeTtlSeconds: number;
  emailCodeCooldownSeconds: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  smtpConfigured: boolean;
};

const authSettingsFormSchema = z.object({
  emailCodeLoginEnabled: z.boolean(),
  emailCodeAutoRegisterEnabled: z.boolean(),
  newUserBonusUsd: z
    .string()
    .trim()
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
      message: "新用户赠送余额必须是非负数字。",
    }),
  emailCodeTtlSeconds: z.number().int().min(60).max(3600),
  emailCodeCooldownSeconds: z.number().int().min(10).max(600),
  smtpHost: z.string().trim(),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim(),
  smtpPassword: z.string(),
  smtpFrom: z.string().trim(),
});

type AuthSettingsFormValues = z.infer<typeof authSettingsFormSchema>;

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失败，请稍后再试。";
}

export function AdminAuthSettings({
  onError,
}: {
  onError: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const { data, error, isFetching } = useAdminResource<{ settings: AuthSettings }>(
    "authSettings",
    "/admin/auth-settings",
  );
  const settings = data?.settings ?? null;

  const [newUserBonusUsd, setNewUserBonusUsd] = useState("0");
  const [emailCodeLoginEnabled, setEmailCodeLoginEnabled] = useState(true);
  const [emailCodeAutoRegisterEnabled, setEmailCodeAutoRegisterEnabled] =
    useState(true);
  const [emailCodeTtlSeconds, setEmailCodeTtlSeconds] = useState(600);
  const [emailCodeCooldownSeconds, setEmailCodeCooldownSeconds] = useState(60);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<"email" | "smtp" | "preview">("email");

  useEffect(() => {
    if (!settings) return;
    setNewUserBonusUsd(settings.newUserBonusUsd);
    setEmailCodeLoginEnabled(settings.emailCodeLoginEnabled);
    setEmailCodeAutoRegisterEnabled(settings.emailCodeAutoRegisterEnabled);
    setEmailCodeTtlSeconds(settings.emailCodeTtlSeconds);
    setEmailCodeCooldownSeconds(settings.emailCodeCooldownSeconds);
    setSmtpHost(settings.smtpHost);
    setSmtpPort(settings.smtpPort);
    setSmtpSecure(settings.smtpSecure);
    setSmtpUser(settings.smtpUser);
    setSmtpPassword("");
    setSmtpFrom(settings.smtpFrom);
    setTestEmail(settings.smtpUser);
    setTestMessage(null);
    setSavedMessage(null);
  }, [settings]);

  function settingsPayload(): AuthSettingsFormValues | null {
    const parsed = authSettingsFormSchema.safeParse({
      emailCodeLoginEnabled,
      emailCodeAutoRegisterEnabled,
      newUserBonusUsd,
      emailCodeTtlSeconds: Number(emailCodeTtlSeconds),
      emailCodeCooldownSeconds: Number(emailCodeCooldownSeconds),
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpSecure,
      smtpUser,
      smtpPassword,
      smtpFrom,
    });
    if (!parsed.success) {
      onError(parsed.error.issues[0]?.message ?? "登录设置校验失败。");
      return null;
    }
    return parsed.data;
  }

  function requestBody() {
    const payload = settingsPayload();
    if (!payload) return null;
    const { smtpPassword: password, ...body } = payload;
    return password.trim() ? { ...body, smtpPassword: password } : body;
  }

  const saveMutation = useMutation({
    mutationFn: (payload: Omit<AuthSettingsFormValues, "smtpPassword"> & { smtpPassword?: string }) =>
      adminFetch<{ settings: AuthSettings }>("/admin/auth-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setSmtpPassword("");
      setSavedMessage("登录设置已保存。");
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.resource("authSettings", "/admin/auth-settings"),
      });
    },
    onError: (saveError) => onError(errorToText(saveError)),
  });

  const testMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof requestBody> & { testEmail: string }) =>
      adminFetch("/admin/auth-settings/test-email", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => setTestMessage(`测试邮件已发送到 ${testEmail.trim()}。`),
    onError: (sendError) => onError(errorToText(sendError)),
  });

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError(null);
    setSavedMessage(null);
    const payload = requestBody();
    if (payload) saveMutation.mutate(payload);
  }

  function sendTestEmail() {
    if (!testEmail.trim()) {
      onError("请填写测试收件邮箱。");
      return;
    }
    const payload = requestBody();
    if (!payload) return;
    onError(null);
    setTestMessage(null);
    testMutation.mutate({ ...payload, testEmail });
  }

  function applyTencentExmailPreset() {
    setSmtpHost("smtp.exmail.qq.com");
    setSmtpPort(465);
    setSmtpSecure(true);
    if (!smtpFrom.trim() && smtpUser.trim()) {
      setSmtpFrom(smtpUser.trim());
    }
    if (!smtpUser.trim() && smtpFrom.trim()) {
      setSmtpUser(smtpFrom.trim());
    }
    setSavedMessage("已切换为腾讯企业邮箱 SMTP：smtp.exmail.qq.com / SSL 465。");
  }

  if (error) {
    return <div className="error compact-error">{errorToText(error)}</div>;
  }
  if (!settings) {
    return <p className="muted">{isFetching ? "登录设置加载中..." : "暂无登录设置"}</p>;
  }

  const previewFrom = smtpFrom.trim() || "APIshare <no-reply@example.com>";
  const previewTo = smtpUser.trim() || "user@example.com";
  const previewTtlMinutes = Math.max(1, Math.ceil(Number(emailCodeTtlSeconds) / 60));

  return (
    <form className="form admin-settings-page" onSubmit={saveSettings}>
      <SettingsConsoleLayout
        className="admin-auth-console"
        nav={
          <>
            <ConsoleNavButton
              active={activePanel === "email"}
              title="邮箱验证码"
              description="登录、注册、赠送余额"
              meta={emailCodeLoginEnabled ? "开启" : "关闭"}
              onClick={() => setActivePanel("email")}
            />
            <ConsoleNavButton
              active={activePanel === "smtp"}
              title="SMTP 发信"
              description="主机、账号、发件人"
              meta={settings.smtpConfigured ? "已配置" : "未配置"}
              onClick={() => setActivePanel("smtp")}
            />
            <ConsoleNavButton
              active={activePanel === "preview"}
              title="测试与预览"
              description="测试发送验证码邮件"
              meta={testMessage ? "已发送" : "预览"}
              onClick={() => setActivePanel("preview")}
            />
          </>
        }
        summary={
          <div className="admin-summary-card">
            <strong>当前登录策略</strong>
            <div className="info-list">
              <InfoLine label="验证码" value={emailCodeLoginEnabled ? "开启" : "关闭"} />
              <InfoLine label="自动注册" value={emailCodeAutoRegisterEnabled ? "允许" : "关闭"} />
              <InfoLine label="赠送余额" value={`$${money(newUserBonusUsd)}`} />
              <InfoLine label="SMTP" value={settings.smtpConfigured ? "已配置" : "未配置"} />
            </div>
          </div>
        }
      >
        <div className="admin-settings-stack">
          {activePanel === "email" ? (
          <div className="form">
            <div className="section-head">
              <div>
                <h2 className="section-title">邮箱验证码</h2>
                <p className="section-subtitle">
                  用户账号使用邮箱验证码登录，自动注册可单独控制。
                </p>
              </div>
              <StatusPill status={emailCodeLoginEnabled ? "ACTIVE" : "DISABLED"} />
            </div>
            <div className="button-row">
              <button className="button secondary" onClick={applyTencentExmailPreset} type="button">
                腾讯企业邮箱
              </button>
              <button className="button secondary" onClick={() => setSavedMessage("已切换为自定义 SMTP，可手动填写 Host、端口与 SSL。")} type="button">
                自定义 SMTP
              </button>
            </div>
            <p className="field-hint">
              腾讯企业邮箱使用 smtp.exmail.qq.com，SSL 端口 465。SMTP 用户名和发件人一般填写完整企业邮箱地址，密码填写客户端专用密码或授权码。
            </p>
            <div className="grid cols-2">
              <label className="check-row"><input checked={emailCodeLoginEnabled} onChange={(event) => setEmailCodeLoginEnabled(event.target.checked)} type="checkbox" />启用邮箱验证码登录</label>
              <label className="check-row"><input checked={emailCodeAutoRegisterEnabled} onChange={(event) => setEmailCodeAutoRegisterEnabled(event.target.checked)} type="checkbox" />允许新邮箱自动创建账号</label>
            </div>
            <div className="grid cols-2">
              <label className="field"><span>新用户赠送余额 USD</span><input className="input" inputMode="decimal" min="0" onChange={(event) => setNewUserBonusUsd(event.target.value)} step="0.00000001" type="number" value={newUserBonusUsd} /></label>
              <label className="field"><span>验证码有效期（秒）</span><input className="input" max={3600} min={60} onChange={(event) => setEmailCodeTtlSeconds(Number(event.target.value))} type="number" value={emailCodeTtlSeconds} /></label>
            </div>
            <label className="field"><span>发送冷却（秒）</span><input className="input" max={600} min={10} onChange={(event) => setEmailCodeCooldownSeconds(Number(event.target.value))} type="number" value={emailCodeCooldownSeconds} /></label>
            <div className="info-list">
              <InfoLine label="登录方式" value={emailCodeLoginEnabled ? "邮箱验证码" : "已关闭"} />
              <InfoLine label="创建账号" value={emailCodeAutoRegisterEnabled ? "首次验证自动创建" : "仅限已存在账号"} />
              <InfoLine label="赠送余额" value={`$${money(newUserBonusUsd)}`} />
            </div>
          </div>
          ) : null}

          {activePanel === "smtp" ? (
          <div className="form">
            <div className="section-head">
              <div>
                <h2 className="section-title">SMTP 发信</h2>
                <p className="section-subtitle">用于发送 APIshare 登录验证码邮件。</p>
              </div>
              <span className={settings.smtpConfigured ? "pill ok" : "pill warn"}>
                {settings.smtpConfigured ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="grid cols-2">
              <label className="field"><span>SMTP Host</span><input className="input" onChange={(event) => setSmtpHost(event.target.value)} value={smtpHost} /></label>
              <label className="field"><span>端口</span><input className="input" max={65535} min={1} onChange={(event) => setSmtpPort(Number(event.target.value))} type="number" value={smtpPort} /></label>
            </div>
            <label className="check-row"><input checked={smtpSecure} onChange={(event) => setSmtpSecure(event.target.checked)} type="checkbox" />使用 SSL/TLS</label>
            <label className="field"><span>发件人 From</span><input className="input" onChange={(event) => setSmtpFrom(event.target.value)} placeholder="APIshare <no-reply@example.com>" value={smtpFrom} /></label>
            <div className="grid cols-2">
              <label className="field"><span>SMTP 用户名</span><input className="input" onChange={(event) => setSmtpUser(event.target.value)} value={smtpUser} /></label>
              <label className="field"><span>SMTP 密码</span><input className="input" onChange={(event) => setSmtpPassword(event.target.value)} placeholder={settings.smtpConfigured ? "留空则不修改" : ""} type="password" value={smtpPassword} /></label>
            </div>
          </div>
          ) : null}

          {activePanel === "preview" ? (
            <div className="email-preview">
              <div className="email-preview-toolbar"><div><span className="eyebrow">邮件预览</span><strong>APIshare 登录验证码</strong></div><span>{smtpSecure ? "SSL/TLS" : "STARTTLS"}</span></div>
              <div className="email-preview-meta"><span>From</span><strong>{previewFrom}</strong><span>To</span><strong>{previewTo}</strong></div>
              <div className="email-test-row">
                <label className="field"><span>测试收件邮箱</span><input className="input" onChange={(event) => setTestEmail(event.target.value)} placeholder="user@example.com" type="email" value={testEmail} /></label>
                <button className="button secondary" disabled={testMutation.isPending} onClick={sendTestEmail} type="button"><Send size={16} />{testMutation.isPending ? "发送中..." : "发送测试"}</button>
              </div>
              {testMessage ? <div className="success compact-success">{testMessage}</div> : null}
              <div className="email-preview-body"><h3>APIshare 登录验证码</h3><p>你的验证码是：</p><div className="email-preview-code">482913</div><p>{previewTtlMinutes} 分钟内有效。若不是你本人操作，请忽略这封邮件。</p></div>
            </div>
          ) : null}
        </div>
      </SettingsConsoleLayout>
      {savedMessage ? <div className="success">{savedMessage}</div> : null}
      <div className="button-row">
        <button className="button" disabled={saveMutation.isPending} type="submit">
          <Save size={17} />
          {saveMutation.isPending ? "保存中..." : "保存登录设置"}
        </button>
      </div>
    </form>
  );
}
