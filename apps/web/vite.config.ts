import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { licenseNotices } from "../../scripts/licenseNotices.ts";

export default defineConfig({
  // Anki serves the app from a folder whose name depends on how it was installed.
  base: "./",
  plugins: [react(), tailwindcss(), licenseNotices()],
  build: {
    // Anki 25.09 ships Chromium 122; newer Anki versions only move this forward.
    target: "chrome122",
    outDir: resolve(import.meta.dirname, "../../addon/src/statly/web"),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
