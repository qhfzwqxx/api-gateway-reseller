"use client";

import {
  ArrowRight,
  Gift,
  KeyRound,
  Mail,
  Network,
  Route,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { apiFetch, apiFieldError } from "../../../lib/api";
import type { FrontAuthSettings, FrontUser } from "../../../lib/types/front";
import {
  FrontAlert,
  FrontButton,
  FrontField,
  FrontLogo,
  FrontSkeleton,
} from "./ui/front-ui";

const emailSchema = z.string().trim().email("请输入有效的邮箱地址");

export function FrontLogin({
  referralCode,
  onLogin,
}: {
  referralCode?: string;
  onLogin: (token: string, user: FrontUser, referralApplied: boolean) => void;
}) {
  const [activeReferralCode, setActiveReferralCode] = useState(referralCode);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    code?: string;
  }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [settings, setSettings] = useState<FrontAuthSettings | null>(null);
  const [countdown, setCountdown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const settingsRequestRef = useRef(0);

  useEffect(() => {
    if (countdown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    setActiveReferralCode(referralCode);
  }, [referralCode]);

  async function loadSettings() {
    const requestId = ++settingsRequestRef.current;
    setSettings(null);
    setSettingsError(null);
    try {
      const result = await apiFetch<{ settings: FrontAuthSettings }>(
        "/auth/settings",
        { token: null },
      );
      if (requestId !== settingsRequestRef.current) return;
      setSettings(result.settings);
    } catch (loadError) {
      if (requestId !== settingsRequestRef.current) return;
      setSettingsError(errorToText(loadError));
    }
  }

  function validateEmail() {
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setFieldErrors((current) => ({
        ...current,
        email: result.error.issues[0]?.message ?? "请输入有效邮箱",
      }));
      emailRef.current?.focus();
      return false;
    }
    setFieldErrors((current) => ({ ...current, email: undefined }));
    return true;
  }

  async function sendCode() {
    if (sendingCode || countdown > 0 || loading) return;
    setError(null);
    setMessage(null);
    if (!validateEmail()) {
      return;
    }
    if (!settings?.emailCodeLoginEnabled) {
      setError("邮箱验证码登录当前不可用，请联系管理员。");
      return;
    }
    if (!settings.smtpConfigured) {
      setError("邮件服务尚未配置，暂时无法发送验证码。");
      return;
    }

    setSendingCode(true);
    try {
      const result = await apiFetch<{ expiresInSeconds: number }>(
        "/auth/email-code/send",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim() }),
          token: null,
        },
      );
      setMessage(
        `验证码已发送，有效期 ${Math.max(1, Math.ceil(result.expiresInSeconds / 60))} 分钟。`,
      );
      setCountdown(60);
      codeRef.current?.focus();
    } catch (sendError) {
      const fieldError = apiFieldError(sendError, "email");
      if (fieldError) {
        setFieldErrors((current) => ({ ...current, email: fieldError }));
        emailRef.current?.focus();
      } else {
        setError(errorToText(sendError));
      }
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const emailValid = validateEmail();
    const codeValid = /^\d{6}$/.test(code);
    if (!codeValid) {
      setFieldErrors((current) => ({
        ...current,
        code: "请输入 6 位数字验证码",
      }));
      if (emailValid) {
        codeRef.current?.focus();
      }
    } else {
      setFieldErrors((current) => ({ ...current, code: undefined }));
    }
    if (!emailValid || !codeValid) {
      return;
    }

    if (!settings?.emailCodeLoginEnabled) {
      setError("邮箱验证码登录当前不可用，请联系管理员。");
      return;
    }

    setLoading(true);
    try {
      const result = await apiFetch<{ token: string; user: FrontUser }>(
        "/auth/email-code/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            code,
            ...(activeReferralCode ? { referralCode: activeReferralCode } : {}),
          }),
          token: null,
        },
      );
      onLogin(result.token, result.user, Boolean(activeReferralCode));
    } catch (loginError) {
      const codeError = apiFieldError(loginError, "code") ?? codeErrorMessage(loginError);
      const emailError = apiFieldError(loginError, "email");
      if (emailError) {
        setFieldErrors((current) => ({ ...current, email: emailError }));
        emailRef.current?.focus();
      } else if (codeError) {
        setFieldErrors((current) => ({ ...current, code: codeError }));
        codeRef.current?.focus();
      } else if (activeReferralCode && isInviteError(loginError)) {
        setActiveReferralCode(undefined);
        setError("该邀请链接无效或已失效，已切换为普通登录。你可以直接再次提交当前验证码。");
      } else {
        setError(errorToText(loginError));
      }
    } finally {
      setLoading(false);
    }
  }

  const authDisabled = settings?.emailCodeLoginEnabled === false;

  return (
    <main className="front-public-page front-auth-page">
      <div className="front-auth-shell">
        <section className="front-auth-brand" aria-label="APIshare 产品能力">
          <FrontLogo />
          <div className="front-auth-brand-copy">
            <span className="front-auth-eyebrow">企业级开发者网关</span>
            <h1>统一管理模型接入、密钥、费用与访问策略</h1>
            <p>
              以 OpenAI 兼容接口连接多模型能力，在一个清晰、稳定的工作台中完成开发配置与用量管理。
            </p>
          </div>
          <div className="front-auth-capabilities">
            <AuthCapability
              icon={<Route aria-hidden="true" size={20} />}
              title="OpenAI 兼容接口"
              body="支持 Responses 与 Chat Completions 接入方式。"
            />
            <AuthCapability
              icon={<KeyRound aria-hidden="true" size={20} />}
              title="密钥与用量集中管理"
              body="快速创建 API Key，查看请求、费用和钱包状态。"
            />
            <AuthCapability
              icon={<Network aria-hidden="true" size={20} />}
              title="访问等级与模型路由"
              body="按账号等级使用对应模型池与路由策略。"
            />
          </div>
          <div className="front-auth-brand-foot">
            <ShieldCheck aria-hidden="true" size={18} />
            <span>登录状态与敏感操作均通过网关鉴权保护</span>
          </div>
        </section>

        <section className="front-auth-form-side">
          <div className="front-auth-mobile-logo">
            <FrontLogo />
          </div>
          <div className="front-auth-form-card">
            <header className="front-auth-form-header">
              <span className="front-auth-eyebrow">用户控制台</span>
              <h2>邮箱验证码登录</h2>
              <p>
                {activeReferralCode
                  ? "登录已有账号，或使用新邮箱自动创建账号并绑定邀请关系。"
                  : "使用邮箱验证码安全进入 APIshare 控制台。"}
              </p>
            </header>

            {activeReferralCode ? (
              <FrontAlert tone="info">
                <div className="front-invite-login-note">
                  <span className="front-inline-icon-copy">
                    <Gift aria-hidden="true" size={18} />
                    已识别邀请链接，登录后将进入邀请奖励页面。
                  </span>
                  <Link className="front-text-link" href="/">
                    改为普通登录 <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                </div>
              </FrontAlert>
            ) : null}

            {settingsError ? (
              <div className="front-auth-settings-error">
                <FrontAlert tone="error" title="登录配置加载失败">
                  {settingsError}
                </FrontAlert>
                <div className="front-auth-error-actions">
                  <FrontButton variant="secondary" onClick={() => void loadSettings()}>
                    重试
                  </FrontButton>
                  <Link className="front-text-link" href="/help">
                    打开帮助中心 <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                </div>
              </div>
            ) : settings ? (
              <>
                {!settings.emailCodeLoginEnabled ? (
                  <FrontAlert tone="warning" title="验证码登录已关闭">
                    当前无法通过邮箱验证码登录，请联系管理员恢复登录配置。
                  </FrontAlert>
                ) : !settings.smtpConfigured ? (
                  <FrontAlert tone="warning" title="邮件服务未配置">
                    验证码邮件暂时无法发送，请联系管理员配置 SMTP。
                  </FrontAlert>
                ) : !settings.emailCodeAutoRegisterEnabled ? (
                  <FrontAlert tone="info" title="仅限已有账号">
                    自动注册已关闭，只有已存在的邮箱账号可以登录。
                  </FrontAlert>
                ) : null}

                {message ? <FrontAlert tone="success">{message}</FrontAlert> : null}
                {error ? <FrontAlert tone="error">{error}</FrontAlert> : null}

                <form className="front-auth-form" onSubmit={submit} noValidate>
                  <FrontField
                    label="邮箱"
                    htmlFor="front-login-email"
                    required
                    error={fieldErrors.email}
                  >
                    <div className="front-input-affix">
                      <Mail aria-hidden="true" size={18} />
                      <input
                        ref={emailRef}
                        id="front-login-email"
                        className="front-input"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        placeholder="name@example.com"
                        value={email}
                        aria-invalid={Boolean(fieldErrors.email)}
                        disabled={loading || sendingCode || countdown > 0}
                        onBlur={validateEmail}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          if (fieldErrors.email) {
                            setFieldErrors((current) => ({
                              ...current,
                              email: undefined,
                            }));
                          }
                        }}
                      />
                    </div>
                  </FrontField>

                  <FrontField
                    label="验证码"
                    htmlFor="front-login-code"
                    required
                    hint="验证码为 6 位数字"
                    error={fieldErrors.code}
                  >
                    <div className="front-auth-code-row">
                      <input
                        ref={codeRef}
                        id="front-login-code"
                        className="front-input front-input-mono"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        value={code}
                        aria-invalid={Boolean(fieldErrors.code)}
                        disabled={loading}
                        onChange={(event) => {
                          setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                          if (fieldErrors.code) {
                            setFieldErrors((current) => ({
                              ...current,
                              code: undefined,
                            }));
                          }
                        }}
                      />
                      <FrontButton
                        variant="secondary"
                        type="button"
                        loading={sendingCode}
                        disabled={
                          loading ||
                          authDisabled ||
                          !settings.smtpConfigured ||
                          countdown > 0
                        }
                        onClick={() => void sendCode()}
                      >
                        {countdown > 0 ? `${countdown} 秒后重发` : "获取验证码"}
                      </FrontButton>
                    </div>
                  </FrontField>

                  <FrontButton
                    className="front-auth-submit"
                    type="submit"
                    loading={loading}
                    disabled={authDisabled || !settings.smtpConfigured || sendingCode}
                  >
                    {loading ? "登录中" : "登录控制台"}
                  </FrontButton>
                </form>
              </>
            ) : (
              <LoginFormSkeleton />
            )}

            <footer className="front-auth-links">
              <Link href="/help">帮助中心</Link>
              <span aria-hidden="true">·</span>
              <Link href="/access">白名单验证</Link>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthCapability({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="front-auth-capability">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function LoginFormSkeleton() {
  return (
    <div className="front-auth-skeleton" aria-label="登录配置加载中">
      <FrontSkeleton height={44} />
      <FrontSkeleton height={44} />
      <FrontSkeleton height={44} />
    </div>
  );
}

function isInviteError(error: unknown) {
  const message = errorToText(error);
  return /invite|referral|邀请码|邀请/i.test(message);
}

function codeErrorMessage(error: unknown) {
  const message = errorToText(error);
  return /验证码(?:无效|已过期|尝试次数过多)|重新获取/i.test(message)
    ? message
    : null;
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
