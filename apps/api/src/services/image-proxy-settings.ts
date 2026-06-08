import { prisma } from "@gateway/db";
import { env } from "../env.js";

export type ImageProxyMode = "direct" | "tencent_cos";

export type ImageProxySettings = {
  mode: ImageProxyMode;
  enabledModels: string[];
};

export type ImageProxyHealthCheck = {
  ok: boolean;
  mode: ImageProxyMode;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
    statusCode?: number;
  }>;
};

export const defaultImageProxySettings: ImageProxySettings = {
  mode: "tencent_cos",
  enabledModels: ["gpt-image-2"],
};

const settingKey = "image_proxy_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultImageProxySettings;
let cachedAtMs = 0;

export async function readImageProxySettings() {
  const now = Date.now();
  if (now - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeImageProxySettings(parseJson(setting?.value));
  cachedAtMs = now;
  return cachedSettings;
}

export async function saveImageProxySettings(input: Partial<ImageProxySettings>) {
  const next = normalizeImageProxySettings({
    ...(await readImageProxySettings()),
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(next) },
    create: { key: settingKey, value: JSON.stringify(next) },
  });

  cachedSettings = next;
  cachedAtMs = Date.now();
  return next;
}

export function shouldProxyImageModelViaTencent(
  settings: ImageProxySettings,
  model: unknown,
) {
  if (settings.mode !== "tencent_cos") {
    return false;
  }

  if (!env.TENCENT_IMAGE_SCF_URL || !env.TENCENT_IMAGE_SCF_CALL_SECRET) {
    return false;
  }

  if (settings.enabledModels.length === 0) {
    return true;
  }

  return (
    typeof model === "string" &&
    settings.enabledModels.some(
      (item) => item.toLowerCase() === model.trim().toLowerCase(),
    )
  );
}

export async function checkImageProxyService(): Promise<ImageProxyHealthCheck> {
  const settings = await readImageProxySettings();
  const checks: ImageProxyHealthCheck["checks"] = [];

  checks.push({
    name: "mode",
    ok: settings.mode === "tencent_cos",
    message:
      settings.mode === "tencent_cos"
        ? "云函数/COS 生图服务已启用"
        : "当前为直连上游模式",
  });

  const configOk = Boolean(
    env.TENCENT_IMAGE_SCF_URL && env.TENCENT_IMAGE_SCF_CALL_SECRET,
  );
  checks.push({
    name: "gateway_env",
    ok: configOk,
    message: configOk
      ? "网关云函数 URL 与调用密钥已配置"
      : "缺少 TENCENT_IMAGE_SCF_URL 或 TENCENT_IMAGE_SCF_CALL_SECRET",
  });

  if (env.TENCENT_IMAGE_SCF_URL) {
    try {
      const response = await fetch(env.TENCENT_IMAGE_SCF_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ping: true }),
      });
      const unauthorizedIsExpected = response.status === 401;
      checks.push({
        name: "scf_endpoint",
        ok: unauthorizedIsExpected,
        statusCode: response.status,
        message: unauthorizedIsExpected
          ? "云函数公网入口可达，未带密钥时正确拒绝"
          : `云函数入口返回 HTTP ${response.status}`,
      });
    } catch (error) {
      checks.push({
        name: "scf_endpoint",
        ok: false,
        message: `云函数入口不可达：${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  const publicBase = (env.TENCENT_IMAGE_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (publicBase) {
    try {
      const response = await fetch(publicBase, { method: "HEAD" });
      checks.push({
        name: "public_base",
        ok: response.status < 500,
        statusCode: response.status,
        message: `公网图片基础域名可访问，HTTP ${response.status}`,
      });
    } catch (error) {
      checks.push({
        name: "public_base",
        ok: false,
        message: `公网图片基础域名不可达：${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  } else {
    checks.push({
      name: "public_base",
      ok: true,
      message: "未配置 TENCENT_IMAGE_PUBLIC_BASE_URL，云函数将使用自身 PUBLIC_IMAGE_BASE",
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    mode: settings.mode,
    checks,
  };
}

export function normalizeImageProxySettings(value: unknown): ImageProxySettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<Record<keyof ImageProxySettings, unknown>>)
      : {};

  return {
    mode: input.mode === "direct" ? "direct" : "tencent_cos",
    enabledModels: normalizeModelList(input.enabledModels),
  };
}

function normalizeModelList(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : defaultImageProxySettings.enabledModels;

  return [...new Set(
    values
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, 100),
  )];
}

function parseJson(value?: string | null) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
