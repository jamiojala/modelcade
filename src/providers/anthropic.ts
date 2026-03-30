import { ModelcadeError } from "../errors";
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

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  anthropicVersion?: string;
  defaultMaxTokens?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

interface AnthropicResponse {
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  content?: Array<
    | {
        type?: "text";
        text?: string;
      }
    | {
        type?: "tool_use";
        id?: string;
        name?: string;
        input?: unknown;
      }
  >;
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions
): ModelProvider {
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const version = options.anthropicVersion ?? "2023-06-01";
  const fetcher = resolveFetch(options.fetch);

  return {
    name: "anthropic",
    async generate(request) {
      const response = await fetcher(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": version,
          ...options.headers
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? options.defaultMaxTokens ?? 1024,
          temperature: request.temperature,
          top_p: request.topP,
          stop_sequences: request.stop,
          system: systemPrompt(request.messages),
          messages: toAnthropicMessages(request.messages),
          tools: request.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: toolSchema(tool)
          })),
          tool_choice: mapAnthropicToolChoice(request.toolChoice)
        }),
        signal: request.signal
      });

      await ensureOk(response, "Anthropic");
      const body = (await response.json()) as AnthropicResponse;

      const text = (body.content ?? [])
        .filter((item): item is { type?: "text"; text?: string } => item.type === "text")
        .map((item) => item.text ?? "")
        .join("");
      const toolCalls = (body.content ?? [])
        .filter(
          (
            item
          ): item is { type?: "tool_use"; id?: string; name?: string; input?: unknown } =>
            item.type === "tool_use" && Boolean(item.name)
        )
        .map((item, index) => ({
          id: item.id ?? randomToolCallId(`anthropic_${index}`),
          name: item.name as string,
          arguments: normalizeToolInput(item.input)
        }));

      return {
        text,
        toolCalls,
        finishReason:
          body.stop_reason === "tool_use"
            ? "tool_calls"
            : mapFinishReason(body.stop_reason),
        usage: {
          inputTokens: body.usage?.input_tokens,
          outputTokens: body.usage?.output_tokens,
          totalTokens:
            (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0)
        },
        raw: body
      };
    },
    async *stream(request) {
      const response = await fetcher(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": version,
          ...options.headers
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          max_tokens: request.maxTokens ?? options.defaultMaxTokens ?? 1024,
          temperature: request.temperature,
          top_p: request.topP,
          stop_sequences: request.stop,
          system: systemPrompt(request.messages),
          messages: toAnthropicMessages(request.messages),
          tools: request.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: toolSchema(tool)
          })),
          tool_choice: mapAnthropicToolChoice(request.toolChoice)
        }),
        signal: request.signal
      });

      await ensureOk(response, "Anthropic");

      let finishReason: string | null | undefined;
      let aggregatedText = "";
      let usage:
        | {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          }
        | undefined;

      const blocks = new Map<
        number,
        {
          kind: "text" | "tool_use";
          id?: string;
          name?: string;
          text: string;
          inputText: string;
          input?: unknown;
        }
      >();

      for await (const eventData of readSseData(response)) {
        const data = JSON.parse(eventData) as {
          type?: string;
          error?: { message?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
          index?: number;
          content_block?: {
            type?: "text" | "tool_use";
            id?: string;
            name?: string;
            text?: string;
            input?: unknown;
          };
          delta?: {
            type?: "text_delta" | "input_json_delta";
            text?: string;
            partial_json?: string;
            stop_reason?: string | null;
          };
        };

        if (data.error?.message) {
          throw new ModelcadeError("PROVIDER_ERROR", data.error.message);
        }

        if (data.type === "message_start" || data.type === "message_delta") {
          usage = {
            inputTokens: data.usage?.input_tokens ?? usage?.inputTokens,
            outputTokens: data.usage?.output_tokens ?? usage?.outputTokens,
            totalTokens:
              (data.usage?.input_tokens ?? usage?.inputTokens ?? 0) +
              (data.usage?.output_tokens ?? usage?.outputTokens ?? 0)
          };
          yield { type: "usage", usage };
        }

        if (data.type === "content_block_start") {
          const index = data.index ?? 0;
          const block = data.content_block;
          if (!block?.type) {
            continue;
          }
          blocks.set(index, {
            kind: block.type,
            id: block.id,
            name: block.name,
            text: block.text ?? "",
            inputText: block.input ? JSON.stringify(block.input) : "",
            input: block.input
          });

          if (block.type === "text" && block.text) {
            aggregatedText += block.text;
            yield { type: "text-delta", delta: block.text };
          }
        }

        if (data.type === "content_block_delta") {
          const index = data.index ?? 0;
          const block = blocks.get(index);
          if (!block) {
            continue;
          }

          if (data.delta?.type === "text_delta" && data.delta.text) {
            block.text += data.delta.text;
            aggregatedText += data.delta.text;
            yield { type: "text-delta", delta: data.delta.text };
          }

          if (data.delta?.type === "input_json_delta" && data.delta.partial_json) {
            block.inputText += data.delta.partial_json;
            if (block.id) {
              yield {
                type: "tool-call-delta",
                id: block.id,
                name: block.name,
                argumentsDelta: data.delta.partial_json
              };
            }
          }
        }

        if (data.type === "message_delta" && data.delta?.stop_reason) {
          finishReason = data.delta.stop_reason;
        }
      }

      const toolCalls: ToolCall[] = [...blocks.values()]
        .filter((block) => block.kind === "tool_use" && Boolean(block.name))
        .map((block, index) => ({
          id: block.id ?? randomToolCallId(`anthropic_${index}`),
          name: block.name as string,
          arguments: block.inputText
            ? parseJsonMaybe(block.inputText)
            : normalizeToolInput(block.input)
        }));

      yield {
        type: "done",
        text: aggregatedText,
        toolCalls,
        finishReason:
          finishReason === "tool_use" ? "tool_calls" : mapFinishReason(finishReason),
        usage
      };
    }
  };
}

function toAnthropicMessages(messages: ProviderRequest["messages"]): Array<{
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
}> {
  const output: Array<{
    role: "user" | "assistant";
    content: Array<Record<string, unknown>>;
  }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      output.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId ?? randomToolCallId("tool_result"),
            content: toText(message.content),
            is_error: false
          }
        ]
      });
      continue;
    }

    const role = message.role === "assistant" ? "assistant" : "user";
    const content = toAnthropicContent(message.content);

    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments
        });
      }
    }

    output.push({ role, content });
  }

  return output;
}

function toAnthropicContent(content: string | MessagePart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return {
          type: "text",
          text: part.text
        };
      }
      return {
        type: "image",
        source: {
          type: "url",
          url: part.imageUrl
        }
      };
    })
    .filter((part) => part !== null) as Array<Record<string, unknown>>;
}

function mapAnthropicToolChoice(
  choice: ProviderRequest["toolChoice"]
): { type: "auto" | "none" | "tool"; name?: string } | undefined {
  if (!choice) {
    return undefined;
  }
  if (choice === "none") {
    return { type: "none" };
  }
  if (choice === "auto") {
    return { type: "auto" };
  }
  return {
    type: "tool",
    name: choice.name
  };
}

function normalizeToolInput(input: unknown): JsonValue {
  if (typeof input === "undefined") {
    return {};
  }
  if (typeof input === "string") {
    return parseJsonMaybe(input);
  }
  return toJsonValue(input);
}
