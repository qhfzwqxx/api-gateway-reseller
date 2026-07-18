CREATE TYPE "ReferralProfileStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "ReferralInviteStatus" AS ENUM ('REWARDED', 'SKIPPED');
CREATE TYPE "ReferralRewardType" AS ENUM ('NONE', 'BALANCE', 'SUBSCRIPTION');

CREATE TABLE "ReferralProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "ReferralProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "successfulInvites" INTEGER NOT NULL DEFAULT 0,
  "rewardedInvites" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReferralProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralInvite" (
  "id" TEXT NOT NULL,
  "referralProfileId" TEXT NOT NULL,
  "inviterUserId" TEXT NOT NULL,
  "inviteeUserId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "ReferralInviteStatus" NOT NULL DEFAULT 'REWARDED',
  "inviterRewardType" "ReferralRewardType" NOT NULL DEFAULT 'NONE',
  "inviterRewardAmount" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "inviterRewardPlanId" TEXT,
  "inviteeRewardType" "ReferralRewardType" NOT NULL DEFAULT 'NONE',
  "inviteeRewardAmount" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "inviteeRewardPlanId" TEXT,
  "inviterRewardedAt" TIMESTAMP(3),
  "inviteeRewardedAt" TIMESTAMP(3),
  "rewardSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralProfile_userId_key" ON "ReferralProfile"("userId");
CREATE UNIQUE INDEX "ReferralProfile_code_key" ON "ReferralProfile"("code");
CREATE INDEX "ReferralProfile_status_idx" ON "ReferralProfile"("status");

CREATE UNIQUE INDEX "ReferralInvite_inviteeUserId_key" ON "ReferralInvite"("inviteeUserId");
CREATE INDEX "ReferralInvite_referralProfileId_createdAt_idx" ON "ReferralInvite"("referralProfileId", "createdAt");
CREATE INDEX "ReferralInvite_inviterUserId_createdAt_idx" ON "ReferralInvite"("inviterUserId", "createdAt");
CREATE INDEX "ReferralInvite_code_idx" ON "ReferralInvite"("code");
CREATE INDEX "ReferralInvite_status_createdAt_idx" ON "ReferralInvite"("status", "createdAt");

ALTER TABLE "ReferralProfile" ADD CONSTRAINT "ReferralProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_referralProfileId_fkey" FOREIGN KEY ("referralProfileId") REFERENCES "ReferralProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_inviteeUserId_fkey" FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
