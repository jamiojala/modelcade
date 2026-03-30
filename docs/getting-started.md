# Getting Started

`modelcade` is a universal gateway SDK for AI models.

Core idea: treat providers as interchangeable backends behind one typed API.

## Install

```bash
pnpm add @jamiojala/modelcade
```

## First Request

```ts
import { createModelcade, createOpenAIProvider } from "@jamiojala/modelcade";

const modelcade = createModelcade({
  providers: {
    openai: createOpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY!
    })
  }
});

const result = await modelcade.generate({
  model: "openai:gpt-4.1-mini",
  messages: [{ role: "user", content: "Say hello in one sentence." }]
});

console.log(result.text);
```

## Message Shape

`modelcade` uses a normalized message contract:

- `system`
- `user`
- `assistant`
- `tool`

Each message supports:

- `content` as string or structured parts
- optional `name`
- optional `toolCallId`
- optional `toolCalls` for assistant tool invocation history

## What You Get Back

`generate()` returns:

- final text
- finish reason
- tool calls + tool results
- token usage (provider permitting)
- fallback attempt diagnostics

For low-latency UX, use `stream()` and consume normalized events.
