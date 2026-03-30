import {
  createAnthropicProvider,
  createGoogleProvider,
  createModelcade,
  createOpenAIProvider
} from "@jamiojala/modelcade";

async function main() {
  const modelcade = createModelcade({
    providers: {
      openai: createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY!
      }),
      anthropic: createAnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY!
      }),
      google: createGoogleProvider({
        apiKey: process.env.GOOGLE_API_KEY!
      })
    }
  });

  const result = await modelcade.generate({
    model: "openai:gpt-4.1-mini",
    fallback: ["anthropic:claude-3-5-sonnet-latest", "google:gemini-2.0-flash"],
    messages: [
      {
        role: "user",
        content: "Summarize what feature flags are in exactly 25 words."
      }
    ]
  });

  console.log("Provider:", result.provider);
  console.log("Model:", result.model);
  console.log("Output:", result.text);
  console.log("Attempts:", result.attempts);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
