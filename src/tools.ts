import type { JsonValue, ToolDefinition } from "./types";

export function defineTool<
  TArgs extends JsonValue = JsonValue,
  TResult extends JsonValue = JsonValue
>(tool: ToolDefinition<TArgs, TResult>): ToolDefinition<TArgs, TResult> {
  return tool;
}
