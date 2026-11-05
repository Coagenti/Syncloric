import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — readiness dell'app e identità dell'artefatto in esecuzione.
 *
 * La versione arriva da package.json (bundled al build), non da un literal: prima era
 * una costante "0.1.0" e non permetteva di dire cosa stesse girando davvero.
 * `commit` e `digest` arrivano dal deployment: il primo è iniettato come build-arg
 * (`SYNCLORIC_COMMIT`, default "unknown"), il secondo lo passa chi esegue il pull
 * dell'immagine. Servono a verificare dall'esterno che produzione e `main` coincidano
 * senza dover entrare nel container.
 */
export function GET() {
  const commit = process.env.SYNCLORIC_COMMIT?.trim() || "unknown";
  const digest = process.env.SYNCLORIC_DIGEST?.trim();

  return NextResponse.json(
    {
      status: "ok",
      service: "syncloric",
      version: pkg.version,
      commit,
      ...(digest ? { digest } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
