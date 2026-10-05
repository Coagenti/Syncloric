#!/bin/sh
# Entrypoint del container app (§ 3): le migrazioni e l'avvio scheduler sono
# gestiti dal bootstrap del server (src/instrumentation.ts, register()):
# il entrypoint serve solo la porta configurata.
# Optional upstream: whitespace-only input means unset; preserve any explicit
# value unchanged so the application still rejects malformed URLs fail-fast.
case "${NORISH_BASE_URL:-}" in
  *[![:space:]]*) ;;
  *) unset NORISH_BASE_URL ;;
esac
exec node /app/server.js
