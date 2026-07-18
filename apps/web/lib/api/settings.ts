import http from "../http";

export interface GatewayNoticeSettings {
  userConcurrencyMessage: string;
  keyConcurrencyMessage: string;
  userRateLimitMessage: string;
  keyRateLimitMessage: string;
  charityIpRateLimitMessage: string;
  modelUnavailableMessage: string;
  missingUsageMessage: string;
  staleResponsesContextMessage: string;
  invalidEncryptedContentMessage: string;
  upstreamBalanceInsufficientMessage: string;
}

export interface RedisFailurePolicySettings {
  policy: "fail-open" | "fail-closed" | "degraded";
  degradedAdminBypassEnabled: boolean;
  degradedUserIds: string[];
  message: string;
}

export interface GlobalCircuitBreakerSettings {
  enabled: boolean;
  allowAdmins: boolean;
  allowedUserIds: string[];
  message: string;
}

export interface WhitelistFilterSettings {
  enabled: boolean;
  secret: string;
  secretVersion: string;
  noticeText: string;
  applyToAdmins: boolean;
}

export interface BannedUserNoticeSettings {
  noticeText: string;
}

export interface TemporaryIpNoticeBanSettings {
  enabled: boolean;
  threshold: number;
  windowSeconds: number;
  banSeconds: number;
  message: string;
  minBanSeconds?: number;
  maxBanSeconds?: number;
  minThreshold?: number;
  maxThreshold?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
}

export interface PendingAutoTerminateSettings {
  enabled: boolean;
  timeoutSeconds: number;
  message: string;
  minTimeoutSeconds?: number;
  maxTimeoutSeconds?: number;
}

export interface CharityAnnouncementSettings {
  serviceEnabled: boolean;
  serviceDisabledMessage: string;
  enabled: boolean;
  frequency: "every_visit" | "interval";
  intervalHours: number;
  minIntervalHours?: number;
  maxIntervalHours?: number;
  title: string;
  content: string;
}

export interface ReasoningEffortTransformRule {
  enabled: boolean;
  from: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  to: "none" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface ReasoningEffortTransformSettings {
  rules: ReasoningEffortTransformRule[];
  gpt56Force: {
    enabled: boolean;
    effort: ReasoningEffortTransformRule["to"];
  };
}

export interface RequestBodyRetentionSettings {
  enabled: boolean;
  retentionDays: number;
}

export interface ImageGenerationToolSettings {
  routingModel: string;
}

export type ImageProxyMode = "direct" | "tencent_cos";

export interface ImageProxySettings {
  mode: ImageProxyMode;
  enabledModels: string[];
}

export interface ImageProxyHealthCheck {
  ok: boolean;
  mode: ImageProxyMode;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
    statusCode?: number;
  }>;
}

export interface AuthSettings {
  emailCodeLoginEnabled: boolean;
  emailCodeAutoRegisterEnabled: boolean;
  newUserBonusUsd: string;
  emailCodeTtlSeconds: number;
  emailCodeCooldownSeconds: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  smtpConfigured: boolean;
}

export interface AuthSettingsInput extends Omit<AuthSettings, "smtpConfigured"> {
  smtpPassword?: string;
}

export type IpBanMode = "error" | "notice";

export interface IpBanRule {
  ip: string;
  mode: IpBanMode;
  message: string;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IpBanRuleInput {
  ip: string;
  mode: IpBanMode;
  message?: string | null;
  reason?: string | null;
}

export interface BannedUserSummary {
  id: string;
  email: string;
  statusReason: string | null;
  displayGroup: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    apiKeys: number;
    apiRequests: number;
  };
}

export interface RiskCenterData {
  ipBanRules: IpBanRule[];
  temporaryIpNoticeBans: Array<{ ip: string; message: string; ttlSeconds: number }>;
  temporaryIpNoticeBanSettings: TemporaryIpNoticeBanSettings;
  pendingAutoTerminateSettings: PendingAutoTerminateSettings;
  gatewayNoticeSettings: GatewayNoticeSettings;
  redisFailurePolicySettings: RedisFailurePolicySettings;
  globalCircuitBreakerSettings: GlobalCircuitBreakerSettings;
  whitelistFilterSettings: WhitelistFilterSettings;
  bannedUserNoticeSettings: BannedUserNoticeSettings;
  bannedUsers: BannedUserSummary[];
  charityAnnouncementSettings: CharityAnnouncementSettings;
  reasoningEffortTransformSettings: ReasoningEffortTransformSettings;
  counters: {
    pendingRequests: number;
    failedRequests24h: number;
    noticeRequests24h: number;
    rateLimitedRequests24h: number;
  };
  checkedAt: string;
}

export interface AuditLog {
  id: string;
  adminUserId: string | null;
  adminEmail: string | null;
  action: string;
  method: string;
  path: string;
  outcome: "success" | "failure" | "unknown";
  statusCode: number | null;
  targetType: string | null;
  targetId: string | null;
  requestBody: unknown;
  responseBody: unknown;
  errorMessage: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogParams {
  q?: string;
  action?: string;
  outcome?: "success" | "failure" | "unknown";
  targetType?: string;
  targetId?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  take?: number;
}

export async function getRiskCenter() {
  const response = await http.get<RiskCenterData>("/admin/risk-center");
  return response.data;
}

export async function getTemporaryIpNoticeBanSettings() {
  const response = await http.get<{ settings: TemporaryIpNoticeBanSettings }>("/admin/temporary-ip-notice-bans");
  return response.data.settings;
}

export async function updateTemporaryIpNoticeBanSettings(input: Partial<TemporaryIpNoticeBanSettings>) {
  const response = await http.put<{ settings: TemporaryIpNoticeBanSettings }>("/admin/temporary-ip-notice-bans/settings", input);
  return response.data.settings;
}

export async function saveIpBanRule(input: IpBanRuleInput) {
  const response = await http.post<{ rule: IpBanRule; rules: IpBanRule[] }>("/admin/ip-ban-rules", input);
  return response.data;
}

export async function updateIpBanRule(ip: string, input: Omit<IpBanRuleInput, "ip">) {
  const response = await http.put<{ rule: IpBanRule; rules: IpBanRule[] }>(`/admin/ip-ban-rules/${encodeURIComponent(ip)}`, input);
  return response.data;
}

export async function deleteIpBanRule(ip: string) {
  const response = await http.delete<{ ip: string; deleted: boolean; rules: IpBanRule[] }>(`/admin/ip-ban-rules/${encodeURIComponent(ip)}`);
  return response.data;
}

export async function updatePendingAutoTerminateSettings(input: Partial<PendingAutoTerminateSettings>) {
  const response = await http.put<{ settings: PendingAutoTerminateSettings }>("/admin/pending-auto-terminate-settings", input);
  return response.data.settings;
}

export async function getGatewayNoticeSettings() {
  const response = await http.get<{ settings: GatewayNoticeSettings; defaults: GatewayNoticeSettings }>("/admin/gateway-notice-settings");
  return response.data;
}

export async function updateGatewayNoticeSettings(input: Partial<GatewayNoticeSettings>) {
  const response = await http.put<{ settings: GatewayNoticeSettings; defaults: GatewayNoticeSettings }>("/admin/gateway-notice-settings", input);
  return response.data;
}

export async function getRedisFailurePolicySettings() {
  const response = await http.get<{ settings: RedisFailurePolicySettings; defaults: RedisFailurePolicySettings; policies: RedisFailurePolicySettings["policy"][] }>("/admin/redis-failure-policy-settings");
  return response.data;
}

export async function updateRedisFailurePolicySettings(input: Partial<RedisFailurePolicySettings>) {
  const response = await http.put<{ settings: RedisFailurePolicySettings }>("/admin/redis-failure-policy-settings", input);
  return response.data.settings;
}

export async function getGlobalCircuitBreakerSettings() {
  const response = await http.get<{ settings: GlobalCircuitBreakerSettings; defaults: GlobalCircuitBreakerSettings }>("/admin/global-circuit-breaker-settings");
  return response.data;
}

export async function updateGlobalCircuitBreakerSettings(input: Partial<GlobalCircuitBreakerSettings>) {
  const response = await http.put<{ settings: GlobalCircuitBreakerSettings }>("/admin/global-circuit-breaker-settings", input);
  return response.data.settings;
}

export async function updateWhitelistFilterSettings(input: Partial<WhitelistFilterSettings>) {
  const response = await http.put<{ settings: WhitelistFilterSettings }>("/admin/whitelist-filter-settings", input);
  return response.data.settings;
}

export async function rotateWhitelistFilterSecret() {
  const response = await http.post<{ settings: WhitelistFilterSettings }>("/admin/whitelist-filter-settings/rotate-secret");
  return response.data.settings;
}

export async function updateBannedUserNoticeSettings(input: Partial<BannedUserNoticeSettings>) {
  const response = await http.put<{ settings: BannedUserNoticeSettings }>("/admin/banned-user-notice-settings", input);
  return response.data.settings;
}

export async function getAuthSettings() {
  const response = await http.get<{ settings: AuthSettings }>("/admin/auth-settings");
  return response.data.settings;
}

export async function updateAuthSettings(input: AuthSettingsInput) {
  const response = await http.put<{ settings: AuthSettings }>("/admin/auth-settings", input);
  return response.data.settings;
}

export async function testAuthEmail(input: AuthSettingsInput & { testEmail: string }) {
  const response = await http.post<{ ok: true }>("/admin/auth-settings/test-email", input);
  return response.data;
}

export async function getCharityAnnouncementSettings() {
  const response = await http.get<{ settings: CharityAnnouncementSettings }>("/admin/charity-announcement-settings");
  return response.data.settings;
}

export async function updateCharityAnnouncementSettings(input: CharityAnnouncementSettings) {
  const response = await http.put<{ settings: CharityAnnouncementSettings }>("/admin/charity-announcement-settings", input);
  return response.data.settings;
}

export async function getReasoningEffortTransformSettings() {
  const response = await http.get<{ settings: ReasoningEffortTransformSettings; options: ReasoningEffortTransformRule["from"][] }>("/admin/reasoning-effort-transform-settings");
  return response.data;
}

export async function updateReasoningEffortTransformSettings(input: ReasoningEffortTransformSettings) {
  const response = await http.put<{ settings: ReasoningEffortTransformSettings }>("/admin/reasoning-effort-transform-settings", input);
  return response.data.settings;
}

export async function getRequestBodyRetentionSettings() {
  const response = await http.get<{
    settings: RequestBodyRetentionSettings;
    defaults: RequestBodyRetentionSettings;
    limits: {
      minRetentionDays: number;
      maxRetentionDays: number;
    };
  }>("/admin/request-body-retention-settings");
  return response.data;
}

export async function updateRequestBodyRetentionSettings(
  input: RequestBodyRetentionSettings,
) {
  const response = await http.put<{
    settings: RequestBodyRetentionSettings;
    defaults: RequestBodyRetentionSettings;
    limits: {
      minRetentionDays: number;
      maxRetentionDays: number;
    };
  }>("/admin/request-body-retention-settings", input);
  return response.data.settings;
}

export async function getImageGenerationToolSettings() {
  const response = await http.get<{
    settings: ImageGenerationToolSettings;
    defaults: ImageGenerationToolSettings;
  }>("/admin/image-generation-tool-settings");
  return response.data;
}

export async function updateImageGenerationToolSettings(input: ImageGenerationToolSettings) {
  const response = await http.put<{
    settings: ImageGenerationToolSettings;
    defaults: ImageGenerationToolSettings;
  }>("/admin/image-generation-tool-settings", input);
  return response.data.settings;
}

export async function getImageProxySettings() {
  const response = await http.get<{
    settings: ImageProxySettings;
    defaults: ImageProxySettings;
    models: string[];
  }>("/admin/image-proxy-settings");
  return response.data;
}

export async function updateImageProxySettings(input: ImageProxySettings) {
  const response = await http.put<{ settings: ImageProxySettings; defaults: ImageProxySettings }>("/admin/image-proxy-settings", input);
  return response.data.settings;
}

export async function checkImageProxySettings() {
  const response = await http.post<{ result: ImageProxyHealthCheck }>("/admin/image-proxy-settings/check");
  return response.data.result;
}

export async function getAuditLogs(params: AuditLogParams = {}) {
  const response = await http.get<{ logs: AuditLog[]; nextCursor: string | null }>("/admin/audit-logs", {
    params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== "")),
  });
  return response.data;
}
