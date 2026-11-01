import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { licenseNotices } from "../../scripts/licenseNotices.ts";

/** One file with everything inside, because an MCP bundle has no install step. */
export default defineConfig({
  plugins: [licenseNotices()],
  build: {
    target: "node20",
    ssr: resolve(import.meta.dirname, "src/index.ts"),
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
  },
  ssr: { noExternal: true },
});
