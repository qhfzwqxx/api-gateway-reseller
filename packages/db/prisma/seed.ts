import bcrypt from "bcryptjs";
import { prisma } from "../src/index.js";

const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "change-this-admin-password";
const baseCurrencyCode = "USD";
const healthCheckIntervalSeconds = process.env.MODEL_POOL_HEALTH_INTERVAL_SECONDS ?? "30";
const penaltySeconds = process.env.MODEL_POOL_PENALTY_SECONDS ?? "60";
const successGraceSeconds = process.env.MODEL_POOL_SUCCESS_GRACE_SECONDS ?? "0";

async function main() {
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      username: adminUsername,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      email: adminEmail,
      username: adminUsername,
      name: "Admin",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  await prisma.balanceCurrency.upsert({
    where: { code: baseCurrencyCode },
    update: {},
    create: {
      id: "balance_currency_usd",
      code: baseCurrencyCode,
      name: "美元基准单位",
      symbol: "$",
      icon: "circle-dollar-sign",
      baseUnitsPerUnit: "1",
      isBase: true,
      enabled: true,
      sortOrder: 100000,
    },
  });

  await prisma.balanceCurrency.upsert({
    where: { code: "POINTS" },
    update: {},
    create: {
      id: "balance_currency_points",
      code: "POINTS",
      name: "积分",
      symbol: "积分",
      icon: "zap",
      baseUnitsPerUnit: "1",
      isBase: false,
      enabled: true,
      sortOrder: 0,
    },
  });

  await prisma.systemSetting.deleteMany({
    where: { key: "balance_currency_active_code" },
  });

  await prisma.systemSetting.upsert({
    where: { key: "model_pool_health_interval_seconds" },
    update: {
      value: healthCheckIntervalSeconds,
    },
    create: {
      key: "model_pool_health_interval_seconds",
      value: healthCheckIntervalSeconds,
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: "model_pool_penalty_seconds" },
    update: {
      value: penaltySeconds,
    },
    create: {
      key: "model_pool_penalty_seconds",
      value: penaltySeconds,
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: "model_pool_success_grace_seconds" },
    update: {
      value: successGraceSeconds,
    },
    create: {
      key: "model_pool_success_grace_seconds",
      value: successGraceSeconds,
    },
  });

  console.log(`Seeded blank deployment admin ${adminUsername}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
