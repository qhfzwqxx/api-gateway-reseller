# APIshare 网关后台接口文档

本文档面向后台 UI/UX 设计师、前端工程师和产品协作方，整理当前项目后台可用接口、页面模块、核心字段和交互约束。接口以源码 `apps/api/src/routes/admin.ts`、`apps/api/src/routes/auth.ts` 为准。

## 1. 基础约定

### 1.1 服务地址

- 默认 API 地址：`http://127.0.0.1:4100`
- 前端实际读取：`NEXT_PUBLIC_API_BASE_URL`
- 浏览器端若配置仍指向 `127.0.0.1`，会自动使用当前页面 hostname + `4100` 端口。

### 1.2 请求格式

- 普通接口使用 JSON：
  - `Content-Type: application/json`
  - `Accept: application/json`
- 导出接口返回文件：
  - CSV：`text/csv; charset=utf-8`
  - JSON 导出：`application/json; charset=utf-8`
- 所有后台 `/admin/*` 接口都需要登录且用户角色为 `ADMIN`。

### 1.3 鉴权

后台登录：

```http
POST /auth/admin-login
Content-Type: application/json

{
  "username": "admin",
  "password": "******"
}
```

成功响应：

```json
{
  "token": "jwt-token",
  "user": {
    "id": "user_id",
    "email": "admin@example.com",
    "role": "ADMIN",
    "allowedModels": [],
    "rateLimitPerMinute": 0,
    "concurrencyLimit": 0
  }
}
```

后续请求：

```http
Authorization: Bearer <token>
```

当前登录用户：

```http
GET /auth/me
```

响应：

```json
{
  "user": {
    "id": "user_id",
    "email": "admin@example.com",
    "role": "ADMIN",
    "status": "ACTIVE",
    "allowedModels": [],
    "rateLimitPerMinute": 0,
    "concurrencyLimit": 0,
    "tokenVersion": 1,
    "tierId": "tier_standard",
    "tier": {
      "id": "tier_standard",
      "code": "standard",
      "name": "Free"
    },
    "wallet": null
  }
}
```

### 1.4 错误响应

通用错误：

```json
{
  "message": "Human readable error"
}
```

参数校验错误：

```json
{
  "message": "Validation error",
  "issues": [
    {
      "path": ["field"],
      "message": "Required"
    }
  ]
}
```

常见 HTTP 状态：

| 状态码 | 含义 |
| --- | --- |
| `400` | 参数错误、业务规则不允许 |
| `401` | 未登录或登录失败 |
| `403` | 权限不足或功能关闭 |
| `404` | 资源不存在 |
| `409` | 冲突，例如编码重复、规则冲突 |
| `410` | 已废弃接口 |
| `429` | 登录/验证码等频率限制 |
| `500` | 服务端错误 |
| `502` | 上游或邮件/告警发送失败 |
| `503` | 依赖未配置或不可用 |

### 1.5 字段格式

- 时间：ISO 8601 字符串，例如 `2026-05-28T08:00:00.000Z`。
- 金额：后端常以 Decimal 返回，前端应按字符串或可字符串化数值处理，精度通常为 8 位小数，例如 `"1.25000000"`。
- ID：Prisma cuid 字符串。
- 可清空字段：多数备注、时间、限额字段支持 `null` 或空字符串，最终保存为 `null` 或 `0`，具体以接口说明为准。

### 1.6 主要枚举

```ts
type UserRole = "USER" | "ADMIN";
type UserStatus = "ACTIVE" | "DISABLED" | "SUSPENDED" | "TRIAL" | "RISK_REVIEW";
type ApiKeyStatus = "ACTIVE" | "DISABLED" | "REVOKED";
type AccessTierStatus = "ACTIVE" | "DISABLED";
type DedicatedRouteTargetType = "USER" | "API_KEY" | "IP";
type DedicatedRouteRuleStatus = "ACTIVE" | "DISABLED";
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
type ModelPoolStatus = "ACTIVE" | "DISABLED";
type ChannelStatus = "ACTIVE" | "FORCED_ACTIVE" | "DISABLED" | "UNAVAILABLE" | "PENALIZED";
type CompactItemType = "compaction" | "compaction_summary";
```

## 2. 建议后台信息架构

后台 UI 可按以下一级导航设计：

1. 总览：系统 KPI、初始化向导、运行状态、风险摘要。
2. 用户与钱包：用户列表、余额调整、公益账号、用户 API Key。
3. 请求日志：请求列表、筛选、详情、终止 PENDING 请求、IP 封禁快捷操作。
4. 上游管理：Provider、上游 Key、Key 限额、上游状态。
5. 模型价格：模型价格表、统一客户价、导入导出。
6. 模型池与调度：模型池、渠道、健康检查、调度参数、路由模拟。
7. 分层与专线：访问等级、IP 等级规则、专线规则。
8. 兑换码：批量生成、禁用、导出、兑换记录。
9. 风控与通知：IP 封禁、临时通知封禁、网关提示、熔断、Redis 降级、外部告警、自动终止。
10. 安全审计：后台审计日志、登录日志、登录/SMTP 配置。

## 3. 总览与运营

### 3.1 后台概览

```http
GET /admin/overview
```

响应字段：

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

UI 建议：顶部 KPI 卡片展示用户数、请求数、钱包余额、收入、上游成本、毛利、Token 总量。

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

### 3.3 服务器运行状态

```http
GET /admin/server-status
```

响应包含：

- `server.nodeVersion`
- `server.uptimeSeconds`
- `server.memory`
- `server.system`
- `server.cpu`
- `server.redis`
- `server.database`
- `server.pm2`
- `modelPool`
- `apiKeys`
- `alerts`
- `checkedAt`

UI 建议：状态页以“健康/警告/严重”分组，不建议做过度装饰；重点展示 Redis、数据库、PM2、模型池、Key 运行告警。

### 3.4 经营报表

```http
GET /admin/reports/summary
GET /admin/reports/summary/export
```

`summary` 固定统计最近 30 天：

```json
{
  "dateFrom": "2026-04-28T00:00:00.000Z",
  "dateTo": "2026-05-28T00:00:00.000Z",
  "summary": {
    "totalCount": 1000,
    "successCount": 900,
    "failedCount": 90,
    "pendingCount": 10,
    "failureRate": 9,
    "inputTokens": 100,
    "cachedInputTokens": 20,
    "outputTokens": 50,
    "totalTokens": 150,
    "chargedAmountUsd": "10.00000000",
    "upstreamCostUsd": "4.00000000",
    "grossProfitUsd": "6.00000000",
    "avgLatencyMs": 1000,
    "avgFirstTokenLatencyMs": 300
  },
  "dimensions": {
    "users": [],
    "models": [],
    "upstreams": [],
    "tiers": [],
    "dedicatedRoutes": []
  }
}
```

维度行通用字段：`id`、`label`、`requestCount`、`totalTokens`、`chargedAmountUsd`、`upstreamCostUsd`、`grossProfitUsd`。

导出接口返回 CSV 文件。

## 4. 访问等级与路由规则

### 4.1 访问等级

```http
GET /admin/access-tiers
POST /admin/access-tiers
PATCH /admin/access-tiers/:id
DELETE /admin/access-tiers/:id
```

创建请求：

```json
{
  "code": "standard",
  "name": "Free",
  "status": "ACTIVE",
  "sortOrder": 100,
  "billingMultiplier": "0",
  "concurrencyLimit": 2,
  "rateLimitPerMinute": 60,
  "userSelectable": true,
  "description": "默认访问等级"
}
```

字段约束：

- `code`：1-60 位，字母/数字/下划线/短横线，保存为小写。
- `name`：1-80 位。
- `status`：`ACTIVE` 或 `DISABLED`。
- `sortOrder`：1-10000。
- `billingMultiplier`：访问等级扣费倍率。
- `concurrencyLimit`：每个用户在该访问等级下的并发上限，跨该用户的多个 API Key 聚合；`0` 表示无限制。
- `rateLimitPerMinute`：每个用户在该访问等级下的 RPM 上限，跨该用户的多个 API Key 聚合；`0` 表示无限制。
- `userSelectable`：是否允许登录用户在前台自行切换到该等级；新建等级默认 `false`。
- `description`：最多 500 位，可空。

响应：

```json
{
  "tiers": [
    {
      "id": "tier_id",
      "code": "standard",
      "name": "Free",
      "status": "ACTIVE",
      "sortOrder": 100,
      "billingMultiplier": "0",
      "concurrencyLimit": 2,
      "rateLimitPerMinute": 60,
      "userSelectable": true,
      "description": null,
      "createdAt": "...",
      "updatedAt": "...",
      "_count": {
        "users": 10,
        "apiKeys": 20,
        "modelPools": 5,
        "dedicatedRouteRules": 1
      }
    }
  ]
}
```

注意：默认等级内部 code 为 `standard`、显示名称为 `Free`。该等级不能删除，不能禁用，不能改 code。

等级限流以每次请求最终解析出的访问等级为准，计数维度为“用户 + 访问等级”。同一用户的多个 Free Key 共享 Free 限额，但 Free 与 Pro 使用相互独立的计数桶。用户级和 API Key 级限制仍会同时生效。

用户前台可选等级：

```http
GET /me/access-tiers
PATCH /me/access-tier
```

`GET /me/access-tiers` 只返回 `ACTIVE` 且 `userSelectable=true` 的等级，并额外返回当前等级。切换请求：

```json
{
  "tierId": "tier_id"
}
```

切换成功后立即更新用户访问等级。未开放前台选择的等级会返回 `403`，因此未开放等级即使被直接调用接口也不能由用户自行选择。若用户存在活动订阅，订阅套餐会锁定当前访问等级，切换接口返回 `409`；用户需要等待订阅结束后再手动选择等级。

### 4.2 IP 访问等级规则

```http
GET /admin/ip-access-tiers
POST /admin/ip-access-tiers
PATCH /admin/ip-access-tiers/:id
DELETE /admin/ip-access-tiers/:id
```

创建/更新字段：

```json
{
  "cidrOrIp": "1.2.3.4/24",
  "tierId": "tier_id",
  "status": "ACTIVE",
  "priority": 100,
  "remark": "办公网段"
}
```

- `cidrOrIp`：IPv4 或 IPv4 CIDR，唯一。
- `priority`：数字越小优先级越高。

### 4.3 专线/专属路由规则

```http
GET /admin/dedicated-route-rules
POST /admin/dedicated-route-rules
PATCH /admin/dedicated-route-rules/:id
DELETE /admin/dedicated-route-rules/:id
POST /admin/route-simulator
```

规则字段：

```json
{
  "name": "VIP 用户专线",
  "targetType": "USER",
  "userId": "user_id",
  "apiKeyId": null,
  "ipPattern": null,
  "accessTierId": "tier_id",
  "upstreamProvider": "openai",
  "upstreamProviderKeyId": "provider_key_id",
  "status": "ACTIVE",
  "priority": 10,
  "startsAt": null,
  "expiresAt": null,
  "remark": "重要客户"
}
```

规则：

- `targetType=USER` 时使用 `userId`。
- `targetType=API_KEY` 时使用 `apiKeyId`。
- `targetType=IP` 时使用 `ipPattern`。
- `accessTierId` 必填。
- `upstreamProvider` 和 `upstreamProviderKeyId` 可用于指定上游或 Key。
- `startsAt`、`expiresAt` 可为空；若填写需为合法时间。

路由模拟：

```http
POST /admin/route-simulator
Content-Type: application/json

{
  "userId": "user_id",
  "apiKeyId": "api_key_id",
  "clientIp": "1.2.3.4",
  "model": "gpt-4.1-mini"
}
```

响应：

```json
{
  "simulation": {
    "route": {},
    "routed": {},
    "notes": []
  }
}
```

UI 建议：专线页应提供冲突提示、有效期提示、优先级排序、模拟入口。

## 5. 调度设置

```http
GET /admin/dispatch-settings
PATCH /admin/dispatch-settings
```

请求字段均可选：

```json
{
  "stickyEnabled": true,
  "stickyTtlSeconds": 3600,
  "stickySlowUnbindEnabled": true,
  "slowFirstTokenMs": 30000,
  "slowTotalLatencyMs": 120000,
  "slowUnbindThreshold": 3,
  "penaltyEnabled": true,
  "penaltyFailureThreshold": 3,
  "penaltySeconds": 300,
  "healthCheckIntervalSeconds": 60,
  "speedRankPenalty": 100,
  "stickyHitPenalty": 50,
  "channelConcurrencyPenalty": 300,
  "keyConcurrencyPenalty": 200,
  "recentFailurePenalty": 250,
  "forceAvailableButtonEnabled": true
}
```

响应：

```json
{
  "settings": {},
  "defaults": {}
}
```

字段范围：

- `stickyTtlSeconds`：60-86400。
- `slowFirstTokenMs`：1000-300000。
- `slowTotalLatencyMs`：1000-600000。
- `slowUnbindThreshold`：1-100。
- `penaltyFailureThreshold`：1-100。
- `penaltySeconds`：1-86400。
- `healthCheckIntervalSeconds`：5-3600。
- `speedRankPenalty`、`stickyHitPenalty`、`channelConcurrencyPenalty`、`keyConcurrencyPenalty`、`recentFailurePenalty`：0-60000。

## 6. 用户、钱包、API Key

### 6.1 用户列表

```http
GET /admin/users
```

返回最近创建的 100 个用户：

```json
{
  "users": [
    {
      "id": "user_id",
      "email": "user@example.com",
      "role": "USER",
      "status": "ACTIVE",
      "statusReason": null,
      "allowedModels": [],
      "rateLimitPerMinute": 0,
      "concurrencyLimit": 0,
      "tierId": "tier_id",
      "tier": { "id": "tier_id", "code": "standard", "name": "标准用户" },
      "charityEnabled": false,
      "charityDisplayName": null,
      "charityKey": null,
      "charityIpRateLimitEnabled": false,
      "charityIpRateLimitPerMinute": 0,
      "tokenVersion": 1,
      "createdAt": "...",
      "wallet": {
        "id": "wallet_id",
        "userId": "user_id",
        "balance": "10.00000000",
        "reservedBalance": "0.00000000",
        "currency": "USD"
      },
      "walletTransactions": [],
      "apiKeys": [],
      "_count": { "apiKeys": 1, "apiRequests": 100 }
    }
  ]
}
```

UI 建议：当前接口无分页和搜索，只返回 100 个。若要做复杂用户管理，建议后续补充分页搜索接口。

### 6.2 创建用户

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
  "allowedModels": ["gpt-4.1-mini"],
  "rateLimitPerMinute": 60,
  "concurrencyLimit": 5,
  "tierId": "tier_id",
  "charityEnabled": false,
  "charityDisplayName": null,
  "charityKey": null,
  "charityIpRateLimitEnabled": false,
  "charityIpRateLimitPerMinute": 0,
  "initialBalance": "10"
}
```

约束：

- `email` 必填且唯一。
- `rateLimitPerMinute`、`concurrencyLimit`：0-10000，0 表示不限制或继承业务默认。
- `initialBalance` 可选；传入时会创建钱包充值流水。

### 6.3 更新用户

```http
PATCH /admin/users/:id
```

可更新字段：

```json
{
  "email": "new@example.com",
  "role": "USER",
  "status": "RISK_REVIEW",
  "statusReason": "异常调用",
  "allowedModels": [],
  "rateLimitPerMinute": 100,
  "concurrencyLimit": 10,
  "tierId": "tier_id",
  "charityEnabled": true,
  "charityDisplayName": "公益账号",
  "charityKey": "public-key",
  "charityIpRateLimitEnabled": true,
  "charityIpRateLimitPerMinute": 20
}
```

### 6.4 删除用户、强制登出

```http
DELETE /admin/users/:id
POST /admin/users/:id/logout
```

注意：

- 管理员不能删除自己的账号。
- 管理员不能强制登出自己的当前后台会话。
- 强制登出通过递增 `tokenVersion` 使旧 token 失效。

### 6.5 调整余额

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

- 正数增加余额。
- 负数扣减余额。
- 调整后余额不能小于 0。

响应：

```json
{
  "wallet": {},
  "transaction": {
    "id": "transaction_id",
    "type": "ADJUST",
    "source": "ADMIN_ADJUST",
    "amount": "10.00000000",
    "balanceBefore": "0.00000000",
    "balanceAfter": "10.00000000",
    "remark": "人工充值"
  }
}
```

### 6.6 用户 API Key

```http
GET /admin/users/:id/api-keys
POST /admin/users/:id/api-keys
PATCH /admin/users/:id/api-keys/batch
PATCH /admin/api-keys/:id
DELETE /admin/api-keys/:id
```

创建 API Key：

```json
{
  "name": "生产 Key",
  "tierId": "tier_id",
  "rateLimitPerMinute": 60,
  "totalLimitUsd": "100",
  "dailyLimitUsd": null,
  "expiresAt": null,
  "concurrencyLimit": 5,
  "allowedModels": ["gpt-4.1-mini"],
  "noticeEnabled": false,
  "noticeText": null,
  "tags": ["prod"],
  "ipWhitelist": ["1.2.3.4", "10.0.0.0/24"]
}
```

创建响应额外返回完整密钥，仅出现一次：

```json
{
  "apiKey": {
    "id": "api_key_id",
    "keyPrefix": "sk-abc",
    "keySecret": "sk-完整密钥",
    "status": "ACTIVE",
    "totalUsedUsd": "0.00000000",
    "totalRemainingUsd": "100.00000000"
  },
  "secret": "sk-完整密钥"
}
```

更新 API Key 可用字段：

```json
{
  "name": "新名称",
  "tierId": "tier_id",
  "status": "ACTIVE",
  "rateLimitPerMinute": 120,
  "totalLimitUsd": "200",
  "dailyLimitUsd": null,
  "expiresAt": "2026-12-31T15:59:59.000Z",
  "concurrencyLimit": 10,
  "allowedModels": [],
  "noticeEnabled": true,
  "noticeText": "维护通知",
  "tags": ["vip"],
  "disabledReason": null,
  "ipWhitelist": []
}
```

批量更新：

```json
{
  "keyIds": ["key1", "key2"],
  "tierId": "tier_id",
  "status": "DISABLED",
  "noticeEnabled": true,
  "noticeText": "暂停服务",
  "tags": ["batch"],
  "disabledReason": "管理员批量停用"
}
```

规则：

- `noticeEnabled=true` 时必须有 `noticeText`。
- 过期 Key 不能重新启用。
- 已超过总额度的 Key 不能重新启用。
- `rateLimitPerMinute` 创建时必须为正整数，更新时也必须为正整数。
- `concurrencyLimit=0` 通常表示不限制。

## 7. 请求日志

### 7.1 请求列表

```http
GET /admin/requests
```

Query 参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `q` | string | 搜索 traceCode、model、endpoint、clientIp、用户 email |
| `userId` | string | 用户 ID |
| `model` | string | 模型名模糊搜索 |
| `status` | enum | `PENDING`、`SUCCESS`、`FAILED` |
| `dateFrom`/`dateTo` | datetime | 创建时间范围 |
| `clientIp` | string | IP 模糊搜索 |
| `apiKey` | string | API Key 名称或前缀 |
| `upstreamProvider` | string | 上游名称 |
| `upstreamKey` | string | 上游 Key 名称或前缀 |
| `endpoint` | string | 端点模糊搜索 |
| `httpStatus` | string | 100-599 |
| `resultType` | enum | 见请求结果枚举，也支持 `notice`、`ip_ban`、`error` 快捷筛选 |
| `minTokens`/`maxTokens` | string | Token 范围 |
| `minChargedUsd`/`maxChargedUsd` | string | 收费范围 |
| `minUpstreamCostUsd`/`maxUpstreamCostUsd` | string | 成本范围 |
| `minGrossProfitUsd`/`maxGrossProfitUsd` | string | 毛利范围 |
| `minLatencyMs`/`maxLatencyMs` | string | 总延迟范围 |
| `minFirstTokenLatencyMs`/`maxFirstTokenLatencyMs` | string | 首 token 延迟范围 |
| `cursor` | string | 游标分页 |
| `take` | number | 1-300，默认 120 |

响应：

```json
{
  "requests": [
    {
      "id": "request_id",
      "traceCode": "REQ-...",
      "user": { "email": "user@example.com" },
      "apiKey": { "id": "key_id", "name": "生产 Key", "keyPrefix": "sk-abc" },
      "upstreamProvider": "openai",
      "upstreamProviderKey": { "id": "up_key", "name": "key1", "keyPrefix": "sk-xxx" },
      "accessTier": { "id": "tier_id", "code": "standard", "name": "标准用户", "status": "ACTIVE" },
      "dedicatedRouteRule": null,
      "clientIp": "1.2.3.4",
      "model": "gpt-4.1-mini",
      "reasoningEffort": "medium",
      "reasoningEffortActual": "low",
      "endpoint": "/v1/responses",
      "method": "POST",
      "status": "SUCCESS",
      "httpStatus": 200,
      "inputTokens": 100,
      "cachedInputTokens": 0,
      "outputTokens": 50,
      "totalTokens": 150,
      "chargedAmountUsd": "0.01000000",
      "upstreamCostUsd": "0.00400000",
      "latencyMs": 1200,
      "firstTokenLatencyMs": 300,
      "errorMessage": null,
      "responseUsage": {},
      "createdAt": "..."
    }
  ],
  "hasMore": true,
  "nextCursor": "last_request_id",
  "summary": {
    "totalCount": 100,
    "successCount": 90,
    "failedCount": 8,
    "pendingCount": 2,
    "failureRate": 8,
    "chargedAmountUsd": "1.00000000",
    "upstreamCostUsd": "0.40000000",
    "grossProfitUsd": "0.60000000"
  },
  "ipBanRules": []
}
```

### 7.2 请求详情

```http
GET /admin/requests/:id
```

比列表多返回：

- `upstreamRequestId`
- `userAgent`
- `requestBody`
- `updatedAt`

### 7.3 手动终止请求

```http
POST /admin/requests/:id/terminate
```

规则：

- 只允许终止 `PENDING` 请求。
- Compact 类内部请求不能手动终止。

响应：

```json
{
  "request": {},
  "abortedActiveRequest": true
}
```

UI 建议：请求列表应支持“实时刷新/手动刷新”、PENDING 行突出显示、详情抽屉展示请求体和 responseUsage JSON。

## 8. 风控、封禁与通知

### 8.1 风险中心

```http
GET /admin/risk-center
```

响应包含：

- `ipBanRules`
- `temporaryIpNoticeBans`
- `temporaryIpNoticeBanSettings`
- `pendingAutoTerminateSettings`
- `gatewayNoticeSettings`
- `redisFailurePolicySettings`
- `globalCircuitBreakerSettings`
- `externalAlertSettings`
- `charityAnnouncementSettings`
- `counters.pendingRequests`
- `counters.failedRequests24h`
- `counters.noticeRequests24h`
- `counters.rateLimitedRequests24h`
- `checkedAt`

### 8.2 IP 封禁规则

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
  "message": "当前 IP 暂不可用",
  "reason": "异常请求"
}
```

`mode` 取值来自后端 `ipBanModes`，前端应使用接口返回的现有规则作为展示源；设计上预留“提示型封禁”和“错误型封禁”的标签。

### 8.3 临时通知封禁

```http
GET /admin/temporary-ip-notice-bans
PUT /admin/temporary-ip-notice-bans/settings
DELETE /admin/temporary-ip-notice-bans/:ip
```

设置请求：

```json
{
  "enabled": true,
  "threshold": 5,
  "windowSeconds": 300,
  "banSeconds": 600,
  "message": "请求触发临时限制"
}
```

### 8.4 PENDING 自动终止

```http
GET /admin/pending-auto-terminate-settings
PUT /admin/pending-auto-terminate-settings
```

请求：

```json
{
  "enabled": true,
  "timeoutSeconds": 300,
  "message": "请求超时，已自动终止"
}
```

响应会附带 `minTimeoutSeconds`、`maxTimeoutSeconds`。

### 8.5 网关提示文案

```http
GET /admin/gateway-notice-settings
PUT /admin/gateway-notice-settings
```

请求为若干文案 key 的局部更新：

```json
{
  "someNoticeKey": "提示内容"
}
```

响应：

```json
{
  "settings": {},
  "defaults": {}
}
```

UI 建议：先按 `defaults` 的 key 动态渲染表单，不要硬编码 key。

### 8.6 Redis 降级策略

```http
GET /admin/redis-failure-policy-settings
PUT /admin/redis-failure-policy-settings
```

请求字段均可选：

```json
{
  "policy": "deny",
  "degradedAdminBypassEnabled": true,
  "degradedUserIds": ["user_id"],
  "message": "系统繁忙，请稍后再试"
}
```

响应包含 `policies` 可选项。

### 8.7 全局熔断

```http
GET /admin/global-circuit-breaker-settings
PUT /admin/global-circuit-breaker-settings
```

请求字段均可选：

```json
{
  "enabled": false,
  "allowAdmins": true,
  "allowedUserIds": [],
  "message": "系统维护中"
}
```

### 8.8 外部告警

```http
GET /admin/external-alert-settings
PUT /admin/external-alert-settings
POST /admin/external-alert-settings/test
```

请求字段均可选：

```json
{
  "enabled": true,
  "webhookUrl": "https://example.com/webhook",
  "minSeverity": "warning",
  "intervalSeconds": 300,
  "mentionText": "@all"
}
```

响应包含：

- `severityOptions`: `["info", "warning", "critical"]`
- `minIntervalSeconds`
- `maxIntervalSeconds`

### 8.9 公益公告

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

响应附带 `minIntervalHours`、`maxIntervalHours`。

## 9. 登录与安全设置

### 9.1 认证/SMTP 设置

```http
GET /admin/auth-settings
PUT /admin/auth-settings
POST /admin/auth-settings/test-email
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
  "smtpPassword": "******",
  "smtpFrom": "APIshare <noreply@example.com>"
}
```

测试邮件请求额外加：

```json
{
  "testEmail": "target@example.com"
}
```

### 9.2 推理强度转换

```http
GET /admin/reasoning-effort-transform-settings
PUT /admin/reasoning-effort-transform-settings
```

响应包含 `options`，通常为推理强度可选值。

保存请求：

```json
{
  "rules": [
    {
      "enabled": true,
      "from": "high",
      "to": "medium"
    }
  ],
  "gpt56Force": {
    "enabled": true,
    "effort": "max"
  }
}
```

`gpt56Force` 仅强制改写 Responses API 中 `gpt-5.6` 及 `gpt-5.6-*` 模型的 `reasoning.effort`。可选值为 `none`、`low`、`medium`、`high`、`xhigh`、`max`。

### 9.3 Request Body 保留策略

```http
GET /admin/request-body-retention-settings
PUT /admin/request-body-retention-settings
```

保存请求：

```json
{
  "enabled": true,
  "retentionDays": 300
}
```

响应：

```json
{
  "settings": {
    "enabled": true,
    "retentionDays": 300
  },
  "defaults": {
    "enabled": true,
    "retentionDays": 300
  },
  "limits": {
    "minRetentionDays": 1,
    "maxRetentionDays": 3650
  }
}
```

清理器只将过期记录的 `requestBody` 设置为 SQL `NULL`，其余调用记录字段和 `responseUsage` 均保留。

规则：

- 最多 20 条。
- 不能出现冲突转换。
- 冲突时返回 `409`，响应含 `conflicts`、`selfTransforms`。

## 10. 审计日志

### 10.1 后台操作审计

```http
GET /admin/audit-logs
```

Query：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `q` | string | 搜索 action、path、adminEmail、targetType、targetId、errorMessage、ip |
| `adminUserId` | string | 管理员用户 ID |
| `action` | string | 操作名模糊匹配 |
| `outcome` | enum | `success`、`failure`、`unknown` |
| `targetType` | string | 目标类型 |
| `targetId` | string | 目标 ID |
| `dateFrom`/`dateTo` | datetime | 时间范围 |
| `cursor` | string | 游标 |
| `take` | number | 1-200，默认 80 |

响应：

```json
{
  "logs": [
    {
      "id": "log_id",
      "adminUserId": "admin_id",
      "adminEmail": "admin@example.com",
      "action": "update_user",
      "method": "PATCH",
      "path": "/admin/users/user_id",
      "targetType": "user",
      "targetId": "user_id",
      "requestBody": {},
      "responseStatus": 200,
      "outcome": "success",
      "errorMessage": null,
      "ip": "1.2.3.4",
      "userAgent": "...",
      "createdAt": "..."
    }
  ],
  "nextCursor": null
}
```

### 10.2 登录日志

```http
GET /admin/login-logs
```

Query：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `take` | number | 1-500，默认 100 |
| `method` | string | 如 `admin_password`、`email_code` |
| `success` | string | `true` 或 `false` |
| `userId` | string | 用户 ID |
| `email` | string | 邮箱模糊搜索 |
| `ip` | string | IP 模糊搜索 |

响应：

```json
{
  "logs": [
    {
      "id": "login_log_id",
      "userId": "user_id",
      "email": "user@example.com",
      "username": "admin",
      "method": "admin_password",
      "success": true,
      "failureReason": null,
      "ip": "1.2.3.4",
      "userAgent": "...",
      "createdAt": "...",
      "user": {
        "id": "user_id",
        "email": "user@example.com",
        "role": "ADMIN",
        "status": "ACTIVE"
      }
    }
  ],
  "total": 100
}
```

## 11. 兑换码

```http
GET /admin/redeem-codes
GET /admin/redeem-codes/export
POST /admin/redeem-codes
PATCH /admin/redeem-codes/:id
```

列表返回最近 200 个兑换码，包含最近 5 条兑换记录。

创建请求：

```json
{
  "amount": "10",
  "count": 5,
  "maxRedemptions": 1,
  "expiresAt": "2026-12-31T15:59:59.000Z",
  "remark": "活动赠送",
  "campaignName": "2026 春季活动",
  "validUserTierId": "tier_id",
  "perUserLimit": 1
}
```

约束：

- `amount` 必须大于 0。
- `count`：1-100。
- `maxRedemptions`：1-1000。
- `perUserLimit`：1-1000，且不能大于 `maxRedemptions`。
- 创建响应会返回明文 `code`，仅出现一次。

创建响应：

```json
{
  "codes": [
    {
      "id": "code_id",
      "code": "明文兑换码",
      "codePrefix": "ABCD",
      "amount": "10.00000000",
      "status": "ACTIVE",
      "maxRedemptions": 1,
      "redeemedCount": 0,
      "expiresAt": "...",
      "campaignName": "2026 春季活动",
      "validUserTier": { "id": "tier_id", "code": "standard", "name": "标准用户" },
      "perUserLimit": 1
    }
  ]
}
```

更新请求：

```json
{
  "status": "DISABLED",
  "expiresAt": null,
  "remark": "停用",
  "campaignName": null,
  "validUserTierId": null,
  "perUserLimit": 1
}
```

导出接口返回 CSV。

## 12. 模型价格

### 12.1 价格列表

```http
GET /admin/model-prices
```

响应：

```json
{
  "modelPrices": [
    {
      "id": "price_id",
      "model": "gpt-4.1-mini",
      "upstreamProvider": "openai",
      "currency": "USD",
      "upstreamInputPer1MTok": "0.10000000",
      "upstreamOutputPer1MTok": "0.40000000",
      "upstreamCachedInputPer1MTok": "0.02500000",
      "upstreamPriceMultiplier": "1.00000000",
      "customerInputPer1MTok": "0.20000000",
      "customerOutputPer1MTok": "0.80000000",
      "customerCachedInputPer1MTok": "0.05000000",
      "customerPriceMultiplier": "1.00000000",
      "minimumChargeUsd": "0.00000000",
      "enabled": true,
      "priceVersion": "v1",
      "effectiveFrom": null,
      "effectiveTo": null,
      "createdByUserId": "admin_id",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "unifiedPriceSettings": []
}
```

### 12.2 创建或更新价格

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
  "upstreamInputPer1MTok": "0.1",
  "upstreamOutputPer1MTok": "0.4",
  "upstreamCachedInputPer1MTok": "0.025",
  "upstreamPriceMultiplier": "1",
  "customerInputPer1MTok": "0.2",
  "customerOutputPer1MTok": "0.8",
  "customerCachedInputPer1MTok": "0.05",
  "customerPriceMultiplier": "1",
  "minimumChargeUsd": "0",
  "enabled": true,
  "priceVersion": "v1",
  "effectiveFrom": null,
  "effectiveTo": null
}
```

规则：

- `model`：1-120。
- `upstreamProvider`：1-80，默认 `default`。
- 同一个 `upstreamProvider + model` 唯一。
- `effectiveFrom` 必须早于 `effectiveTo`。
- 删除价格会同步删除相关模型池渠道。

### 12.3 统一客户价

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
      "customerInputPer1MTok": "0.2",
      "customerCachedInputPer1MTok": "0.05",
      "customerOutputPer1MTok": "0.8",
      "customerPriceMultiplier": "1"
    }
  ]
}
```

响应：

```json
{
  "updated": 1,
  "models": 1,
  "unifiedPriceSettings": []
}
```

### 12.4 导入导出

```http
GET /admin/model-prices/export?format=json
GET /admin/model-prices/export?format=csv
POST /admin/model-prices/import
```

导入请求二选一：`rows` 或 `content`。

```json
{
  "format": "csv",
  "dryRun": true,
  "content": "model,upstreamProvider,..."
}
```

或：

```json
{
  "dryRun": true,
  "rows": [
    {
      "model": "gpt-4.1-mini",
      "upstreamProvider": "openai"
    }
  ]
}
```

`dryRun=true` 响应：

```json
{
  "dryRun": true,
  "summary": {
    "rows": 10,
    "creates": 5,
    "updates": 5
  },
  "rows": []
}
```

导入错误：

```json
{
  "message": "Model price import contains invalid rows",
  "errors": [],
  "preview": []
}
```

## 13. 模型池与渠道

### 13.1 模型池列表

```http
GET /admin/model-pools
```

响应包含：

- `modelPools`：模型池列表。
- `availableChannels`：可添加渠道，来自已配置价格和 provider。
- `accessTiers`：可选访问等级。
- `healthCheck`：健康检查全局配置和范围。
- `dispatchSettings`：调度设置。

模型池字段示例：

```json
{
  "id": "pool_id",
  "model": "gpt-4.1-mini",
  "tierId": "tier_id",
  "tier": { "id": "tier_id", "code": "standard", "name": "标准用户", "status": "ACTIVE" },
  "status": "ACTIVE",
  "autoHealthCheckEnabled": true,
  "healthCheckEndpoint": "responses",
  "readyChannelCount": 2,
  "pricedChannelCount": 3,
  "channels": [
    {
      "id": "channel_id",
      "upstreamProvider": "openai",
      "status": "ACTIVE",
      "priority": 100,
      "consecutiveFailures": 0,
      "recoverySuccesses": 0,
      "penalizedUntil": null,
      "lastCheckStatus": "SUCCESS",
      "lastCheckedAt": "...",
      "lastLatencyMs": 1000,
      "lastFirstTokenLatencyMs": 300,
      "hasPrice": true,
      "priceEnabled": true,
      "providerStatus": "ACTIVE",
      "providerPriority": 100,
      "activeKeyCount": 2,
      "unavailableReasons": [],
      "effectiveStatus": "READY"
    }
  ]
}
```

### 13.2 健康检查配置

```http
PATCH /admin/model-pools/health-check
```

请求字段均可选：

```json
{
  "intervalSeconds": 60,
  "penaltySeconds": 300,
  "successGraceSeconds": 120
}
```

### 13.3 复制 standard 等级模型池

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

响应：

```json
{
  "result": {
    "sourceTier": {},
    "targetTier": {},
    "sourcePools": 10,
    "createdPools": 8,
    "updatedPools": 0,
    "createdChannels": 20,
    "updatedChannels": 0,
    "skippedModels": []
  }
}
```

### 13.4 按上游批量设置渠道状态

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

### 13.5 将上游添加到模型池

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

### 13.6 模型池 CRUD

```http
POST /admin/model-pools
PATCH /admin/model-pools/:id
DELETE /admin/model-pools/:id
```

创建请求：

```json
{
  "model": "gpt-4.1-mini",
  "tierId": "tier_id",
  "status": "ACTIVE",
  "autoHealthCheckEnabled": true,
  "healthCheckEndpoint": "responses"
}
```

注意：模型必须先配置上游价格，才能加入模型池。

更新请求：

```json
{
  "status": "ACTIVE",
  "autoHealthCheckEnabled": true,
  "healthCheckEndpoint": "responses"
}
```

### 13.7 渠道 CRUD 与手动检测

```http
POST /admin/model-pools/:id/channels
PATCH /admin/model-pool-channels/:id
DELETE /admin/model-pool-channels/:id
POST /admin/model-pool-channels/:id/check
```

添加渠道：

```json
{
  "upstreamProvider": "openai",
  "status": "ACTIVE"
}
```

更新渠道：

```json
{
  "status": "FORCED_ACTIVE",
  "priority": 10
}
```

规则：

- 不能添加 `default` 上游到模型池。
- 上游 Provider 必须存在。
- 该模型 + 上游必须已有价格。
- 手动检测响应为 `{ "result": {} }`。

## 14. 上游 Provider 与上游 Key

### 14.1 Provider 列表

```http
GET /admin/upstream-providers
```

响应：

```json
{
  "providers": [
    {
      "id": "provider_id",
      "name": "openai",
      "baseUrl": "https://api.openai.com",
      "apiKey": "sk-****abcd",
      "status": "ACTIVE",
      "priority": 100,
      "timeoutMs": 180000,
      "compactItemType": "compaction_summary",
      "keys": [
        {
          "id": "key_id",
          "name": "default",
          "key": "sk-****abcd",
          "keyPrefix": "sk-abc",
          "status": "ACTIVE",
          "priority": 100,
          "dailyLimitUsd": null,
          "monthlyLimitUsd": null,
          "providerRateLimit": null,
          "lastCheckStatus": null,
          "lastError": null
        }
      ]
    }
  ]
}
```

注意：`apiKey` 和 `key` 会脱敏。

### 14.2 创建/更新/删除 Provider

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
  "apiKey": "sk-...",
  "priority": 100,
  "timeoutMs": 180000,
  "compactItemType": "compaction_summary",
  "status": "ACTIVE"
}
```

更新请求字段均可选：

```json
{
  "name": "openai-new",
  "baseUrl": "https://api.openai.com",
  "apiKey": "sk-...",
  "priority": 50,
  "timeoutMs": 180000,
  "compactItemType": "compaction",
  "status": "DISABLED"
}
```

规则：

- `baseUrl` 必须是 URL，尾部斜杠会被去掉。
- `timeoutMs`：5000-600000。
- Provider 创建/更新 API Key 后会确保默认上游 Key 存在。
- 删除 Provider 会同时删除相关上游 Key、模型价格、模型池渠道。
- 重命名 Provider 会迁移旧名称下的模型价格和模型池渠道。

### 14.3 上游 Key

```http
POST /admin/upstream-providers/:id/keys
PATCH /admin/upstream-provider-keys/:id
DELETE /admin/upstream-provider-keys/:id
```

创建 Key：

```json
{
  "name": "key-1",
  "key": "sk-...",
  "status": "ACTIVE",
  "priority": 100,
  "dailyLimitUsd": "100",
  "monthlyLimitUsd": "3000",
  "providerRateLimit": 1000
}
```

更新 Key：

```json
{
  "name": "key-1",
  "key": "sk-new",
  "status": "DISABLED",
  "priority": 50,
  "dailyLimitUsd": null,
  "monthlyLimitUsd": null,
  "providerRateLimit": null,
  "disabledReason": "额度耗尽",
  "lastErrorCategory": "rate_limit"
}
```

约束：

- 同一 Provider 下 Key 名称唯一。
- 金额限额必须为非负数，`null` 或空值表示不限制。
- `providerRateLimit`：0-1000000，可空。

## 15. 前台相关但后台会用到的公共接口

这些不是后台管理接口，但 UI 设计师理解产品状态页时会用到。

```http
GET /public/charity-status
GET /public/charity-status/events
GET /public/charity-dashboard
GET /public/charity-dashboard/events
```

事件接口为 SSE，可用于前台公益状态实时更新。

用户侧接口：

```http
GET /models
GET /usage/summary
GET /usage/requests
GET /wallet
GET /me/referral
POST /redeem-codes/redeem
GET /api-keys
POST /api-keys
PATCH /api-keys/:id
DELETE /api-keys/:id
```

后台设计一般不用直接管理这些页面，但如果要设计“用户视角预览”，可参考。

## 16. 邀请奖励

### 16.1 用户侧邀请信息

```http
GET /me/referral
```

返回当前用户专属邀请码、邀请链接、双方奖励摘要和最近 20 条邀请记录。用户首次访问时会自动创建 `ReferralProfile`。

### 16.2 邀请链接注册

```http
POST /auth/email-code/login
```

请求体新增可选字段：

```json
{
  "email": "new-user@example.com",
  "code": "123456",
  "referralCode": "abc123"
}
```

仅当邮箱不存在且本次自动创建新用户时，`referralCode` 才会生效。已有用户登录、邀请码无效、邀请码停用或邀请功能关闭时，不创建邀请记录，也不发放邀请奖励。

### 16.3 后台邀请配置

```http
GET /admin/referral-settings
PUT /admin/referral-settings
```

配置字段：

```json
{
  "enabled": true,
  "inviteBaseUrl": "",
  "inviterReward": {
    "type": "BALANCE",
    "amountUsd": "1.00000000",
    "subscriptionPlanId": null
  },
  "inviteeReward": {
    "type": "NONE",
    "amountUsd": "0.00000000",
    "subscriptionPlanId": null
  }
}
```

`type` 可选 `NONE`、`BALANCE`、`SUBSCRIPTION`。余额奖励写入钱包流水，`source` 为 `REFERRAL`；订阅奖励复用订阅发放逻辑，`source` 为 `REFERRAL`。双方奖励互相独立，均可为空。

### 16.4 后台邀请记录

```http
GET /admin/referrals
```

查询参数：

- `q`：搜索邀请码、邀请人邮箱、被邀请人邮箱。
- `status`：`REWARDED` / `SKIPPED`。

返回最近 200 条邀请记录，包括邀请人、被邀请新用户、双方奖励快照和发奖时间。

## 17. UI 设计重点与交互约束

### 16.1 高优先级页面

1. 登录页：用户名 + 密码后台登录，错误态、锁定态。
2. 总览页：KPI、初始化向导、系统告警、风险计数。
3. 请求日志页：高密度表格、多条件筛选、详情抽屉、终止 PENDING。
4. 用户页：用户详情、钱包余额、API Key、公益账号设置。
5. 上游页：Provider + Key 双层管理、Key 状态和额度。
6. 模型池页：模型 -> 等级 -> 渠道矩阵，健康状态明显。
7. 价格页：表格编辑、导入预览、统一客户价。
8. 风控页：封禁、熔断、降级、通知、外部告警统一配置。

### 16.2 状态颜色建议

- `ACTIVE` / `SUCCESS` / `READY`：绿色。
- `TRIAL` / `PENDING` / `FORCED_ACTIVE`：蓝色或琥珀色。
- `DISABLED` / `REVOKED`：灰色。
- `FAILED` / `SUSPENDED` / `RISK_REVIEW` / `UNAVAILABLE` / `PENALIZED`：红色或橙色。
- 金额亏损、错误率升高、无可用渠道：红色强调。

### 16.3 表格字段建议

请求日志表：

- 时间、traceCode、用户、API Key、模型、状态、HTTP、上游、上游 Key、Token、收费、成本、毛利、延迟、首 token 延迟、IP。

用户表：

- 邮箱、角色、状态、等级、余额、预留余额、API Key 数、请求数、速率限制、并发限制、创建时间、最近登录。

上游表：

- 名称、状态、优先级、Base URL、超时、Compact 类型、Key 数、活动 Key 数、最近错误。

模型池表：

- 模型、等级、池状态、可用渠道数、有价格渠道数、自动健康检查、检测端点、渠道健康。

### 16.4 危险操作确认

建议所有以下操作使用确认弹窗：

- 删除用户。
- 删除 API Key。
- 停用/吊销 API Key。
- 调整余额为负数。
- 删除 Provider。
- 删除模型价格。
- 删除模型池或渠道。
- 批量禁用渠道。
- 开启全局熔断。
- 手动终止请求。

### 16.5 现有接口限制

- `/admin/users` 目前只返回最近 100 个，没有分页搜索。
- `/admin/redeem-codes` 目前只返回最近 200 个，没有分页搜索。
- 多数设置接口返回完整 settings，可按返回值刷新表单。
- 导入接口支持 dry run，UI 应提供“预览 -> 确认导入”的两步流程。
- 明文 API Key 和兑换码只在创建响应出现一次，UI 必须提供一次性复制提示。
