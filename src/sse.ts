import { ModelcadeError } from "./errors";

const SSE_SPLIT = /\r?\n\r?\n/;

export async function* readSseData(
  response: Response
): AsyncGenerator<string, void, unknown> {
  if (!response.body) {
    throw new ModelcadeError(
      "STREAM_ERROR",
      "Response body was empty for an SSE stream."
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(SSE_SPLIT);
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/);
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length > 0) {
        yield dataLines.join("\n");
      }
    }
  }

  buffer += decoder.decode();
  const lines = buffer.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length > 0) {
    yield dataLines.join("\n");
  }
}
