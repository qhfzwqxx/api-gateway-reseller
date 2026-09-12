ALTER TABLE "UpstreamProvider"
ADD COLUMN "levelTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "UpstreamProvider"
SET "levelTags" = ARRAY_REMOVE(
  ARRAY[
    CASE
      WHEN "name" ~* '(^|[[:space:]·_-])free($|[[:space:]·_-]|分组|专线|线路)'
      THEN 'FREE'
    END,
    CASE
      WHEN "name" ~* '(^|[[:space:]·_-])team($|[[:space:]·_-]|分组|专线|线路)'
      THEN 'TEAM'
    END,
    CASE
      WHEN "name" ~* '(^|[[:space:]·_-])plus($|[[:space:]·_-]|分组|专线|线路)'
      THEN 'PLUS'
    END,
    CASE
      WHEN "name" ~* '(^|[[:space:]·_-])pro($|[[:space:]·_-]|分组|专线|线路)'
      THEN 'PRO'
    END
  ],
  NULL
);
