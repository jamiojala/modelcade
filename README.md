# `@jamiojala/modelcade`

[![CI](https://img.shields.io/github/actions/workflow/status/jamiojala/modelcade/ci.yml?branch=main&label=CI)](https://github.com/jamiojala/modelcade/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40jamiojala%2Fmodelcade)](https://www.npmjs.com/package/@jamiojala/modelcade)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)

Provider-agnostic TypeScript SDK for AI model access.

`modelcade` gives you one clean API across major model providers, with:

- normalized request/response types
- normalized streaming events
- tool-calling orchestration
- built-in fallback routing
- strict TypeScript ergonomics

## Why Modelcade

Most apps end up needing more than one provider for reliability, cost, or model quality. Raw provider SDKs have incompatible shapes for message formats, streaming, and tool use.

`modelcade` makes switching providers an implementation detail, not an architecture rewrite.

## Installation

```bash
pnpm add @jamiojala/modelcade
```

## Quick Start

```ts
import { createModelcade, createOpenAIProvider } from "@jamiojala/modelcade";

const modelcade = createModelcade({
  providers: {
    openai: createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!
    })
  },
  defaultModel: "openai:gpt-4.1-mini"
});

const result = await modelcade.generate({
  messages: [{ role: "user", content: "Write a short product slogan." }]
});

console.log(result.text);
```

## Fallbacks

```ts
const result = await modelcade.generate({
  model: "openai:gpt-4.1-mini",
  fallback: ["anthropic:claude-3-5-sonnet-latest", "google:gemini-2.0-flash"],
  messages: [{ role: "user", content: "Explain eventual consistency in 2 lines." }]
});
```

When a provider fails, `modelcade` automatically moves to the next route and returns per-attempt diagnostics in `result.attempts`.

## Streaming

```ts
for await (const event of modelcade.stream({
  model: "openai:gpt-4.1-mini",
  messages: [{ role: "user", content: "Stream me a haiku." }]
})) {
  if (event.type === "text-delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "done") {
    console.log("\nDone:", event.response.finishReason);
  }
}
```

## Tool Calling

```ts
import { defineTool } from "@jamiojala/modelcade";

const weatherTool = defineTool({
  name: "get_weather",
  description: "Return current weather by city",
  schema: {
    type: "object",
    properties: {
      city: { type: "string" }
    },
    required: ["city"],
    additionalProperties: false
  },
  execute: async (args) => {
    const { city } = args as { city: string };
    return { city, temperatureC: 9, conditions: "Cloudy" };
  }
});

const result = await modelcade.generate({
  model: "openai:gpt-4.1-mini",
  messages: [{ role: "user", content: "What is the weather in Helsinki?" }],
  tools: [weatherTool]
});
```

When tool calls are returned by a provider, `modelcade` executes tool handlers, appends tool messages, and continues the model loop until final assistant output (or `maxSteps` is reached).

## Providers

Built-in provider adapters:

- OpenAI: `createOpenAIProvider`
- Anthropic: `createAnthropicProvider`
- Google Gemini: `createGoogleProvider`

You can also implement custom providers via the `ModelProvider` interface.

## Examples

- [Basic OpenAI](/examples/basic-openai.ts)
- [Fallback Chain](/examples/fallback.ts)
- [Streaming](/examples/streaming.ts)
- [Tool Calling](/examples/tool-calling.ts)

## Docs

- [Getting Started](/docs/getting-started.md)
- [Provider Guide](/docs/providers.md)
- [Streaming Contract](/docs/streaming.md)
- [Tool Calling](/docs/tool-calling.md)
- [Fallback Strategies](/docs/fallbacks.md)
- [Architecture](/docs/architecture.md)

## Development

```bash
pnpm install
pnpm test
pnpm build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full workflow details.

## License

[MIT](./LICENSE)
