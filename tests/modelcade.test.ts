import { describe, expect, it, vi } from "vitest";
import { createModelcade } from "../src/gateway";
import type { ModelProvider, ProviderRequest } from "../src/provider";

describe("modelcade", () => {
  it("falls back to the next route when the primary provider fails", async () => {
    const primary: ModelProvider = {
      name: "primary",
      async generate() {
        throw new Error("Primary down");
      }
    };

    const backup: ModelProvider = {
      name: "backup",
      async generate() {
        return {
          text: "Hello from backup",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    };

    const modelcade = createModelcade({
      providers: [primary, backup]
    });

    const result = await modelcade.generate({
      model: "primary:model-a",
      fallback: ["backup:model-b"],
      messages: [{ role: "user", content: "Hi" }]
    });

    expect(result.provider).toBe("backup");
    expect(result.model).toBe("model-b");
    expect(result.text).toBe("Hello from backup");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.error).toContain("Primary down");
  });

  it("executes tools and continues until final answer", async () => {
    let callCount = 0;

    const provider: ModelProvider = {
      name: "mock",
      async generate(request: ProviderRequest) {
        callCount += 1;

        if (callCount === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "call_1",
                name: "sum",
                arguments: { a: 2, b: 3 }
              }
            ],
            finishReason: "tool_calls"
          };
        }

        const toolMessage = request.messages.find((message) => message.role === "tool");
        expect(toolMessage).toBeDefined();

        return {
          text: "The answer is 5.",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    };

    const modelcade = createModelcade({
      providers: [provider]
    });

    const result = await modelcade.generate({
      model: "mock:model",
      messages: [{ role: "user", content: "What is 2+3?" }],
      tools: [
        {
          name: "sum",
          execute: async (args) => {
            const input = args as { a: number; b: number };
            return {
              value: input.a + input.b
            };
          }
        }
      ]
    });

    expect(callCount).toBe(2);
    expect(result.text).toBe("The answer is 5.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolResults[0]?.result).toEqual({ value: 5 });
  });

  it("streams text deltas and final done response", async () => {
    const provider: ModelProvider = {
      name: "streamer",
      async generate() {
        return {
          text: "unused",
          toolCalls: [],
          finishReason: "stop"
        };
      },
      async *stream() {
        yield { type: "text-delta" as const, delta: "Hello " };
        yield { type: "text-delta" as const, delta: "world" };
        yield {
          type: "done" as const,
          text: "Hello world",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    };

    const modelcade = createModelcade({ providers: [provider] });
    const events = [];

    for await (const event of modelcade.stream({
      model: "streamer:model",
      messages: [{ role: "user", content: "Say hello" }]
    })) {
      events.push(event);
    }

    const done = events.find((event) => event.type === "done");
    expect(done).toBeDefined();
    expect(events.filter((event) => event.type === "text-delta")).toHaveLength(2);
    expect(done && "response" in done ? done.response.text : "").toBe("Hello world");
  });

  it("falls back during streaming when an attempt fails", async () => {
    const failing: ModelProvider = {
      name: "failing",
      async generate() {
        throw new Error("not used");
      },
      async *stream() {
        throw new Error("stream failure");
      }
    };

    const backup: ModelProvider = {
      name: "backup",
      async generate() {
        return {
          text: "ok",
          toolCalls: [],
          finishReason: "stop"
        };
      },
      async *stream() {
        yield { type: "text-delta" as const, delta: "ok" };
        yield {
          type: "done" as const,
          text: "ok",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    };

    const modelcade = createModelcade({ providers: [failing, backup] });
    const events = [];

    for await (const event of modelcade.stream({
      model: "failing:model-a",
      fallback: ["backup:model-b"],
      messages: [{ role: "user", content: "hello" }]
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "attempt-error")).toBe(true);
    const done = events.find((event) => event.type === "done");
    expect(done && "response" in done ? done.response.provider : "").toBe("backup");
  });

  it("can infer provider when only one provider is registered", async () => {
    const provider: ModelProvider = {
      name: "solo",
      async generate() {
        return {
          text: "single provider",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    };

    const modelcade = createModelcade({ providers: [provider] });

    const result = await modelcade.generate({
      model: "gpt-like-model",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(result.provider).toBe("solo");
    expect(result.model).toBe("gpt-like-model");
  });

  it("returns unresolved tool calls when no local tools are registered", async () => {
    const provider: ModelProvider = {
      name: "mock",
      async generate() {
        return {
          text: "",
          toolCalls: [
            {
              id: "missing_tool_call",
              name: "missing_tool",
              arguments: {}
            }
          ],
          finishReason: "tool_calls"
        };
      }
    };

    const modelcade = createModelcade({ providers: [provider], maxSteps: 1 });

    const result = await modelcade.generate({
      model: "mock:model",
      messages: [{ role: "user", content: "run missing tool" }],
      tools: []
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolResults).toHaveLength(0);
  });

  it("surfaces fallback exhaustion", async () => {
    const failing: ModelProvider = {
      name: "broken",
      async generate() {
        throw new Error("always failing");
      }
    };

    const modelcade = createModelcade({ providers: [failing] });
    await expect(
      modelcade.generate({
        model: "broken:model",
        messages: [{ role: "user", content: "hey" }]
      })
    ).rejects.toThrow("All fallback routes failed");
  });

  it("passes tool execution context", async () => {
    const spy = vi.fn();

    let callCount = 0;
    const provider: ModelProvider = {
      name: "contextual",
      async generate() {
        callCount += 1;
        if (callCount === 1) {
          return {
            text: "",
            toolCalls: [{ id: "ctx", name: "ctxTool", arguments: { ok: true } }],
            finishReason: "tool_calls"
          };
        }
        return {
          text: "done",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    };

    const modelcade = createModelcade({ providers: [provider] });
    await modelcade.generate({
      model: "contextual:model",
      messages: [{ role: "user", content: "context please" }],
      tools: [
        {
          name: "ctxTool",
          execute: async (_args, context) => {
            spy(context);
            return { ok: true };
          }
        }
      ]
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      provider: "contextual",
      model: "model"
    });
  });
});
