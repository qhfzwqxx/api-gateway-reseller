import { Readable } from "node:stream";
import type {
  onRequestAsyncHookHandler,
  onSendHookHandler,
} from "fastify";
import {
  readEffectiveResponseContentFilterSettings,
  type ResponseContentFilterSettings,
} from "./response-content-filter-settings.js";
import {
  createResponseContentRedactionStream,
  redactResponseJsonValue,
  redactResponseText,
} from "./response-content-redactor.js";

const responseContentFilterSettingsByRequest = new WeakMap<
  object,
  ResponseContentFilterSettings
>();

export const loadProxyResponseContentFilterSettings: onRequestAsyncHookHandler =
  async (request) => {
    try {
      responseContentFilterSettingsByRequest.set(
        request,
        await readEffectiveResponseContentFilterSettings(),
      );
    } catch (error) {
      request.log.warn(
        { error },
        "Response content filter settings unavailable; passing response through",
      );
    }
  };

export const filterProxyResponseContent: onSendHookHandler = (
  request,
  reply,
  payload,
  done,
) => {
  try {
    done(
      null,
      filterResponsePayload(
        payload,
        String(reply.getHeader("content-type") ?? ""),
        responseContentFilterSettingsByRequest.get(request),
        () => {
          if (!reply.raw.headersSent) {
            reply.removeHeader("content-length");
          }
        },
      ),
    );
  } catch (error) {
    request.log.warn(
      { error },
      "Response content filter failed; passing response through",
    );
    done(null, payload);
  }
};

function filterResponsePayload(
  payload: unknown,
  contentType: string,
  settings: ResponseContentFilterSettings | undefined,
  removeContentLength: () => void,
) {
  if (
    !settings?.enabled ||
    settings.blockedTerms.length === 0 ||
    payload === null ||
    payload === undefined
  ) {
    return payload;
  }

  if (!isTextualPayload(payload, contentType)) {
    return payload;
  }

  if (typeof payload === "string") {
    const filtered = filterSerializedText(payload, contentType, settings);
    if (filtered !== payload) {
      removeContentLength();
    }
    return filtered;
  }

  if (Buffer.isBuffer(payload)) {
    const source = payload.toString("utf8");
    const filtered = filterSerializedText(source, contentType, settings);
    if (filtered === source) {
      return payload;
    }
    removeContentLength();
    return Buffer.from(filtered, "utf8");
  }

  if (isReadablePayload(payload)) {
    removeContentLength();
    return payload.pipe(createResponseContentRedactionStream(settings));
  }

  return payload;
}

function filterSerializedText(
  payload: string,
  contentType: string,
  settings: ResponseContentFilterSettings,
) {
  if (isJsonContentType(contentType)) {
    try {
      return JSON.stringify(
        redactResponseJsonValue(JSON.parse(payload), settings),
      );
    } catch {
      return redactResponseText(payload, settings);
    }
  }
  return redactResponseText(payload, settings);
}

function isTextualPayload(payload: unknown, contentType: string) {
  if (typeof payload === "string") {
    return !contentType || isTextualContentType(contentType);
  }
  if (Buffer.isBuffer(payload) || isReadablePayload(payload)) {
    return isTextualContentType(contentType);
  }
  return false;
}

function isTextualContentType(contentType: string) {
  const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mimeType.startsWith("text/") ||
    isJsonContentType(mimeType) ||
    mimeType === "application/xml" ||
    mimeType.endsWith("+xml") ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-javascript" ||
    mimeType === "application/x-ndjson"
  );
}

function isJsonContentType(contentType: string) {
  const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mimeType === "application/json" || mimeType.endsWith("+json");
}

function isReadablePayload(payload: unknown): payload is Readable {
  return payload instanceof Readable;
}
