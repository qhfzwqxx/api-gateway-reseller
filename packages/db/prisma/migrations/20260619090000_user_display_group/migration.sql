ALTER TABLE "User" ADD COLUMN "displayGroup" TEXT NOT NULL DEFAULT '普通用户组';

UPDATE "User"
SET "displayGroup" = CASE
  WHEN "role" = 'ADMIN' THEN '管理员组'
  WHEN "charityEnabled" = true OR lower("email") = 'free@qq.com' THEN '公益组'
  WHEN "status" = 'RISK_REVIEW' THEN '风控组'
  WHEN "status" IN ('SUSPENDED', 'DISABLED') THEN '受限组'
  ELSE '普通用户组'
END;

CREATE INDEX "User_displayGroup_idx" ON "User"("displayGroup");
