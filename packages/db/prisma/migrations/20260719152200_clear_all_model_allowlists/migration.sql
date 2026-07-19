UPDATE "User"
SET
  "allowedModels" = ARRAY[]::TEXT[],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE cardinality("allowedModels") > 0;

UPDATE "ApiKey"
SET
  "allowedModels" = ARRAY[]::TEXT[],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE cardinality("allowedModels") > 0;
