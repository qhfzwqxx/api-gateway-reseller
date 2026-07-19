WITH targets AS MATERIALIZED (
  SELECT
    w.id AS wallet_id,
    w."userId",
    u."displayGroup",
    w.balance AS balance_before
  FROM "Wallet" w
  JOIN "User" u ON u.id = w."userId"
  WHERE u."displayGroup" IN ('普通用户组', 'q群管理员')
    AND w.balance <> 0
),
updated_wallets AS (
  UPDATE "Wallet" w
  SET
    balance = 0,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM targets t
  WHERE w.id = t.wallet_id
  RETURNING w.id
)
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
      t."userId"
        || t."displayGroup"
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
  -t.balance_before,
  t.balance_before,
  0,
  '按用户组清零钱包余额',
  jsonb_build_object(
    'operation', 'GROUP_BALANCE_RESET',
    'displayGroup', t."displayGroup"
  ),
  CURRENT_TIMESTAMP
FROM targets t
JOIN updated_wallets w ON w.id = t.wallet_id;
