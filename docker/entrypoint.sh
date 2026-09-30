#!/bin/sh
# Entrypoint del container app (§ 3): le migrazioni e l'avvio scheduler sono
# gestiti dal bootstrap del server (src/instrumentation.ts, register()):
# il entrypoint serve solo la porta configurata.
# Compose supplies an empty string for an omitted optional API key.
# Keep the application schema strict: empty means absent only at this boundary.
if [ -z "${NORISH_API_KEY:-}" ]; then
  unset NORISH_API_KEY
fi
# Optional upstream: whitespace-only input means unset; preserve any explicit
# value unchanged so the application still rejects malformed URLs fail-fast.
case "${NORISH_BASE_URL:-}" in
  *[![:space:]]*) ;;
  *) unset NORISH_BASE_URL ;;
esac
exec node /app/server.js
