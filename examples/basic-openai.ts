import { createModelcade, createOpenAIProvider } from "@jamiojala/modelcade";

async function main() {
  const modelcade = createModelcade({
    providers: {
      openai: createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY!
      })
    },
    defaultModel: "openai:gpt-4.1-mini"
  });

  const result = await modelcade.generate({
    messages: [{ role: "user", content: "Write a one-line launch announcement." }]
  });

  console.log(result.text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
