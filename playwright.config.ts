import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  workers: 1,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3177", launchOptions: { args: ["--no-sandbox"] } },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3177",
    url: "http://127.0.0.1:3177/dashboard",
    reuseExistingServer: false,
    env: {
      NORISH_BASE_URL: "http://127.0.0.1:9999",
      DATABASE_URL: "postgres://test:test@127.0.0.1:9999/test",
      BETTER_AUTH_SECRET: "playwright-fixture-not-a-real-secret-00000000",
      ENCRYPTION_KEY: "0".repeat(64),
    },
    timeout: 120_000,
  },
});
