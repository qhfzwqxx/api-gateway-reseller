ALTER TABLE "UpstreamProvider" ADD COLUMN "groupName" TEXT;

CREATE INDEX "UpstreamProvider_groupName_idx" ON "UpstreamProvider"("groupName");
