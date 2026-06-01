CREATE TYPE "SubscriptionQuotaMode" AS ENUM ('DAILY', 'TOTAL', 'UNLIMITED');

ALTER TABLE "SubscriptionPlan"
  ADD COLUMN IF NOT EXISTS "quotaMode" "SubscriptionQuotaMode" NOT NULL DEFAULT 'DAILY',
  ADD COLUMN IF NOT EXISTS "quotaAmountUsd" DECIMAL(18, 8) NOT NULL DEFAULT 0;

ALTER TABLE "UserSubscription"
  ADD COLUMN IF NOT EXISTS "quotaGrantCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "dailyUsageDateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "dailyUsedUsd" DECIMAL(18, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalUsedUsd" DECIMAL(18, 8) NOT NULL DEFAULT 0;

ALTER TABLE "ApiRequest"
  ADD COLUMN IF NOT EXISTS "subscriptionChargedAmountUsd" DECIMAL(18, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "walletChargedAmountUsd" DECIMAL(18, 8) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "SubscriptionUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "requestId" TEXT,
  "usageDateKey" TEXT NOT NULL,
  "amountUsd" DECIMAL(18, 8) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'API_CHARGE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionUsage_requestId_key" ON "SubscriptionUsage"("requestId");
CREATE INDEX IF NOT EXISTS "SubscriptionUsage_userId_usageDateKey_idx" ON "SubscriptionUsage"("userId", "usageDateKey");
CREATE INDEX IF NOT EXISTS "SubscriptionUsage_subscriptionId_usageDateKey_idx" ON "SubscriptionUsage"("subscriptionId", "usageDateKey");
CREATE INDEX IF NOT EXISTS "SubscriptionUsage_createdAt_idx" ON "SubscriptionUsage"("createdAt");

ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_quotaMode_check" CHECK ("quotaAmountUsd" >= 0);

ALTER TABLE "SubscriptionUsage"
  ADD CONSTRAINT "SubscriptionUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SubscriptionUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "UserSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
