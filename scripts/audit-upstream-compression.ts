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
import { probePolicyRecoveryStream } from "../apps/api/src/services/policy-recovery.ts";

type Encoding = "gzip" | "deflate" | "br";

const encodings: Encoding[] = ["gzip", "deflate", "br"];
const jsonFixture = {
  ok: true,
  message: "压缩响应已正确解码",
  nested: { value: 42 },
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
  const body = path.startsWith("/json/")
    ? JSON.stringify(jsonFixture)
    : path.startsWith("/tiny/")
      ? "ok"
    : path.startsWith("/policy-sse/")
      ? policySseFixture
      : path.startsWith("/completed-sse/")
        ? completedSseFixture
        : JSON.stringify({ payload: "x".repeat(256 * 1024) });
  const compressed = compress(encoding, Buffer.from(body, "utf8"));
  response.writeHead(200, {
    "content-type": path.includes("sse")
      ? "text/event-stream"
      : "application/json",
    "content-encoding": encoding,
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
    for (const encoding of encodings) {
      const jsonResponse = await fetch(`${origin}/json/${encoding}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      assert.equal(jsonResponse.headers.get("content-encoding"), encoding);
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
      assert.ok(Number(tinyResponse.headers.get("content-length")) > 2);
      const tinyBody = await safeReadUpstreamBody(tinyResponse, { maxBytes: 2 });
      assert.ok(!("error" in tinyBody), `${encoding} encoded length was treated as decoded length`);
      assert.equal(tinyBody.text, "ok");

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

    console.log(JSON.stringify({
      ok: true,
      encodings,
      jsonDecodeCases: encodings.length,
      encodedLengthCases: encodings.length,
      compressedSsePolicyCases: encodings.length,
      compressedSseCompletionCases: encodings.length,
      decodedSizeLimitCases: encodings.length,
      invalidEncodingCases: 1,
      removedHeaders: ["content-encoding", "content-length"],
    }, null, 2));
  } finally {
    server.close();
    await once(server, "close");
  }
}

function compress(encoding: Encoding, value: Buffer) {
  if (encoding === "gzip") return gzipSync(value);
  if (encoding === "deflate") return deflateSync(value);
  return brotliCompressSync(value);
}
