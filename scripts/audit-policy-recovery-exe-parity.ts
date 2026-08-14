import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  buildPolicyRecoveryBody,
  createPolicyRecoveryContext,
  detectPolicyBlock,
  probePolicyRecoveryStream,
  sanitizePolicyResponseBody,
  sanitizePolicyResponseHeaders,
  sanitizePolicySseText,
} from "../apps/api/src/services/policy-recovery.ts";
import {
  defaultPolicyRecoverySettings,
  type PolicyRecoverySnapshot,
} from "../apps/api/src/services/policy-recovery-settings.ts";

const require = createRequire(import.meta.url);
const exe = require("./fixtures/leila-restored-1.0.2/context-proxy.js");
const lingjie = require("./fixtures/leila-restored-1.0.2/lingjie-context.js");
const differences: unknown[] = [];
const buf = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value));

async function main() {
const jsonCases = [
  { name: "codex header", status: 403, headers: { "x-codex-error-info": "cyberPolicy" }, body: { error: { message: "blocked" } } },
  { name: "trusted header", status: 403, headers: { "x-verification-recommendation": "trusted_access_for_cyber" }, body: {} },
  { name: "moderation", status: 200, headers: {}, body: { moderation_response: { blocked: true, metadata: { protection_type: "cyber", safety_limited: true } } } },
  { name: "moderation uppercase metadata", status: 200, headers: {}, body: { moderation_response: { blocked: true, Metadata: { protectionType: "cyber", safetyLimited: true } } } },
  { name: "policy code", status: 400, headers: {}, body: { error: { code: "policy_violation" } } },
  { name: "strong structured text", status: 400, headers: {}, body: { error: { message: "Request was blocked by our safety system" } } },
  { name: "codex trusted body is not direct signal", status: 403, headers: {}, body: { codexErrorInfo: "trusted_access_for_cyber" } },
  { name: "ordinary text", status: 400, headers: {}, body: { error: { message: "ordinary invalid request" } } },
];
for (const item of jsonCases) {
  const exeSignal = exe.detectPolicyBlockJson(buf(item.body), item.status, item.headers);
  const gatewaySignal = detectPolicyBlock({
    statusCode: item.status,
    headers: item.headers,
    body: item.body,
    source: "json",
  });
  compareSignal("json-detect", item.name, exeSignal, gatewaySignal);
}

const sseCases = [
  { name: "failed policy", status: 200, text: "event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"policy_violation\"}}}\n\n" },
  { name: "moderation", status: 200, text: "data: {\"moderation_response\":{\"blocked\":true,\"metadata\":{\"protection_type\":\"cyber\",\"safety_limited\":true}}}\n\n" },
  { name: "trusted whitespace context", status: 200, text: "event: content_block\ndata: {\"error\":{\"message\":\"request trusted   access due safety blocked\"}}\n\n" },
  { name: "content block context", status: 200, text: "event: content_block\ndata: {\"type\":\"content_block\",\"message\":\"网络安全策略拦截\"}\n\n" },
  { name: "codex trusted body is not direct signal", status: 200, text: "event: response.failed\ndata: {\"codexErrorInfo\":\"trusted_access_for_cyber\"}\n\n" },
  { name: "substantive then block", status: 200, text: "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\nevent: response.failed\ndata: {\"error\":{\"code\":\"policy_violation\"}}\n\n" },
  { name: "done", status: 200, text: "data: [DONE]\n\n" },
];
for (const item of sseCases) {
  const headers = { "content-type": "text/event-stream" };
  const exeSignal = exe.detectPolicyBlockSse(buf(item.text), item.status, headers);
  const gatewaySignal = detectPolicyBlock({
    statusCode: item.status,
    headers,
    body: item.text,
    source: "sse",
  });
  compareSignal("sse-detect", item.name, exeSignal, gatewaySignal);
}

const bodyCases = [
  { name: "verification scalar", body: { verification: "trusted_access_for_cyber", keep: 1 } },
  { name: "verification mixed", body: { verification: { recommendation: "trusted_access_for_cyber", keep: "yes" }, keep: 1 } },
  { name: "moderation", body: { moderation_response: { blocked: true, metadata: { protection_type: "cyber", safety_limited: true } }, keep: 1 } },
  { name: "nested array", body: { items: [{ codexErrorInfo: "cyberPolicy", keep: 1 }, "trusted_access_for_cyber"], keep: 2 } },
];
for (const item of bodyCases) {
  const exeBody = JSON.parse(exe.sanitizeJsonBody(buf(item.body)).toString());
  const gatewayBody = sanitizePolicyResponseBody(item.body);
  compareValue("json-sanitize", item.name, exeBody, gatewayBody);
}

const headerCases = [
  { "x-codex-error-info": "cyberPolicy", "x-test": "ok", "content-length": "12", "content-encoding": "gzip" },
  { "x-verification-recommendation": "trusted_access_for_cyber", "openai-verification-recommendation": "trusted_access_for_cyber", "x-test": "ok" },
];
for (const input of headerCases) {
  const exeHeaders = sortRecord(exe.sanitizeResponseHeaders(input));
  const gatewayHeaders = sortRecord(Object.fromEntries(sanitizePolicyResponseHeaders(new Headers(input)).entries()));
  compareValue("header-sanitize", JSON.stringify(input), exeHeaders, gatewayHeaders);
}

for (const item of sseCases) {
  const exeBody = exe.sanitizeSseBody(buf(item.text)).toString();
  const gatewayBody = sanitizePolicySseText(item.text);
  compareValue("sse-sanitize", item.name, exeBody, gatewayBody);
}

const baseInstructions = lingjie.renderProxyContext(lingjie.DEFAULT_EDITABLE_SCOPE, true);
const paritySettings: PolicyRecoverySnapshot = {
  ...defaultPolicyRecoverySettings,
  masterEnabled: true,
  activeProfile: "layered-v1",
  activeProfileName: "V1 多文件分层版",
  baseInstructions,
  mergedSha256: createHash("sha256").update(baseInstructions, "utf8").digest("hex"),
  mergedBytes: Buffer.byteLength(baseInstructions, "utf8"),
  estimatedTokens: Math.ceil(Buffer.byteLength(baseInstructions, "utf8") / 4),
};
const exeSettings = {
  forceModel: false,
  model: "fixture-model",
  extraScope: lingjie.DEFAULT_EDITABLE_SCOPE,
  chatInstructionRole: "developer",
};
const authorization = {
  authorized: true,
  trigger: lingjie.ACTIVATION_PHRASE,
  exclusion: null,
  scope: lingjie.DEFAULT_EDITABLE_SCOPE.join("\n"),
};
const injectionCases = [
  { endpoint: "/v1/responses", body: { model: "fixture-model", input: "hi", instructions: "original" } },
  { endpoint: "/v1/responses/compact", body: { model: "fixture-model", input: "hi", instructions: ["original"] } },
  { endpoint: "/v1/chat/completions", body: { model: "fixture-model", messages: [{ role: "user", content: "hi" }] } },
];
for (const item of injectionCases) {
  const context = createPolicyRecoveryContext(structuredClone(item.body), paritySettings);
  let exeBody = exe.buildPayload(structuredClone(item.body), exeSettings, authorization, 0, item.endpoint);
  let gatewayBody = buildPolicyRecoveryBody({
    context,
    endpoint: item.endpoint,
    recoveryAttempt: 0,
    provider: "fixture-provider",
    model: "fixture-model",
  });
  compareValue("initial-payload", item.endpoint, exeBody, gatewayBody);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    exeBody = exe.buildPolicyRetryPayload(exeBody, item.endpoint, authorization, "developer", attempt);
    gatewayBody = buildPolicyRecoveryBody({
      context,
      endpoint: item.endpoint,
      recoveryAttempt: attempt,
      signal: { source: "sse", code: "fixture", summary: `SIGNAL_${attempt}` },
      provider: "fixture-provider",
      model: "fixture-model",
    });
    compareValue("retry-payload", `${item.endpoint}#${attempt}`, exeBody, gatewayBody);
  }
}

const storageDirectory = await mkdtemp(join(tmpdir(), "policy-recovery-parity-"));
const manager = new exe.ContextProxyManager({
  storageDirectory,
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  },
  onLog: () => undefined,
});
try {
  const probeCases = [
    { name: "policy signal", chunks: ["event: response.failed\ndata: {\"error\":{\"message\":\"Request was blocked by our safety system\"}}\n\n"] },
    { name: "completed", chunks: ["event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n"] },
    { name: "done", chunks: ["data: [DONE]\n\n"] },
    { name: "indeterminate", chunks: ["event: response.created\ndata: {\"type\":\"response.created\"}\n\n"] },
    { name: "substantive boundary", chunks: ["event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\n", "event: response.failed\ndata: {\"error\":{\"message\":\"Request was blocked by our safety system\"}}\n\n"] },
  ];
  for (const item of probeCases) {
    const exeResult = await probeExeStream(manager, item.chunks);
    const gatewayResult = await probeGatewayStream(item.chunks);
    compareValue("sse-probe", item.name, Boolean(exeResult.retry), Boolean(gatewayResult.signal));
    if (item.name === "indeterminate") {
      compareValue("sse-probe-signal", item.name, exeResult.signal, gatewayResult.signal?.summary ?? null);
    }
  }
} finally {
  manager.httpAgent.destroy();
  manager.httpsAgent.destroy();
  await rm(storageDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  differenceCount: differences.length,
  checked: {
    jsonDetection: jsonCases.length,
    sseDetection: sseCases.length,
    jsonSanitization: bodyCases.length,
    headerSanitization: headerCases.length,
    sseSanitization: sseCases.length,
    payloadStates: injectionCases.length * 4,
    sseProbeStates: 5,
  },
  differences,
}, null, 2));
if (differences.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function compareSignal(kind: string, name: string, exeValue: unknown, gatewayValue: unknown) {
  compareValue(kind, name, Boolean(exeValue), Boolean(gatewayValue));
}

function compareValue(kind: string, name: string, exeValue: unknown, gatewayValue: unknown) {
  if (JSON.stringify(exeValue) !== JSON.stringify(gatewayValue)) {
    differences.push({ kind, name, exe: exeValue, gateway: gatewayValue });
  }
}

function sortRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

async function probeExeStream(managerInstance: any, chunks: string[]) {
  const source = new PassThrough();
  const resultPromise = managerInstance.probeSseResponse(
    { stream: source, statusCode: 200, headers: { "content-type": "text/event-stream" } },
    { authorized: true },
  );
  for (const chunk of chunks) source.write(Buffer.from(chunk));
  source.end();
  return resultPromise;
}

async function probeGatewayStream(chunks: string[]) {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  return probePolicyRecoveryStream(response, defaultPolicyRecoverySettings.sseProbeBytes);
}
