# Fallback Strategies

Fallbacks are first-class in `modelcade`.

## Per-Request Fallbacks

```ts
const result = await modelcade.generate({
  model: "openai:gpt-4.1-mini",
  fallback: ["anthropic:claude-3-5-sonnet-latest", "google:gemini-2.0-flash"],
  messages: [{ role: "user", content: "Draft a release note." }]
});
```

Routes are attempted in order.

## Default Fallbacks

```ts
const modelcade = createModelcade({
  providers: { openai, anthropic, google },
  defaultModel: "openai:gpt-4.1-mini",
  defaultFallbacks: ["anthropic:claude-3-5-sonnet-latest", "google:gemini-2.0-flash"]
});
```

## Attempt Diagnostics

Every response includes `attempts`:

- provider name
- model name
- duration
- error (if failed)

This is useful for:

- reliability dashboards
- fallback observability
- provider SLO tuning

## Model Target Syntax

With multiple providers, use:

```txt
provider:model
```

If only one provider is registered, `model` alone is accepted.
