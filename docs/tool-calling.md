# Tool Calling

`modelcade` normalizes tool-calling across providers and can execute tools automatically.

## Define a Tool

```ts
import { defineTool } from "@jamiojala/modelcade";

const searchDocs = defineTool({
  name: "search_docs",
  description: "Search internal docs by query",
  schema: {
    type: "object",
    properties: {
      query: { type: "string" }
    },
    required: ["query"],
    additionalProperties: false
  },
  execute: async (args) => {
    const { query } = args as { query: string };
    return {
      query,
      matches: ["result-a", "result-b"]
    };
  }
});
```

## Use in Generation

```ts
const result = await modelcade.generate({
  model: "openai:gpt-4.1-mini",
  messages: [{ role: "user", content: "Find setup docs for webhooks." }],
  tools: [searchDocs]
});
```

## Execution Loop

When the model returns tool calls:

1. `modelcade` executes matching tool handlers.
2. Tool outputs are added as `tool` role messages.
3. Model execution continues until no more tool calls are returned.

Control via:

- `executeTools` (default `true`)
- `maxSteps` to cap iterative tool loops

## Error Semantics

- Missing tool handler: tool result contains `error`.
- Tool execution exception: captured as tool result `error`.
- Endless tool loops: throws when `maxSteps` is reached.
