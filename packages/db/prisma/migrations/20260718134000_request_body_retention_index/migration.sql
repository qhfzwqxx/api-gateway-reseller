CREATE INDEX CONCURRENTLY IF NOT EXISTS "ApiRequest_requestBody_createdAt_id_idx"
ON "ApiRequest"("createdAt" ASC, "id" ASC)
WHERE "requestBody" IS NOT NULL;
