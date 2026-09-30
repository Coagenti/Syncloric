#!/bin/sh
# Entrypoint del container app (§ 3): le migrazioni e l'avvio scheduler sono
# gestiti dal bootstrap del server (src/instrumentation.ts, register()):
# il entrypoint serve solo la porta configurata.
# Compose supplies an empty string for an omitted optional API key.
# Keep the application schema strict: empty means absent only at this boundary.
if [ -z "${NORISH_API_KEY:-}" ]; then
  unset NORISH_API_KEY
fi
exec node /app/server.js