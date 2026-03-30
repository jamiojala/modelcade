import { createModelcade, createOpenAIProvider, defineTool } from "@jamiojala/modelcade";

const getWeather = defineTool({
  name: "get_weather",
  description: "Return weather conditions for a city.",
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
    return {
      city,
      temperatureC: 10,
      conditions: "Cloudy",
      source: "example-data"
    };
  }
});

async function main() {
  const modelcade = createModelcade({
    providers: {
      openai: createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY!
      })
    }
  });

  const result = await modelcade.generate({
    model: "openai:gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: "What is the weather in Helsinki today?"
      }
    ],
    tools: [getWeather]
  });

  console.log(result.text);
  console.log("Tool calls:", result.toolCalls);
  console.log("Tool results:", result.toolResults);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
