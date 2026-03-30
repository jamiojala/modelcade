import { parseJsonMaybe, type ModelProvider, type ProviderRequest } from "../provider";
import { readSseData } from "../sse";
import type { JsonValue, MessagePart, ToolCall } from "../types";
import {
  ensureOk,
  mapFinishReason,
  randomToolCallId,
  resolveFetch,
  systemPrompt,
  toolSchema,
  toJsonValue,
  toText
} from "./shared";

export interface GoogleProviderOptions {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          name?: string;
          args?: unknown;
        };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function createGoogleProvider(options: GoogleProviderOptions): ModelProvider {
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/,
    ""
  );
  const fetcher = resolveFetch(options.fetch);

  return {
    name: "google",
    async generate(request) {
      const endpoint = `${baseUrl}/models/${encodeURIComponent(
        request.model
      )}:generateContent?key=${encodeURIComponent(options.apiKey)}`;

      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...options.headers
        },
        body: JSON.stringify(toGeminiBody(request)),
        signal: request.signal
      });

      await ensureOk(response, "Google");
      const body = (await response.json()) as GeminiResponse;
      const candidate = body.candidates?.[0];

      const text = extractGeminiText(candidate?.content?.parts);
      const toolCalls = extractGeminiToolCalls(candidate?.content?.parts);

      return {
        text,
        toolCalls,
        finishReason: mapFinishReason(candidate?.finishReason),
        usage: {
          inputTokens: body.usageMetadata?.promptTokenCount,
          outputTokens: body.usageMetadata?.candidatesTokenCount,
          totalTokens: body.usageMetadata?.totalTokenCount
        },
        raw: body
      };
    },
    async *stream(request) {
      const endpoint = `${baseUrl}/models/${encodeURIComponent(
        request.model
      )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(options.apiKey)}`;

      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...options.headers
        },
        body: JSON.stringify(toGeminiBody(request)),
        signal: request.signal
      });

      await ensureOk(response, "Google");

      let finishReason: string | undefined;
      let usage:
        | {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          }
        | undefined;

      let latestSnapshot = "";
      let aggregatedText = "";
      const toolCalls: ToolCall[] = [];

      for await (const eventData of readSseData(response)) {
        if (!eventData || eventData === "[DONE]") {
          continue;
        }

        const data = JSON.parse(eventData) as GeminiResponse;
        const candidate = data.candidates?.[0];
        if (candidate?.finishReason) {
          finishReason = candidate.finishReason;
        }

        const snapshot = extractGeminiText(candidate?.content?.parts);
        const delta = computeDelta(latestSnapshot, snapshot);
        latestSnapshot = snapshot;

        if (delta.length > 0) {
          aggregatedText += delta;
          yield {
            type: "text-delta",
            delta
          };
        }

        const chunkToolCalls = extractGeminiToolCalls(candidate?.content?.parts);
        for (const call of chunkToolCalls) {
          const exists = toolCalls.some(
            (item) =>
              item.name === call.name &&
              JSON.stringify(item.arguments) === JSON.stringify(call.arguments)
          );
          if (!exists) {
            toolCalls.push(call);
            yield {
              type: "tool-call",
              toolCall: call
            };
          }
        }

        if (data.usageMetadata) {
          usage = {
            inputTokens: data.usageMetadata.promptTokenCount,
            outputTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount
          };
          yield {
            type: "usage",
            usage
          };
        }
      }

      yield {
        type: "done",
        text: aggregatedText,
        toolCalls,
        finishReason: mapFinishReason(finishReason),
        usage
      };
    }
  };
}

function toGeminiBody(request: ProviderRequest): Record<string, unknown> {
  const system = systemPrompt(request.messages);

  return {
    contents: toGeminiContents(request.messages),
    ...(system
      ? {
          systemInstruction: {
            parts: [{ text: system }]
          }
        }
      : {}),
    generationConfig: {
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      topP: request.topP,
      stopSequences: request.stop
    },
    tools: request.tools?.length
      ? [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: toolSchema(tool)
            }))
          }
        ]
      : undefined,
    toolConfig: mapGeminiToolChoice(request.toolChoice)
  };
}

function toGeminiContents(messages: ProviderRequest["messages"]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      output.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.name ?? "tool",
              response: parseJsonMaybe(toText(message.content))
            }
          }
        ]
      });
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    const parts = toGeminiParts(message.content);

    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: {
            name: call.name,
            args: call.arguments
          }
        });
      }
    }

    output.push({
      role,
      parts
    });
  }

  return output;
}

function toGeminiParts(content: string | MessagePart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }
    return {
      text: `Image URL: ${part.imageUrl}`
    };
  });
}

function mapGeminiToolChoice(
  choice: ProviderRequest["toolChoice"]
): { functionCallingConfig: Record<string, unknown> } | undefined {
  if (!choice) {
    return undefined;
  }

  if (choice === "none") {
    return {
      functionCallingConfig: {
        mode: "NONE"
      }
    };
  }

  if (choice === "auto") {
    return {
      functionCallingConfig: {
        mode: "AUTO"
      }
    };
  }

  return {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [choice.name]
    }
  };
}

function extractGeminiText(
  parts:
    | Array<{
        text?: string;
        functionCall?: { name?: string; args?: unknown };
      }>
    | undefined
): string {
  if (!parts?.length) {
    return "";
  }

  return parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function extractGeminiToolCalls(
  parts:
    | Array<{
        text?: string;
        functionCall?: { name?: string; args?: unknown };
      }>
    | undefined
): ToolCall[] {
  if (!parts?.length) {
    return [];
  }

  return parts
    .filter((part) => part.functionCall?.name)
    .map((part, index) => ({
      id: randomToolCallId(`gemini_${index}`),
      name: part.functionCall?.name as string,
      arguments: normalizeGeminiArgs(part.functionCall?.args)
    }));
}

function normalizeGeminiArgs(args: unknown): JsonValue {
  if (typeof args === "string") {
    return parseJsonMaybe(args);
  }
  if (typeof args === "undefined") {
    return {};
  }
  return toJsonValue(args);
}

function computeDelta(previous: string, next: string): string {
  if (!previous) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  return next;
}
