import { ModelcadeError } from "../errors";
import { parseJsonMaybe, type ModelProvider, type ProviderRequest } from "../provider";
import { readSseData } from "../sse";
import type { MessagePart, ToolCall } from "../types";
import {
  ensureOk,
  mapFinishReason,
  randomToolCallId,
  resolveFetch,
  toolSchema
} from "./shared";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function createOpenAIProvider(options: OpenAIProviderOptions): ModelProvider {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetcher = resolveFetch(options.fetch);

  return {
    name: "openai",
    async generate(request) {
      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
          ...(options.organization
            ? { "OpenAI-Organization": options.organization }
            : {}),
          ...(options.project ? { "OpenAI-Project": options.project } : {}),
          ...options.headers
        },
        body: JSON.stringify({
          model: request.model,
          messages: toOpenAIMessages(request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          top_p: request.topP,
          stop: request.stop,
          tools: request.tools?.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: toolSchema(tool)
            }
          })),
          tool_choice: mapOpenAIToolChoice(request.toolChoice)
        }),
        signal: request.signal
      });

      await ensureOk(response, "OpenAI");
      const body = (await response.json()) as OpenAIChatCompletionResponse;
      const choice = body.choices?.[0];

      const text = openAIMessageText(choice?.message?.content);
      const toolCalls = parseOpenAIToolCalls(choice?.message?.tool_calls);

      return {
        text,
        toolCalls,
        finishReason:
          choice?.finish_reason === "tool_calls"
            ? "tool_calls"
            : mapFinishReason(choice?.finish_reason),
        usage: {
          inputTokens: body.usage?.prompt_tokens,
          outputTokens: body.usage?.completion_tokens,
          totalTokens: body.usage?.total_tokens
        },
        raw: body
      };
    },
    async *stream(request) {
      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
          ...(options.organization
            ? { "OpenAI-Organization": options.organization }
            : {}),
          ...(options.project ? { "OpenAI-Project": options.project } : {}),
          ...options.headers
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          stream_options: {
            include_usage: true
          },
          messages: toOpenAIMessages(request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          top_p: request.topP,
          stop: request.stop,
          tools: request.tools?.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: toolSchema(tool)
            }
          })),
          tool_choice: mapOpenAIToolChoice(request.toolChoice)
        }),
        signal: request.signal
      });

      await ensureOk(response, "OpenAI");

      const toolCallBuffers = new Map<
        number,
        { id: string; name?: string; argumentsText: string }
      >();
      let finishReason: string | null | undefined;
      let aggregatedText = "";
      let usage:
        | {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          }
        | undefined;

      for await (const eventData of readSseData(response)) {
        if (eventData === "[DONE]") {
          break;
        }

        const data = JSON.parse(eventData) as {
          choices?: Array<{
            finish_reason?: string | null;
            delta?: {
              content?: string | Array<{ type?: string; text?: string }>;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: {
                  name?: string;
                  arguments?: string;
                };
              }>;
            };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
          error?: {
            message?: string;
          };
        };

        if (data.error?.message) {
          throw new ModelcadeError("PROVIDER_ERROR", data.error.message);
        }

        const choice = data.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const deltaContent = choice?.delta?.content;
        if (typeof deltaContent === "string") {
          aggregatedText += deltaContent;
          yield { type: "text-delta", delta: deltaContent };
        } else if (Array.isArray(deltaContent)) {
          const text = deltaContent
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("");

          if (text.length > 0) {
            aggregatedText += text;
            yield { type: "text-delta", delta: text };
          }
        }

        const deltaToolCalls = choice?.delta?.tool_calls;
        if (deltaToolCalls) {
          for (const item of deltaToolCalls) {
            const index = item.index ?? 0;
            const existing = toolCallBuffers.get(index) ?? {
              id: item.id ?? randomToolCallId("openai"),
              argumentsText: ""
            };

            if (item.id) {
              existing.id = item.id;
            }
            if (item.function?.name) {
              existing.name = item.function.name;
            }
            if (item.function?.arguments) {
              existing.argumentsText += item.function.arguments;
            }
            toolCallBuffers.set(index, existing);

            yield {
              type: "tool-call-delta",
              id: existing.id,
              name: item.function?.name,
              argumentsDelta: item.function?.arguments
            };
          }
        }

        if (data.usage) {
          usage = {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens
          };
          yield {
            type: "usage",
            usage
          };
        }
      }

      const toolCalls: ToolCall[] = [...toolCallBuffers.values()]
        .filter((item) => Boolean(item.name))
        .map((item) => ({
          id: item.id,
          name: item.name as string,
          arguments: parseJsonMaybe(item.argumentsText),
          rawArguments: item.argumentsText
        }));

      yield {
        type: "done",
        text: aggregatedText,
        toolCalls,
        finishReason:
          finishReason === "tool_calls" ? "tool_calls" : mapFinishReason(finishReason),
        usage
      };
    }
  };
}

function toOpenAIMessages(messages: ProviderRequest["messages"]): Array<{
  role: string;
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}> {
  return messages.map((message) => {
    const base: {
      role: string;
      content: string | Array<Record<string, unknown>> | null;
      name?: string;
      tool_call_id?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    } = {
      role: message.role,
      content: toOpenAIContent(message.content),
      name: message.name
    };

    if (message.role === "tool" && message.toolCallId) {
      base.tool_call_id = message.toolCallId;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      base.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments:
            typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments)
        }
      }));

      if (
        typeof base.content === "string" &&
        base.content.length === 0 &&
        base.tool_calls.length > 0
      ) {
        base.content = null;
      }
    }

    return base;
  });
}

function toOpenAIContent(
  content: string | MessagePart[]
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image_url",
      image_url: {
        url: part.imageUrl,
        detail: part.detail
      }
    };
  });
}

function mapOpenAIToolChoice(
  choice: ProviderRequest["toolChoice"]
): "auto" | "none" | { type: "function"; function: { name: string } } | undefined {
  if (!choice) {
    return undefined;
  }
  if (choice === "auto" || choice === "none") {
    return choice;
  }
  return {
    type: "function",
    function: {
      name: choice.name
    }
  };
}

function openAIMessageText(
  content: string | Array<{ type?: string; text?: string }> | null | undefined
): string {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function parseOpenAIToolCalls(
  toolCalls:
    | Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>
    | undefined
): ToolCall[] {
  if (!toolCalls?.length) {
    return [];
  }

  return toolCalls
    .filter((call) => call.type === "function" && call.function?.name)
    .map((call, index) => {
      const rawArguments = call.function?.arguments ?? "{}";
      return {
        id: call.id ?? randomToolCallId(`openai_${index}`),
        name: call.function?.name as string,
        arguments: parseJsonMaybe(rawArguments),
        rawArguments
      };
    });
}
