import type {
  FinishReason,
  GenerationOptions,
  JsonValue,
  TokenUsage,
  ToolCall
} from "./types";

export interface ProviderRequest extends GenerationOptions {
  model: string;
}

export interface ProviderGenerateResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage?: TokenUsage;
  raw?: unknown;
}

export type ProviderStreamEvent =
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "tool-call-delta";
      id: string;
      name?: string;
      argumentsDelta?: string;
    }
  | {
      type: "tool-call";
      toolCall: ToolCall;
    }
  | {
      type: "usage";
      usage: TokenUsage;
    }
  | {
      type: "done";
      finishReason?: FinishReason;
      text?: string;
      toolCalls?: ToolCall[];
      usage?: TokenUsage;
      raw?: unknown;
    };

export interface ModelProvider {
  readonly name: string;
  generate(request: ProviderRequest): Promise<ProviderGenerateResult>;
  stream?(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
}

export function parseJsonMaybe(input: string): JsonValue {
  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return input;
  }
}
