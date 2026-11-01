import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const outDir = resolve(import.meta.dirname, "../../addon/src/statly/modules/mobile");

/**
 * Builds the script inside the Anki card. It must stay small and free of dependencies, and it is
 * left unminified on purpose: a minifier can produce double braces, which Anki reads as fields.
 */
export default defineConfig({
  build: {
    target: "safari15",
    minify: false,
    emptyOutDir: false,
    outDir,
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      formats: ["iife"],
      name: "StatlyCard",
      fileName: () => "viewer.js",
    },
  },
  plugins: [
    {
      name: "copy-card-styles",
      closeBundle() {
        copyFileSync(resolve(import.meta.dirname, "src/card.css"), resolve(outDir, "card.css"));
      },
    },
  ],
  test: { environment: "jsdom" },
});
