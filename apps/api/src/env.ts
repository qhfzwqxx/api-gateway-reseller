import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(4100),
  CORS_ORIGINS: z.string().default("http://127.0.0.1:4101,http://localhost:4101"),
  JWT_SECRET: z.string().min(16),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  UPSTREAM_BASE_URL: z.string().url().default("https://api.openai.com"),
  UPSTREAM_API_KEY: z.string().default(""),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(60000),
  UPSTREAM_KEY_ENCRYPTION_SECRET: z.string().optional(),
  TENCENT_IMAGE_SCF_URL: z.string().url().optional(),
  TENCENT_IMAGE_SCF_CALL_SECRET: z.string().optional(),
  TENCENT_IMAGE_COS_PREFIX: z.string().optional(),
  TENCENT_IMAGE_PUBLIC_BASE_URL: z.string().url().optional(),
  DEFAULT_CURRENCY: z.string().default("USD"),
});

export const env = envSchema.parse(process.env);
