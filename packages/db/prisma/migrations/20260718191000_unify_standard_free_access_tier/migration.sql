UPDATE "AccessTier"
SET "name" = 'Free', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'standard' AND "name" <> 'Free';

UPDATE "User"
SET "tierId" = (
  SELECT "id"
  FROM "AccessTier"
  WHERE "code" = 'standard'
)
WHERE "tierId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "AccessTier"
    WHERE "code" = 'standard'
  );
