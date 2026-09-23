import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { buildResponsesLiteRetryBody } from "../apps/api/src/services/responses-lite-compatibility.ts";
import {
  buildUpstreamBody,
  type ProxyBody,
} from "../apps/api/src/services/proxy-request-utils.ts";

const message =
  "X-OpenAI-Internal-Codex-Responses-Lite requires `reasoning.context` to be `all_turns`.";
const errorBody = {
  error: {
    code: "unsupported_value",
    message,
    param: "reasoning.context",
    type: "invalid_request_error",
  },
};
const defaults = {
  endpoint: "/v1/responses",
  method: "POST",
  statusCode: 400,
  errorText: JSON.stringify(errorBody),
};
const input = [
  {
    role: "user",
    content: [
      { type: "input_text", text: "Describe this image" },
      { type: "input_image", image_url: "data:image/png;base64,fixture" },
    ],
  },
];

for (const reasoning of [
  undefined,
  null,
  {},
  { context: "auto" },
  { context: "current_turn", effort: "high", summary: "auto" },
]) {
  const body: ProxyBody = Object.freeze({
    model: "fixture-model",
    stream: true,
    input,
    tools: [
      {
        type: "function",
        name: "fixture_tool",
        parameters: { type: "object" },
      },
    ],
    store: false,
    include: ["reasoning.encrypted_content"],
    reasoning: reasoning && Object.freeze(reasoning),
  });
  const original = structuredClone(body);
  const retried = buildResponsesLiteRetryBody({ ...defaults, body });
  assert.ok(retried);
  assert.deepEqual(retried.reasoning, { ...reasoning, context: "all_turns" });
  assert.strictEqual(retried.input, input);
  assert.equal(retried.stream, true);
  assert.deepEqual(retried, {
    ...original,
    reasoning: { ...reasoning, context: "all_turns" },
  });
  assert.deepEqual(body, original);
  assert.equal(
    buildResponsesLiteRetryBody({ ...defaults, body: retried }),
    null,
  );
  assert.equal(
    buildResponsesLiteRetryBody({ ...defaults, body, retryAttempted: true }),
    null,
  );
  const transformed = buildUpstreamBody(defaults.endpoint, retried, {
    name: "fixture-provider",
    baseUrl: "https://example.test/v1",
  });
  assert.deepEqual(transformed.reasoning, retried.reasoning);
}

for (const overrides of [
  { endpoint: "/v1/responses/compact" },
  { endpoint: "/v1/responses/input_tokens" },
  { endpoint: "/v1/chat/completions" },
  { endpoint: "/v1/images/generations" },
  { method: "GET" },
  { statusCode: 200 },
  { statusCode: 429 },
  { statusCode: 500 },
  { errorText: "Unsupported reasoning.context value" },
  {
    errorText: JSON.stringify({
      error: { message: "Unknown parameter: reasoning.context" },
    }),
  },
  {
    errorText: JSON.stringify({
      error: { message: "Unrelated error" },
      input: message,
    }),
  },
  { errorText: JSON.stringify({ output: message }) },
]) {
  assert.equal(
    buildResponsesLiteRetryBody({ ...defaults, body: {}, ...overrides }),
    null,
  );
}
assert.ok(
  buildResponsesLiteRetryBody({ ...defaults, errorText: message, body: {} }),
);

const received: ProxyBody[] = [];
const server = createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  const body = JSON.parse(text) as ProxyBody;
  received.push(body);
  response.setHeader("content-type", "application/json");
  if (
    (body.reasoning as Record<string, unknown> | null)?.context !== "all_turns"
  ) {
    response.writeHead(400).end(JSON.stringify(errorBody));
    return;
  }
  response.end(JSON.stringify({ id: "resp_fixture", status: "completed" }));
});

async function main() {
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/v1/responses`;
    const body: ProxyBody = { model: "fixture-model", input, reasoning: null };
    const first = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(first.status, 400);
    const retried = buildResponsesLiteRetryBody({
      ...defaults,
      statusCode: first.status,
      errorText: await first.text(),
      body,
    });
    assert.ok(retried);
    const second = await fetch(url, {
      method: "POST",
      body: JSON.stringify(retried),
    });
    assert.equal(second.status, 200);
    assert.equal(
      ((await second.json()) as { status: string }).status,
      "completed",
    );
    assert.equal(received.length, 2);
    assert.deepEqual(received[1]?.input, input);
    console.log(
      "Responses Lite compatibility checks passed (including local HTTP 400 → 200).",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
