import { prisma } from "@gateway/db";
import { activeBalanceCurrencySettingKey } from "./balance-currency.js";

export async function assertDatabaseCompatibility() {
  const activeSetting = await prisma.systemSetting.findUnique({
    where: { key: activeBalanceCurrencySettingKey },
    select: { value: true },
  });

  if (!activeSetting?.value) {
    throw new Error(
      "Database compatibility check failed: active balance currency is missing",
    );
  }

  const [activeCurrency, mismatchedWallets] = await Promise.all([
    prisma.balanceCurrency.findUnique({
      where: { code: activeSetting.value },
      select: { code: true, enabled: true },
    }),
    prisma.wallet.count({
      where: { currency: { not: activeSetting.value } },
    }),
    prisma.walletTransaction.findFirst({
      select: { currency: true },
    }),
  ]);

  if (!activeCurrency?.enabled) {
    throw new Error(
      `Database compatibility check failed: active balance currency ${activeSetting.value} is unavailable`,
    );
  }

  if (mismatchedWallets > 0) {
    throw new Error(
      `Database compatibility check failed: ${mismatchedWallets} wallets have not migrated to ${activeSetting.value}`,
    );
  }
}
