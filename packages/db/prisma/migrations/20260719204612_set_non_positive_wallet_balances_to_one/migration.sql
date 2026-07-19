WITH targets AS MATERIALIZED (
  SELECT
    w.id AS wallet_id,
    w."userId",
    w.balance AS balance_before
  FROM "Wallet" w
  WHERE w.balance <= 0
), updated_wallets AS (
  UPDATE "Wallet" w
  SET
    balance = 1,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM targets t
  WHERE w.id = t.wallet_id
  RETURNING w.id
), inserted_transactions AS (
  INSERT INTO "WalletTransaction" (
    id,
    "userId",
    type,
    source,
    amount,
    "balanceBefore",
    "balanceAfter",
    remark,
    metadata,
    "createdAt"
  )
  SELECT
    'c' || substr(
      md5(
        'BALANCE_FLOOR_TO_ONE'
          || t."userId"
          || t.balance_before::text
          || clock_timestamp()::text
          || random()::text
      ),
      1,
      24
    ),
    t."userId",
    'ADJUST'::"WalletTransactionType",
    'ADMIN_ADJUST',
    1 - t.balance_before,
    t.balance_before,
    1,
    '将非正余额补至 1',
    jsonb_build_object(
      'operation', 'BALANCE_FLOOR_TO_ONE',
      'targetBalance', '1',
      'previousBalance', t.balance_before::text
    ),
    CURRENT_TIMESTAMP
  FROM targets t
  JOIN updated_wallets w ON w.id = t.wallet_id
  RETURNING id
)
SELECT count(*)
FROM inserted_transactions;
