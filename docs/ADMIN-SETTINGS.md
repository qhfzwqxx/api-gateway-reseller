# APIshare 网关后台设置功能文档

本文档是 [后台接口文档](./ADMIN-API.md) 的设置功能展开版，面向 UI 设计师、前端工程师和后台产品规划使用。它按后台“设置中心/配置页”的方式组织，覆盖所有当前源码中可配置的后台设置，不只列接口，还说明每个设置项的含义、默认值、字段范围、影响范围、建议控件和危险提示。

## 1. 设置总览

当前后台设置能力分为 13 类：

| 设置模块 | 主要接口 | 存储/作用域 | 主要影响 |
| --- | --- | --- | --- |
| 登录与 SMTP | `/admin/auth-settings` | `SystemSetting.auth_settings` | 用户邮箱验证码登录、自动注册、新用户赠金、SMTP 发信 |
| 模型调度 | `/admin/dispatch-settings` | `SystemSetting.model_dispatch_settings` | 模型池选路、粘性、惩罚、健康检查间隔 |
| 模型池健康检查 | `/admin/model-pools/health-check` | 复用调度设置 | 渠道检测周期、失败惩罚、恢复宽限 |
| PENDING 自动终止 | `/admin/pending-auto-terminate-settings` | `SystemSetting.pending_auto_terminate_settings` | 长时间未完成请求自动失败 |
| 临时 IP 通知封禁 | `/admin/temporary-ip-notice-bans/settings` | `SystemSetting.temporary_ip_notice_ban_settings` + Redis | 自动终止频繁 IP 的临时提示封禁 |
| 网关提示文案 | `/admin/gateway-notice-settings` | `SystemSetting.gateway_notice_settings` | 限流、并发、模型不可用、上下文异常等返回给用户的文案 |
| Redis 失败策略 | `/admin/redis-failure-policy-settings` | `SystemSetting.redis_failure_policy_settings` | Redis 不可用时放行/拒绝/降级名单 |
| 全局熔断 | `/admin/global-circuit-breaker-settings` | `SystemSetting.global_circuit_breaker_settings` | 全站 API 调用维护模式 |
| 外部告警 | `/admin/external-alert-settings` | `SystemSetting.external_alert_settings` | 运维告警 Webhook 推送 |
| 公益公告与公益服务 | `/admin/charity-announcement-settings` | `SystemSetting.charity_announcement_settings` | 公益 API 可用性与公告 |
| 推理强度转换 | `/admin/reasoning-effort-transform-settings` | `SystemSetting.reasoning_effort_transform_settings` | 请求中的 reasoning effort 改写 |
| 统一客户价 | `/admin/model-prices/unified` | `SystemSetting.model_price_unified_customer_settings` | 按模型覆盖客户侧价格 |
| 业务实体设置 | 用户、API Key、Provider、模型池、访问等级等接口 | 业务表 | 用户限额、Key 限额、上游超时、渠道状态、等级路由 |

## 2. 通用设计规则

### 2.1 设置页布局建议

建议后台单独设计“设置中心”，并按风险等级分区：

1. 基础设置：登录与 SMTP、公益公告、网关提示文案。
2. 调度设置：模型调度、模型池健康检查、推理强度转换。
3. 风控设置：自动终止、临时 IP 通知封禁、Redis 失败策略、全局熔断。
4. 运维设置：外部告警、服务器状态入口。
5. 价格设置：统一客户价入口，跳转或内嵌模型价格页。

### 2.2 保存交互

- 每个设置模块独立保存，避免一个表单同时提交所有设置。
- GET 返回的 `settings` 作为表单初始值。
- 若接口返回 `defaults`，UI 应提供“恢复默认值”或“查看默认值”能力。
- 保存成功后使用接口返回的新 `settings` 覆盖本地表单，不要只乐观更新。
- 对全局熔断、Redis fail-closed、批量调度参数等高风险设置，应二次确认。

### 2.3 字段控件建议

- boolean：使用开关。
- enum：使用下拉或分段控件。
- 秒/分钟/小时：使用数字输入 + 单位后缀，必要时用滑条辅助。
- 文案：短文本用 input，长文案用 textarea。
- 用户 ID 列表：使用 tag input，建议联动用户搜索。
- 金额：使用 decimal input，保留 8 位小数。
- Webhook、URL：使用 URL input，并提供测试按钮。

### 2.4 通用响应与错误

所有后台设置接口都需要：

```http
Authorization: Bearer <admin-token>
Content-Type: application/json
```

校验错误通常返回：

```json
{
  "message": "Validation error",
  "issues": [
    { "path": ["field"], "message": "错误说明" }
  ]
}
```

业务错误通常返回：

```json
{
  "message": "错误说明"
}
```

## 3. 登录与 SMTP 设置

### 3.1 功能定位

用于配置用户侧邮箱验证码登录、自动注册、新用户赠金，以及 SMTP 邮件发送。后台管理员登录本身仍使用 `/auth/admin-login` 的用户名密码登录。

### 3.2 接口

```http
GET /admin/auth-settings
PUT /admin/auth-settings
POST /admin/auth-settings/test-email
GET /auth/settings
```

其中：

- `/admin/auth-settings`：后台管理完整设置，不返回 SMTP 密码明文。
- `/auth/settings`：前台公共登录页读取，只返回公开字段和 `smtpConfigured`。
- `/admin/auth-settings/test-email`：保存前或保存后测试 SMTP。

### 3.3 GET 响应

```json
{
  "settings": {
    "emailCodeLoginEnabled": true,
    "emailCodeAutoRegisterEnabled": true,
    "newUserBonusUsd": "0.00000000",
    "emailCodeTtlSeconds": 600,
    "emailCodeCooldownSeconds": 60,
    "smtpHost": "",
    "smtpPort": 465,
    "smtpSecure": true,
    "smtpUser": "",
    "smtpFrom": "",
    "smtpConfigured": false
  }
}
```

注意：后台响应不包含 `smtpPassword`，只能通过 PUT 覆盖。

### 3.4 保存请求

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
  "smtpPassword": "smtp-password",
  "smtpFrom": "APIshare <noreply@example.com>"
}
```

### 3.5 字段说明

| 字段 | 类型 | 默认值 | 范围/约束 | 说明 |
| --- | --- | --- | --- | --- |
| `emailCodeLoginEnabled` | boolean | `true` | 必填 | 是否允许用户邮箱验证码登录 |
| `emailCodeAutoRegisterEnabled` | boolean | `true` | 必填 | 邮箱不存在时是否自动创建用户 |
| `newUserBonusUsd` | decimal string | `"0.00000000"` | 非负数 | 自动注册用户初始赠金 |
| `emailCodeTtlSeconds` | number | `600` | 60-3600 | 验证码有效期 |
| `emailCodeCooldownSeconds` | number | `60` | 10-600 | 同一邮箱发送冷却时间 |
| `smtpHost` | string | `""` | 最多 255 | SMTP Host |
| `smtpPort` | number | `465` | 1-65535 | SMTP 端口 |
| `smtpSecure` | boolean | `true` | 必填 | 是否使用 SSL/TLS |
| `smtpUser` | string | `""` | 最多 255 | SMTP 用户名 |
| `smtpPassword` | string | `""` | 最多 1000 | SMTP 密码；空值表示不覆盖旧密码 |
| `smtpFrom` | string | `""` | 最多 255 | 发件人 |
| `smtpConfigured` | boolean | 计算字段 | 只读 | `smtpHost + smtpPort + smtpFrom` 是否齐全 |

### 3.6 测试邮件

测试接口请求包含所有保存字段，并额外加：

```json
{
  "testEmail": "target@example.com"
}
```

成功：

```json
{ "ok": true }
```

失败：

- SMTP 未配置完整：`400`
- 邮件发送失败：`502`

### 3.7 UI 注意事项

- SMTP 密码输入框显示占位文案“留空则不修改”。
- `smtpConfigured=false` 时，前台验证码发送会失败，设置页应有醒目提示。
- 关闭 `emailCodeLoginEnabled` 会导致用户无法通过邮箱验证码登录，应二次确认。
- 关闭 `emailCodeAutoRegisterEnabled` 后，未存在邮箱登录会被拒绝。

## 4. 模型调度设置

### 4.1 功能定位

控制模型池如何选择上游渠道，包括粘性路由、慢请求解绑、失败惩罚、健康检查间隔，以及后台是否允许强制可用按钮。

### 4.2 接口

```http
GET /admin/dispatch-settings
PATCH /admin/dispatch-settings
```

GET 响应：

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

PATCH 请求字段均可选，保存后返回完整 `settings` 和 `defaults`。

### 4.3 字段说明

| 字段 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `stickyEnabled` | boolean | `true` | - | 是否启用调用者到渠道的粘性绑定 |
| `stickyTtlSeconds` | number | `600` | 60-86400 | 粘性绑定有效期 |
| `stickySlowUnbindEnabled` | boolean | `true` | - | 慢请求达到阈值后是否解除粘性 |
| `slowFirstTokenMs` | number | `15000` | 1000-300000 | 首 token 慢请求阈值 |
| `slowTotalLatencyMs` | number | `45000` | 1000-600000 | 总延迟慢请求阈值 |
| `slowUnbindThreshold` | number | `3` | 1-100 | 连续慢请求多少次后解绑 |
| `penaltyEnabled` | boolean | `true` | - | 是否启用失败惩罚 |
| `penaltyFailureThreshold` | number | `2` | 1-100 | 连续失败多少次后惩罚 |
| `penaltySeconds` | number | `60` | 1-86400 | 惩罚持续秒数 |
| `healthCheckIntervalSeconds` | number | `30` | 5-3600 | 健康检查调度间隔 |
| `speedRankPenalty` | number | `300` | 0-60000 | 排名靠后的速度惩罚分 |
| `stickyHitPenalty` | number | `500` | 0-60000 | 粘性占用惩罚分 |
| `forceAvailableButtonEnabled` | boolean | `true` | - | 后台是否显示/允许强制可用相关操作 |

### 4.4 UI 设计建议

分为四组：

1. 粘性路由：`stickyEnabled`、`stickyTtlSeconds`。
2. 慢请求解绑：`stickySlowUnbindEnabled`、`slowFirstTokenMs`、`slowTotalLatencyMs`、`slowUnbindThreshold`。
3. 失败惩罚：`penaltyEnabled`、`penaltyFailureThreshold`、`penaltySeconds`。
4. 评分与高级：`healthCheckIntervalSeconds`、`speedRankPenalty`、`stickyHitPenalty`、`forceAvailableButtonEnabled`。

高风险提示：

- 关闭失败惩罚可能让异常上游继续承接流量。
- `penaltySeconds` 过长可能导致可用渠道减少。
- `stickyTtlSeconds` 过长会削弱负载均衡。

## 5. 模型池健康检查设置

### 5.1 功能定位

模型池页面中的健康检查设置是调度系统的一个专用入口，控制检测频率、失败惩罚和恢复宽限。

### 5.2 接口

```http
GET /admin/model-pools
PATCH /admin/model-pools/health-check
```

`GET /admin/model-pools` 响应中包含：

```json
{
  "healthCheck": {
    "intervalSeconds": 30,
    "minIntervalSeconds": 5,
    "maxIntervalSeconds": 3600,
    "penaltySeconds": 60,
    "minPenaltySeconds": 1,
    "maxPenaltySeconds": 86400,
    "successGraceSeconds": 120,
    "minSuccessGraceSeconds": 0,
    "maxSuccessGraceSeconds": 86400,
    "serverNow": "2026-05-28T00:00:00.000Z"
  }
}
```

PATCH 请求：

```json
{
  "intervalSeconds": 30,
  "penaltySeconds": 60,
  "successGraceSeconds": 120
}
```

字段均可选。

### 5.3 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `intervalSeconds` | number | 自动健康检查间隔。也对应调度设置里的 `healthCheckIntervalSeconds` |
| `penaltySeconds` | number | 渠道失败后被惩罚的持续时间 |
| `successGraceSeconds` | number | 成功调用后，健康状态保持宽限时间 |
| `serverNow` | datetime | 服务端当前时间，用于前端倒计时 |

### 5.4 UI 注意事项

- 应在模型池页面提供“全局健康检查设置”区域。
- 单个渠道有 `nextCheckAt`、`nextCheckRemainingSeconds`、`penalizedUntil` 等倒计时字段，可做状态徽标。
- 修改健康检查设置会影响所有模型池渠道。

## 6. PENDING 自动终止设置

### 6.1 功能定位

用于清理长时间停留在 `PENDING` 的请求。开启后，后台清理任务会把超时请求标记为失败。

### 6.2 接口

```http
GET /admin/pending-auto-terminate-settings
PUT /admin/pending-auto-terminate-settings
```

GET 响应：

```json
{
  "settings": {
    "enabled": true,
    "timeoutSeconds": 30,
    "message": "手动终止",
    "minTimeoutSeconds": 5,
    "maxTimeoutSeconds": 3600
  }
}
```

保存请求：

```json
{
  "enabled": true,
  "timeoutSeconds": 30,
  "message": "请求长时间未完成，已自动终止"
}
```

### 6.3 字段说明

| 字段 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | - | 是否启用自动终止 |
| `timeoutSeconds` | number | `30` | 5-3600 | PENDING 超过多少秒后终止 |
| `message` | string | `"手动终止"` | 1-8000 | 写入请求错误信息或返回提示的文案 |
| `minTimeoutSeconds` | number | `5` | 只读 | UI 最小值 |
| `maxTimeoutSeconds` | number | `3600` | 只读 | UI 最大值 |

### 6.4 UI 注意事项

- 建议在风险中心展示当前 PENDING 数量。
- `timeoutSeconds` 设置过小会误杀慢请求，设置过大则无法及时释放异常请求。
- 修改该设置影响后台定时清理逻辑。

## 7. 临时 IP 通知封禁设置

### 7.1 功能定位

当同一 IP 在时间窗口内多次触发自动终止，会进入 Redis 临时封禁。封禁不是永久黑名单，而是返回可配置提示，TTL 到期后自动解除。

### 7.2 接口

```http
GET /admin/temporary-ip-notice-bans
PUT /admin/temporary-ip-notice-bans/settings
DELETE /admin/temporary-ip-notice-bans/:ip
```

GET 响应：

```json
{
  "bans": [
    {
      "ip": "1.2.3.4",
      "message": "您的网络较差，请一分钟后再试",
      "ttlSeconds": 52
    }
  ],
  "settings": {
    "enabled": true,
    "threshold": 2,
    "windowSeconds": 600,
    "banSeconds": 60,
    "message": "您的网络较差，请一分钟后再试",
    "minBanSeconds": 10,
    "maxBanSeconds": 3600,
    "minThreshold": 2,
    "maxThreshold": 20,
    "minWindowSeconds": 60,
    "maxWindowSeconds": 86400
  }
}
```

保存请求：

```json
{
  "enabled": true,
  "threshold": 2,
  "windowSeconds": 600,
  "banSeconds": 60,
  "message": "您的网络较差，请一分钟后再试"
}
```

### 7.3 字段说明

| 字段 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | - | 是否启用临时封禁 |
| `threshold` | number | `2` | 2-20 | 窗口内触发多少次自动终止后封禁 |
| `windowSeconds` | number | `600` | 60-86400 | 统计窗口 |
| `banSeconds` | number | `60` | 10-3600 | 临时封禁时长 |
| `message` | string | `"您的网络较差，请一分钟后再试"` | 1-8000 | 封禁期间提示文案 |

### 7.4 UI 注意事项

- 临时封禁列表来自 Redis，重启或 Redis 数据丢失会影响列表。
- 删除单个 IP 是立即解除临时封禁。
- 建议显示 TTL 倒计时和“一键解除”操作。

## 8. 网关提示文案设置

### 8.1 功能定位

集中配置网关在常见拦截/降级场景下返回给用户的提示文案。

### 8.2 接口

```http
GET /admin/gateway-notice-settings
PUT /admin/gateway-notice-settings
```

GET 响应：

```json
{
  "settings": {
    "userConcurrencyMessage": "当前账号并发已达到 {limit}，请等待正在处理的请求完成后重试。",
    "keyConcurrencyMessage": "当前 API Key 并发已达到 {limit}，请等待正在处理的请求完成后重试。",
    "userRateLimitMessage": "当前账号已达到每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
    "keyRateLimitMessage": "当前 API Key 已达到每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
    "charityIpRateLimitMessage": "当前 IP 已达到公益账号每分钟 {limit} 次请求限制，请约 {seconds} 秒后重试。",
    "modelUnavailableMessage": "当前模型暂不可用，请稍后再试。",
    "missingUsageMessage": "请新建对话或清空当前会话上下文后重试。",
    "staleResponsesContextMessage": "当前会话的上下文已失效，请新建对话或清空当前会话上下文后重试。",
    "invalidEncryptedContentMessage": "当前会话包含无法继续使用的上下文，请新建对话或清空当前会话上下文后重试。"
  },
  "defaults": {}
}
```

PUT 请求为局部更新，所有字段可选：

```json
{
  "modelUnavailableMessage": "当前模型暂不可用，请稍后再试。"
}
```

### 8.3 字段说明

| 字段 | 可用变量 | 触发场景 |
| --- | --- | --- |
| `userConcurrencyMessage` | `{limit}` | 用户级并发达到限制 |
| `keyConcurrencyMessage` | `{limit}` | API Key 级并发达到限制 |
| `userRateLimitMessage` | `{limit}`、`{seconds}` | 用户级每分钟限流 |
| `keyRateLimitMessage` | `{limit}`、`{seconds}` | API Key 每分钟限流 |
| `charityIpRateLimitMessage` | `{limit}`、`{seconds}` | 公益账号 IP 限流 |
| `modelUnavailableMessage` | 无 | 模型无可用渠道 |
| `missingUsageMessage` | 无 | 上下文 usage 缺失 |
| `staleResponsesContextMessage` | 无 | Responses 上下文过期 |
| `invalidEncryptedContentMessage` | 无 | 加密上下文不可继续使用 |

所有文案最长 8000 字符；空字符串会回退默认值。

### 8.4 UI 注意事项

- 建议每条文案旁展示“可用变量”。
- 保存前可做本地预览，例如把 `{limit}` 替换为 `60`。
- 不要删除变量说明，变量漏写不会导致接口失败，但用户提示会不够明确。

## 9. Redis 失败策略设置

### 9.1 功能定位

Redis 用于限流、并发控制、临时封禁、粘性等运行时能力。当 Redis 异常时，该设置决定网关如何处理调用。

### 9.2 接口

```http
GET /admin/redis-failure-policy-settings
PUT /admin/redis-failure-policy-settings
```

GET 响应：

```json
{
  "settings": {
    "policy": "fail-open",
    "degradedAdminBypassEnabled": true,
    "degradedUserIds": [],
    "message": "网关风控组件暂不可用，请稍后重试。"
  },
  "defaults": {},
  "policies": ["fail-open", "fail-closed", "degraded"]
}
```

保存请求：

```json
{
  "policy": "degraded",
  "degradedAdminBypassEnabled": true,
  "degradedUserIds": ["user_id_1", "user_id_2"],
  "message": "网关风控组件暂不可用，请稍后重试。"
}
```

字段均可选。

### 9.3 策略说明

| policy | 含义 | 适用场景 | 风险 |
| --- | --- | --- | --- |
| `fail-open` | Redis 失败时放行 | 业务连续性优先 | 限流/并发/封禁可能失效 |
| `fail-closed` | Redis 失败时拒绝 | 风控严格优先 | Redis 抖动会影响全部调用 |
| `degraded` | 只允许白名单用户或管理员绕过 | 折中策略 | 需维护白名单 |

### 9.4 字段说明

| 字段 | 类型 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `policy` | enum | `fail-open` | 三选一 | Redis 失败策略 |
| `degradedAdminBypassEnabled` | boolean | `true` | - | degraded 模式下管理员是否放行 |
| `degradedUserIds` | string[] | `[]` | 最多 500，去重 | degraded 模式下放行用户 |
| `message` | string | 默认提示 | 最多 1000 | 拒绝时提示 |

### 9.5 UI 注意事项

- 选择 `fail-closed` 必须二次确认。
- 选择 `degraded` 时展示用户白名单编辑器。
- 建议在服务器状态页 Redis 异常时提供跳转到该设置。

## 10. 全局熔断设置

### 10.1 功能定位

全局熔断用于维护模式。开启后，普通 API 调用会被拒绝，管理员或白名单用户可绕过。

### 10.2 接口

```http
GET /admin/global-circuit-breaker-settings
PUT /admin/global-circuit-breaker-settings
```

GET 响应：

```json
{
  "settings": {
    "enabled": false,
    "allowAdmins": true,
    "allowedUserIds": [],
    "message": "网关维护中，暂时暂停普通调用，请稍后再试。"
  },
  "defaults": {}
}
```

保存请求：

```json
{
  "enabled": true,
  "allowAdmins": true,
  "allowedUserIds": ["user_id"],
  "message": "网关维护中，暂时暂停普通调用，请稍后再试。"
}
```

字段均可选。

### 10.3 字段说明

| 字段 | 类型 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `false` | - | 是否开启全局熔断 |
| `allowAdmins` | boolean | `true` | - | 管理员是否绕过 |
| `allowedUserIds` | string[] | `[]` | 最多 500，去重 | 允许绕过的用户 ID |
| `message` | string | 默认维护文案 | 最多 1000 | 拒绝时返回给用户 |

### 10.4 UI 注意事项

- 开启熔断是高危操作，必须确认。
- 顶部导航或总览页应显示“全局熔断已开启”红色状态。
- `allowAdmins=false` 且没有白名单时，所有调用都会被拒绝。

## 11. 外部告警设置

### 11.1 功能定位

把服务器状态、Redis、数据库、PM2、模型池、上游 Key 等告警推送到外部 Webhook。

### 11.2 接口

```http
GET /admin/external-alert-settings
PUT /admin/external-alert-settings
POST /admin/external-alert-settings/test
```

GET 响应：

```json
{
  "settings": {
    "enabled": false,
    "webhookUrl": "",
    "minSeverity": "warning",
    "intervalSeconds": 300,
    "mentionText": ""
  },
  "defaults": {},
  "severityOptions": ["info", "warning", "critical"],
  "minIntervalSeconds": 60,
  "maxIntervalSeconds": 86400
}
```

保存或测试请求：

```json
{
  "enabled": true,
  "webhookUrl": "https://example.com/webhook",
  "minSeverity": "warning",
  "intervalSeconds": 300,
  "mentionText": "@all"
}
```

字段均可选。测试接口会先合并当前设置，再发送测试告警。

### 11.3 字段说明

| 字段 | 类型 | 默认值 | 范围/约束 | 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `false` | - | 是否启用外部告警 |
| `webhookUrl` | string | `""` | 最多 2000 | Webhook 地址 |
| `minSeverity` | enum | `warning` | `info`/`warning`/`critical` | 最低推送级别 |
| `intervalSeconds` | number | `300` | 60-86400 | 最短推送间隔 |
| `mentionText` | string | `""` | 最多 500 | 附加提醒文本 |

### 11.4 UI 注意事项

- Webhook 为空时测试会失败：`Webhook URL is required`。
- 建议测试按钮和保存按钮分开。
- 告警调度器 30 秒 tick 一次，`intervalSeconds` 是实际推送节流。

## 12. 公益公告与公益服务设置

### 12.1 功能定位

控制公益 API 服务是否开启，以及前台公益页面公告展示策略。

### 12.2 接口

```http
GET /admin/charity-announcement-settings
PUT /admin/charity-announcement-settings
```

GET 响应：

```json
{
  "settings": {
    "serviceEnabled": true,
    "serviceDisabledMessage": "公益 API 当前暂不可用，请稍后再试。",
    "enabled": false,
    "frequency": "every_visit",
    "intervalHours": 24,
    "title": "公益 API 使用公告",
    "content": "",
    "minIntervalHours": 1,
    "maxIntervalHours": 720
  }
}
```

保存请求：

```json
{
  "serviceEnabled": true,
  "serviceDisabledMessage": "公益 API 当前暂不可用，请稍后再试。",
  "enabled": true,
  "frequency": "interval",
  "intervalHours": 24,
  "title": "公益 API 使用公告",
  "content": "公告内容"
}
```

### 12.3 字段说明

| 字段 | 类型 | 默认值 | 范围/约束 | 说明 |
| --- | --- | --- | --- | --- |
| `serviceEnabled` | boolean | `true` | - | 公益 API 服务是否可用 |
| `serviceDisabledMessage` | string | 默认不可用文案 | 最多 8000 | 服务关闭时返回文案 |
| `enabled` | boolean | `false` | - | 是否展示公益公告 |
| `frequency` | enum | `every_visit` | `every_visit`/`interval` | 每次访问展示或按间隔展示 |
| `intervalHours` | number | `24` | 1-720 | 间隔展示小时数 |
| `title` | string | `"公益 API 使用公告"` | 最多 80 | 公告标题 |
| `content` | string | `""` | 最多 2000 | 公告正文 |

### 12.4 联动

保存公益公告设置后，后端会触发 `emitPublicStatusChanged()`，通知公益状态相关 SSE 更新。

### 12.5 UI 注意事项

- `serviceEnabled=false` 是高影响操作，应二次确认。
- 当 `enabled=false` 时，公告标题/正文可折叠但仍保留。
- `frequency=interval` 时显示 `intervalHours`；`every_visit` 时隐藏或禁用。

## 13. 推理强度转换设置

### 13.1 功能定位

在代理请求前自动改写请求体中的推理强度字段，用于执行通用 from/to 转换规则，或强制 GPT-5.6 系列模型使用统一强度。

支持识别的字段：

- `reasoning_effort`
- `model_reasoning_effort`
- `reasoning.effort`

### 13.2 接口

```http
GET /admin/reasoning-effort-transform-settings
PUT /admin/reasoning-effort-transform-settings
```

GET 响应：

```json
{
  "settings": {
    "rules": [],
    "gpt56Force": {
      "enabled": false,
      "effort": "medium"
    }
  },
  "options": ["none", "low", "medium", "high", "xhigh", "max"]
}
```

`gpt56Force` 开启后仅作用于 `/v1/responses`，匹配 `gpt-5.6` 及 `gpt-5.6-*` 系列模型。网关会覆盖已有的 `reasoning.effort`，客户端未传该字段时也会自动补充。

## 14. Request Body 保留策略

### 14.1 功能定位

按照调用记录的 `createdAt` 自动清空超过保留天数的 `requestBody`。清理只更新 `requestBody = NULL`，不会修改或删除请求 ID、用户、API Key、模型、推理强度、状态、Token、费用、耗时、错误信息、`responseUsage`、`createdAt` 或 `updatedAt`。

默认启用，默认保留 300 天。后台清理器在服务启动后执行一次，之后每小时运行；单次最多分 10 批、每批 500 条进行处理。

### 14.2 接口

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

允许范围为 1–3650 天。保存设置后会异步触发一次分批清理，不阻塞管理员接口响应。

### 14.3 空间说明

普通清理和 `VACUUM` 会让 PostgreSQL 内部复用被释放的 TOAST 页面，但操作系统看到的数据库文件大小通常不会立即下降。当前磁盘空间不足时不要执行 `VACUUM FULL`。

保存请求：

```json
{
  "rules": [
    {
      "enabled": true,
      "from": "xhigh",
      "to": "high"
    },
    {
      "enabled": true,
      "from": "high",
      "to": "medium"
    }
  ]
}
```

### 13.3 字段说明

| 字段 | 类型 | 默认值 | 范围/约束 | 说明 |
| --- | --- | --- | --- | --- |
| `rules` | array | `[]` | 0-20 条 | 转换规则列表 |
| `rules[].enabled` | boolean | `true` | - | 是否启用该规则 |
| `rules[].from` | enum | - | `low`/`medium`/`high`/`xhigh` | 原始值 |
| `rules[].to` | enum | - | 同上 | 转换后值 |

### 13.4 冲突规则

后端会拒绝：

- 启用状态下，同一个 `from` 出现多条规则。
- `from` 和 `to` 相同的自转换。

冲突响应：

```json
{
  "message": "推理强度转换存在冲突",
  "conflicts": [
    {
      "from": "high",
      "count": 2,
      "rules": []
    }
  ],
  "selfTransforms": []
}
```

### 13.5 UI 注意事项

- 规则列表适合用可排序表格或行编辑器。
- 每行提供启用开关、from 下拉、to 下拉、删除按钮。
- 保存前前端也可做冲突预校验。
- 这类设置会改变用户真实请求，建议展示“原始强度”和“实际强度”的请求日志字段：`reasoningEffort`、`reasoningEffortActual`。

## 14. 统一客户价设置

### 14.1 功能定位

统一客户价是模型价格体系上的覆盖层。按 `model` 保存客户侧价格，启用后会覆盖各上游价格中的客户输入/缓存输入/输出价格和客户倍率。

### 14.2 接口

```http
GET /admin/model-prices
PUT /admin/model-prices/unified
```

`GET /admin/model-prices` 响应中包含：

```json
{
  "modelPrices": [],
  "unifiedPriceSettings": [
    {
      "model": "gpt-4.1-mini",
      "enabled": true,
      "customerInputPer1MTok": "0.20000000",
      "customerCachedInputPer1MTok": "0.05000000",
      "customerOutputPer1MTok": "0.80000000",
      "customerPriceMultiplier": "1.00000000"
    }
  ]
}
```

保存请求：

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

### 14.3 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 模型名；必须已有对应模型价格 |
| `enabled` | boolean | 是否启用该模型统一客户价 |
| `customerInputPer1MTok` | decimal string | 客户输入价，每 1M tokens |
| `customerCachedInputPer1MTok` | decimal string | 客户缓存输入价，每 1M tokens |
| `customerOutputPer1MTok` | decimal string | 客户输出价，每 1M tokens |
| `customerPriceMultiplier` | decimal string | 客户价格倍率 |

### 14.4 UI 注意事项

- 建议在模型价格页提供“统一客户价”标签页。
- 保存时后端只更新已有模型价格的模型，未定价模型会被忽略。
- 应清晰展示统一价启用后会覆盖各上游客户价，但不改变上游成本价。

## 15. IP 封禁规则设置

### 15.1 功能定位

IP 封禁规则是持久风控规则，不同于临时 IP 通知封禁。可用于明确禁止或提示某些 IP。

### 15.2 接口

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

`PUT /admin/ip-ban-rules/:ip` 请求体不需要 `ip`：

```json
{
  "mode": "notice",
  "message": "当前 IP 暂不可用",
  "reason": "异常请求"
}
```

### 15.3 字段说明

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `ip` | string | 1-128 | IP 字符串 |
| `mode` | enum | 来自后端 `ipBanModes` | 封禁模式 |
| `message` | string/null | 最多 8000 | 返回给用户的提示 |
| `reason` | string/null | 最多 1000 | 后台备注原因 |

### 15.4 UI 注意事项

- 建议在请求日志详情页提供“封禁该 IP”快捷入口。
- IP 规则列表应显示命中模式、原因、提示文案、操作人可在审计日志追踪。
- `mode` 的具体选项以前端从现有规则或后端枚举约定为准；设计稿应预留模式标签。

## 16. 业务实体类设置

以下设置不是 `SystemSetting`，但属于后台设置能力，会直接影响网关行为。

### 16.1 用户运行限制

接口：

```http
PATCH /admin/users/:id
POST /admin/users
```

字段：

| 字段 | 类型 | 范围 | 说明 |
| --- | --- | --- | --- |
| `allowedModels` | string[] | - | 用户允许调用的模型；空数组通常表示不限 |
| `rateLimitPerMinute` | number | 0-10000 | 用户每分钟限流；0 通常表示不限 |
| `concurrencyLimit` | number | 0-10000 | 用户并发限制；0 通常表示不限 |
| `tierId` | string/null | - | 用户访问等级 |
| `status` | enum | `ACTIVE`/`DISABLED`/`SUSPENDED`/`TRIAL`/`RISK_REVIEW` | 用户状态 |
| `statusReason` | string/null | 最多 500 | 状态原因 |
| `charityEnabled` | boolean | - | 是否开启公益账号能力 |
| `charityDisplayName` | string/null | 最多 80 | 公益展示名 |
| `charityKey` | string/null | 最多 300 | 公益调用 key |
| `charityIpRateLimitEnabled` | boolean | - | 公益账号是否启用 IP 限流 |
| `charityIpRateLimitPerMinute` | number | 0-10000 | 公益 IP 每分钟限流 |

UI 注意：

- 用户状态非 `ACTIVE/TRIAL` 会影响登录和调用。
- 公益账号字段建议独立折叠成“公益能力”设置区。

### 16.2 API Key 限制

接口：

```http
POST /admin/users/:id/api-keys
PATCH /admin/api-keys/:id
PATCH /admin/users/:id/api-keys/batch
```

字段：

| 字段 | 类型 | 范围 | 说明 |
| --- | --- | --- | --- |
| `status` | enum | `ACTIVE`/`DISABLED`/`REVOKED` | Key 状态 |
| `rateLimitPerMinute` | number | 1-10000 | Key 每分钟限流 |
| `totalLimitUsd` | decimal/null | 非负 | Key 总额度 |
| `expiresAt` | datetime/null | - | Key 过期时间 |
| `concurrencyLimit` | number | 0-10000 | Key 并发限制 |
| `allowedModels` | string[] | - | Key 允许模型 |
| `noticeEnabled` | boolean | - | 是否每次请求返回 Key 级通知 |
| `noticeText` | string/null | 最多 8000 | 通知文案 |
| `tags` | string[] | 最多 20，每项最多 40 | 标签 |
| `ipWhitelist` | string[] | 最多 100，每项最多 128 | IP 白名单 |
| `tierId` | string/null | - | Key 访问等级 |

规则：

- `noticeEnabled=true` 时必须有 `noticeText`。
- 过期或超过总额度的 Key 不能启用。
- 创建响应里的 `secret` 只出现一次。

### 16.3 上游 Provider 设置

接口：

```http
POST /admin/upstream-providers
PATCH /admin/upstream-providers/:id
```

字段：

| 字段 | 类型 | 默认值 | 范围/约束 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | - | 1-80，唯一 | 上游名称 |
| `baseUrl` | URL string | - | 合法 URL | 上游 API 地址 |
| `apiKey` | string | - | 创建必填，更新可空 | 默认上游 key |
| `status` | enum | `ACTIVE` | `ACTIVE`/`DISABLED` | 上游状态 |
| `priority` | number | `100` | 1-10000 | 上游优先级 |
| `timeoutMs` | number | `180000` | 5000-600000 | 上游请求超时 |
| `compactItemType` | enum | `compaction_summary` | `compaction`/`compaction_summary` | compact fallback 项类型 |

UI 注意：

- Provider 禁用会影响模型池渠道有效性。
- 重命名 Provider 会迁移价格和渠道引用。
- 删除 Provider 会删除相关 Key、价格、渠道，必须强确认。

### 16.4 上游 Key 设置

接口：

```http
POST /admin/upstream-providers/:id/keys
PATCH /admin/upstream-provider-keys/:id
```

字段：

| 字段 | 类型 | 默认值 | 范围/约束 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | - | 1-80，同 Provider 下唯一 | Key 名称 |
| `key` | string | - | 创建必填，更新可空 | 上游密钥 |
| `status` | enum | `ACTIVE` | `ACTIVE`/`DISABLED` | Key 状态 |
| `priority` | number | `100` | 1-10000 | Key 优先级 |
| `dailyLimitUsd` | decimal/null | null | 非负 | 日额度 |
| `monthlyLimitUsd` | decimal/null | null | 非负 | 月额度 |
| `providerRateLimit` | number/null | null | 0-1000000 | Provider 侧限流 |
| `disabledReason` | string/null | - | 最多 500 | 禁用原因 |
| `lastErrorCategory` | string/null | - | 最多 80 | 最近错误分类 |

### 16.5 模型池设置

接口：

```http
POST /admin/model-pools
PATCH /admin/model-pools/:id
POST /admin/model-pools/:id/channels
PATCH /admin/model-pool-channels/:id
PATCH /admin/model-pool-channels/by-provider
POST /admin/model-pools/add-provider
POST /admin/model-pools/copy-standard
```

模型池字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `model` | string | - | 模型名称 |
| `tierId` | string | standard 等级 | 访问等级 |
| `status` | enum | `ACTIVE` | 池状态 |
| `autoHealthCheckEnabled` | boolean | `true` | 是否自动检测 |
| `healthCheckEndpoint` | enum | `responses` | 检测端点 |

渠道字段：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `upstreamProvider` | string | - | 上游名称 |
| `status` | enum | `ACTIVE` | 渠道状态 |
| `priority` | number | `100` | 渠道优先级 |

渠道状态含义：

- `ACTIVE`：正常参与调度。
- `FORCED_ACTIVE`：强制可用，通常用于临时恢复。
- `DISABLED`：人工停用。
- `UNAVAILABLE`：不可用状态。
- `PENALIZED`：惩罚中。

### 16.6 访问等级设置

接口：

```http
POST /admin/access-tiers
PATCH /admin/access-tiers/:id
POST /admin/ip-access-tiers
PATCH /admin/ip-access-tiers/:id
POST /admin/dedicated-route-rules
PATCH /admin/dedicated-route-rules/:id
```

访问等级字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 等级编码，唯一，保存为小写 |
| `name` | string | 展示名 |
| `status` | enum | `ACTIVE`/`DISABLED` |
| `sortOrder` | number | 排序 |
| `description` | string/null | 说明 |

IP 等级规则字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `cidrOrIp` | string | IPv4 或 IPv4 CIDR |
| `tierId` | string | 命中的访问等级 |
| `status` | enum | `ACTIVE`/`DISABLED` |
| `priority` | number | 优先级 |
| `remark` | string/null | 备注 |

专线规则字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 规则名 |
| `targetType` | enum | `USER`/`API_KEY`/`IP` |
| `userId` | string/null | USER 目标 |
| `apiKeyId` | string/null | API_KEY 目标 |
| `ipPattern` | string/null | IP 目标 |
| `accessTierId` | string | 命中的访问等级 |
| `upstreamProvider` | string/null | 指定上游 |
| `upstreamProviderKeyId` | string/null | 指定上游 Key |
| `status` | enum | `ACTIVE`/`DISABLED` |
| `priority` | number | 优先级 |
| `startsAt` | datetime/null | 生效开始 |
| `expiresAt` | datetime/null | 过期时间 |
| `remark` | string/null | 备注 |

## 17. 设置中心页面清单

建议 UI 设计至少覆盖以下页面或标签页：

1. `设置 / 登录与邮件`
   - 邮箱验证码开关
   - 自动注册开关
   - 新用户赠金
   - SMTP 配置
   - 测试邮件

2. `设置 / 调度策略`
   - 粘性路由
   - 慢请求解绑
   - 失败惩罚
   - 评分参数

3. `设置 / 健康检查`
   - 全局检测间隔
   - 惩罚时长
   - 成功宽限
   - 跳转模型池渠道列表

4. `设置 / 风控策略`
   - PENDING 自动终止
   - 临时 IP 通知封禁
   - Redis 失败策略
   - 全局熔断
   - IP 黑名单入口

5. `设置 / 文案与通知`
   - 网关提示文案
   - 公益公告
   - 公益服务开关

6. `设置 / 告警`
   - Webhook
   - 最低告警级别
   - 推送间隔
   - 测试告警

7. `设置 / 推理强度`
   - 转换规则列表
   - 冲突校验

8. `设置 / 价格策略`
   - 统一客户价
   - 模型价格页入口

## 18. 防漏核对表

交付 UI/前端前，按下面清单确认：

- 登录与 SMTP：`GET/PUT /admin/auth-settings`、`POST /admin/auth-settings/test-email`。
- 调度：`GET/PATCH /admin/dispatch-settings`。
- 模型池健康：`PATCH /admin/model-pools/health-check`，并从 `GET /admin/model-pools` 读取范围。
- PENDING 自动终止：`GET/PUT /admin/pending-auto-terminate-settings`。
- 临时 IP 通知封禁：`GET /admin/temporary-ip-notice-bans`、`PUT /admin/temporary-ip-notice-bans/settings`、`DELETE /admin/temporary-ip-notice-bans/:ip`。
- 网关文案：`GET/PUT /admin/gateway-notice-settings`。
- Redis 失败策略：`GET/PUT /admin/redis-failure-policy-settings`。
- 全局熔断：`GET/PUT /admin/global-circuit-breaker-settings`。
- 外部告警：`GET/PUT /admin/external-alert-settings`、`POST /admin/external-alert-settings/test`。
- 公益公告：`GET/PUT /admin/charity-announcement-settings`。
- 推理强度转换：`GET/PUT /admin/reasoning-effort-transform-settings`。
- 统一客户价：`GET /admin/model-prices`、`PUT /admin/model-prices/unified`。
- IP 封禁：`GET/POST/PUT/DELETE /admin/ip-ban-rules`。
- 用户限制：`POST/PATCH /admin/users`。
- API Key 限制：`POST /admin/users/:id/api-keys`、`PATCH /admin/api-keys/:id`、`PATCH /admin/users/:id/api-keys/batch`。
- Provider 设置：`POST/PATCH /admin/upstream-providers`。
- 上游 Key 设置：`POST /admin/upstream-providers/:id/keys`、`PATCH /admin/upstream-provider-keys/:id`。
- 模型池与渠道：`POST/PATCH /admin/model-pools`、`POST/PATCH /admin/model-pool-channels`、批量 Provider 渠道操作。
- 访问等级、IP 等级、专线：`/admin/access-tiers`、`/admin/ip-access-tiers`、`/admin/dedicated-route-rules`。
