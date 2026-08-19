import { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";

export const baseBalanceCurrencyCode = "USD";
export const activeBalanceCurrencySettingKey = "balance_currency_active_code";
const maxStoredCurrencyAmount = new Decimal("9999999999.99999999");

export const balanceCurrencySelect = {
  id: true,
  code: true,
  name: true,
  symbol: true,
  icon: true,
  baseUnitsPerUnit: true,
  isBase: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CurrencyDb = PrismaClient | Prisma.TransactionClient;

export async function readBalanceCurrencySettings(db: CurrencyDb = prisma) {
  const [currencies, activeSetting] = await Promise.all([
    db.balanceCurrency.findMany({
      orderBy: [{ isBase: "desc" }, { createdAt: "asc" }],
      select: balanceCurrencySelect,
    }),
    db.systemSetting.findUnique({
      where: { key: activeBalanceCurrencySettingKey },
      select: { value: true },
    }),
  ]);

  const baseCurrency =
    currencies.find((currency) => currency.isBase) ??
    currencies.find((currency) => currency.code === baseBalanceCurrencyCode);
  const activeCurrencyCode = activeSetting?.value || baseCurrency?.code || baseBalanceCurrencyCode;
  const activeCurrency =
    currencies.find((currency) => currency.code === activeCurrencyCode) ??
    baseCurrency ??
    null;

  return {
    currencies: currencies.map(toBalanceCurrencyDto),
    baseCurrencyCode: baseCurrency?.code ?? baseBalanceCurrencyCode,
    activeCurrencyCode: activeCurrency?.code ?? baseBalanceCurrencyCode,
    activeCurrency: activeCurrency ? toBalanceCurrencyDto(activeCurrency) : null,
  };
}

export async function getBalanceCurrency(
  db: CurrencyDb,
  code: string,
) {
  return db.balanceCurrency.findUnique({
    where: { code: normalizeCurrencyCode(code) },
    select: balanceCurrencySelect,
  });
}

export async function getBalanceCurrencyOrThrow(
  db: CurrencyDb,
  code: string,
) {
  const currency = await getBalanceCurrency(db, code);
  if (!currency) {
    throw Object.assign(new Error(`余额货币不存在：${code}`), {
      statusCode: 404,
    });
  }

  return currency;
}

export async function getRedeemableBalanceCurrencyOrThrow(
  db: CurrencyDb,
  code: string,
) {
  const currency = await getBalanceCurrencyOrThrow(db, code);
  if (currency.isBase) {
    throw Object.assign(new Error("基准货币仅用于内部计价，不能用于余额兑换码"), {
      statusCode: 400,
    });
  }
  if (!currency.enabled) {
    throw Object.assign(new Error("该余额货币已停用，不能用于新兑换码"), {
      statusCode: 400,
    });
  }

  return currency;
}

export async function getActiveBalanceCurrency(db: CurrencyDb = prisma) {
  const settings = await readBalanceCurrencySettings(db);
  if (!settings.activeCurrency) {
    throw new Error("No balance currency configured");
  }

  return settings.activeCurrency;
}

export function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeBaseUnitsPerUnit(value: string | number | Decimal) {
  const amount = new Decimal(value);
  const normalized = amount.toDecimalPlaces(8);
  if (
    !amount.isFinite() ||
    normalized.lte(0) ||
    normalized.gt(maxStoredCurrencyAmount)
  ) {
    throw Object.assign(new Error("汇率必须是大于 0 的数字"), {
      statusCode: 400,
    });
  }

  return normalized.toFixed(8);
}

export function baseUnitsPerUnitFromUnitsPerBase(
  value: string | number | Decimal,
) {
  const unitsPerBase = new Decimal(value);
  if (!unitsPerBase.isFinite() || unitsPerBase.lte(0)) {
    throw Object.assign(new Error("兑换比例必须是大于 0 的数字"), {
      statusCode: 400,
    });
  }

  const baseUnitsPerUnit = new Decimal(1)
    .div(unitsPerBase)
    .toDecimalPlaces(8);
  if (
    baseUnitsPerUnit.lte(0) ||
    baseUnitsPerUnit.gt(maxStoredCurrencyAmount)
  ) {
    throw Object.assign(new Error("兑换比例超出可保存范围"), {
      statusCode: 400,
    });
  }

  return baseUnitsPerUnit.toFixed(8);
}

export function toBalanceCurrencyDto<
  T extends {
    baseUnitsPerUnit: Decimal.Value;
  },
>(currency: T) {
  const baseUnitsPerUnit = new Decimal(currency.baseUnitsPerUnit);
  return {
    ...currency,
    baseUnitsPerUnit: baseUnitsPerUnit.toFixed(8),
    unitsPerBase: new Decimal(1).div(baseUnitsPerUnit).toDecimalPlaces(8).toFixed(8),
  };
}

export function baseToWalletAmount(
  baseAmount: Decimal.Value,
  currency: { baseUnitsPerUnit: Decimal.Value },
) {
  return new Decimal(baseAmount)
    .div(currency.baseUnitsPerUnit)
    .toDecimalPlaces(8);
}

export function walletToBaseAmount(
  walletAmount: Decimal.Value,
  currency: { baseUnitsPerUnit: Decimal.Value },
) {
  return new Decimal(walletAmount)
    .mul(currency.baseUnitsPerUnit)
    .toDecimalPlaces(8);
}

export async function upsertWalletWithActiveCurrency(
  tx: Prisma.TransactionClient,
  userId: string,
  balance = "0",
) {
  const currency = await getActiveBalanceCurrency(tx);
  return tx.wallet.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      balance,
      currency: currency.code,
    },
  });
}

export async function migrateWalletsToCurrency(
  tx: Prisma.TransactionClient,
  targetCode: string,
) {
  const target = await getBalanceCurrencyOrThrow(tx, targetCode);
  if (target.isBase) {
    throw Object.assign(new Error("基准货币仅用于计价，不能作为用户余额货币"), {
      statusCode: 400,
    });
  }
  if (!target.enabled) {
    throw Object.assign(new Error("目标余额货币已停用"), { statusCode: 400 });
  }

  const pendingReservations = await tx.apiRequest.count({
    where: {
      status: "PENDING",
      reservedAmountUsd: { gt: 0 },
    },
  });
  if (pendingReservations > 0) {
    throw Object.assign(
      new Error("当前有进行中的余额冻结请求，请稍后再切换货币"),
      { statusCode: 409 },
    );
  }

  const wallets = await tx.wallet.findMany({
    include: { balanceCurrency: { select: balanceCurrencySelect } },
  });
  let convertedWallets = 0;
  let migratedBaseBalance = new Decimal(0);

  for (const wallet of wallets) {
    const source = wallet.balanceCurrency;
    const balanceBefore = new Decimal(wallet.balance.toString());
    const reservedBefore = new Decimal(wallet.reservedBalance.toString());
    const baseBalance = walletToBaseAmount(balanceBefore, source);
    const balanceAfter = baseToWalletAmount(baseBalance, target);
    const reservedAfter = baseToWalletAmount(
      walletToBaseAmount(reservedBefore, source),
      target,
    );

    if (
      wallet.currency !== target.code ||
      !balanceBefore.eq(balanceAfter) ||
      !reservedBefore.eq(reservedAfter)
    ) {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          currency: target.code,
          balance: balanceAfter.toFixed(8),
          reservedBalance: reservedAfter.toFixed(8),
        },
      });

      if (!balanceBefore.eq(0) || !balanceAfter.eq(0)) {
        await tx.walletTransaction.create({
          data: {
            userId: wallet.userId,
            type: "ADJUST",
            source: "CURRENCY_MIGRATION",
            amount: balanceAfter.minus(balanceBefore).toFixed(8),
            balanceBefore: balanceBefore.toFixed(8),
            balanceAfter: balanceAfter.toFixed(8),
            currency: target.code,
            remark: `余额货币迁移：${source.code} → ${target.code}`,
            metadata: {
              fromCurrency: source.code,
              toCurrency: target.code,
              baseBalance: baseBalance.toFixed(8),
              baseUnitsPerSourceUnit: source.baseUnitsPerUnit.toString(),
              baseUnitsPerTargetUnit: target.baseUnitsPerUnit.toString(),
            },
          },
        });
      }

      convertedWallets += 1;
    }

    migratedBaseBalance = migratedBaseBalance.plus(baseBalance);
  }

  await tx.systemSetting.upsert({
    where: { key: activeBalanceCurrencySettingKey },
    update: { value: target.code },
    create: { key: activeBalanceCurrencySettingKey, value: target.code },
  });

  return {
    target,
    convertedWallets,
    totalWallets: wallets.length,
    migratedBaseBalance: migratedBaseBalance.toFixed(8),
  };
}
