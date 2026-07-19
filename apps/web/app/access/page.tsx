"use client";

import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  apiFetch,
  apiFieldError,
  clearToken,
  getToken,
  isAuthError,
  setToken,
} from "../../lib/api";
import type { FrontAuthSettings, FrontUser } from "../../lib/types/front";
import {
  FrontAlert,
  FrontButton,
  FrontCard,
  FrontField,
  FrontIconButton,
  FrontLogo,
  FrontProviders,
  FrontSkeleton,
} from "../front/_components/ui/front-ui";

export default function AccessPage() {
  return (
    <FrontProviders>
      <AccessController />
    </FrontProviders>
  );
}

function AccessController() {
  const [user, setUser] = useState<FrontUser | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);
  const [settings, setSettings] = useState<FrontAuthSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const settingsRequestRef = useRef(0);

  useEffect(() => {
    void loadSettings();
    const token = getToken();
    if (!token) {
      setLoadingUser(false);
      return;
    }
    void apiFetch<{ user: FrontUser }>("/auth/me", { token })
      .then((result) => setUser(result.user))
      .catch((loadError) => {
        if (isAuthError(loadError)) clearToken();
        else setError(errorToText(loadError));
      })
      .finally(() => setLoadingUser(false));
  }, []);

  async function loadSettings() {
    const requestId = ++settingsRequestRef.current;
    setSettingsLoading(true);
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
    } finally {
      if (requestId === settingsRequestRef.current) {
        setSettingsLoading(false);
      }
    }
  }

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(
      () => setCountdown((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [countdown]);

  function validateEmail() {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    setEmailError(valid ? null : "请输入有效的邮箱地址");
    if (!valid) emailRef.current?.focus();
    return valid;
  }

  async function sendCode() {
    if (sendingCode || countdown > 0 || submitting) return;
    setError(null);
    setMessage(null);
    if (!validateEmail()) return;
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
      await apiFetch("/auth/email-code/send", {
        method: "POST",
        token: null,
        body: JSON.stringify({ email: email.trim() }),
      });
      setCountdown(60);
      setMessage("验证码已发送，请检查邮箱。请在有效期内完成登录并继续验证。");
      codeRef.current?.focus();
    } catch (sendError) {
      const fieldError = apiFieldError(sendError, "email");
      if (fieldError) {
        setEmailError(fieldError);
        emailRef.current?.focus();
      } else {
        setError(errorToText(sendError));
      }
    } finally {
      setSendingCode(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const emailValid = validateEmail();
    const codeValid = /^\d{6}$/.test(code);
    setCodeError(codeValid ? null : "请输入 6 位数字验证码");
    if (!emailValid || !codeValid) {
      if (emailValid && !codeValid) codeRef.current?.focus();
      return;
    }
    if (!settings?.emailCodeLoginEnabled || !settings.smtpConfigured) {
      setError("邮箱验证码登录当前不可用，请稍后重试或联系管理员。");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<{ token: string; user: FrontUser }>(
        "/auth/email-code/login",
        {
          method: "POST",
          token: null,
          body: JSON.stringify({ email: email.trim(), code }),
        },
      );
      setToken(result.token);
      setUser(result.user);
      setMessage("账号登录成功，请继续输入白名单密钥。");
      window.requestAnimationFrame(() => secretRef.current?.focus());
    } catch (loginError) {
      const nextEmailError = apiFieldError(loginError, "email");
      const nextCodeError = apiFieldError(loginError, "code") ?? codeErrorMessage(loginError);
      if (nextEmailError) {
        setEmailError(nextEmailError);
        emailRef.current?.focus();
      } else if (nextCodeError) {
        setCodeError(nextCodeError);
        codeRef.current?.focus();
      } else {
        setError(errorToText(loginError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const normalizedSecret = secret.trim();
    if (!normalizedSecret) {
      setSecretError("请输入管理员提供的白名单密钥");
      secretRef.current?.focus();
      return;
    }
    setSecretError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/whitelist-filter/unlock", {
        method: "POST",
        body: JSON.stringify({ secret: normalizedSecret }),
      });
      setSecret("");
      setShowSecret(false);
      setSuccess(true);
      setMessage("白名单验证已完成，当前账号已解除过滤。");
    } catch (unlockError) {
      if (isAuthError(unlockError)) {
        clearToken();
        setUser(null);
      }
      setError(errorToText(unlockError));
    } finally {
      setSubmitting(false);
    }
  }

  function switchAccount() {
    clearToken();
    setUser(null);
    setCode("");
    setSecret("");
    setSuccess(false);
    setMessage(null);
    setError(null);
    window.requestAnimationFrame(() => emailRef.current?.focus());
  }

  const step = success ? 3 : user ? 2 : 1;
  const authUnavailable =
    !settings || !settings.emailCodeLoginEnabled || !settings.smtpConfigured;

  return (
    <main className="front-public-page front-access-page">
      <header className="front-public-header">
        <Link href="/" aria-label="返回 APIshare 控制台"><FrontLogo /></Link>
        <Link className="front-button front-button-secondary" href="/">
          <ArrowLeft aria-hidden="true" size={17} /> 返回控制台
        </Link>
      </header>

      <div className="front-access-container">
        <section className="front-access-intro">
          <FrontBadgeLike />
          <h1>白名单验证</h1>
          <p>先使用邮箱验证码确认账号，再输入管理员提供的当前白名单密钥。</p>
          <div className="front-stepper" aria-label={`当前第 ${Math.min(step, 2)} 步`}>
            <AccessStep number={1} label="邮箱登录" active={step === 1} done={step > 1} />
            <span aria-hidden="true" />
            <AccessStep number={2} label="密钥验证" active={step === 2} done={step > 2} />
          </div>
        </section>

        <FrontCard className="front-access-card">
          {message ? <FrontAlert tone="success">{message}</FrontAlert> : null}
          {error ? <FrontAlert tone="error">{error}</FrontAlert> : null}

          {!user && settingsError ? (
            <FrontAlert tone="error" title="登录配置加载失败">
              <div className="front-inline-retry">
                <span>{settingsError}</span>
                <FrontButton variant="secondary" onClick={() => void loadSettings()}>
                  重试
                </FrontButton>
              </div>
            </FrontAlert>
          ) : null}

          {!user && settings ? (
            !settings.emailCodeLoginEnabled ? (
              <FrontAlert tone="warning" title="验证码登录已关闭">
                当前无法通过邮箱验证码登录，请联系管理员。
              </FrontAlert>
            ) : !settings.smtpConfigured ? (
              <FrontAlert tone="warning" title="邮件服务未配置">
                验证码邮件暂时无法发送，请联系管理员配置 SMTP。
              </FrontAlert>
            ) : !settings.emailCodeAutoRegisterEnabled ? (
              <FrontAlert tone="info" title="仅限已有账号">
                自动注册已关闭，只有已存在的邮箱账号可以继续验证。
              </FrontAlert>
            ) : null
          ) : null}

          {loadingUser || (!user && settingsLoading) ? (
            <div className="front-access-skeleton">
              <FrontSkeleton height={44} />
              <FrontSkeleton height={44} />
              <FrontSkeleton height={44} />
            </div>
          ) : success ? (
            <div className="front-access-success">
              <span><Check aria-hidden="true" size={28} /></span>
              <h2>验证成功</h2>
              <p>当前账号 {user?.email} 已完成白名单验证，可以返回控制台继续使用。</p>
              <Link className="front-button front-button-primary" href="/">
                进入控制台
              </Link>
            </div>
          ) : user ? (
            <form className="front-access-form" onSubmit={unlock}>
              <div className="front-current-account">
                <div><span>当前账号</span><strong>{user.email}</strong></div>
                <FrontButton variant="ghost" type="button" onClick={switchAccount}>
                  <LogOut aria-hidden="true" size={16} /> 切换账号
                </FrontButton>
              </div>
              <FrontField
                label="白名单密钥"
                htmlFor="front-access-secret"
                required
                error={secretError}
                hint="密钥由管理员提供，验证成功后即可进入控制台"
              >
                <div className="front-input-affix front-input-affix-action">
                  <KeyRound aria-hidden="true" size={18} />
                  <input
                    ref={secretRef}
                    id="front-access-secret"
                    className="front-input front-input-mono"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    autoComplete="new-password"
                    disabled={submitting}
                    aria-invalid={Boolean(secretError)}
                    onChange={(event) => {
                      setSecret(event.target.value);
                      setSecretError(null);
                    }}
                  />
                  <FrontIconButton
                    label={showSecret ? "隐藏白名单密钥" : "显示白名单密钥"}
                    onClick={() => setShowSecret((current) => !current)}
                  >
                    {showSecret ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                  </FrontIconButton>
                </div>
              </FrontField>
              <FrontButton type="submit" loading={submitting}>
                {submitting ? "验证中" : <><ShieldCheck aria-hidden="true" size={18} /> 验证密钥</>}
              </FrontButton>
            </form>
          ) : (
            <form className="front-access-form" onSubmit={login} noValidate>
              <FrontField label="邮箱" htmlFor="front-access-email" required error={emailError}>
                <div className="front-input-affix">
                  <Mail aria-hidden="true" size={18} />
                  <input
                    ref={emailRef}
                    id="front-access-email"
                    className="front-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    placeholder="name@example.com"
                    aria-invalid={Boolean(emailError)}
                    disabled={
                      submitting || sendingCode || countdown > 0 || authUnavailable
                    }
                    onBlur={validateEmail}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setEmailError(null);
                    }}
                  />
                </div>
              </FrontField>
              <FrontField label="验证码" htmlFor="front-access-code" required error={codeError}>
                <div className="front-auth-code-row">
                  <input
                    ref={codeRef}
                    id="front-access-code"
                    className="front-input front-input-mono"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={code}
                    placeholder="000000"
                    disabled={submitting || authUnavailable}
                    aria-invalid={Boolean(codeError)}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                      setCodeError(null);
                    }}
                  />
                  <FrontButton
                    variant="secondary"
                    type="button"
                    loading={sendingCode}
                    disabled={submitting || authUnavailable || countdown > 0}
                    onClick={() => void sendCode()}
                  >
                    {countdown > 0 ? `${countdown} 秒后重发` : "发送验证码"}
                  </FrontButton>
                </div>
              </FrontField>
              <FrontButton
                type="submit"
                loading={submitting}
                disabled={authUnavailable || sendingCode}
              >
                {submitting ? "登录中" : "登录并继续"}
              </FrontButton>
            </form>
          )}
        </FrontCard>
      </div>
    </main>
  );
}

function FrontBadgeLike() {
  return (
    <span className="front-access-icon">
      <ShieldCheck aria-hidden="true" size={24} />
    </span>
  );
}

function AccessStep({
  number,
  label,
  active,
  done,
}: {
  number: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className={`${active ? "front-active" : ""}${done ? " front-done" : ""}`}>
      <span>{done ? <Check aria-hidden="true" size={15} /> : number}</span>
      <strong>{label}</strong>
    </div>
  );
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function codeErrorMessage(error: unknown) {
  const message = errorToText(error);
  return /验证码(?:无效|已过期|尝试次数过多)|重新获取/i.test(message)
    ? message
    : null;
}
