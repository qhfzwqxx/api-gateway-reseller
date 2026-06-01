-- Apply a final customer billing multiplier per resolved access tier.
ALTER TABLE "AccessTier" ADD COLUMN "billingMultiplier" DECIMAL(18, 8) NOT NULL DEFAULT 1;
