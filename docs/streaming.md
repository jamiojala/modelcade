# Streaming Contract

`modelcade.stream()` emits normalized events across providers.

## Event Types

- `attempt-start`: fallback attempt begins
- `text-delta`: incremental assistant text
- `tool-call`: normalized tool call discovered
- `tool-result`: local tool execution result
- `attempt-error`: provider attempt failed
- `done`: final normalized response object

## Example

```ts
for await (const event of modelcade.stream({
  model: "openai:gpt-4.1-mini",
  fallback: ["anthropic:claude-3-5-sonnet-latest"],
  messages: [{ role: "user", content: "Explain CQRS in three bullets." }]
})) {
  if (event.type === "text-delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "attempt-error") {
    console.error("Attempt failed:", event.error.message);
  }

  if (event.type === "done") {
    console.log("Final provider:", event.response.provider);
  }
}
```

## Behavior Notes

- If a provider supports native streaming, `modelcade` forwards real deltas.
- If not, `modelcade` falls back to single-shot generation and emits one `text-delta`.
- Tool calls are emitted as soon as they are assembled.
- Tool execution events are emitted before the next model turn.
