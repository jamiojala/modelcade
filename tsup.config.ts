import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/providers/openai.ts",
    "src/providers/anthropic.ts",
    "src/providers/google.ts"
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  splitting: false,
  treeshake: true,
  outDir: "dist"
});
