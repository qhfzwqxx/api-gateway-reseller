CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "ApiRequest_traceCode_trgm_idx"
ON "ApiRequest" USING GIN ("traceCode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ApiRequest_model_trgm_idx"
ON "ApiRequest" USING GIN ("model" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ApiRequest_endpoint_trgm_idx"
ON "ApiRequest" USING GIN ("endpoint" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ApiRequest_clientIp_trgm_idx"
ON "ApiRequest" USING GIN ("clientIp" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "User_email_trgm_idx"
ON "User" USING GIN ("email" gin_trgm_ops);
