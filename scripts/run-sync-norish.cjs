#!/usr/bin/env node
/**
 * Runner per `pnpm sync:norish`: sync manuale norish → Syncloric per UN utente
 * selezionato esplicitamente (stesso pattern launcher di run-db-migrate.cjs).
 *
 * Uso: pnpm sync:norish --user <uuid> [--period week|month]
 * La chiave arriva da env NORISH_API_KEY o dalla chiave cifrata per-utente
 * (mai argv, mai log); l'URL è risolto GUI > env al momento del comando.
 */
const { build } = require("esbuild");
const path = require("path");

const root = path.resolve(__dirname, "..");

build({
  entryPoints: [path.join(root, "src/server/services/norish/cli.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: path.join(root, "node_modules/.cache/syncloric-sync-norish.cjs"),
  external: ["pg-native", "pino-pretty"],
  alias: { "@": path.join(root, "src") },
  logLevel: "warning",
})
  .then(() => require(path.join(root, "node_modules/.cache/syncloric-sync-norish.cjs")))
  .catch(() => {
    console.error("[sync:norish] errore di avvio (parametri mancanti o errati)");
    process.exit(1);
  });