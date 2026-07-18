"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { apiFetch } from "../../lib/api";

type User = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
};

function getUserToken() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem("gateway_user_token");
}

function setUserToken(token: string) {
  window.localStorage.setItem("gateway_user_token", token);
}

function clearUserToken() {
  window.localStorage.removeItem("gateway_user_token");
}

export default function AccessPage() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getUserToken();
    if (!token) {
      setLoadingUser(false);
      return;
    }

    void apiFetch<{ user: User }>("/auth/me", { token })
      .then((result) => setUser(result.user))
      .catch(() => clearUserToken())
      .finally(() => setLoadingUser(false));
  }, []);

  async function sendCode() {
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("请先填写邮箱。");
      return;
    }

    setSendingCode(true);
    try {
      const result = await apiFetch<{ expiresInSeconds: number }>(
        "/auth/email-code/send",
        {
          method: "POST",
          body: JSON.stringify({ email }),
          token: null,
        },
      );
      setMessage(`验证码已发送，${Math.ceil(result.expiresInSeconds / 60)} 分钟内有效。`);
    } catch (sendError) {
      setError(errorToText(sendError));
    } finally {
      setSendingCode(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim() || !code.trim()) {
      setError("请填写邮箱和验证码。");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<{ token: string; user: User }>(
        "/auth/email-code/login",
        {
          method: "POST",
          body: JSON.stringify({ email, code }),
          token: null,
        },
      );
      setUserToken(result.token);
      setUser(result.user);
      setMessage("登录成功，请填写白名单密钥。");
    } catch (loginError) {
      setError(errorToText(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!secret.trim()) {
      setError("请填写密钥。");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<{ ok: true }>("/auth/whitelist-filter/unlock", {
        method: "POST",
        body: JSON.stringify({ secret }),
      });
      setSecret("");
      setMessage("验证成功，当前账号已解除白名单过滤。");
    } catch (unlockError) {
      setError(errorToText(unlockError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-950">白名单验证</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">登录账号后填写管理员提供的当前密钥。</p>
        </div>

        {message ? <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{message}</div> : null}
        {error ? <div className="mb-4 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}

        {loadingUser ? (
          <div className="flex h-32 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            正在读取登录状态
          </div>
        ) : user ? (
          <form className="grid gap-4" onSubmit={unlock}>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              当前账号：<span className="font-medium text-slate-950">{user.email}</span>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">白名单密钥</span>
              <input
                className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                autoComplete="one-time-code"
              />
            </label>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              {submitting ? "验证中" : "解除过滤"}
            </button>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={login}>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">邮箱</span>
              <input className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">验证码</span>
                <input className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" />
              </label>
              <button className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60" type="button" disabled={sendingCode} onClick={sendCode}>
                {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                {sendingCode ? "发送中" : "发送验证码"}
              </button>
            </div>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {submitting ? "登录中" : "登录并继续"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function errorToText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
