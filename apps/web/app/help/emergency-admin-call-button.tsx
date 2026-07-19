"use client";

import { Send, Siren } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import {
  FrontAlert,
  FrontButton,
  FrontDialog,
  FrontField,
} from "../front/_components/ui/front-ui";

type CallState = "idle" | "sending" | "sent" | "error";
const maxAdminMessageLength = 1000;

export function EmergencyAdminCallButton() {
  const [state, setState] = useState<CallState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [open, setOpen] = useState(false);
  const textareaId = useId();

  async function callAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setStatusMessage("");
    try {
      const data = await apiFetch<{ message?: string }>("/public/emergency-admin-call", {
        method: "POST",
        token: null,
        body: JSON.stringify({ source: "help", message: adminMessage.trim() }),
      });
      setState("sent");
      setStatusMessage(data.message ?? "已呼叫管理员，请等待处理。");
      setOpen(false);
    } catch (error) {
      setState("error");
      setStatusMessage(error instanceof Error ? error.message : "呼叫失败，请稍后再试。");
    }
  }

  return (
    <div className="front-emergency-call">
      <FrontButton
        variant="danger"
        disabled={state === "sending" || state === "sent"}
        onClick={() => {
          if (state === "error") {
            setState("idle");
            setStatusMessage("");
          }
          setOpen(true);
        }}
      >
        <Siren aria-hidden="true" size={18} />
        {state === "sent" ? "已呼叫管理员" : "紧急呼叫管理员"}
      </FrontButton>
      {statusMessage ? (
        <FrontAlert tone={state === "error" ? "error" : "success"}>{statusMessage}</FrontAlert>
      ) : (
        <p>同一 IP 5 分钟内最多触发一次邮件提醒，请优先提供请求时间和错误信息。</p>
      )}

      <FrontDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (state !== "sending") setOpen(nextOpen);
        }}
        title="紧急呼叫管理员"
        description="请说明接口超时、余额异常、模型不可用或其他需要立即查看的问题。"
        footer={
          <>
            <FrontButton variant="secondary" disabled={state === "sending"} onClick={() => setOpen(false)}>
              取消
            </FrontButton>
            <FrontButton variant="danger" loading={state === "sending"} form="front-emergency-form" type="submit">
              {state === "sending" ? "正在发送" : <><Send aria-hidden="true" size={17} />发送呼叫</>}
            </FrontButton>
          </>
        }
      >
        <form id="front-emergency-form" className="front-emergency-form" onSubmit={callAdmin}>
          <FrontField
            label="要对管理员说的内容"
            htmlFor={textareaId}
            hint={`${adminMessage.length}/${maxAdminMessageLength} 字符；可留空，但建议写清问题。`}
          >
            <textarea
              id={textareaId}
              className="front-textarea"
              autoFocus
              rows={6}
              maxLength={maxAdminMessageLength}
              value={adminMessage}
              disabled={state === "sending"}
              onChange={(event) => setAdminMessage(event.target.value.slice(0, maxAdminMessageLength))}
              placeholder="例如：2026-07-18 20:30，gpt-4.1 请求连续超时，HTTP 502。"
            />
          </FrontField>
          {state === "error" && statusMessage ? <FrontAlert tone="error">{statusMessage}</FrontAlert> : null}
        </form>
      </FrontDialog>
    </div>
  );
}
