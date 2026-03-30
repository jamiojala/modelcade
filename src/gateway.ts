import { ModelcadeError } from "./errors";
import type {
  FinishReason,
  GenerationOptions,
  JsonValue,
  ModelcadeMessage,
  TokenUsage,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult
} from "./types";
import type { ModelProvider, ProviderGenerateResult, ProviderRequest } from "./provider";
import { parseJsonMaybe } from "./provider";

export interface ModelRoute {
  provider: string;
  model: string;
}

export type ModelTarget = string | ModelRoute;

export interface AttemptSummary {
  attempt: number;
  provider: string;
  model: string;
  durationMs: number;
  error?: string;
}

export interface ModelcadeConfig {
  providers: Record<string, ModelProvider> | ModelProvider[];
  defaultModel?: ModelTarget;
  defaultFallbacks?: ModelTarget[];
  maxSteps?: number;
}

export interface GatewayRequest extends GenerationOptions {
  model?: ModelTarget;
  fallback?: ModelTarget[];
  executeTools?: boolean;
  maxSteps?: number;
}

export interface ModelcadeResponse {
  provider: string;
  model: string;
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  finishReason: FinishReason;
  usage?: TokenUsage;
  attempts: AttemptSummary[];
  raw?: unknown;
}

export type ModelcadeStreamEvent =
  | {
      type: "attempt-start";
      attempt: number;
      provider: string;
      model: string;
    }
  | {
      type: "text-delta";
      attempt: number;
      delta: string;
    }
  | {
      type: "tool-call";
      attempt: number;
      call: ToolCall;
    }
  | {
      type: "tool-result";
      attempt: number;
      result: ToolResult;
    }
  | {
      type: "attempt-error";
      attempt: number;
      provider: string;
      model: string;
      error: ModelcadeError;
    }
  | {
      type: "done";
      response: ModelcadeResponse;
    };

interface CoreRunResponse {
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  finishReason: FinishReason;
  usage?: TokenUsage;
  raw?: unknown;
}

type CoreStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "tool-result"; result: ToolResult }
  | { type: "final"; response: CoreRunResponse };

export class Modelcade {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly defaultModel?: ModelTarget;
  private readonly defaultFallbacks?: ModelTarget[];
  private readonly maxSteps: number;

  constructor(config: ModelcadeConfig) {
    if (Array.isArray(config.providers)) {
      for (const provider of config.providers) {
        this.providers.set(provider.name, provider);
      }
    } else {
      for (const [key, provider] of Object.entries(config.providers)) {
        this.providers.set(key, provider);
        if (!this.providers.has(provider.name)) {
          this.providers.set(provider.name, provider);
        }
      }
    }

    if (this.providers.size === 0) {
      throw new ModelcadeError(
        "INVALID_REQUEST",
        "At least one provider must be registered."
      );
    }

    this.defaultModel = config.defaultModel;
    this.defaultFallbacks = config.defaultFallbacks;
    this.maxSteps = config.maxSteps ?? 4;
  }

  registerProvider(name: string, provider: ModelProvider): void {
    this.providers.set(name, provider);
  }

  async generate(request: GatewayRequest): Promise<ModelcadeResponse> {
    const routes = this.resolveRoutes(request.model, request.fallback);
    const attempts: AttemptSummary[] = [];
    const maxSteps = request.maxSteps ?? this.maxSteps;

    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const attempt = index + 1;
      const startedAt = Date.now();

      try {
        const provider = this.getProvider(route.provider, route.model, attempt);
        const result = await this.runConversation(
          provider,
          route.model,
          request,
          attempt,
          maxSteps
        );

        attempts.push({
          attempt,
          provider: route.provider,
          model: route.model,
          durationMs: Date.now() - startedAt
        });

        return {
          provider: route.provider,
          model: route.model,
          text: result.text,
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          finishReason: result.finishReason,
          usage: result.usage,
          attempts,
          raw: result.raw
        };
      } catch (error) {
        const wrapped = this.normalizeAttemptError(error, route, attempt);
        attempts.push({
          attempt,
          provider: route.provider,
          model: route.model,
          durationMs: Date.now() - startedAt,
          error: wrapped.message
        });
      }
    }

    throw new ModelcadeError("FALLBACK_EXHAUSTED", "All fallback routes failed.", {
      details: attempts
    });
  }

  async *stream(
    request: GatewayRequest
  ): AsyncGenerator<ModelcadeStreamEvent, void, unknown> {
    const routes = this.resolveRoutes(request.model, request.fallback);
    const attempts: AttemptSummary[] = [];
    const maxSteps = request.maxSteps ?? this.maxSteps;

    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const attempt = index + 1;
      const startedAt = Date.now();

      yield {
        type: "attempt-start",
        attempt,
        provider: route.provider,
        model: route.model
      };

      try {
        const provider = this.getProvider(route.provider, route.model, attempt);

        for await (const event of this.runConversationStream(
          provider,
          route.model,
          request,
          attempt,
          maxSteps
        )) {
          if (event.type === "final") {
            attempts.push({
              attempt,
              provider: route.provider,
              model: route.model,
              durationMs: Date.now() - startedAt
            });

            yield {
              type: "done",
              response: {
                provider: route.provider,
                model: route.model,
                text: event.response.text,
                toolCalls: event.response.toolCalls,
                toolResults: event.response.toolResults,
                finishReason: event.response.finishReason,
                usage: event.response.usage,
                attempts,
                raw: event.response.raw
              }
            };
            return;
          }

          if (event.type === "text-delta") {
            yield {
              type: "text-delta",
              attempt,
              delta: event.delta
            };
          } else if (event.type === "tool-call") {
            yield {
              type: "tool-call",
              attempt,
              call: event.call
            };
          } else if (event.type === "tool-result") {
            yield {
              type: "tool-result",
              attempt,
              result: event.result
            };
          }
        }
      } catch (error) {
        const wrapped = this.normalizeAttemptError(error, route, attempt);
        attempts.push({
          attempt,
          provider: route.provider,
          model: route.model,
          durationMs: Date.now() - startedAt,
          error: wrapped.message
        });

        yield {
          type: "attempt-error",
          attempt,
          provider: route.provider,
          model: route.model,
          error: wrapped
        };
      }
    }

    throw new ModelcadeError("FALLBACK_EXHAUSTED", "All fallback routes failed.", {
      details: attempts
    });
  }

  private async runConversation(
    provider: ModelProvider,
    model: string,
    request: GatewayRequest,
    attempt: number,
    maxSteps: number
  ): Promise<CoreRunResponse> {
    const messages = this.cloneMessages(request.messages);
    const executeTools = request.executeTools ?? true;
    const tools = request.tools ?? [];
    const shouldExecuteTools = executeTools && tools.length > 0;

    let text = "";
    let finishReason: FinishReason = "unknown";
    let usage: TokenUsage | undefined;
    let raw: unknown;
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];

    for (let step = 0; step < maxSteps; step += 1) {
      const result = await this.generateWithProvider(provider, model, request, messages);
      text += result.text;
      finishReason = result.finishReason;
      usage = mergeUsage(usage, result.usage);
      raw = result.raw ?? raw;
      toolCalls.push(...result.toolCalls);

      if (!shouldExecuteTools || result.toolCalls.length === 0) {
        return {
          text,
          finishReason,
          usage,
          raw,
          toolCalls,
          toolResults
        };
      }

      messages.push({
        role: "assistant",
        content: result.text,
        toolCalls: result.toolCalls
      });

      const executed = await this.executeToolCalls(
        result.toolCalls,
        tools,
        attempt,
        provider.name,
        model
      );
      toolResults.push(...executed);
      messages.push(...executed.map((item) => this.toToolMessage(item)));

      if (step === maxSteps - 1) {
        throw new ModelcadeError(
          "INVALID_REQUEST",
          `Reached maxSteps=${maxSteps} while tool calls were still being produced.`,
          { provider: provider.name, model, attempt }
        );
      }
    }

    return {
      text,
      finishReason,
      usage,
      raw,
      toolCalls,
      toolResults
    };
  }

  private async *runConversationStream(
    provider: ModelProvider,
    model: string,
    request: GatewayRequest,
    attempt: number,
    maxSteps: number
  ): AsyncGenerator<CoreStreamEvent, void, unknown> {
    const messages = this.cloneMessages(request.messages);
    const executeTools = request.executeTools ?? true;
    const tools = request.tools ?? [];
    const shouldExecuteTools = executeTools && tools.length > 0;

    let text = "";
    let finishReason: FinishReason = "unknown";
    let usage: TokenUsage | undefined;
    let raw: unknown;
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];

    for (let step = 0; step < maxSteps; step += 1) {
      let stepText = "";
      let stepFinishReason: FinishReason = "unknown";
      let stepUsage: TokenUsage | undefined;
      let stepRaw: unknown;
      const stepToolCalls: ToolCall[] = [];

      if (provider.stream) {
        const toolBuffers = new Map<
          string,
          { id: string; name?: string; argumentsText: string }
        >();

        for await (const event of provider.stream({
          ...request,
          messages,
          model
        })) {
          if (event.type === "text-delta") {
            stepText += event.delta;
            text += event.delta;
            yield { type: "text-delta", delta: event.delta };
          } else if (event.type === "tool-call-delta") {
            const existing = toolBuffers.get(event.id) ?? {
              id: event.id,
              argumentsText: ""
            };
            if (event.name) {
              existing.name = event.name;
            }
            if (event.argumentsDelta) {
              existing.argumentsText += event.argumentsDelta;
            }
            toolBuffers.set(event.id, existing);
          } else if (event.type === "tool-call") {
            pushUniqueToolCall(stepToolCalls, event.toolCall);
          } else if (event.type === "usage") {
            stepUsage = mergeUsage(stepUsage, event.usage);
          } else if (event.type === "done") {
            stepFinishReason = event.finishReason ?? stepFinishReason;
            stepUsage = mergeUsage(stepUsage, event.usage);
            stepRaw = event.raw ?? stepRaw;

            if (event.text && stepText.length === 0) {
              stepText += event.text;
              text += event.text;
              yield { type: "text-delta", delta: event.text };
            }

            if (event.toolCalls?.length) {
              for (const call of event.toolCalls) {
                pushUniqueToolCall(stepToolCalls, call);
              }
            }
          }
        }

        for (const buffered of toolBuffers.values()) {
          if (!buffered.name) {
            continue;
          }
          pushUniqueToolCall(stepToolCalls, {
            id: buffered.id,
            name: buffered.name,
            arguments: parseJsonMaybe(buffered.argumentsText),
            rawArguments: buffered.argumentsText
          });
        }
      } else {
        const result = await this.generateWithProvider(provider, model, request, messages);
        stepText = result.text;
        text += result.text;
        stepFinishReason = result.finishReason;
        stepUsage = result.usage;
        stepRaw = result.raw;
        stepToolCalls.push(...result.toolCalls);

        if (result.text.length > 0) {
          yield { type: "text-delta", delta: result.text };
        }
      }

      finishReason = stepFinishReason;
      usage = mergeUsage(usage, stepUsage);
      raw = stepRaw ?? raw;

      for (const call of stepToolCalls) {
        toolCalls.push(call);
        yield {
          type: "tool-call",
          call
        };
      }

      if (!shouldExecuteTools || stepToolCalls.length === 0) {
        yield {
          type: "final",
          response: {
            text,
            toolCalls,
            toolResults,
            finishReason,
            usage,
            raw
          }
        };
        return;
      }

      messages.push({
        role: "assistant",
        content: stepText,
        toolCalls: stepToolCalls
      });

      const executed = await this.executeToolCalls(
        stepToolCalls,
        tools,
        attempt,
        provider.name,
        model
      );
      toolResults.push(...executed);
      for (const result of executed) {
        yield {
          type: "tool-result",
          result
        };
      }
      messages.push(...executed.map((item) => this.toToolMessage(item)));

      if (step === maxSteps - 1) {
        throw new ModelcadeError(
          "INVALID_REQUEST",
          `Reached maxSteps=${maxSteps} while tool calls were still being produced.`,
          { provider: provider.name, model, attempt }
        );
      }
    }
  }

  private async generateWithProvider(
    provider: ModelProvider,
    model: string,
    request: GatewayRequest,
    messages: ModelcadeMessage[]
  ): Promise<ProviderGenerateResult> {
    const providerRequest: ProviderRequest = {
      ...request,
      messages,
      model
    };

    try {
      return await provider.generate(providerRequest);
    } catch (error) {
      const detail = toErrorMessage(error);
      throw ModelcadeError.wrap(
        "PROVIDER_ERROR",
        `Provider "${provider.name}" failed during generate(): ${detail}`,
        error,
        { provider: provider.name, model }
      );
    }
  }

  private async executeToolCalls(
    calls: ToolCall[],
    tools: ToolDefinition[],
    attempt: number,
    provider: string,
    model: string
  ): Promise<ToolResult[]> {
    const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
    const output: ToolResult[] = [];

    for (const call of calls) {
      const tool = toolByName.get(call.name);
      if (!tool || !tool.execute) {
        output.push({
          toolCallId: call.id,
          name: call.name,
          error: `Tool "${call.name}" is not registered or does not define execute().`
        });
        continue;
      }

      try {
        const context: ToolExecutionContext = {
          attempt,
          provider,
          model,
          call
        };
        const result = await tool.execute(call.arguments, context);
        output.push({
          toolCallId: call.id,
          name: call.name,
          result
        });
      } catch (error) {
        output.push({
          toolCallId: call.id,
          name: call.name,
          error: toErrorMessage(error)
        });
      }
    }

    return output;
  }

  private toToolMessage(result: ToolResult): ModelcadeMessage {
    return {
      role: "tool",
      name: result.name,
      toolCallId: result.toolCallId,
      content: JSON.stringify(
        result.error ? { error: result.error } : { result: result.result ?? null }
      )
    };
  }

  private resolveRoutes(
    model: ModelTarget | undefined,
    fallback: ModelTarget[] | undefined
  ): ModelRoute[] {
    const primary = model ?? this.defaultModel;
    if (!primary) {
      throw new ModelcadeError(
        "INVALID_REQUEST",
        "No model target was supplied. Pass request.model or configure defaultModel."
      );
    }

    const chain: ModelTarget[] = [primary];
    if (fallback?.length) {
      chain.push(...fallback);
    } else if (this.defaultFallbacks?.length) {
      chain.push(...this.defaultFallbacks);
    }

    const seen = new Set<string>();
    const routes: ModelRoute[] = [];

    for (const target of chain) {
      const parsed = this.parseTarget(target);
      const key = `${parsed.provider}::${parsed.model}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(parsed);
      }
    }

    return routes;
  }

  private parseTarget(target: ModelTarget): ModelRoute {
    if (typeof target !== "string") {
      return {
        provider: target.provider,
        model: target.model
      };
    }

    const separatorIndex = target.indexOf(":");
    if (separatorIndex > 0) {
      const provider = target.slice(0, separatorIndex).trim();
      const model = target.slice(separatorIndex + 1).trim();
      if (!provider || !model) {
        throw new ModelcadeError(
          "MODEL_SPEC_INVALID",
          `Invalid model target "${target}". Expected "provider:model".`
        );
      }
      return { provider, model };
    }

    if (this.providers.size === 1) {
      const [provider] = this.providers.keys();
      return {
        provider,
        model: target
      };
    }

    throw new ModelcadeError(
      "MODEL_SPEC_INVALID",
      `Invalid model target "${target}". With multiple providers, use "provider:model".`
    );
  }

  private getProvider(name: string, model: string, attempt: number): ModelProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ModelcadeError(
        "PROVIDER_NOT_FOUND",
        `Provider "${name}" is not registered.`,
        { provider: name, model, attempt }
      );
    }
    return provider;
  }

  private normalizeAttemptError(
    error: unknown,
    route: ModelRoute,
    attempt: number
  ): ModelcadeError {
    if (error instanceof ModelcadeError) {
      if (
        error.provider === route.provider &&
        error.model === route.model &&
        error.attempt === attempt
      ) {
        return error;
      }

      return new ModelcadeError(error.code, error.message, {
        provider: error.provider ?? route.provider,
        model: error.model ?? route.model,
        attempt: error.attempt ?? attempt,
        cause: error.cause,
        details: error.details
      });
    }

    return ModelcadeError.wrap(
      "PROVIDER_ERROR",
      toErrorMessage(error),
      error,
      {
        provider: route.provider,
        model: route.model,
        attempt
      }
    );
  }

  private cloneMessages(messages: ModelcadeMessage[]): ModelcadeMessage[] {
    return messages.map((message) => ({
      ...message,
      content: Array.isArray(message.content)
        ? message.content.map((part) => ({ ...part }))
        : message.content,
      toolCalls: message.toolCalls?.map((call) => ({ ...call }))
    }));
  }
}

export function createModelcade(config: ModelcadeConfig): Modelcade {
  return new Modelcade(config);
}

function mergeUsage(
  current: TokenUsage | undefined,
  incoming: TokenUsage | undefined
): TokenUsage | undefined {
  if (!incoming) {
    return current;
  }

  return {
    inputTokens: sumMaybe(current?.inputTokens, incoming.inputTokens),
    outputTokens: sumMaybe(current?.outputTokens, incoming.outputTokens),
    totalTokens: sumMaybe(current?.totalTokens, incoming.totalTokens)
  };
}

function sumMaybe(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a !== "number" && typeof b !== "number") {
    return undefined;
  }
  return (a ?? 0) + (b ?? 0);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function pushUniqueToolCall(output: ToolCall[], call: ToolCall): void {
  const duplicate = output.some(
    (item) =>
      item.id === call.id &&
      item.name === call.name &&
      JSON.stringify(item.arguments) === JSON.stringify(call.arguments)
  );

  if (!duplicate) {
    output.push(call);
  }
}
