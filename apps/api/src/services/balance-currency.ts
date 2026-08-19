import { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";

export const baseBalanceCurrencyCode = "USD";
export const defaultBalanceCurrencyCode = "POINTS";
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
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CurrencyDb = PrismaClient | Prisma.TransactionClient;

type BalanceCurrencyRecord = Prisma.BalanceCurrencyGetPayload<{
  select: typeof balanceCurrencySelect;
}>;

export type TierCurrencyOption = {
  currency: BalanceCurrencyRecord;
  priority: number;
  source: "USER" | "DEFAULT";
};

export async function readBalanceCurrencySettings(db: CurrencyDb = prisma) {
  const [currencies, walletStats] = await Promise.all([
    db.balanceCurrency.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { code: "asc" }],
      select: {
        ...balanceCurrencySelect,
        accessTiers: {
          select: {
            accessTier: {
              select: {
                id: true,
                code: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    db.wallet.groupBy({
      by: ["currency"],
      _count: { _all: true },
      _sum: { balance: true, reservedBalance: true },
    }),
  ]);

  const statsByCurrency = new Map(
    walletStats.map((stat) => [
      stat.currency,
      {
        walletCount: stat._count._all,
        balance: new Decimal(stat._sum.balance?.toString() ?? "0"),
        reservedBalance: new Decimal(stat._sum.reservedBalance?.toString() ?? "0"),
      },
    ]),
  );
  const baseCurrency =
    currencies.find((currency) => currency.isBase) ??
    currencies.find((currency) => currency.code === baseBalanceCurrencyCode);

  return {
    currencies: currencies.map(({ accessTiers, ...currency }) => {
      const stats = statsByCurrency.get(currency.code) ?? {
        walletCount: 0,
        balance: new Decimal(0),
        reservedBalance: new Decimal(0),
      };
      const dto = toBalanceCurrencyDto(currency);

      return {
        ...dto,
        accessTiers: accessTiers.map(({ accessTier }) => accessTier),
        walletCount: stats.walletCount,
        balance: stats.balance.toFixed(8),
        reservedBalance: stats.reservedBalance.toFixed(8),
        balanceBase: walletToBaseAmount(stats.balance, currency).toFixed(8),
        reservedBalanceBase: walletToBaseAmount(
          stats.reservedBalance,
          currency,
        ).toFixed(8),
      };
    }),
    baseCurrencyCode: baseCurrency?.code ?? baseBalanceCurrencyCode,
  };
}

export async function getBalanceCurrency(db: CurrencyDb, code: string) {
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

export async function getUsableBalanceCurrencyOrThrow(
  db: CurrencyDb,
  code: string,
  purpose = "此操作",
) {
  const currency = await getBalanceCurrencyOrThrow(db, code);
  if (currency.isBase) {
    throw Object.assign(
      new Error("基准货币仅用于内部计价，不能作为用户钱包货币"),
      { statusCode: 400 },
    );
  }
  if (!currency.enabled) {
    throw Object.assign(new Error(`该余额货币已停用，不能用于${purpose}`), {
      statusCode: 400,
    });
  }

  return currency;
}

export async function getRedeemableBalanceCurrencyOrThrow(
  db: CurrencyDb,
  code: string,
) {
  return getUsableBalanceCurrencyOrThrow(db, code, "余额兑换码");
}

export async function getDefaultBalanceCurrency(db: CurrencyDb = prisma) {
  return getUsableBalanceCurrencyOrThrow(
    db,
    defaultBalanceCurrencyCode,
    "默认奖励",
  );
}

export async function setBalanceCurrencyEnabled(
  tx: Prisma.TransactionClient,
  code: string,
  enabled: boolean,
) {
  const currency = await getBalanceCurrencyOrThrow(tx, code);
  if (currency.isBase) {
    throw Object.assign(new Error("基准货币固定启用，不能修改启用状态"), {
      statusCode: 400,
    });
  }

  return tx.balanceCurrency.update({
    where: { code: currency.code },
    data: { enabled },
    select: balanceCurrencySelect,
  });
}

export async function setBalanceCurrencyOrder(
  tx: Prisma.TransactionClient,
  currencyCodes: string[],
) {
  const normalizedCodes = currencyCodes.map(normalizeCurrencyCode);
  if (new Set(normalizedCodes).size !== normalizedCodes.length) {
    throw Object.assign(new Error("货币排序中存在重复代码"), { statusCode: 400 });
  }

  const currencies = await tx.balanceCurrency.findMany({
    where: { isBase: false },
    select: { code: true },
  });
  const knownCodes = currencies.map((currency) => currency.code).sort();
  if (
    normalizedCodes.length !== knownCodes.length ||
    normalizedCodes.slice().sort().some((code, index) => code !== knownCodes[index])
  ) {
    throw Object.assign(new Error("货币排序必须包含全部非基准货币"), {
      statusCode: 400,
    });
  }

  await Promise.all(
    normalizedCodes.map((code, index) =>
      tx.balanceCurrency.update({
        where: { code },
        data: { sortOrder: index * 10 },
      }),
    ),
  );
}

export async function setBalanceCurrencyAccessTiers(
  tx: Prisma.TransactionClient,
  code: string,
  accessTierIds: string[],
) {
  const currency = await getBalanceCurrencyOrThrow(tx, code);
  if (currency.isBase) {
    throw Object.assign(new Error("基准货币不能绑定访问等级"), {
      statusCode: 400,
    });
  }

  const uniqueTierIds = [...new Set(accessTierIds)];
  if (uniqueTierIds.length !== accessTierIds.length) {
    throw Object.assign(new Error("访问等级中存在重复项"), { statusCode: 400 });
  }
  if (uniqueTierIds.length > 0) {
    const existingTiers = await tx.accessTier.findMany({
      where: { id: { in: uniqueTierIds } },
      select: { id: true },
    });
    if (existingTiers.length !== uniqueTierIds.length) {
      throw Object.assign(new Error("包含不存在的访问等级"), { statusCode: 404 });
    }
  }

  await tx.balanceCurrencyAccessTier.deleteMany({
    where: { currencyCode: currency.code },
  });
  await tx.userTierCurrencyPreference.deleteMany({
    where:
      uniqueTierIds.length > 0
        ? {
            currencyCode: currency.code,
            accessTierId: { notIn: uniqueTierIds },
          }
        : { currencyCode: currency.code },
  });
  if (uniqueTierIds.length > 0) {
    await tx.balanceCurrencyAccessTier.createMany({
      data: uniqueTierIds.map((accessTierId) => ({
        currencyCode: currency.code,
        accessTierId,
      })),
    });
  }
}

export async function getTierCurrencyOptions(
  db: CurrencyDb,
  input: { userId?: string; accessTierId: string },
): Promise<TierCurrencyOption[]> {
  const bindings = await db.balanceCurrencyAccessTier.findMany({
    where: {
      accessTierId: input.accessTierId,
      currency: { enabled: true, isBase: false },
    },
    select: { currency: { select: balanceCurrencySelect } },
  });
  const currencies = bindings
    .map((binding) => binding.currency)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.code.localeCompare(right.code),
    );
  if (!input.userId || currencies.length === 0) {
    return currencies.map((currency, priority) => ({
      currency,
      priority,
      source: "DEFAULT",
    }));
  }

  const preferenceRows = await db.userTierCurrencyPreference.findMany({
    where: {
      userId: input.userId,
      accessTierId: input.accessTierId,
      currencyCode: { in: currencies.map((currency) => currency.code) },
    },
    orderBy: { priority: "asc" },
    select: { currencyCode: true },
  });
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const preferredCodes = preferenceRows
    .map((preference) => preference.currencyCode)
    .filter((code, index, items) => currencyByCode.has(code) && items.indexOf(code) === index);
  const orderedCodes = [
    ...preferredCodes,
    ...currencies.map((currency) => currency.code).filter((code) => !preferredCodes.includes(code)),
  ];
  const source = preferredCodes.length > 0 ? "USER" : "DEFAULT";

  return orderedCodes.map((code, priority) => ({
    currency: currencyByCode.get(code)!,
    priority,
    source,
  }));
}

export async function getTierCurrencyOptionsOrThrow(
  db: CurrencyDb,
  input: { userId?: string; accessTierId: string },
) {
  const options = await getTierCurrencyOptions(db, input);
  if (options.length === 0) {
    throw Object.assign(
      new Error("该访问等级尚未配置可用货币，请联系管理员配置后重试。"),
      { statusCode: 409 },
    );
  }
  return options;
}

export async function replaceUserTierCurrencyPreference(
  tx: Prisma.TransactionClient,
  input: { userId: string; accessTierId: string; currencyCodes: string[] },
) {
  const normalizedCodes = input.currencyCodes.map(normalizeCurrencyCode);
  if (new Set(normalizedCodes).size !== normalizedCodes.length) {
    throw Object.assign(new Error("货币优先级中存在重复代码"), { statusCode: 400 });
  }
  const allowedOptions = await getTierCurrencyOptionsOrThrow(tx, {
    accessTierId: input.accessTierId,
  });
  const allowedCodes = allowedOptions.map((option) => option.currency.code);
  if (
    normalizedCodes.length !== allowedCodes.length ||
    normalizedCodes.slice().sort().some((code, index) => code !== allowedCodes.slice().sort()[index])
  ) {
    throw Object.assign(
      new Error("只能提交该访问等级已启用并绑定的全部货币"),
      { statusCode: 400 },
    );
  }

  await tx.userTierCurrencyPreference.deleteMany({
    where: { userId: input.userId, accessTierId: input.accessTierId },
  });
  await tx.userTierCurrencyPreference.createMany({
    data: normalizedCodes.map((currencyCode, priority) => ({
      userId: input.userId,
      accessTierId: input.accessTierId,
      currencyCode,
      priority,
    })),
  });
}

export async function upsertWallet(
  tx: Prisma.TransactionClient,
  userId: string,
  currencyCode: string,
  balance = "0",
) {
  const currency = await getBalanceCurrencyOrThrow(tx, currencyCode);
  if (currency.isBase) {
    throw Object.assign(new Error("基准货币不能创建用户钱包"), {
      statusCode: 400,
    });
  }

  return tx.wallet.upsert({
    where: {
      userId_currency: { userId, currency: currency.code },
    },
    update: {},
    create: {
      userId,
      balance,
      currency: currency.code,
    },
    include: { balanceCurrency: { select: balanceCurrencySelect } },
  });
}

export async function applyWalletBalanceDelta(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    currencyCode: string;
    amount: Decimal.Value;
  },
) {
  const currency = await getUsableBalanceCurrencyOrThrow(
    tx,
    input.currencyCode,
    "余额变更",
  );
  const delta = new Decimal(input.amount);
  if (!delta.isFinite() || delta.isZero()) {
    throw Object.assign(new Error("余额变更金额不能为零且必须是有效数字"), {
      statusCode: 400,
    });
  }

  const wallet = await upsertWallet(tx, input.userId, currency.code);
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
  );
  const lockedWallet = await tx.wallet.findUniqueOrThrow({
    where: { id: wallet.id },
    include: { balanceCurrency: { select: balanceCurrencySelect } },
  });
  const balanceBefore = new Decimal(lockedWallet.balance.toString());
  const balanceAfter = balanceBefore.plus(delta);
  if (balanceAfter.lt(0)) {
    throw Object.assign(new Error("余额不能低于零"), { statusCode: 400 });
  }
  if (balanceAfter.gt(maxStoredCurrencyAmount)) {
    throw Object.assign(new Error("余额超过系统允许的最大值"), { statusCode: 400 });
  }

  const updatedWallet = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: balanceAfter.toFixed(8) },
    include: { balanceCurrency: { select: balanceCurrencySelect } },
  });

  return { wallet: updatedWallet, balanceBefore, balanceAfter, delta };
}

export async function releaseWalletReservedAmountInTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: string; currencyCode: string | null; amountUsd: Decimal.Value },
) {
  const reservedAmountUsd = new Decimal(input.amountUsd);
  if (reservedAmountUsd.lte(0) || !input.currencyCode) return;

  const currency = await getBalanceCurrency(tx, input.currencyCode);
  if (!currency) return;
  const walletAmount = baseToWalletAmount(reservedAmountUsd, currency);
  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "Wallet"
      SET "reservedBalance" = GREATEST(
        0,
        "reservedBalance" - ${walletAmount.toFixed(8)}::numeric
      )
      WHERE "userId" = ${input.userId}
        AND "currency" = ${currency.code}
    `,
  );
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
  T extends { baseUnitsPerUnit: Decimal.Value },
>(currency: T) {
  const baseUnitsPerUnit = new Decimal(currency.baseUnitsPerUnit);
  return {
    ...currency,
    baseUnitsPerUnit: baseUnitsPerUnit.toFixed(8),
    unitsPerBase: new Decimal(1)
      .div(baseUnitsPerUnit)
      .toDecimalPlaces(8)
      .toFixed(8),
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
