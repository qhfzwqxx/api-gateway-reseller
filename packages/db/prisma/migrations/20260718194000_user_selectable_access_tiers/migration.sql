ALTER TABLE "AccessTier"
ADD COLUMN "userSelectable" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AccessTier"
SET "userSelectable" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('standard', 'plus');

UPDATE "AccessTier"
SET "userSelectable" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'pro';
