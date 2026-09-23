# Responses Lite 参数兼容

当上游 `/v1/responses` 返回 HTTP 400，且错误明确为
`X-OpenAI-Internal-Codex-Responses-Lite requires \`reasoning.context\` to be \`all_turns\`.`
时，网关在同一渠道、同一请求记录内补充 `reasoning.context: "all_turns"` 并重试一次。

- 首次请求保持原有参数；不按模型名称或供应商域名强制添加此参数。
- 保留已有 reasoning 配置及图片、工具、消息内容；不修改客户端原始对象。
- 已设置 `all_turns`、已经兼容重试、非 400 或其他错误不触发此重试。
- 仅适用于实际转发到 `/v1/responses` 的 POST 请求，不影响 compact、图片接口或 Chat Completions 上游。
- 不添加或透传 `X-OpenAI-Internal-Codex-Responses-Lite` 内部请求头。
- 第二次响应继续走正常响应、计费和错误处理；不保证修复其他上游错误或客户端附件入口问题。

本地验证：`npm run audit:responses-lite`，无需数据库、真实上游或 API 密钥。

此变更需要发布 API 服务才会在线上生效。遵循现有发布保护：提交变更后使用
`bash deploy.sh --update --backup`，不要在运行目录直接覆盖构建产物。
