-- codex: requires-api-stop
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "BalanceCurrency"
    WHERE "code" = 'POINTS'
      AND "isBase" = false
      AND "enabled" = true
  ) THEN
    RAISE EXCEPTION 'POINTS balance currency is required for the multi-wallet migration';
  END IF;
END $$;

ALTER TABLE "BalanceCurrency"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 100;

WITH ordered AS (
  SELECT
    "code",
    CASE
      WHEN "code" = 'POINTS' THEN 0
      WHEN "isBase" THEN 100000
      ELSE 100 + (ROW_NUMBER() OVER (ORDER BY "createdAt", "code") * 10)
    END AS "nextSortOrder"
  FROM "BalanceCurrency"
)
UPDATE "BalanceCurrency" AS currency
SET "sortOrder" = ordered."nextSortOrder"
FROM ordered
WHERE currency."code" = ordered."code";

CREATE INDEX "BalanceCurrency_sortOrder_createdAt_idx"
ON "BalanceCurrency"("sortOrder", "createdAt");

CREATE TABLE "BalanceCurrencyAccessTier" (
  "id" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "accessTierId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BalanceCurrencyAccessTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BalanceCurrencyAccessTier_currencyCode_accessTierId_key"
ON "BalanceCurrencyAccessTier"("currencyCode", "accessTierId");
CREATE INDEX "BalanceCurrencyAccessTier_accessTierId_idx"
ON "BalanceCurrencyAccessTier"("accessTierId");

ALTER TABLE "BalanceCurrencyAccessTier"
ADD CONSTRAINT "BalanceCurrencyAccessTier_currencyCode_fkey"
FOREIGN KEY ("currencyCode") REFERENCES "BalanceCurrency"("code")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BalanceCurrencyAccessTier"
ADD CONSTRAINT "BalanceCurrencyAccessTier_accessTierId_fkey"
FOREIGN KEY ("accessTierId") REFERENCES "AccessTier"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BalanceCurrencyAccessTier" (
  "id",
  "currencyCode",
  "accessTierId",
  "createdAt"
)
SELECT
  'bcat_' || md5(currency."code" || ':' || tier."id"),
  currency."code",
  tier."id",
  CURRENT_TIMESTAMP
FROM "BalanceCurrency" AS currency
CROSS JOIN "AccessTier" AS tier
WHERE currency."enabled" = true
  AND currency."isBase" = false
  AND tier."status" = 'ACTIVE'
ON CONFLICT ("currencyCode", "accessTierId") DO NOTHING;

CREATE TABLE "UserTierCurrencyPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessTierId" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTierCurrencyPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTierCurrencyPreference_userId_accessTierId_currencyCode_key"
ON "UserTierCurrencyPreference"("userId", "accessTierId", "currencyCode");
CREATE UNIQUE INDEX "UserTierCurrencyPreference_userId_accessTierId_priority_key"
ON "UserTierCurrencyPreference"("userId", "accessTierId", "priority");
CREATE INDEX "UserTierCurrencyPreference_userId_accessTierId_priority_idx"
ON "UserTierCurrencyPreference"("userId", "accessTierId", "priority");

ALTER TABLE "UserTierCurrencyPreference"
ADD CONSTRAINT "UserTierCurrencyPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserTierCurrencyPreference"
ADD CONSTRAINT "UserTierCurrencyPreference_accessTierId_fkey"
FOREIGN KEY ("accessTierId") REFERENCES "AccessTier"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserTierCurrencyPreference"
ADD CONSTRAINT "UserTierCurrencyPreference_currencyCode_fkey"
FOREIGN KEY ("currencyCode") REFERENCES "BalanceCurrency"("code")
ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Wallet" AS wallet
SET
  "balance" = ROUND(
    wallet."balance" * source_currency."baseUnitsPerUnit" /
      points_currency."baseUnitsPerUnit",
    8
  ),
  "reservedBalance" = ROUND(
    wallet."reservedBalance" * source_currency."baseUnitsPerUnit" /
      points_currency."baseUnitsPerUnit",
    8
  ),
  "currency" = 'POINTS'
FROM "BalanceCurrency" AS source_currency,
     "BalanceCurrency" AS points_currency
WHERE source_currency."code" = wallet."currency"
  AND points_currency."code" = 'POINTS';

DROP INDEX "Wallet_userId_key";
CREATE UNIQUE INDEX "Wallet_userId_currency_key" ON "Wallet"("userId", "currency");
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");
CREATE INDEX "Wallet_currency_idx" ON "Wallet"("currency");

ALTER TABLE "Wallet"
ALTER COLUMN "currency" SET DEFAULT 'POINTS';

ALTER TABLE "WalletTransaction"
ALTER COLUMN "currency" SET DEFAULT 'POINTS';

ALTER TABLE "RedeemCode"
ALTER COLUMN "currency" SET DEFAULT 'POINTS';

ALTER TABLE "ApiRequest"
ADD COLUMN "walletCurrency" TEXT;

UPDATE "ApiRequest"
SET "walletCurrency" = 'POINTS'
WHERE "reservedAmountUsd" > 0;

ALTER TABLE "ApiRequest"
ADD CONSTRAINT "ApiRequest_walletCurrency_fkey"
FOREIGN KEY ("walletCurrency") REFERENCES "BalanceCurrency"("code")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ApiRequest_walletCurrency_idx" ON "ApiRequest"("walletCurrency");

DELETE FROM "SystemSetting"
WHERE "key" = 'balance_currency_active_code';

COMMIT;
