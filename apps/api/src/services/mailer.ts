import nodemailer from "nodemailer";
import type { AuthSettings } from "./auth-settings.js";

export async function sendEmailLoginCode(
  settings: AuthSettings,
  input: {
    to: string;
    code: string;
    ttlMinutes: number;
  },
) {
  const transporter = createTransporter(settings);
  const html = renderEmailLoginCodeHtml(input.code, input.ttlMinutes);

  await transporter.sendMail({
    from: settings.smtpFrom,
    to: input.to,
    subject: "APIshare 登录验证码",
    text: `你的 APIshare 登录验证码是 ${input.code}，${input.ttlMinutes} 分钟内有效。若不是你本人操作，请忽略这封邮件。`,
    html,
  });
}

export async function sendSmtpTestEmail(
  settings: AuthSettings,
  input: {
    to: string;
    code: string;
    ttlMinutes: number;
  },
) {
  await sendEmailLoginCode(settings, {
    to: input.to,
    code: input.code,
    ttlMinutes: input.ttlMinutes,
  });
}

export async function sendEmergencyAdminCallEmail(
  settings: AuthSettings,
  input: {
    to: string;
    ip: string;
    calledAt: Date;
    message: string;
  },
) {
  const transporter = createTransporter(settings);
  const calledAtText = formatDateTime(input.calledAt);
  const html = renderEmergencyAdminCallHtml({
    ip: input.ip,
    calledAtText,
    message: input.message,
  });
  const messageText = input.message.trim() || "用户没有填写留言。";

  await transporter.sendMail({
    from: settings.smtpFrom,
    to: input.to,
    subject: "APIshare 紧急呼叫管理员",
    text: `有人正在呼叫管理员。\n\nIP：${input.ip}\n时间：${calledAtText}\n留言：${messageText}\n\n请尽快查看 APIshare 网关状态。`,
    html,
  });
}

function createTransporter(settings: AuthSettings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: settings.smtpUser
      ? {
          user: settings.smtpUser,
          pass: settings.smtpPassword,
        }
      : undefined,
  });
}

function renderEmergencyAdminCallHtml(input: {
  ip: string;
  calledAtText: string;
  message: string;
}) {
  const ip = escapeHtml(input.ip);
  const calledAtText = escapeHtml(input.calledAtText);
  const message = escapeHtml(input.message.trim() || "用户没有填写留言。").replace(
    /\n/g,
    "<br />",
  );

  return `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>APIshare 紧急呼叫管理员</title>
  </head>
  <body style="margin:0; padding:0; background:#f6f8fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb; margin:0; padding:36px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; border-collapse:separate; border-spacing:0; border:1px solid #dfe7f2; border-radius:20px; background:#ffffff;">
            <tr>
              <td style="padding:26px 30px 20px; border-bottom:1px solid #edf2f7;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="height:36px; color:#0f172a; font:800 30px/36px Arial,'Microsoft YaHei',sans-serif; letter-spacing:0;">
                      APIshare
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <h1 style="margin:0 0 10px; color:#0f172a; font:700 24px/1.3 Arial,'Microsoft YaHei',sans-serif;">有人正在呼叫管理员</h1>
                <p style="margin:0 0 24px; color:#475569; font:400 15px/1.8 Arial,'Microsoft YaHei',sans-serif;">帮助中心收到一次紧急呼叫，请尽快查看 APIshare 网关状态。</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:14px 16px; border-radius:12px; background:#f8fafc; color:#334155; font:400 14px/1.7 Arial,'Microsoft YaHei',sans-serif;">
                      呼叫 IP：<strong style="color:#0f172a;">${ip}</strong><br />
                      呼叫时间：<strong style="color:#0f172a;">${calledAtText}</strong>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:14px 16px; border-radius:12px; background:#fff7ed; color:#334155; font:400 14px/1.7 Arial,'Microsoft YaHei',sans-serif;">
                      <strong style="display:block; margin:0 0 6px; color:#0f172a;">用户留言</strong>
                      ${message}
                    </td>
                  </tr>
                </table>
                <p style="margin:0; color:#64748b; font:400 13px/1.8 Arial,'Microsoft YaHei',sans-serif;">同一 IP 5 分钟内最多触发一次紧急呼叫，以减少重复提醒。</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderEmailLoginCodeHtml(code: string, ttlMinutes: number) {
  const codeCells = escapeHtml(code)
    .split("")
    .map(
      (char) =>
        `<td align="center" style="width:44px; height:52px; border:1px solid #d7e1ee; border-radius:12px; background:#f8fbff; color:#0f172a; font:700 24px/1 Arial,'Microsoft YaHei',sans-serif;">${char}</td>`,
    )
    .join('<td style="width:8px;"></td>');

  return `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>APIshare 登录验证码</title>
  </head>
  <body style="margin:0; padding:0; background:#f6f8fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb; margin:0; padding:36px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; border-collapse:separate; border-spacing:0; border:1px solid #dfe7f2; border-radius:20px; background:#ffffff;">
            <tr>
              <td style="padding:26px 30px 20px; border-bottom:1px solid #edf2f7;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="height:36px; color:#0f172a; font:800 30px/36px Arial,'Microsoft YaHei',sans-serif; letter-spacing:0;">
                      APIshare
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <h1 style="margin:0 0 10px; color:#0f172a; font:700 24px/1.3 Arial,'Microsoft YaHei',sans-serif;">确认你的登录请求</h1>
                <p style="margin:0 0 24px; color:#475569; font:400 15px/1.8 Arial,'Microsoft YaHei',sans-serif;">请在登录页面输入下面的验证码。验证码仅用于本次 APIshare 登录。</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>${codeCells}</tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:14px 16px; border-radius:12px; background:#f8fafc; color:#334155; font:400 14px/1.7 Arial,'Microsoft YaHei',sans-serif;">
                      有效期 <strong style="color:#0f172a;">${ttlMinutes} 分钟</strong>。为了账户安全，请不要把验证码转发给任何人。
                    </td>
                  </tr>
                </table>
                <p style="margin:0; color:#64748b; font:400 13px/1.8 Arial,'Microsoft YaHei',sans-serif;">如果这不是你本人操作，可以忽略这封邮件；未完成验证不会登录你的账户。</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
