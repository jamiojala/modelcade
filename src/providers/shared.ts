import { ModelcadeError } from "../errors";
import type {
  FinishReason,
  JsonValue,
  JsonObject,
  MessagePart,
  ModelcadeMessage,
  ToolDefinition
} from "../types";

export interface FetchProviderOptions {
  fetch?: typeof fetch;
}

export function resolveFetch(customFetch?: typeof fetch): typeof fetch {
  if (customFetch) {
    return customFetch;
  }
  if (typeof globalThis.fetch !== "function") {
    throw new ModelcadeError(
      "INVALID_REQUEST",
      "No fetch implementation found. Pass options.fetch in the provider config."
    );
  }
  return globalThis.fetch.bind(globalThis) as typeof fetch;
}

export async function ensureOk(response: Response, provider: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const bodyText = await response.text();
  throw new ModelcadeError(
    "PROVIDER_ERROR",
    `${provider} request failed (${response.status} ${response.statusText}): ${bodyText}`
  );
}

export function toText(content: string | MessagePart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function systemPrompt(messages: ModelcadeMessage[]): string | undefined {
  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => toText(message.content))
    .filter((value) => value.length > 0);

  if (systemMessages.length === 0) {
    return undefined;
  }

  return systemMessages.join("\n\n");
}

export function toolSchema(tool: ToolDefinition): JsonObject {
  return (
    tool.schema ?? {
      type: "object",
      additionalProperties: true
    }
  );
}

export function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "stop":
    case "end_turn":
    case "STOP":
      return "stop";
    case "length":
    case "max_tokens":
    case "MAX_TOKENS":
      return "length";
    case "tool_calls":
    case "tool_use":
      return "tool_calls";
    case "content_filter":
    case "SAFETY":
      return "content_filter";
    default:
      return "unknown";
  }
}

export function randomToolCallId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function toJsonValue(input: unknown): JsonValue {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => toJsonValue(item));
  }

  if (typeof input === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = toJsonValue(value);
    }
    return output;
  }

  return String(input);
}
