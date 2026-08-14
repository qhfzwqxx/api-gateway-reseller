import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  brotliCompressSync,
  deflateSync,
  gzipSync,
} from "node:zlib";
import {
  getForwardableUpstreamResponseHeaders,
  safeReadUpstreamBody,
} from "../apps/api/src/services/proxy-request-utils.ts";
import {
  isProtectedCompactRequest,
  prepareCompactEndpointRequestBody,
} from "../apps/api/src/services/compact-request-utils.ts";
import {
  buildPolicyRecoveryBody,
  createPolicyRecoveryContext,
  probePolicyRecoveryStream,
  sanitizePolicyResponseBody,
  supportsPolicyRecovery,
} from "../apps/api/src/services/policy-recovery.ts";
import {
  createPolicyRecoverySnapshot,
  defaultPolicyRecoverySettings,
} from "../apps/api/src/services/policy-recovery-settings.ts";

type Encoding = "identity" | "gzip" | "deflate" | "br";

const encodings: Encoding[] = ["identity", "gzip", "deflate", "br"];
const jsonFixture = {
  ok: true,
  message: "压缩响应已正确解码",
  nested: { value: 42 },
};
const compactEncryptedContent = "fixture-compact-encrypted-content";
const compactRequestFixture = {
  model: "fixture-model",
  input: [
    { role: "user", content: [{ type: "input_text", text: "请压缩当前会话" }] },
    {
      type: "compaction_summary",
      encrypted_content: "fixture-previous-encrypted-content",
    },
    {
      type: "compaction_trigger",
      encrypted_content: "fixture-trigger-encrypted-content",
    },
  ],
  instructions: ["caller-original-instructions"],
};
const compactResponseFixture = {
  id: "resp_compact_fixture",
  object: "response.compaction",
  output: [
    {
      id: "cmp_fixture",
      type: "compaction_summary",
      encrypted_content: compactEncryptedContent,
      summary: [{ type: "summary_text", text: "压缩后的连续会话摘要" }],
    },
  ],
  openai_verification_recommendation: "trusted_access_for_cyber",
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};
const policySseFixture = [
  "event: response.failed",
  'data: {"type":"response.failed","response":{"error":{"message":"Request was blocked by our safety system"}}}',
  "",
  "",
].join("\n");
const completedSseFixture = [
  "event: response.completed",
  'data: {"type":"response.completed"}',
  "",
  "",
].join("\n");

const server = createServer((request, response) => {
  const path = request.url ?? "/";
  const encoding = encodings.find((candidate) => path.endsWith(`/${candidate}`));
  if (path === "/invalid-gzip") {
    response.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "gzip",
    });
    response.end('{"ok":true}');
    return;
  }
  if (!encoding) {
    response.writeHead(404).end();
    return;
  }
  const body = path.startsWith("/compact-json/")
    ? JSON.stringify(compactResponseFixture)
    : path.startsWith("/error/")
      ? JSON.stringify({
          error: {
            message: "compressed upstream fixture error",
            type: "upstream_fixture_error",
          },
        })
    : path.startsWith("/json/")
      ? JSON.stringify(jsonFixture)
    : path.startsWith("/tiny/")
      ? "ok"
      : path.startsWith("/policy-sse/")
        ? policySseFixture
        : path.startsWith("/completed-sse/")
          ? completedSseFixture
          : JSON.stringify({ payload: "x".repeat(256 * 1024) });
  const compressed = compress(encoding, Buffer.from(body, "utf8"));
  response.writeHead(path.startsWith("/error/") ? 422 : 200, {
    "content-type": path.includes("sse")
      ? "text/event-stream"
      : "application/json",
    ...(encoding === "identity" ? {} : { "content-encoding": encoding }),
    "content-length": String(compressed.byteLength),
    "x-compression-fixture": encoding,
  });
  response.end(compressed);
});

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const policyCompactPayloadStates = assertPolicyCompactPayloadChain();
    for (const encoding of encodings) {
      const jsonResponse = await fetch(`${origin}/json/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      assert.equal(
        jsonResponse.headers.get("content-encoding"),
        encoding === "identity" ? null : encoding,
      );
      const jsonBody = await safeReadUpstreamBody(jsonResponse, { maxBytes: 1024 * 1024 });
      assert.ok(!("error" in jsonBody), `${encoding} JSON response failed to decode`);
      assert.deepEqual(jsonBody.json, jsonFixture);

      const forwardableHeaders = Object.fromEntries(
        getForwardableUpstreamResponseHeaders(jsonResponse.headers),
      );
      assert.equal(forwardableHeaders["content-encoding"], undefined);
      assert.equal(forwardableHeaders["content-length"], undefined);
      assert.equal(forwardableHeaders["x-compression-fixture"], encoding);

      const tinyResponse = await fetch(`${origin}/tiny/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      assert.equal(
        Number(tinyResponse.headers.get("content-length")) > 2,
        encoding !== "identity",
      );
      const tinyBody = await safeReadUpstreamBody(tinyResponse, { maxBytes: 2 });
      assert.ok(!("error" in tinyBody), `${encoding} encoded length was treated as decoded length`);
      assert.equal(tinyBody.text, "ok");

      const compactResponse = await fetch(`${origin}/compact-json/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      const compactBody = await safeReadUpstreamBody(compactResponse, {
        maxBytes: 1024 * 1024,
      });
      assert.ok(!("error" in compactBody), `${encoding} compact response failed to decode`);
      assert.deepEqual(compactBody.json, compactResponseFixture);
      assert.equal(
        readCompactEncryptedContent(compactBody.json),
        compactEncryptedContent,
      );
      const sanitizedCompactBody = sanitizePolicyResponseBody(compactBody.json);
      assert.equal(
        readCompactEncryptedContent(sanitizedCompactBody),
        compactEncryptedContent,
      );

      const errorResponse = await fetch(`${origin}/error/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      assert.equal(errorResponse.status, 422);
      const errorBody = await safeReadUpstreamBody(errorResponse, {
        maxBytes: 1024 * 1024,
      });
      assert.ok(!("error" in errorBody), `${encoding} error response failed to decode`);
      assert.deepEqual(errorBody.json, {
        error: {
          message: "compressed upstream fixture error",
          type: "upstream_fixture_error",
        },
      });

      const policyResponse = await fetch(`${origin}/policy-sse/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      const policyProbe = await probePolicyRecoveryStream(policyResponse, 256 * 1024);
      assert.equal(policyProbe.signal?.code, "policy_text_block");
      assert.equal(policyProbe.text, policySseFixture);

      const completedResponse = await fetch(`${origin}/completed-sse/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      const completedProbe = await probePolicyRecoveryStream(completedResponse, 256 * 1024);
      assert.equal(completedProbe.signal, null);
      assert.equal(completedProbe.response.headers.get("content-encoding"), null);
      assert.equal(completedProbe.response.headers.get("content-length"), null);
      assert.equal(
        completedProbe.response.headers.get("x-compression-fixture"),
        encoding,
      );
      assert.equal(await completedProbe.response.text(), completedSseFixture);

      const oversizedResponse = await fetch(`${origin}/oversized/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      const oversizedBody = await safeReadUpstreamBody(oversizedResponse, { maxBytes: 4096 });
      assert.ok("error" in oversizedBody, `${encoding} oversized decoded body was accepted`);
      assert.equal(oversizedBody.error.statusCode, 502);
    }

    const invalidResponse = await fetch(`${origin}/invalid-gzip`, {
      headers: { "Accept-Encoding": "identity" },
    });
    const invalidBody = await safeReadUpstreamBody(invalidResponse, { maxBytes: 1024 * 1024 });
    assert.ok("error" in invalidBody, "invalid gzip response was accepted");

    const hopByHopHeaders = Object.fromEntries(
      getForwardableUpstreamResponseHeaders(
        new Headers({
          connection: "keep-alive",
          "content-encoding": "gzip",
          "content-length": "10",
          "transfer-encoding": "chunked",
          "x-preserved": "yes",
        }),
      ),
    );
    assert.deepEqual(hopByHopHeaders, { "x-preserved": "yes" });

    console.log(JSON.stringify({
      ok: true,
      encodings,
      jsonDecodeCases: encodings.length,
      encodedLengthCases: encodings.length,
      compressedCompactJsonCases: encodings.length,
      compressedErrorResponseCases: encodings.length,
      sanitizedCompactItemCases: encodings.length,
      compressedSsePolicyCases: encodings.length,
      compressedSseCompletionCases: encodings.length,
      decodedSizeLimitCases: encodings.length,
      invalidEncodingCases: 1,
      policyCompactPayloadStates,
      removedHeaders: [
        "connection",
        "content-encoding",
        "content-length",
        "transfer-encoding",
      ],
    }, null, 2));
  } finally {
    server.close();
    await once(server, "close");
  }
}

function assertPolicyCompactPayloadChain() {
  const settings = createPolicyRecoverySnapshot({
    ...defaultPolicyRecoverySettings,
    masterEnabled: true,
  });
  assert.equal(supportsPolicyRecovery("/v1/responses/compact", "POST", false), true);
  assert.match(settings.baseInstructions, /compact|压缩/iu);
  const context = createPolicyRecoveryContext(
    structuredClone(compactRequestFixture),
    settings,
  );
  const originalBody = structuredClone(context.originalBody);
  assert.equal(
    isProtectedCompactRequest({
      endpoint: "/v1/responses",
      requestBody: compactRequestFixture,
    }),
    true,
  );
  assert.equal(
    isProtectedCompactRequest({
      endpoint: "/v1/responses",
      requestBody: { input: [{ role: "user", content: "normal request" }] },
    }),
    false,
  );
  assert.equal(
    isProtectedCompactRequest({ endpoint: "/v1/responses/compact" }),
    true,
  );
  assert.equal(
    isProtectedCompactRequest({
      endpoint: "/v1/responses",
      responseUsage: { gatewayCompactKind: "fallback" },
    }),
    true,
  );

  const compactEndpointBody = prepareCompactEndpointRequestBody(
    compactRequestFixture,
  );
  assert.ok(compactEndpointBody && typeof compactEndpointBody === "object");
  assert.ok(!Array.isArray(compactEndpointBody));
  assert.equal("stream" in compactEndpointBody, false);
  assert.deepEqual(
    (compactEndpointBody as Record<string, unknown>).input,
    compactRequestFixture.input.filter(
      (item) => item.type !== "compaction_trigger",
    ),
  );

  for (let recoveryAttempt = 0; recoveryAttempt <= 3; recoveryAttempt += 1) {
    const body = buildPolicyRecoveryBody({
      context,
      endpoint: "/v1/responses/compact",
      recoveryAttempt,
      signal: recoveryAttempt > 0
        ? {
            source: "sse",
            code: "fixture-policy-signal",
            summary: `FIXTURE_SIGNAL_${recoveryAttempt}`,
          }
        : null,
      provider: "fixture-provider",
      model: "fixture-model",
    });
    assert.deepEqual(body.input, compactRequestFixture.input);
    assert.ok(Array.isArray(body.instructions));
    assert.equal(
      body.instructions.filter((item) => item === settings.baseInstructions).length,
      1,
    );
    assert.equal(
      body.instructions.filter((item) => item === "caller-original-instructions").length,
      1,
    );
    assert.equal(
      body.instructions.filter(
        (item) => typeof item === "string" && item.includes("[GPT56_POLICY_RETRY_V2]"),
      ).length,
      recoveryAttempt > 0 ? 1 : 0,
    );
    assert.equal(
      body.input.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          item.type === "compaction_trigger",
      ).length,
      1,
    );
  }

  assert.deepEqual(context.originalBody, originalBody);
  return 4;
}

function readCompactEncryptedContent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = (value as Record<string, unknown>).output;
  if (!Array.isArray(output)) return null;
  const compactItem = output.find(
    (item) => item && typeof item === "object" && !Array.isArray(item)
      && (item as Record<string, unknown>).type === "compaction_summary",
  );
  if (!compactItem || typeof compactItem !== "object") return null;
  const encryptedContent = (compactItem as Record<string, unknown>).encrypted_content;
  return typeof encryptedContent === "string" ? encryptedContent : null;
}

function compress(encoding: Encoding, value: Buffer) {
  if (encoding === "identity") return value;
  if (encoding === "gzip") return gzipSync(value);
  if (encoding === "deflate") return deflateSync(value);
  return brotliCompressSync(value);
}
