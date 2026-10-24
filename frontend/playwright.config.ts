import { defineConfig, devices } from "@playwright/test";

// Starts its own backend (:8010) and Vite dev server (:5180) so it never touches other local servers.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:5180", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: "uvicorn app.main:app --port 8010",
      cwd: "../backend",
      url: "http://127.0.0.1:8010/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5180 --strictPort",
      env: { API_URL: "http://127.0.0.1:8010" },
      url: "http://127.0.0.1:5180",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
