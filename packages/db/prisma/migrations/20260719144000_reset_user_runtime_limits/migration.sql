UPDATE "User"
SET
  "rateLimitPerMinute" = 0,
  "concurrencyLimit" = 0,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "rateLimitPerMinute" <> 0
   OR "concurrencyLimit" <> 0;
