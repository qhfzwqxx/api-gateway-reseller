import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ResponseContentFilterSettings } from "./response-content-filter-settings.js";

type CompiledBlockedTerm = {
  value: string;
  comparison: string;
};

export class StreamingResponseContentRedactor {
  private readonly replacement: string;
  private readonly caseSensitive: boolean;
  private readonly termsByFirstCharacter = new Map<
    string,
    CompiledBlockedTerm[]
  >();
  private pending = "";

  constructor(settings: ResponseContentFilterSettings) {
    this.replacement = settings.replacement;
    this.caseSensitive = settings.caseSensitive;

    for (const value of settings.blockedTerms) {
      const comparison = this.normalize(value);
      const firstCharacter = this.normalize(value[0] ?? "");
      const terms = this.termsByFirstCharacter.get(firstCharacter) ?? [];
      terms.push({ value, comparison });
      this.termsByFirstCharacter.set(firstCharacter, terms);
    }

    for (const terms of this.termsByFirstCharacter.values()) {
      terms.sort((left, right) => right.value.length - left.value.length);
    }
  }

  write(text: string) {
    if (!text || this.termsByFirstCharacter.size === 0) {
      return text;
    }
    this.pending += text;
    return this.consume(false);
  }

  flush() {
    if (this.termsByFirstCharacter.size === 0) {
      const output = this.pending;
      this.pending = "";
      return output;
    }
    return this.consume(true);
  }

  private consume(flush: boolean) {
    const source = this.pending;
    const output: string[] = [];
    let index = 0;

    while (index < source.length) {
      const candidates = this.findCandidates(source, index);
      if (!candidates) {
        output.push(source[index] ?? "");
        index += 1;
        continue;
      }

      const match = candidates.find((candidate) =>
        this.matchesAt(source, index, candidate),
      );
      if (match) {
        if (
          !flush &&
          candidates.some((candidate) =>
            this.couldExtendMatch(source, index, candidate),
          )
        ) {
          break;
        }
        output.push(this.replacement);
        index += match.value.length;
        continue;
      }

      if (
        !flush &&
        candidates.some((candidate) =>
          this.couldExtendMatch(source, index, candidate),
        )
      ) {
        break;
      }

      output.push(source[index] ?? "");
      index += 1;
    }

    this.pending = source.slice(index);
    return output.join("");
  }

  private findCandidates(source: string, index: number) {
    const firstCharacter = this.normalize(source[index] ?? "");
    return this.termsByFirstCharacter.get(firstCharacter);
  }

  private matchesAt(
    source: string,
    index: number,
    candidate: CompiledBlockedTerm,
  ) {
    if (source.length - index < candidate.value.length) {
      return false;
    }
    const segment = source.slice(index, index + candidate.value.length);
    return this.normalize(segment) === candidate.comparison;
  }

  private couldExtendMatch(
    source: string,
    index: number,
    candidate: CompiledBlockedTerm,
  ) {
    const availableLength = source.length - index;
    if (availableLength >= candidate.value.length) {
      return false;
    }
    const available = source.slice(index);
    const candidatePrefix = candidate.value.slice(0, availableLength);
    return this.normalize(available) === this.normalize(candidatePrefix);
  }

  private normalize(value: string) {
    return this.caseSensitive ? value : value.toLowerCase();
  }
}

export function redactResponseText(
  text: string,
  settings: ResponseContentFilterSettings,
) {
  const redactor = new StreamingResponseContentRedactor(settings);
  return redactor.write(text) + redactor.flush();
}

export function redactResponseJsonValue(
  value: unknown,
  settings: ResponseContentFilterSettings,
): unknown {
  if (typeof value === "string") {
    return redactResponseText(value, settings);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactResponseJsonValue(item, settings));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactResponseJsonValue(item, settings),
    ]),
  );
}

export function createResponseContentRedactionStream(
  settings: ResponseContentFilterSettings,
) {
  const decoder = new StringDecoder("utf8");
  const redactor = new StreamingResponseContentRedactor(settings);

  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        const text =
          typeof chunk === "string"
            ? chunk
            : decoder.write(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
              );
        const output = redactor.write(text);
        if (output) {
          this.push(output, "utf8");
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(callback) {
      try {
        const output = redactor.write(decoder.end()) + redactor.flush();
        if (output) {
          this.push(output, "utf8");
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}
