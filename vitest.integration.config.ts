import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration: in-memory PGlite (Postgres WASM) — niente Docker necessario in
 * locale (Docker assente su questo ambiente, § card): le stesse migrazioni
 * drizzle girano su un PG reale 17.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});