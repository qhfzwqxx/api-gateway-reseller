import { prisma } from "@gateway/db";

export type GatewayNoticeSettings = {
  userConcurrencyMessage: string;
  keyConcurrencyMessage: string;
  tierConcurrencyMessage: string;
  userRateLimitMessage: string;
  keyRateLimitMessage: string;
  tierRateLimitMessage: string;
  charityIpRateLimitMessage: string;
  modelUnavailableMessage: string;
  missingUsageMessage: string;
  staleResponsesContextMessage: string;
  invalidEncryptedContentMessage: string;
  upstreamBalanceInsufficientMessage: string;
};

export const defaultGatewayNoticeSettings: GatewayNoticeSettings = {
  userConcurrencyMessage: "当前账号并发已达到 {limit}，请等待正在处理的请求完成后重试。",
  keyConcurrencyMessage: "当前 API Key 并发已达到 {limit}，请等待正在处理的请求完成后重试。",
  tierConcurrencyMessage:
    "当前访问等级并发已达到 {limit}，请等待该等级下正在处理的请求完成后重试。",
  userRateLimitMessage: "当前账号已达到每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
  keyRateLimitMessage: "当前 API Key 已达到每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
  tierRateLimitMessage:
    "当前访问等级已达到每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
  charityIpRateLimitMessage:
    "当前 IP 已达到公益账号每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
  modelUnavailableMessage: "当前模型暂不可用，请稍后再试。",
  missingUsageMessage: "请新建对话或清空当前会话上下文后重试。",
  staleResponsesContextMessage:
    "当前会话的上下文已失效，请新建对话或清空当前会话上下文后重试。",
  invalidEncryptedContentMessage:
    "当前会话包含无法继续使用的上下文，请新建对话或清空当前会话上下文后重试。",
  upstreamBalanceInsufficientMessage: "当前服务临时繁忙，请稍后重试。",
};

const settingKey = "gateway_notice_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultGatewayNoticeSettings;
let cachedAtMs = 0;

export async function readGatewayNoticeSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeGatewayNoticeSettings(parseSettings(setting?.value));
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveGatewayNoticeSettings(input: Partial<GatewayNoticeSettings>) {
  const current = await readGatewayNoticeSettings();
  const settings = normalizeGatewayNoticeSettings({ ...current, ...input });
  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });
  cachedSettings = settings;
  cachedAtMs = Date.now();
  return settings;
}

export function renderGatewayNoticeTemplate(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Partial<GatewayNoticeSettings>;
  } catch {
    return {};
  }
}

function normalizeGatewayNoticeSettings(input: Partial<GatewayNoticeSettings>) {
  return Object.fromEntries(
    Object.entries(defaultGatewayNoticeSettings).map(([key, fallback]) => {
      const value = String(input[key as keyof GatewayNoticeSettings] ?? "").trim();
      return [key, (value || fallback).slice(0, 8000)];
    }),
  ) as GatewayNoticeSettings;
}
