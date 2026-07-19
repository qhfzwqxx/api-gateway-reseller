CREATE TABLE "UpstreamProviderGroup" (
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamProviderGroup_pkey" PRIMARY KEY ("name")
);

INSERT INTO "UpstreamProviderGroup" ("name", "createdAt", "updatedAt")
SELECT DISTINCT "groupName", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "UpstreamProvider"
WHERE "groupName" IS NOT NULL;

ALTER TABLE "UpstreamProvider"
ADD CONSTRAINT "UpstreamProvider_groupName_fkey"
FOREIGN KEY ("groupName") REFERENCES "UpstreamProviderGroup"("name")
ON DELETE SET NULL ON UPDATE CASCADE;
