import { prisma } from "@gateway/db";
import {
  baseBalanceCurrencyCode,
  defaultBalanceCurrencyCode,
} from "./balance-currency.js";

export async function assertDatabaseCompatibility() {
  const [baseCurrency, pointsCurrency, baseCurrencyWallets] = await Promise.all([
    prisma.balanceCurrency.findUnique({
      where: { code: baseBalanceCurrencyCode },
      select: { code: true, enabled: true, isBase: true },
    }),
    prisma.balanceCurrency.findUnique({
      where: { code: defaultBalanceCurrencyCode },
      select: { code: true, enabled: true, isBase: true },
    }),
    prisma.wallet.count({
      where: { currency: baseBalanceCurrencyCode },
    }),
  ]);

  if (!baseCurrency?.isBase || !baseCurrency.enabled) {
    throw new Error(
      `Database compatibility check failed: base currency ${baseBalanceCurrencyCode} is unavailable`,
    );
  }

  if (!pointsCurrency || pointsCurrency.isBase) {
    throw new Error(
      `Database compatibility check failed: default balance currency ${defaultBalanceCurrencyCode} is missing or configured as base currency`,
    );
  }

  if (baseCurrencyWallets > 0) {
    throw new Error(
      `Database compatibility check failed: ${baseCurrencyWallets} user wallets use the internal base currency`,
    );
  }
}
