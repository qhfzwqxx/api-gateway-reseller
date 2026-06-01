CREATE TYPE "RedeemCodeRewardType" AS ENUM ('BALANCE', 'SUBSCRIPTION');
CREATE TYPE "SubscriptionPlanStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "UserSubscriptionStatus" AS ENUM ('ACTIVE', 'QUEUED', 'EXPIRED', 'DISABLED');

CREATE TABLE "SubscriptionPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "SubscriptionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "tierId" TEXT NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "tierId" TEXT NOT NULL,
  "status" "UserSubscriptionStatus" NOT NULL DEFAULT 'QUEUED',
  "active" BOOLEAN NOT NULL DEFAULT false,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "remainingSeconds" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMP(3),
  "baseTierId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'ADMIN',
  "redeemCodeId" TEXT,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RedeemCode" ADD COLUMN "rewardType" "RedeemCodeRewardType" NOT NULL DEFAULT 'BALANCE';
ALTER TABLE "RedeemCode" ADD COLUMN "subscriptionPlanId" TEXT;

CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");
CREATE INDEX "SubscriptionPlan_status_sortOrder_idx" ON "SubscriptionPlan"("status", "sortOrder");
CREATE INDEX "SubscriptionPlan_tierId_idx" ON "SubscriptionPlan"("tierId");

CREATE INDEX "UserSubscription_userId_active_idx" ON "UserSubscription"("userId", "active");
CREATE INDEX "UserSubscription_userId_status_endsAt_idx" ON "UserSubscription"("userId", "status", "endsAt");
CREATE INDEX "UserSubscription_planId_idx" ON "UserSubscription"("planId");
CREATE INDEX "UserSubscription_tierId_idx" ON "UserSubscription"("tierId");
CREATE INDEX "UserSubscription_redeemCodeId_idx" ON "UserSubscription"("redeemCodeId");
CREATE INDEX "RedeemCode_subscriptionPlanId_idx" ON "RedeemCode"("subscriptionPlanId");

ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AccessTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_baseTierId_fkey" FOREIGN KEY ("baseTierId") REFERENCES "AccessTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_redeemCodeId_fkey" FOREIGN KEY ("redeemCodeId") REFERENCES "RedeemCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RedeemCode" ADD CONSTRAINT "RedeemCode_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
