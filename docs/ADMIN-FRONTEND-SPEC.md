# 管理员后台前端重构规格文档

本文档面向重新开发管理员后台前端的产品、UI 和前端工程师。内容按当前后端源码整理，覆盖后台所有设置功能、业务功能、接口、关键字段、页面建议和交互注意事项。

源码依据：

- 后台接口：`apps/api/src/routes/admin.ts`
- 鉴权接口：`apps/api/src/routes/auth.ts`
- 数据模型：`packages/db/prisma/schema.prisma`
- 当前后台前端：`apps/web/app/admin/*`、`apps/web/app/dashboard-client.tsx`

## 1. 基础约定

### 1.1 服务地址

- 默认 API：`http://127.0.0.1:4100`
- Web 默认：`http://127.0.0.1:4101`
- 前端实际 API 地址读取 `NEXT_PUBLIC_API_BASE_URL`。

### 1.2 鉴权

管理员登录：

```http
POST /auth/admin-login
Content-Type: application/json
```

请求：

```json
{
  "username": "admin",
  "password": "password"
}
```

成功：

```json
{
  "token": "jwt",
  "user": {
    "id": "user_id",
    "email": "admin@example.com",
    "username": "admin",
    "role": "ADMIN",
    "status": "ACTIVE",
    "allowedModels": [],
    "rateLimitPerMinute": 0,
    "concurrencyLimit": 0,
    "tokenVersion": 1
  }
}
```

后续所有 `/admin/*` 请求：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

校验当前登录用户：

```http
GET /auth/me
```

前端要求：进入后台后必须检查 `user.role === "ADMIN"`，否则提示“请使用管理员账号登录后台”并清理 token。

### 1.3 通用响应和错误

普通错误：

```json
{ "message": "错误说明" }
```

参数校验错误：

```json
{
  "message": "Validation error",
  "issues": [
    { "path": ["field"], "message": "错误说明" }
  ]
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| 400 | 参数错误或业务规则不允许 |
| 401 | 未登录、登录过期、账号不可用 |
| 403 | 非管理员或功能关闭 |
| 404 | 资源不存在 |
| 409 | 冲突，例如重复、状态不允许 |
| 429 | 频率限制 |
| 500 | 服务端错误 |
| 502 | 上游、邮件、Webhook 测试失败 |

### 1.4 通用字段格式

- 时间：ISO 8601 字符串。
- 金额：字符串或 Decimal 可序列化值，前端按字符串处理，通常保留 8 位小数。
- ID：Prisma cuid 字符串。
- 空值：可清空字段通常传 `null` 或空字符串，具体见各接口。

### 1.5 枚举

```ts
type UserRole = "USER" | "ADMIN";
type UserStatus = "ACTIVE" | "DISABLED" | "SUSPENDED" | "TRIAL" | "RISK_REVIEW";
type ApiKeyStatus = "ACTIVE" | "DISABLED" | "REVOKED";
type AccessTierStatus = "ACTIVE" | "DISABLED";
type ApiRequestStatus = "PENDING" | "SUCCESS" | "FAILED";
type ApiRequestResultType =
  | "PROXIED_SUCCESS"
  | "UPSTREAM_ERROR"
  | "GATEWAY_NOTICE"
  | "IP_BAN"
  | "RATE_LIMITED"
  | "INSUFFICIENT_BALANCE"
  | "MANUAL_TERMINATED"
  | "AUTO_TERMINATED"
  | "BILLING_ERROR"
  | "CLIENT_CLOSED"
  | "GATEWAY_ERROR";
type UpstreamProviderStatus = "ACTIVE" | "DISABLED";
type ChannelStatus = "ACTIVE" | "FORCED_ACTIVE" | "DISABLED" | "UNAVAILABLE" | "PENALIZED";
type CompactItemType = "compaction" | "compaction_summary";
type RedisFailurePolicy = "fail-open" | "fail-closed" | "degraded";
```

## 2. 建议后台信息架构

建议新版后台按以下模块设计：

1. 运营总览：KPI、初始化向导、服务器状态、风险摘要。
2. 用户与钱包：用户列表、创建用户、余额调整、用户 API Key、公益用户字段。
3. 兑换码：批量生成、状态管理、核销记录、导出。
4. 上游管理：Provider、Provider Key、密钥限额、超时、compact 类型。
5. 模型价格：模型价格 CRUD、导入导出、统一客户价。
6. 模型池：按访问等级配置模型池和渠道、健康检查、批量复制/添加渠道。
7. 调度与访问等级：调度参数、访问等级、IP 等级规则、路由模拟。
8. 调用记录：全站请求列表、筛选、详情、人工终止、IP 封禁快捷入口。
9. 风控与公告：IP 封禁、临时 IP notice、自动终止、网关提示、Redis 策略、全局熔断、外部告警。
10. 系统设置：登录/SMTP、公益公告、推理强度转换。
11. 审计日志：后台操作审计、登录日志。

## 3. 运营总览

### 3.1 后台概览

```http
GET /admin/overview
```

响应：

```json
{
  "users": 12,
  "requests": 1024,
  "totalWalletBalance": "100.00000000",
  "revenue": "20.00000000",
  "upstreamCost": "8.00000000",
  "grossProfit": "12.00000000",
  "totalTokens": 123456
}
```

用途：KPI 卡片展示用户数、请求数、总余额、收入、成本、毛利、总 token。

### 3.2 初始化向导

```http
GET /admin/setup-wizard
```

响应：

```json
{
  "wizard": {
    "completed": 6,
    "total": 10,
    "percent": 60,
    "steps": [
      {
        "id": "provider",
        "label": "配置上游 Provider",
        "completed": true,
        "detail": "1 个 ACTIVE 上游"
      }
    ]
  }
}
```

步骤 ID：`provider`、`provider-key`、`model-price`、`standard-tier`、`standard-pool`、`pool-channel`、`user`、`wallet`、`api-key`、`test-call`。

### 3.3 服务器状态

```http
GET /admin/server-status
```

响应包含：

- `server.nodeVersion`
- `server.uptimeSeconds`
- `server.memory`
- `server.system`
- `server.cpu`
- `server.database`
- `server.redis`
- `server.pm2`
- `apiKeys`
- `modelPool`
- `alerts`
- `checkedAt`

前端建议：5 秒轮询。重点展示 Redis、数据库、PM2、模型池可用渠道、当前并发、当前分钟请求、告警列表。

### 3.4 风险中心汇总

```http
GET /admin/risk-center
```

响应聚合多个设置和计数：

```json
{
  "ipBanRules": [],
  "temporaryIpNoticeBans": [],
  "temporaryIpNoticeBanSettings": {},
  "pendingAutoTerminateSettings": {},
  "gatewayNoticeSettings": {},
  "redisFailurePolicySettings": {},
  "globalCircuitBreakerSettings": {},
  "externalAlertSettings": {},
  "charityAnnouncementSettings": {},
  "reasoningEffortTransformSettings": {},
  "counters": {
    "pendingRequests": 0,
    "failedRequests24h": 0,
    "noticeRequests24h": 0,
    "rateLimitedRequests24h": 0
  },
  "checkedAt": "2026-05-28T00:00:00.000Z"
}
```

用途：风控页首屏总览，也可作为多个设置卡片的初始数据。

## 4. 用户与钱包

### 4.1 用户列表

```http
GET /admin/users
```

返回最近创建的 100 个用户，每个用户包含钱包、最近 5 条钱包流水、API Key、统计计数。

关键字段：

```ts
type AdminUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  statusReason?: string | null;
  allowedModels: string[];
  rateLimitPerMinute: number;
  concurrencyLimit: number;
  tierId?: string | null;
  tier?: { id: string; code: string; name: string } | null;
  charityEnabled: boolean;
  charityDisplayName?: string | null;
  charityKey?: string | null;
  charityIpRateLimitEnabled: boolean;
  charityIpRateLimitPerMinute: number;
  tokenVersion: number;
  wallet?: Wallet | null;
  walletTransactions: WalletTransaction[];
  apiKeys: AdminApiKey[];
  _count: { apiKeys: number; apiRequests: number };
  createdAt: string;
};
```

### 4.2 创建用户

```http
POST /admin/users
```

请求：

```json
{
  "email": "user@example.com",
  "role": "USER",
  "status": "ACTIVE",
  "statusReason": null,
  "allowedModels": [],
  "rateLimitPerMinute": 0,
  "concurrencyLimit": 0,
  "tierId": "tier_standard",
  "charityEnabled": false,
  "charityDisplayName": null,
  "charityKey": null,
  "charityIpRateLimitEnabled": false,
  "charityIpRateLimitPerMinute": 0,
  "initialBalance": "0"
}
```

说明：

- `role` 默认 `USER`。
- `status` 默认 `ACTIVE`。
- `rateLimitPerMinute`、`concurrencyLimit` 为 0 表示不限制。
- 不传 `tierId` 时默认 standard 等级。
- `initialBalance` 可选，创建钱包并写入初始充值流水。

### 4.3 编辑用户

```http
PATCH /admin/users/:id
```

字段均可选：

```json
{
  "email": "new@example.com",
  "role": "USER",
  "status": "ACTIVE",
  "statusReason": "原因",
  "allowedModels": ["gpt-4.1-mini"],
  "rateLimitPerMinute": 60,
  "concurrencyLimit": 5,
  "tierId": "tier_id",
  "charityEnabled": true,
  "charityDisplayName": "公益账号",
  "charityKey": "public-key",
  "charityIpRateLimitEnabled": true,
  "charityIpRateLimitPerMinute": 10
}
```

### 4.4 强制用户退出

```http
POST /admin/users/:id/logout
```

效果：递增用户 `tokenVersion`，旧 JWT 失效。

限制：不能退出当前管理员自己的会话。

### 4.5 删除用户

```http
DELETE /admin/users/:id
```

限制：不能删除当前管理员自己。删除用户会级联删除其钱包、API Key、请求等关联数据。

### 4.6 余额调整

```http
POST /admin/users/:id/balance
```

请求：

```json
{
  "amount": "10.00000000",
  "remark": "人工充值"
}
```

说明：

- 正数为充值，负数为扣减。
- 调整后余额不能小于 0。
- 会写入 `WalletTransaction`，类型 `ADJUST`，source `ADMIN_ADJUST`。

## 5. 用户 API Key

### 5.1 查询用户 API Key

```http
GET /admin/users/:id/api-keys
```

### 5.2 创建用户 API Key

```http
POST /admin/users/:id/api-keys
```

请求：

```json
{
  "name": "生产 Key",
  "tierId": "tier_id",
  "rateLimitPerMinute": 60,
  "totalLimitUsd": "100",
  "dailyLimitUsd": null,
  "expiresAt": null,
  "concurrencyLimit": 5,
  "allowedModels": [],
  "noticeEnabled": false,
  "noticeText": null,
  "tags": ["prod"],
  "ipWhitelist": ["1.2.3.4", "10.0.0.0/24"]
}
```

响应：

```json
{
  "apiKey": {},
  "secret": "sk_live_xxx"
}
```

注意：当前后端也会把明文 key 保存到 `keySecret` 并在管理接口返回。新版前端应按产品决策展示；如果要安全化，建议只在创建结果里展示 `secret`。

### 5.3 编辑 API Key

```http
PATCH /admin/api-keys/:id
```

字段同创建，另支持：

```json
{
  "status": "ACTIVE",
  "disabledReason": "原因"
}
```

规则：

- 启用已过期 Key 会返回 400。
- 启用已超过总额度 Key 会返回 400。
- `noticeEnabled=true` 时必须有 `noticeText`。

### 5.4 批量编辑某用户 API Key

```http
PATCH /admin/users/:id/api-keys/batch
```

请求：

```json
{
  "keyIds": ["key_id"],
  "tierId": "tier_id",
  "status": "DISABLED",
  "noticeEnabled": true,
  "noticeText": "维护中",
  "tags": ["batch"],
  "disabledReason": "批量停用"
}
```

### 5.5 删除 API Key

```http
DELETE /admin/api-keys/:id
```

## 6. 访问等级与路由模拟

### 6.1 访问等级

```http
GET /admin/access-tiers
POST /admin/access-tiers
PATCH /admin/access-tiers/:id
DELETE /admin/access-tiers/:id
```

创建：

```json
{
  "code": "standard",
  "name": "标准用户",
  "status": "ACTIVE",
  "sortOrder": 100,
  "description": "默认等级"
}
```

字段约束：

- `code`：1-60 位，字母、数字、下划线、短横线；保存为小写。
- `name`：1-80 位。
- `status`：`ACTIVE` / `DISABLED`。
- `sortOrder`：1-10000。
- `description`：最多 500，可空。

规则：

- 系统会自动确保 standard 等级存在。
- standard 不能删除，不能禁用，不能修改 code。

### 6.2 IP 访问等级规则

```http
GET /admin/ip-access-tiers
POST /admin/ip-access-tiers
PATCH /admin/ip-access-tiers/:id
DELETE /admin/ip-access-tiers/:id
```

请求：

```json
{
  "cidrOrIp": "1.2.3.4/24",
  "tierId": "tier_id",
  "status": "ACTIVE",
  "priority": 100,
  "remark": "办公网段"
}
```

说明：

- `cidrOrIp` 仅支持 IPv4 或 IPv4 CIDR。
- `cidrOrIp` 唯一。
- `priority` 越小越优先。
- 路由优先级：IP 等级规则 > API Key 等级 > 用户等级 > standard。

### 6.3 路由模拟

```http
POST /admin/route-simulator
```

请求：

```json
{
  "userId": "user_id",
  "apiKeyId": "api_key_id",
  "clientIp": "1.2.3.4",
  "model": "gpt-4.1-mini"
}
```

用途：展示某用户、某 Key、某 IP、某模型最终会落到哪个访问等级、模型池、渠道、上游 Key，以及不可用原因。

## 7. 调度设置

### 7.1 模型调度参数

```http
GET /admin/dispatch-settings
PATCH /admin/dispatch-settings
```

响应：

```json
{
  "settings": {
    "stickyEnabled": true,
    "stickyTtlSeconds": 600,
    "stickySlowUnbindEnabled": true,
    "slowFirstTokenMs": 15000,
    "slowTotalLatencyMs": 45000,
    "slowUnbindThreshold": 3,
    "penaltyEnabled": true,
    "penaltyFailureThreshold": 2,
    "penaltySeconds": 60,
    "healthCheckIntervalSeconds": 30,
    "speedRankPenalty": 300,
    "stickyHitPenalty": 500,
    "forceAvailableButtonEnabled": true
  },
  "defaults": {}
}
```

字段范围：

| 字段 | 范围 | 说明 |
| --- | --- | --- |
| `stickyEnabled` | boolean | 是否启用粘性路由 |
| `stickyTtlSeconds` | 60-86400 | 粘性有效期 |
| `stickySlowUnbindEnabled` | boolean | 慢请求是否解除粘性 |
| `slowFirstTokenMs` | 1000-300000 | 首 token 慢阈值 |
| `slowTotalLatencyMs` | 1000-600000 | 总延迟慢阈值 |
| `slowUnbindThreshold` | 1-100 | 连续慢多少次解绑 |
| `penaltyEnabled` | boolean | 是否启用失败惩罚 |
| `penaltyFailureThreshold` | 1-100 | 连续失败多少次惩罚 |
| `penaltySeconds` | 1-86400 | 惩罚时长 |
| `healthCheckIntervalSeconds` | 5-3600 | 健康检查间隔 |
| `speedRankPenalty` | 0-60000 | 速度排名惩罚分 |
| `stickyHitPenalty` | 0-60000 | 粘性占用惩罚分 |
| `forceAvailableButtonEnabled` | boolean | 是否允许强制可用操作 |

## 8. 上游管理

### 8.1 查询上游 Provider

```http
GET /admin/upstream-providers
```

返回 Provider 及其 keys。`apiKey`、`key` 字段已脱敏。

### 8.2 创建/更新 Provider

```http
POST /admin/upstream-providers
PATCH /admin/upstream-providers/:id
DELETE /admin/upstream-providers/:id
```

创建请求：

```json
{
  "name": "openai",
  "baseUrl": "https://api.openai.com",
  "apiKey": "sk-xxx",
  "priority": 100,
  "timeoutMs": 180000,
  "compactItemType": "compaction_summary",
  "status": "ACTIVE"
}
```

字段：

- `name`：1-80，唯一。
- `baseUrl`：URL，后端会去掉末尾 `/`。
- `apiKey`：Provider 默认 Key。创建必填；更新传空字符串表示不修改。
- `priority`：1-10000。
- `timeoutMs`：5000-600000。
- `compactItemType`：`compaction` / `compaction_summary`。
- `status`：`ACTIVE` / `DISABLED`。

注意：

- 创建或更新 `apiKey` 后会确保默认 Provider Key 存在。
- 重命名 Provider 时，相关 model price 和 model pool channel 会迁移到新名称。
- 删除 Provider 会删除相关模型价格和模型池渠道。

### 8.3 Provider Key

```http
POST /admin/upstream-providers/:id/keys
PATCH /admin/upstream-provider-keys/:id
DELETE /admin/upstream-provider-keys/:id
```

创建：

```json
{
  "name": "key-1",
  "key": "sk-xxx",
  "status": "ACTIVE",
  "priority": 100,
  "dailyLimitUsd": "100",
  "monthlyLimitUsd": "1000",
  "providerRateLimit": 60
}
```

更新字段均可选，另支持：

```json
{
  "disabledReason": "余额不足",
  "lastErrorCategory": "quota"
}
```

说明：

- `dailyLimitUsd`、`monthlyLimitUsd` 可为 `null`。
- `providerRateLimit` 可为 `null` 或 0，最大 1000000。
- Key 名称在同一 Provider 下唯一。
- 若设置了 `UPSTREAM_KEY_ENCRYPTION_SECRET`，后端会写入加密字段，但当前仍保留明文字段。

## 9. 模型价格

### 9.1 查询

```http
GET /admin/model-prices
```

响应：

```json
{
  "modelPrices": [],
  "unifiedPriceSettings": []
}
```

### 9.2 创建/更新/删除

```http
POST /admin/model-prices
PUT /admin/model-prices/:id
DELETE /admin/model-prices/:id
```

创建请求：

```json
{
  "model": "gpt-4.1-mini",
  "upstreamProvider": "openai",
  "currency": "USD",
  "upstreamInputPer1MTok": "1",
  "upstreamCachedInputPer1MTok": "0",
  "upstreamOutputPer1MTok": "4",
  "upstreamPriceMultiplier": "1",
  "customerInputPer1MTok": "2",
  "customerCachedInputPer1MTok": "0",
  "customerOutputPer1MTok": "8",
  "customerPriceMultiplier": "1",
  "minimumChargeUsd": "0",
  "enabled": true,
  "priceVersion": "v1",
  "effectiveFrom": null,
  "effectiveTo": null
}
```

说明：

- 唯一键：`upstreamProvider + model`。
- 删除价格会删除该模型池中对应上游 Provider 的渠道。
- `effectiveFrom` 必须早于 `effectiveTo`。

### 9.3 导入导出

```http
GET /admin/model-prices/export?format=json
GET /admin/model-prices/export?format=csv
POST /admin/model-prices/import
```

导入请求：

```json
{
  "format": "csv",
  "dryRun": true,
  "content": "model,upstreamProvider,...",
  "rows": []
}
```

说明：

- `rows` 和 `content` 二选一。
- `dryRun=true` 返回创建/更新预览，不落库。
- 最多 1000 行，`content` 最大 2MB。

### 9.4 统一客户价

```http
PUT /admin/model-prices/unified
```

请求：

```json
{
  "updates": [
    {
      "model": "gpt-4.1-mini",
      "enabled": true,
      "customerInputPer1MTok": "2",
      "customerCachedInputPer1MTok": "0",
      "customerOutputPer1MTok": "8",
      "customerPriceMultiplier": "1"
    }
  ]
}
```

用途：按模型统一覆盖客户侧价格，用于同一模型多个上游 Provider 时保持客户价格一致。

## 10. 模型池

### 10.1 查询模型池

```http
GET /admin/model-pools
```

返回：

- `modelPools`：池列表，含 tier、channels、readyChannelCount、pricedChannelCount。
- `availableChannels`：可添加渠道来源，来自已定价模型和 Provider。
- `accessTiers`：访问等级列表。
- `healthCheck`：健康检查配置和范围。
- `dispatchSettings`：调度参数。

### 10.2 健康检查设置

```http
PATCH /admin/model-pools/health-check
```

请求字段均可选：

```json
{
  "intervalSeconds": 30,
  "penaltySeconds": 60,
  "successGraceSeconds": 60
}
```

响应返回 `healthCheck`，包含最小/最大范围。

### 10.3 批量复制 standard 模型池

```http
POST /admin/model-pools/copy-standard
```

请求：

```json
{
  "targetTierId": "tier_id",
  "overwriteExisting": false
}
```

用途：把 standard 等级下的模型池和渠道复制到另一个访问等级。

### 10.4 批量按 Provider 更新渠道状态

```http
PATCH /admin/model-pool-channels/by-provider
```

请求：

```json
{
  "upstreamProvider": "openai",
  "status": "DISABLED"
}
```

### 10.5 按 Provider 批量添加渠道

```http
POST /admin/model-pools/add-provider
```

请求：

```json
{
  "upstreamProvider": "openai",
  "tierId": "tier_id",
  "channelStatus": "ACTIVE",
  "onlyEnabledPrices": true
}
```

用途：根据该 Provider 的模型价格，批量创建模型池/渠道。

### 10.6 模型池 CRUD

```http
POST /admin/model-pools
PATCH /admin/model-pools/:id
DELETE /admin/model-pools/:id
```

创建：

```json
{
  "model": "gpt-4.1-mini",
  "tierId": "tier_id",
  "status": "ACTIVE",
  "autoHealthCheckEnabled": true,
  "healthCheckEndpoint": "responses"
}
```

说明：

- 创建模型池前，该模型必须至少有一个上游价格。
- `healthCheckEndpoint` 选项来自后端 `modelPoolHealthCheckEndpoints`，当前前端可按 `responses`、`chat_completions` 等后端返回/约定处理。

### 10.7 模型池渠道

```http
POST /admin/model-pools/:id/channels
PATCH /admin/model-pool-channels/:id
DELETE /admin/model-pool-channels/:id
POST /admin/model-pool-channels/:id/check
```

新增渠道：

```json
{
  "upstreamProvider": "openai",
  "status": "ACTIVE"
}
```

编辑渠道：

```json
{
  "status": "FORCED_ACTIVE",
  "priority": 100
}
```

说明：

- 只能添加已存在 Provider。
- 只能添加该模型已有价格的 Provider。
- `default` Provider 不能加入模型池。
- 手动检测接口返回 `result`。

## 11. 调用记录

### 11.1 请求列表

```http
GET /admin/requests
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| `q` | traceCode、model、endpoint、clientIp、用户邮箱模糊搜索 |
| `userId` | 用户 ID |
| `model` | 模型模糊搜索 |
| `status` | `PENDING` / `SUCCESS` / `FAILED` |
| `dateFrom` / `dateTo` | ISO 时间 |
| `clientIp` | IP 模糊搜索 |
| `apiKey` | API Key 名称或 prefix |
| `upstreamProvider` | 上游名称 |
| `upstreamKey` | 上游 Key 名称或 prefix |
| `endpoint` | endpoint 模糊搜索 |
| `httpStatus` | 100-599 |
| `resultType` | 见枚举，另支持 `notice`、`ip_ban`、`error` |
| `minTokens` / `maxTokens` | token 范围 |
| `minChargedUsd` / `maxChargedUsd` | 客户扣费范围 |
| `minUpstreamCostUsd` / `maxUpstreamCostUsd` | 上游成本范围 |
| `minGrossProfitUsd` / `maxGrossProfitUsd` | 毛利范围 |
| `minLatencyMs` / `maxLatencyMs` | 总延迟范围 |
| `minFirstTokenLatencyMs` / `maxFirstTokenLatencyMs` | 首 token 延迟范围 |
| `cursor` | 翻页游标 |
| `take` | 1-300，默认 120 |

响应：

```json
{
  "requests": [],
  "hasMore": false,
  "nextCursor": null,
  "summary": {
    "totalCount": 0,
    "successCount": 0,
    "failedCount": 0,
    "pendingCount": 0,
    "failureRate": 0,
    "chargedAmountUsd": "0.00000000",
    "upstreamCostUsd": "0.00000000",
    "grossProfitUsd": "0.00000000"
  },
  "ipBanRules": []
}
```

### 11.2 请求详情

```http
GET /admin/requests/:id
```

比列表多返回 `requestBody`、`responseUsage`、`upstreamRequestId`、`userAgent`、`updatedAt`。

安全注意：`requestBody` 已做部分脱敏和截断，但仍可能包含用户输入内容。新前端应将详情查看做权限提示。

### 11.3 人工终止 PENDING 请求

```http
POST /admin/requests/:id/terminate
```

限制：

- 只能终止 `PENDING`。
- compact 保护请求不能手动终止。

响应：

```json
{
  "request": {},
  "abortedActiveRequest": true
}
```

## 12. 风控与公告

### 12.1 永久 IP 封禁规则

```http
GET /admin/ip-ban-rules
POST /admin/ip-ban-rules
PUT /admin/ip-ban-rules/:ip
DELETE /admin/ip-ban-rules/:ip
```

请求：

```json
{
  "ip": "1.2.3.4",
  "mode": "notice",
  "message": "访问过于频繁，请稍后再试。",
  "reason": "风控"
}
```

`mode`：

- `error`：直接错误拒绝。
- `notice`：对支持 notice 的接口返回公告内容。

### 12.2 临时 IP notice 封禁

```http
GET /admin/temporary-ip-notice-bans
PUT /admin/temporary-ip-notice-bans/settings
DELETE /admin/temporary-ip-notice-bans/:ip
```

设置请求：

```json
{
  "enabled": true,
  "threshold": 3,
  "windowSeconds": 300,
  "banSeconds": 600,
  "message": "请求异常，请稍后重试。"
}
```

范围会在 GET 或 `/admin/risk-center` 中返回：

- `minBanSeconds` / `maxBanSeconds`
- `minThreshold` / `maxThreshold`
- `minWindowSeconds` / `maxWindowSeconds`

### 12.3 PENDING 自动终止

```http
GET /admin/pending-auto-terminate-settings
PUT /admin/pending-auto-terminate-settings
```

请求：

```json
{
  "enabled": true,
  "timeoutSeconds": 300,
  "message": "请求超时，已自动终止。"
}
```

### 12.4 网关提示文案

```http
GET /admin/gateway-notice-settings
PUT /admin/gateway-notice-settings
```

字段：

```json
{
  "userConcurrencyMessage": "用户并发达到上限 {{limit}}",
  "keyConcurrencyMessage": "Key 并发达到上限 {{limit}}",
  "userRateLimitMessage": "用户每分钟请求达到上限 {{limit}}，请 {{seconds}} 秒后重试",
  "keyRateLimitMessage": "Key 每分钟请求达到上限 {{limit}}，请 {{seconds}} 秒后重试",
  "charityIpRateLimitMessage": "公益接口当前 IP 访问过快",
  "modelUnavailableMessage": "模型暂不可用",
  "missingUsageMessage": "上游未返回用量，网关未扣费",
  "staleResponsesContextMessage": "上下文已失效，请重新发起会话",
  "invalidEncryptedContentMessage": "加密上下文无效，请重试"
}
```

GET 返回 `defaults`，前端可提供恢复默认值。

### 12.5 Redis 失败策略

```http
GET /admin/redis-failure-policy-settings
PUT /admin/redis-failure-policy-settings
```

请求：

```json
{
  "policy": "fail-open",
  "degradedAdminBypassEnabled": true,
  "degradedUserIds": [],
  "message": "网关风控组件暂不可用，请稍后重试。"
}
```

策略：

- `fail-open`：Redis 异常时放行请求。
- `fail-closed`：Redis 异常时拒绝请求。
- `degraded`：只放行指定用户或管理员。

高风险：切换为 `fail-closed` 或 `degraded` 需要二次确认。

### 12.6 全局熔断

```http
GET /admin/global-circuit-breaker-settings
PUT /admin/global-circuit-breaker-settings
```

请求：

```json
{
  "enabled": false,
  "allowAdmins": true,
  "allowedUserIds": [],
  "message": "系统维护中，请稍后重试。"
}
```

说明：启用后会阻断普通 API 调用，可配置管理员或白名单用户绕过。高风险，必须二次确认。

### 12.7 外部告警

```http
GET /admin/external-alert-settings
PUT /admin/external-alert-settings
POST /admin/external-alert-settings/test
```

请求：

```json
{
  "enabled": true,
  "webhookUrl": "https://example.com/webhook",
  "minSeverity": "warning",
  "intervalSeconds": 300,
  "mentionText": "@all"
}
```

GET 返回：

- `defaults`
- `severityOptions`
- `minIntervalSeconds`
- `maxIntervalSeconds`

测试接口会先保存合并后的设置，再发送测试消息。

## 13. 登录、SMTP、公益、推理转换

### 13.1 登录与 SMTP 设置

```http
GET /admin/auth-settings
PUT /admin/auth-settings
POST /admin/auth-settings/test-email
GET /auth/settings
```

保存请求：

```json
{
  "emailCodeLoginEnabled": true,
  "emailCodeAutoRegisterEnabled": true,
  "newUserBonusUsd": "0",
  "emailCodeTtlSeconds": 600,
  "emailCodeCooldownSeconds": 60,
  "smtpHost": "smtp.example.com",
  "smtpPort": 465,
  "smtpSecure": true,
  "smtpUser": "noreply@example.com",
  "smtpPassword": "password",
  "smtpFrom": "APIshare <noreply@example.com>"
}
```

字段范围：

- `newUserBonusUsd` 非负。
- `emailCodeTtlSeconds`：60-3600。
- `emailCodeCooldownSeconds`：10-600。
- `smtpPort`：1-65535。
- `smtpPassword` 留空表示不覆盖旧密码。

测试邮件请求同保存字段，额外：

```json
{ "testEmail": "target@example.com" }
```

### 13.2 公益公告与公益服务

```http
GET /admin/charity-announcement-settings
PUT /admin/charity-announcement-settings
```

请求：

```json
{
  "serviceEnabled": true,
  "serviceDisabledMessage": "公益服务维护中",
  "enabled": true,
  "frequency": "interval",
  "intervalHours": 24,
  "title": "公告标题",
  "content": "公告内容"
}
```

说明：

- `serviceEnabled=false` 会影响公益用户 API 调用。
- `frequency`：`every_visit` / `interval`。
- `intervalHours` 范围由响应中的 `minIntervalHours`、`maxIntervalHours` 给出。

### 13.3 推理强度转换

```http
GET /admin/reasoning-effort-transform-settings
PUT /admin/reasoning-effort-transform-settings
```

请求：

```json
{
  "rules": [
    { "enabled": true, "from": "high", "to": "medium" }
  ]
}
```

GET 返回 `options`。保存时后端会检测冲突；冲突返回 409：

```json
{
  "message": "推理强度转换存在冲突",
  "conflicts": [],
  "selfTransforms": []
}
```

## 14. 兑换码

### 14.1 查询与导出

```http
GET /admin/redeem-codes
GET /admin/redeem-codes/export
```

查询返回最近 200 个兑换码，含最近 5 条核销记录和有效用户等级。

导出返回 CSV。

### 14.2 批量生成

```http
POST /admin/redeem-codes
```

请求：

```json
{
  "amount": "10",
  "count": 10,
  "maxRedemptions": 1,
  "expiresAt": null,
  "remark": "活动",
  "campaignName": "new-user",
  "validUserTierId": null,
  "perUserLimit": 1
}
```

约束：

- `amount` 必须大于 0。
- `count`：1-100。
- `maxRedemptions`：1-1000。
- `perUserLimit`：1-1000，不能大于 `maxRedemptions`。
- `validUserTierId` 可限制只有某访问等级用户可兑换。

响应的每个 code 会额外包含明文 `code`，只在生成响应中出现。

### 14.3 编辑兑换码

```http
PATCH /admin/redeem-codes/:id
```

请求：

```json
{
  "status": "ACTIVE",
  "expiresAt": null,
  "remark": "备注",
  "campaignName": "活动名",
  "validUserTierId": null,
  "perUserLimit": 1
}
```

## 15. 报表

### 15.1 30 天经营报表

```http
GET /admin/reports/summary
GET /admin/reports/summary/export
```

响应：

```json
{
  "dateFrom": "2026-04-28T00:00:00.000Z",
  "dateTo": "2026-05-28T00:00:00.000Z",
  "summary": {
    "totalCount": 0,
    "successCount": 0,
    "failedCount": 0,
    "pendingCount": 0,
    "failureRate": 0,
    "inputTokens": 0,
    "cachedInputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "chargedAmountUsd": "0.00000000",
    "upstreamCostUsd": "0.00000000",
    "grossProfitUsd": "0.00000000",
    "avgLatencyMs": null,
    "avgFirstTokenLatencyMs": null
  },
  "dimensions": {
    "users": [],
    "models": [],
    "upstreams": [],
    "tiers": []
  }
}
```

维度行字段：

```ts
{
  id: string | null;
  label: string;
  requestCount: number;
  totalTokens: number;
  chargedAmountUsd: string;
  upstreamCostUsd: string;
  grossProfitUsd: string;
}
```

导出返回 CSV。

## 16. 审计与登录日志

### 16.1 后台操作审计

```http
GET /admin/audit-logs
```

查询参数：

- `q`
- `adminUserId`
- `action`
- `outcome`: `success` / `failure` / `unknown`
- `targetType`
- `targetId`
- `dateFrom`
- `dateTo`
- `cursor`
- `take`: 1-200，默认 80

说明：

- 后端记录所有 `/admin/*` 的 `POST`、`PATCH`、`PUT`、`DELETE`。
- 不记录查询接口。
- `requestBody` 会脱敏敏感字段：`password`、`token`、`apiKey`、`key`、`keySecret`、`secret`、`authorization`、`charityKey`。

### 16.2 登录日志

```http
GET /admin/login-logs
```

查询参数：

- `take`: 1-500，默认 100
- `method`
- `success`: `true` / `false`
- `userId`
- `email`
- `ip`

响应：

```json
{
  "logs": [],
  "total": 0
}
```

## 17. 前端实现建议

### 17.0 邀请奖励页面

新增前台页面“邀请奖励”：

- 调用 `GET /me/referral` 展示专属邀请链接、邀请码、累计成功邀请数、奖励记录数和最近邀请记录。
- 公开路由 `/invite/[code]` 使用现有前台邮箱验证码登录界面，登录时向 `/auth/email-code/login` 传入 `referralCode`。
- 已有用户通过邀请页登录不展示奖励到账承诺，只按普通登录处理。

新增后台页面“邀请奖励”：

- 位于“用户与商业”工作区。
- 调用 `GET /admin/referral-settings` / `PUT /admin/referral-settings` 配置开关、邀请链接基础地址、邀请人奖励、被邀请人奖励。
- 双方奖励类型均支持 `NONE`、`BALANCE`、`SUBSCRIPTION`；余额需要金额，订阅需要选择有效套餐。
- 调用 `GET /admin/referrals` 展示最近 200 条邀请注册记录，包括双方邮箱、邀请码、双方奖励、状态和创建时间。

### 17.1 请求封装

建议统一封装：

- 自动拼接 API base URL。
- 自动带 `Authorization`。
- 解析 `message` 和 `issues`。
- 401 时清理 token 并跳转登录。
- 导出接口单独处理 blob。

### 17.2 数据刷新

- 服务器状态：5 秒轮询。
- 请求列表：用户手动刷新或筛选变化刷新，不建议默认高频轮询。
- 模型池健康：手动刷新和检测后刷新。
- 设置保存后：使用接口返回值覆盖本地表单。

### 17.3 高风险操作二次确认

必须确认：

- 删除用户。
- 删除上游 Provider。
- 删除模型价格。
- 删除模型池。
- 全局熔断开启。
- Redis 策略切到 `fail-closed`。
- 批量停用渠道或 API Key。
- 余额扣减。
- 人工终止请求。

### 17.4 页面权限和安全提示

- 请求详情可能包含用户输入内容。
- API Key 明文 `keySecret` 当前会返回，展示时应默认隐藏。
- 上游密钥只展示脱敏值，更新时提供“留空不修改”。
- SMTP 密码也应“留空不修改”。

### 17.5 当前后端限制

- `/admin/users` 固定返回最近 100 个用户，暂无分页和搜索。
- `/admin/redeem-codes` 固定返回最近 200 个兑换码。
- 管理后台只有 ADMIN 角色，没有细粒度权限。
- CORS 当前后端源码中存在硬编码白名单，虽然 `.env` 有 `CORS_ORIGINS`，前端部署时需要确认后端是否已修正。
- 没有 OpenAPI schema，前端应按本文档和源码类型对接。
