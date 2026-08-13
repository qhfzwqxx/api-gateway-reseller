ALTER TABLE "ModelPool"
ADD COLUMN "policyRecoveryEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ApiRequest"
ADD COLUMN "policyRecoveryAudit" JSONB;
