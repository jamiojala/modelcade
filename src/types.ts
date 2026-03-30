export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ModelcadeRole = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  imageUrl: string;
  detail?: "low" | "high" | "auto";
}

export type MessagePart = TextPart | ImagePart;

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonValue;
  rawArguments?: string;
}

export interface ModelcadeMessage {
  role: ModelcadeRole;
  content: string | MessagePart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolExecutionContext {
  attempt: number;
  provider: string;
  model: string;
  call: ToolCall;
}

export type ToolExecutor<
  TArgs extends JsonValue = JsonValue,
  TResult extends JsonValue = JsonValue
> = (args: TArgs, context: ToolExecutionContext) => Promise<TResult> | TResult;

export interface ToolDefinition<
  TArgs extends JsonValue = JsonValue,
  TResult extends JsonValue = JsonValue
> {
  name: string;
  description?: string;
  schema?: JsonObject;
  execute?: ToolExecutor<TArgs, TResult>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result?: JsonValue;
  error?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "unknown";

export interface GenerationOptions {
  messages: ModelcadeMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { name: string };
  signal?: AbortSignal;
  metadata?: Record<string, string>;
}
