CREATE TEMP TABLE "UpstreamProviderNameMap" ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    "id",
    "name" AS "oldName",
    "baseUrl",
    "groupName",
    "levelTags",
    COUNT(*) OVER (PARTITION BY "baseUrl") AS "baseUrlCount",
    ROW_NUMBER() OVER (PARTITION BY "baseUrl" ORDER BY "createdAt", "id") AS "baseUrlSequence"
  FROM "UpstreamProvider"
)
SELECT
  "id",
  "oldName",
  CASE
    WHEN "baseUrlCount" = 1 THEN "baseUrl"
    WHEN "oldName" = "baseUrl" THEN "baseUrl"
    WHEN 'PLUS' = ANY("levelTags") THEN "baseUrl" || ' · Plus'
    WHEN 'PRO' = ANY("levelTags") THEN "baseUrl" || ' · Pro'
    WHEN "groupName" = '破甲分组' THEN "baseUrl" || ' · 破甲'
    WHEN "oldName" ILIKE '%画图%' THEN "baseUrl" || ' · 画图'
    ELSE "baseUrl" || ' · ' || "baseUrlSequence"
  END AS "newName"
FROM candidates;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UpstreamProviderNameMap"
    GROUP BY "newName"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Upstream provider Base URL name mapping is not unique';
  END IF;
END $$;

UPDATE "UpstreamProvider"
SET "name" = '__upstream_rename__' || "id"
WHERE "id" IN (SELECT "id" FROM "UpstreamProviderNameMap");

UPDATE "ModelPrice" AS price
SET "upstreamProvider" = mapping."newName"
FROM "UpstreamProviderNameMap" AS mapping
WHERE price."upstreamProvider" = mapping."oldName";

UPDATE "ModelPoolChannel" AS channel
SET "upstreamProvider" = mapping."newName"
FROM "UpstreamProviderNameMap" AS mapping
WHERE channel."upstreamProvider" = mapping."oldName";

UPDATE "UpstreamProvider" AS provider
SET "name" = mapping."newName"
FROM "UpstreamProviderNameMap" AS mapping
WHERE provider."id" = mapping."id";
