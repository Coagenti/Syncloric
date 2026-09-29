import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit (§ 3): legge DATABASE_URL dall'env (solo per push/studio — le
 * migrazioni versionate si generano con `pnpm db:generate`, niente introspezione
 * per generare). Schema unico: src/server/db/schema.ts.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});