import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health — health probe con controllo DB (stesso pattern di norish,
 * § 5.1): 200 quand'app + DB rispondono, 503 con dettaglio altrimenti.
 */
export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ok", database: "up", service: "syncloric" });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "down",
        message: error instanceof Error ? error.message : "errore db",
      },
      { status: 503 },
    );
  }
}