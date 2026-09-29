#!/bin/sh
# Entrypoint del container app (§ 3): le migrazioni e l'avvio scheduler sono
# gestiti dal bootstrap del server (src/instrumentation.ts, register()):
# il entrypoint serve solo la porta configurata.
exec node /app/server.js