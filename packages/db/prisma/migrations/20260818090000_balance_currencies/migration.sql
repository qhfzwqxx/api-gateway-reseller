CREATE TABLE "BalanceCurrency" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT 'circle-dollar-sign',
  "baseUnitsPerUnit" DECIMAL(18, 8) NOT NULL DEFAULT 1,
  "isBase" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BalanceCurrency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BalanceCurrency_code_key" ON "BalanceCurrency"("code");
CREATE INDEX "BalanceCurrency_isBase_idx" ON "BalanceCurrency"("isBase");
CREATE INDEX "BalanceCurrency_enabled_idx" ON "BalanceCurrency"("enabled");

INSERT INTO "BalanceCurrency" (
  "id",
  "code",
  "name",
  "symbol",
  "icon",
  "baseUnitsPerUnit",
  "isBase",
  "enabled"
)
VALUES
  ('balance_currency_usd', 'USD', '美元基准单位', '$', 'circle-dollar-sign', 1, true, true),
  ('balance_currency_points', 'POINTS', '积分', '积分', 'zap', 1, false, true);

ALTER TABLE "WalletTransaction"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE "Wallet"
ADD CONSTRAINT "Wallet_currency_fkey"
FOREIGN KEY ("currency") REFERENCES "BalanceCurrency"("code")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction"
ADD CONSTRAINT "WalletTransaction_currency_fkey"
FOREIGN KEY ("currency") REFERENCES "BalanceCurrency"("code")
ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Wallet"
SET "currency" = 'POINTS'
WHERE "currency" = 'USD';

INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
VALUES ('balance_currency_active_code', 'POINTS', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "value" = EXCLUDED."value",
  "updatedAt" = CURRENT_TIMESTAMP;
