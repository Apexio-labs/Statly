import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://127.0.0.1:5199", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "pnpm exec vite --port 5199 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: true,
  },
});
