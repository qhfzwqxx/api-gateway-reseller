"use client";

import { Send, Siren, X } from "lucide-react";
import { FormEvent, useEffect, useId, useRef, useState } from "react";

type CallState = "idle" | "sending" | "sent" | "error";

const maxAdminMessageLength = 1000;

export function EmergencyAdminCallButton() {
  const [state, setState] = useState<CallState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [open, setOpen] = useState(false);
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => textareaRef.current?.focus(), 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && state !== "sending") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, state]);

  async function callAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setStatusMessage("");

    try {
      const response = await fetch("/api/public/emergency-admin-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "help",
          message: adminMessage.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message ?? "呼叫失败，请稍后再试。");
      }

      setState("sent");
      setStatusMessage(data.message ?? "已呼叫管理员，请等待处理。");
      setOpen(false);
    } catch (error) {
      setState("error");
      setStatusMessage(
        error instanceof Error ? error.message : "呼叫失败，请稍后再试。",
      );
    }
  }

  const disabled = state === "sending" || state === "sent";

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (state === "error") {
            setState("idle");
            setStatusMessage("");
          }
        }}
        disabled={disabled}
        className="inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        <Siren className="size-4" aria-hidden="true" />
        {state === "sending" ? "正在呼叫管理员" : "紧急呼叫管理员"}
      </button>

      {statusMessage ? (
        <p
          className={
            state === "error"
              ? "text-sm leading-6 text-red-700"
              : "text-sm leading-6 text-emerald-700"
          }
          role={state === "error" ? "alert" : "status"}
        >
          {statusMessage}
        </p>
      ) : (
        <p className="text-sm leading-6 text-slate-600">
          点击后填写要对管理员说的内容，同一 IP 5 分钟内最多触发一次邮件提醒。
        </p>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/45 px-3 py-3 sm:items-center sm:justify-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${textareaId}-title`}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="关闭弹窗"
            onClick={() => {
              if (state !== "sending") {
                setOpen(false);
              }
            }}
          />
          <form
            onSubmit={callAdmin}
            className="relative grid max-h-[88dvh] w-full max-w-lg gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id={`${textareaId}-title`}
                  className="text-lg font-bold text-slate-950 sm:text-xl"
                >
                  紧急呼叫管理员
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  请写下你遇到的问题，管理员会尽快查看。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={state === "sending"}
                className="grid size-11 shrink-0 place-items-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="关闭"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-2">
              <label
                htmlFor={textareaId}
                className="text-sm font-semibold text-slate-800"
              >
                要对管理员说的内容
              </label>
              <textarea
                ref={textareaRef}
                id={textareaId}
                value={adminMessage}
                onChange={(event) =>
                  setAdminMessage(
                    event.target.value.slice(0, maxAdminMessageLength),
                  )
                }
                maxLength={maxAdminMessageLength}
                rows={6}
                className="min-h-36 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-3 text-base leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                placeholder="例如：接口一直超时、余额异常、模型不可用，或你希望管理员立刻查看的问题。"
              />
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>可留空发送，但建议写清楚问题。</span>
                <span>
                  {adminMessage.length}/{maxAdminMessageLength}
                </span>
              </div>
            </div>

            {state === "error" && statusMessage ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700" role="alert">
                {statusMessage}
              </p>
            ) : null}

            <div className="grid gap-3">
              <button
                type="submit"
                disabled={state === "sending"}
                className="inline-flex min-h-12 touch-manipulation items-center justify-center gap-2 rounded-md bg-red-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <Send className="size-4" aria-hidden="true" />
                {state === "sending" ? "正在发送" : "发送呼叫"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
