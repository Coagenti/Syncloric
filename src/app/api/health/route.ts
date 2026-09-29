import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — readiness dello scheletro. L'app parte solo se
 * l'env è valida (fail fast in server/config): se rispondiamo, la config è ok.
 * Il DB ha un probe dedicato su GET /api/v1/health (§ 5.1, pattern norish).
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "syncloric",
    version: "0.1.0",
  });
}