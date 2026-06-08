import { prisma } from "@gateway/db";

export type ImageGenerationToolSettings = {
  routingModel: string;
};

export const defaultImageGenerationToolSettings: ImageGenerationToolSettings = {
  routingModel: "gpt-image-2",
};

const settingKey = "image_generation_tool_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultImageGenerationToolSettings;
let cachedAtMs = 0;

export async function readImageGenerationToolSettings() {
  const now = Date.now();
  if (now - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeImageGenerationToolSettings(parseJson(setting?.value));
  cachedAtMs = now;
  return cachedSettings;
}

export async function saveImageGenerationToolSettings(
  input: Partial<ImageGenerationToolSettings>,
) {
  const next = normalizeImageGenerationToolSettings({
    ...(await readImageGenerationToolSettings()),
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

export function normalizeImageGenerationToolSettings(
  value: unknown,
): ImageGenerationToolSettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<Record<keyof ImageGenerationToolSettings, unknown>>)
      : {};
  const routingModel =
    typeof input.routingModel === "string" && input.routingModel.trim()
      ? input.routingModel.trim()
      : defaultImageGenerationToolSettings.routingModel;

  return { routingModel };
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
