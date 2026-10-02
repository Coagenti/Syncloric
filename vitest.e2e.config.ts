import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.spec.ts"],
    // This regression uses the Playwright driver and its real Next webServer.
    exclude: ["tests/e2e/contrast.spec.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});