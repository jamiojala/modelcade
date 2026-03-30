import { createModelcade, createOpenAIProvider } from "@jamiojala/modelcade";

async function main() {
  const modelcade = createModelcade({
    providers: {
      openai: createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY!
      })
    }
  });

  for await (const event of modelcade.stream({
    model: "openai:gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: "Write a 4-line launch update. Stream it naturally."
      }
    ]
  })) {
    if (event.type === "attempt-start") {
      console.log(`\n[attempt ${event.attempt}] ${event.provider}:${event.model}`);
    }

    if (event.type === "text-delta") {
      process.stdout.write(event.delta);
    }

    if (event.type === "attempt-error") {
      console.error(`\nAttempt failed: ${event.error.message}`);
    }

    if (event.type === "done") {
      console.log("\n\nFinish reason:", event.response.finishReason);
      console.log("Usage:", event.response.usage);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
