import {
  convertChatToolCallToResponsesOutput,
  customToolInputFromChatArguments,
  isPlainObject,
  responseToolCallItemId,
} from "./proxy-request-utils.js";
import type {
  ChatToolSpec,
  ProxyTransformContext,
  ToolConversionContext,
} from "./proxy-request-utils.js";

type StreamTransformMode =
  | "passthrough"
  | "chat_to_responses"
  | "responses_to_chat";

export type ProxyStreamTransformer = {
  readonly transforms: boolean;
  transformText(text: string): string;
  flush(): string;
};

export function createProxyStreamTransformer(
  endpoint: string,
  upstreamEndpoint: string,
  transformContext?: ProxyTransformContext,
): ProxyStreamTransformer {
  const mode = resolveStreamTransformMode(endpoint, upstreamEndpoint);
  if (mode === "chat_to_responses") {
    return new ChatCompletionsToResponsesStreamTransformer(
      transformContext?.toolContext,
    );
  }
  if (mode === "responses_to_chat") {
    return new ResponsesToChatCompletionsStreamTransformer();
  }

  return passthroughStreamTransformer;
}

function resolveStreamTransformMode(
  endpoint: string,
  upstreamEndpoint: string,
): StreamTransformMode {
  if (
    endpoint === "/v1/responses" &&
    upstreamEndpoint === "/v1/chat/completions"
  ) {
    return "chat_to_responses";
  }

  if (
    endpoint === "/v1/chat/completions" &&
    upstreamEndpoint === "/v1/responses"
  ) {
    return "responses_to_chat";
  }

  return "passthrough";
}

const passthroughStreamTransformer: ProxyStreamTransformer = {
  transforms: false,
  transformText(text) {
    return text;
  },
  flush() {
    return "";
  },
};

type ParsedSseBlock = {
  event?: string;
  data: string;
};

abstract class SseBlockTransformer implements ProxyStreamTransformer {
  readonly transforms = true;
  private pending = "";

  transformText(text: string) {
    this.pending += text;
    let output = "";

    while (true) {
      const boundary = /\r?\n\r?\n/.exec(this.pending);
      if (!boundary) {
        break;
      }

      const block = this.pending.slice(0, boundary.index);
      this.pending = this.pending.slice(boundary.index + boundary[0].length);
      output += this.transformSseBlock(block);
    }

    return output;
  }

  flush() {
    const trailing = this.pending;
    this.pending = "";
    return (
      (trailing.trim() ? this.transformSseBlock(trailing) : "") +
      this.finalizeStream()
    );
  }

  protected abstract transformParsedBlock(block: ParsedSseBlock): string;

  protected finalizeStream(): string {
    return "";
  }

  private transformSseBlock(block: string) {
    const parsed = parseSseBlock(block);
    if (!parsed) {
      return "";
    }

    return this.transformParsedBlock(parsed);
  }
}

type ChatToolState = {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  added: boolean;
  done: boolean;
  spec?: ChatToolSpec;
};

class ChatCompletionsToResponsesStreamTransformer extends SseBlockTransformer {
  constructor(private readonly toolContext?: ToolConversionContext) {
    super();
  }

  private responseStarted = false;
  private completed = false;
  private responseId = `resp_${Date.now()}`;
  private model: string | undefined;
  private createdAt = Math.floor(Date.now() / 1000);
  private sequenceNumber = 0;
  private nextOutputIndex = 0;
  private textAdded = false;
  private textDone = false;
  private text = "";
  private textOutputIndex = 0;
  private textItemId = "";
  private latestUsage: unknown;
  private finishReason: string | null = null;
  private tools = new Map<number, ChatToolState>();

  protected transformParsedBlock(block: ParsedSseBlock) {
    if (block.data.trim() === "[DONE]") {
      return this.finalize(true);
    }

    const payload = parseJson(block.data);
    if (!isPlainObject(payload)) {
      return "";
    }

    if (block.event === "error" || isPlainObject(payload.error)) {
      return this.fail(payload.error ?? payload);
    }

    return this.handleChatChunk(payload);
  }

  protected finalizeStream() {
    return this.finalize(true);
  }

  private handleChatChunk(chunk: unknown) {
    if (!isPlainObject(chunk)) {
      return "";
    }

    if (typeof chunk.id === "string" && chunk.id) {
      this.responseId = responseIdFromChatId(chunk.id);
    }
    if (typeof chunk.model === "string" && chunk.model) {
      this.model = chunk.model;
    }
    if (typeof chunk.created === "number" && Number.isFinite(chunk.created)) {
      this.createdAt = chunk.created;
    }

    let output = this.ensureResponseStarted();

    if (chunk.usage !== undefined && chunk.usage !== null) {
      this.latestUsage = chatUsageToResponsesUsage(chunk.usage);
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    for (const choice of choices) {
      if (!isPlainObject(choice)) {
        continue;
      }

      const delta = isPlainObject(choice.delta) ? choice.delta : {};
      const content = readChatDeltaText(delta);
      if (content) {
        output += this.pushTextDelta(content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const toolCall of delta.tool_calls) {
          output += this.pushToolCallDelta(toolCall);
        }
      }

      if (typeof choice.finish_reason === "string") {
        this.finishReason = choice.finish_reason;
      }
    }

    return output;
  }

  private ensureResponseStarted() {
    if (this.responseStarted) {
      return "";
    }

    this.responseStarted = true;
    const response = this.baseResponse("in_progress", []);
    return (
      this.sseEvent("response.created", {
        type: "response.created",
        response,
        sequence_number: this.nextSequenceNumber(),
      }) +
      this.sseEvent("response.in_progress", {
        type: "response.in_progress",
        response,
        sequence_number: this.nextSequenceNumber(),
      })
    );
  }

  private pushTextDelta(delta: string) {
    let output = "";
    if (!this.textAdded) {
      this.textAdded = true;
      this.textOutputIndex = this.nextOutputIndex++;
      this.textItemId = `${this.responseId}_msg`;
      output += this.sseEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: this.textOutputIndex,
        item: {
          id: this.textItemId,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
        sequence_number: this.nextSequenceNumber(),
      });
      output += this.sseEvent("response.content_part.added", {
        type: "response.content_part.added",
        item_id: this.textItemId,
        output_index: this.textOutputIndex,
        content_index: 0,
        part: {
          type: "output_text",
          text: "",
          annotations: [],
        },
        sequence_number: this.nextSequenceNumber(),
      });
    }

    this.text += delta;
    output += this.sseEvent("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: this.textItemId,
      output_index: this.textOutputIndex,
      content_index: 0,
      delta,
      sequence_number: this.nextSequenceNumber(),
    });
    return output;
  }

  private pushToolCallDelta(toolCall: unknown) {
    if (!isPlainObject(toolCall)) {
      return "";
    }

    const chatIndex =
      typeof toolCall.index === "number" && Number.isFinite(toolCall.index)
        ? toolCall.index
        : 0;
    const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
    const id = typeof toolCall.id === "string" ? toolCall.id : undefined;
    const name = typeof fn.name === "string" ? fn.name : undefined;
    const argsDelta =
      typeof fn.arguments === "string" ? fn.arguments : undefined;

    const existing = this.tools.get(chatIndex);
    const state =
      existing ??
      ({
        outputIndex: this.nextOutputIndex,
        itemId: "",
        callId: "",
        name: "",
        arguments: "",
        added: false,
        done: false,
        spec: undefined,
      } satisfies ChatToolState);

    if (id) {
      state.callId = id;
    }
    if (name) {
      state.name = name;
      state.spec = this.toolContext?.specsByChatName.get(name);
    }
    if (argsDelta) {
      state.arguments += argsDelta;
    }

    this.tools.set(chatIndex, state);

    let output = "";
    let justAdded = false;
    if (!state.added && state.callId && state.name) {
      state.added = true;
      justAdded = true;
      state.outputIndex = this.nextOutputIndex++;
      state.spec = this.toolContext?.specsByChatName.get(state.name);
      state.itemId = responseToolCallItemId(state.callId, state.spec);
      output += this.sseEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: state.outputIndex,
        item: this.responseToolCallItem(state, "in_progress", ""),
        sequence_number: this.nextSequenceNumber(),
      });
    }

    if (
      state.added &&
      state.spec?.kind !== "custom" &&
      (argsDelta || justAdded) &&
      state.arguments
    ) {
      output += this.sseEvent("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: state.itemId,
        output_index: state.outputIndex,
        delta: justAdded ? state.arguments : argsDelta,
        sequence_number: this.nextSequenceNumber(),
      });
    }

    return output;
  }

  private finalize(includeDone: boolean) {
    if (this.completed) {
      return "";
    }

    let output = this.ensureResponseStarted();
    const responseOutput: unknown[] = [];

    if (this.textAdded && !this.textDone) {
      this.textDone = true;
      const contentPart = {
        type: "output_text",
        text: this.text,
        annotations: [],
      };
      const item = {
        id: this.textItemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [contentPart],
      };
      responseOutput.push(item);
      output += this.sseEvent("response.output_text.done", {
        type: "response.output_text.done",
        item_id: this.textItemId,
        output_index: this.textOutputIndex,
        content_index: 0,
        text: this.text,
        sequence_number: this.nextSequenceNumber(),
      });
      output += this.sseEvent("response.content_part.done", {
        type: "response.content_part.done",
        item_id: this.textItemId,
        output_index: this.textOutputIndex,
        content_index: 0,
        part: contentPart,
        sequence_number: this.nextSequenceNumber(),
      });
      output += this.sseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: this.textOutputIndex,
        item,
        sequence_number: this.nextSequenceNumber(),
      });
    }

    for (const state of [...this.tools.values()].sort(
      (a, b) => a.outputIndex - b.outputIndex,
    )) {
      if (!state.added || state.done) {
        continue;
      }

      state.done = true;
      state.spec =
        state.spec ?? this.toolContext?.specsByChatName.get(state.name);
      const item = this.responseToolCallItem(
        state,
        "completed",
        state.arguments,
      );
      responseOutput.push(item);
      if (state.spec?.kind === "custom") {
        const input = customToolInputFromChatArguments(state.arguments);
        if (input) {
          output += this.sseEvent("response.custom_tool_call_input.delta", {
            type: "response.custom_tool_call_input.delta",
            item_id: state.itemId,
            output_index: state.outputIndex,
            delta: input,
            sequence_number: this.nextSequenceNumber(),
          });
        }
        output += this.sseEvent("response.custom_tool_call_input.done", {
          type: "response.custom_tool_call_input.done",
          item_id: state.itemId,
          output_index: state.outputIndex,
          input,
          sequence_number: this.nextSequenceNumber(),
        });
      } else {
        output += this.sseEvent("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          item_id: state.itemId,
          output_index: state.outputIndex,
          arguments: state.arguments,
          sequence_number: this.nextSequenceNumber(),
        });
      }
      output += this.sseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: state.outputIndex,
        item,
        sequence_number: this.nextSequenceNumber(),
      });
    }

    const status =
      this.finishReason === "length" || this.finishReason === "content_filter"
        ? "incomplete"
        : "completed";
    const response = this.baseResponse(status, responseOutput);
    if (this.latestUsage !== undefined) {
      response.usage = this.latestUsage;
    }
    if (status === "incomplete") {
      response.incomplete_details = {
        reason:
          this.finishReason === "content_filter"
            ? "content_filter"
            : "max_output_tokens",
      };
    }

    output += this.sseEvent("response.completed", {
      type: "response.completed",
      response,
      sequence_number: this.nextSequenceNumber(),
    });
    this.completed = true;

    return output + (includeDone ? doneSseEvent() : "");
  }

  private responseToolCallItem(
    state: ChatToolState,
    status: "in_progress" | "completed",
    rawArguments: string,
  ) {
    const converted = convertChatToolCallToResponsesOutput(
      {
        id: state.callId,
        type: "function",
        function: {
          name: state.name,
          arguments: rawArguments,
        },
      },
      state.outputIndex,
      this.toolContext,
    );

    if (isPlainObject(converted)) {
      return {
        ...converted,
        id: state.itemId,
        status,
      };
    }

    return {
      id: state.itemId,
      type: "function_call",
      status,
      call_id: state.callId,
      name: state.name,
      arguments: rawArguments,
    };
  }

  private fail(error: unknown) {
    this.completed = true;
    const message =
      isPlainObject(error) && typeof error.message === "string"
        ? error.message
        : "Upstream stream failed";
    return (
      this.sseEvent("response.failed", {
        type: "response.failed",
        response: {
          ...this.baseResponse("failed", []),
          error: {
            message,
            type:
              isPlainObject(error) && typeof error.type === "string"
                ? error.type
                : "upstream_error",
          },
        },
        sequence_number: this.nextSequenceNumber(),
      }) + doneSseEvent()
    );
  }

  private baseResponse(status: string, output: unknown[]) {
    return {
      id: this.responseId,
      object: "response",
      created_at: this.createdAt,
      status,
      model: this.model,
      output,
      output_text: this.text,
      parallel_tool_calls: true,
      usage: this.latestUsage,
    } as Record<string, unknown>;
  }

  private sseEvent(event: string, data: unknown) {
    return sseEvent(event, data);
  }

  private nextSequenceNumber() {
    return this.sequenceNumber++;
  }
}

type ResponseToolState = {
  chatIndex: number;
  id: string;
  name: string;
  arguments: string;
  custom: boolean;
  customInputStarted: boolean;
  customInputClosed: boolean;
};

class ResponsesToChatCompletionsStreamTransformer extends SseBlockTransformer {
  private finalSent = false;
  private doneSent = false;
  private chatId = `chatcmpl_${Date.now()}`;
  private model: string | undefined;
  private created = Math.floor(Date.now() / 1000);
  private emittedText = "";
  private nextToolIndex = 0;
  private toolsByItemId = new Map<string, ResponseToolState>();

  protected transformParsedBlock(block: ParsedSseBlock) {
    if (block.data.trim() === "[DONE]") {
      return this.finishWithDone();
    }

    const payload = parseJson(block.data);
    if (!isPlainObject(payload)) {
      return "";
    }

    if (block.event === "error" || isPlainObject(payload.error)) {
      return sseEvent("error", payload);
    }

    return this.handleResponsesEvent(payload);
  }

  protected finalizeStream() {
    return this.finishWithDone();
  }

  private handleResponsesEvent(payload: unknown) {
    if (!isPlainObject(payload)) {
      return "";
    }

    const response = isPlainObject(payload.response) ? payload.response : null;
    if (response) {
      this.updateResponseMetadata(response);
    }

    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "response.output_item.added") {
      return this.handleOutputItemAdded(payload.item);
    }

    if (type === "response.output_text.delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!delta) {
        return "";
      }
      this.emittedText += delta;
      return this.chatChunk({
        choices: [
          {
            index: 0,
            delta: { content: delta },
            finish_reason: null,
          },
        ],
      });
    }

    if (type === "response.function_call_arguments.delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
      return this.pushToolArgumentsDelta(itemId, delta);
    }

    if (type === "response.custom_tool_call_input.delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
      return this.pushCustomToolInputDelta(itemId, delta);
    }

    if (type === "response.custom_tool_call_input.done") {
      const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
      return this.closeCustomToolInput(itemId);
    }

    if (type === "response.completed" && response) {
      return this.completeFromResponse(response);
    }

    if (type === "response.failed") {
      return sseEvent("error", {
        error: response?.error ?? {
          message: "Upstream Responses stream failed",
          type: "upstream_error",
        },
      });
    }

    return "";
  }

  private updateResponseMetadata(response: Record<string, unknown>) {
    if (typeof response.id === "string" && response.id) {
      this.chatId = chatIdFromResponseId(response.id);
    }
    if (typeof response.model === "string" && response.model) {
      this.model = response.model;
    }
    if (
      typeof response.created_at === "number" &&
      Number.isFinite(response.created_at)
    ) {
      this.created = response.created_at;
    }
  }

  private handleOutputItemAdded(item: unknown) {
    if (!isPlainObject(item)) {
      return "";
    }

    if (item.type !== "function_call" && item.type !== "custom_tool_call") {
      return "";
    }

    const itemId = typeof item.id === "string" ? item.id : `call_${Date.now()}`;
    const name = typeof item.name === "string" ? item.name : "tool_call";
    const id =
      typeof item.call_id === "string" && item.call_id ? item.call_id : itemId;
    const state = {
      chatIndex: this.nextToolIndex++,
      id,
      name,
      arguments: "",
      custom: item.type === "custom_tool_call",
      customInputStarted: false,
      customInputClosed: false,
    };
    this.toolsByItemId.set(itemId, state);

    return this.chatChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: state.chatIndex,
                id: state.id,
                type: "function",
                function: {
                  name: state.name,
                  arguments: "",
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  }

  private pushToolArgumentsDelta(itemId: string, delta: string) {
    if (!delta) {
      return "";
    }

    const state = this.toolsByItemId.get(itemId);
    if (!state) {
      return "";
    }

    state.arguments += delta;
    return this.chatChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: state.chatIndex,
                function: {
                  arguments: delta,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  }

  private pushCustomToolInputDelta(itemId: string, delta: string) {
    const state = this.toolsByItemId.get(itemId);
    if (!state || !state.custom) {
      return "";
    }

    const prefix = state.customInputStarted ? "" : '{"input":"';
    state.customInputStarted = true;
    state.arguments += delta;
    return this.chatChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: state.chatIndex,
                function: {
                  arguments: `${prefix}${escapeJsonStringChunk(delta)}`,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  }

  private closeCustomToolInput(itemId: string) {
    const state = this.toolsByItemId.get(itemId);
    if (
      !state ||
      !state.custom ||
      !state.customInputStarted ||
      state.customInputClosed
    ) {
      return "";
    }

    state.customInputClosed = true;
    return this.chatChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: state.chatIndex,
                function: {
                  arguments: '"}',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  }

  private closeAllCustomToolInputs() {
    let output = "";
    for (const [itemId] of this.toolsByItemId) {
      output += this.closeCustomToolInput(itemId);
    }
    return output;
  }

  private completeFromResponse(response: Record<string, unknown>) {
    this.updateResponseMetadata(response);
    let output = "";
    const outputText = extractResponsesOutputText(response);
    if (outputText && !this.emittedText) {
      this.emittedText = outputText;
      output += this.chatChunk({
        choices: [
          {
            index: 0,
            delta: { content: outputText },
            finish_reason: null,
          },
        ],
      });
    }

    output += this.sendFinalChunk(response);
    return output;
  }

  private finishWithDone() {
    let output = "";
    if (!this.finalSent) {
      output += this.sendFinalChunk();
    }
    if (!this.doneSent) {
      this.doneSent = true;
      output += doneSseEvent();
    }
    return output;
  }

  private sendFinalChunk(response?: Record<string, unknown>) {
    if (this.finalSent) {
      return "";
    }

    this.finalSent = true;
    let output = this.closeAllCustomToolInputs();
    const finishReason =
      response?.status === "incomplete"
        ? "length"
        : this.toolsByItemId.size > 0
          ? "tool_calls"
          : "stop";
    output += this.chatChunk({
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    });

    const usage = responsesUsageToChatUsage(response?.usage);
    if (usage) {
      output += this.chatChunk({
        choices: [],
        usage,
      });
    }

    return output;
  }

  private chatChunk(extra: Record<string, unknown>) {
    return sseData({
      id: this.chatId,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      ...extra,
    });
  }
}

function parseSseBlock(block: string): ParsedSseBlock | null {
  let event: string | undefined;
  const dataParts: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = trimSseValue(line.slice("event:".length));
      continue;
    }

    if (line.startsWith("data:")) {
      dataParts.push(trimSseValue(line.slice("data:".length)));
    }
  }

  if (dataParts.length === 0) {
    return null;
  }

  return {
    event,
    data: dataParts.join("\n"),
  };
}

function trimSseValue(value: string) {
  return value.startsWith(" ") ? value.slice(1) : value;
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseData(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function doneSseEvent() {
  return "data: [DONE]\n\n";
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readChatDeltaText(delta: Record<string, unknown>) {
  if (typeof delta.content === "string") {
    return delta.content;
  }

  return "";
}

function responseIdFromChatId(id: string) {
  if (id.startsWith("resp_")) {
    return id;
  }
  if (id.startsWith("chatcmpl_")) {
    return `resp_${id.slice("chatcmpl_".length)}`;
  }
  return `resp_${id}`;
}

function chatIdFromResponseId(id: string) {
  if (id.startsWith("chatcmpl_")) {
    return id;
  }
  if (id.startsWith("resp_")) {
    return `chatcmpl_${id.slice("resp_".length)}`;
  }
  return `chatcmpl_${id}`;
}

function chatUsageToResponsesUsage(usage: unknown) {
  if (!isPlainObject(usage)) {
    return undefined;
  }

  const promptTokens = readNumber(usage.prompt_tokens);
  const completionTokens = readNumber(usage.completion_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  const cachedTokens = isPlainObject(usage.prompt_tokens_details)
    ? readNumber(usage.prompt_tokens_details.cached_tokens)
    : 0;
  const reasoningTokens = isPlainObject(usage.completion_tokens_details)
    ? readNumber(usage.completion_tokens_details.reasoning_tokens)
    : 0;

  return {
    input_tokens: promptTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens,
    },
    output_tokens: completionTokens,
    output_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
    total_tokens: totalTokens || promptTokens + completionTokens,
  };
}

function responsesUsageToChatUsage(usage: unknown) {
  if (!isPlainObject(usage)) {
    return undefined;
  }

  const inputTokens = readNumber(usage.input_tokens);
  const outputTokens = readNumber(usage.output_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  const cachedTokens = isPlainObject(usage.input_tokens_details)
    ? readNumber(usage.input_tokens_details.cached_tokens)
    : 0;
  const reasoningTokens = isPlainObject(usage.output_tokens_details)
    ? readNumber(usage.output_tokens_details.reasoning_tokens)
    : 0;

  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens || inputTokens + outputTokens,
    prompt_tokens_details: {
      cached_tokens: cachedTokens,
    },
    completion_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
  };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function escapeJsonStringChunk(value: string) {
  return JSON.stringify(value).slice(1, -1);
}

function extractResponsesOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = response.output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) =>
      isPlainObject(item) && Array.isArray(item.content) ? item.content : [],
    )
    .map((part) =>
      isPlainObject(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}
