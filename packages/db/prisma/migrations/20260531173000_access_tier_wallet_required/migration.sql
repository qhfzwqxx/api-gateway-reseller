-- Control whether a resolved access tier must pass wallet balance gates before proxying.
ALTER TABLE "AccessTier" ADD COLUMN "walletRequired" BOOLEAN NOT NULL DEFAULT true;
