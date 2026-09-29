#!/usr/bin/env node
/**
 * Runner per `pnpm db:migrate`: bundla src/server/db/migrate.ts con esbuild
 * (sistemando l'alias @/) poi lo esegue in node. Compattissimo e senza runtime
 * extra: tsx non copre gli alias tsconfig di sua iniziativa.
 */
const { build } = require("esbuild");
const path = require("path");

const root = path.resolve(__dirname, "..");

build({
  entryPoints: [path.join(root, "src/server/db/migrate.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: path.join(root, "node_modules/.cache/syncloric-db-migrate.cjs"),
  external: ["pg-native", "pino-pretty"],
  alias: { "@": path.join(root, "src") },
  logLevel: "warning",
})
  .then(() => require(path.join(root, "node_modules/.cache/syncloric-db-migrate.cjs")))
  .catch((error) => {
    console.error("[db:migrate] errore:", error);
    process.exit(1);
  });