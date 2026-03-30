# Provider Guide

`modelcade` ships with adapters for:

- OpenAI
- Anthropic
- Google Gemini

## OpenAI

```ts
import { createOpenAIProvider } from "@jamiojala/modelcade";

const openai = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!
});
```

Optional config:

- `baseUrl`
- `organization`
- `project`
- `headers`
- custom `fetch`

## Anthropic

```ts
import { createAnthropicProvider } from "@jamiojala/modelcade";

const anthropic = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultMaxTokens: 1024
});
```

Optional config:

- `baseUrl`
- `anthropicVersion`
- `defaultMaxTokens`
- `headers`
- custom `fetch`

## Google Gemini

```ts
import { createGoogleProvider } from "@jamiojala/modelcade";

const google = createGoogleProvider({
  apiKey: process.env.GOOGLE_API_KEY!
});
```

Optional config:

- `baseUrl`
- `headers`
- custom `fetch`

## Custom Providers

Implement the `ModelProvider` interface:

```ts
import type {
  ModelProvider,
  ProviderRequest,
  ProviderGenerateResult
} from "@jamiojala/modelcade";

const customProvider: ModelProvider = {
  name: "myprovider",
  async generate(_request: ProviderRequest): Promise<ProviderGenerateResult> {
    return {
      text: "hello",
      toolCalls: [],
      finishReason: "stop"
    };
  }
};
```

This lets you integrate private model gateways, on-prem model runtimes, or proxy APIs without changing app-level code.
