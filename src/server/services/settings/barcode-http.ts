import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { getBarcodeEnabled, setBarcodeEnabled } from "@/server/db/repositories/barcode-settings";
import { BARCODE_SETTINGS_KEY, parseBarcodeSettings } from "./barcode-config";

type AdminSession = { user: { id: string; role?: string | null } };
export type BarcodeAuditEvent = { actorUserId: string; key: typeof BARCODE_SETTINGS_KEY; before: boolean; after: boolean };
export interface BarcodeSettingsDeps {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<AdminSession | null>;
  /** Called inside the setting transaction: throwing rolls back both writes. */
  writeAudit?: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0], event: BarcodeAuditEvent) => Promise<void>;
}
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function buildBarcodeSettingsHandlers(deps: BarcodeSettingsDeps) {
  async function requireAdmin(headers: Headers): Promise<AdminSession | Response> {
    try {
      const session = await deps.getSession(headers);
      if (!session?.user) return json({ error: "Autenticazione richiesta." }, 401);
      if (session.user.role !== "admin") return json({ error: "Richiede amministratore." }, 403);
      return session;
    } catch { return json({ error: "Accesso temporaneamente non disponibile." }, 503); }
  }
  return {
    async GET(request: Request) {
      const auth = await requireAdmin(request.headers);
      if (auth instanceof Response) return auth;
      try { return json({ enabled: await getBarcodeEnabled(deps.getDb()) }); }
      catch { return json({ error: "Impostazioni Barcode non disponibili." }, 503); }
    },
    async PUT(request: Request) {
      const auth = await requireAdmin(request.headers);
      if (auth instanceof Response) return auth;
      if (!isAllowedRequestOrigin(request)) return json({ error: "Origine non consentita." }, 403);
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Invia dati JSON." }, 400);
      let value: { enabled: boolean };
      try { value = parseBarcodeSettings(await request.json()); }
      catch { return json({ error: "Indica un valore booleano per la ricerca Barcode." }, 400); }
      try {
        await deps.getDb().transaction(async tx => {
          const before = await getBarcodeEnabled(tx);
          await setBarcodeEnabled(tx, value.enabled);
          await deps.writeAudit?.(tx, { actorUserId: auth.user.id, key: BARCODE_SETTINGS_KEY, before, after: value.enabled });
        });
        return json({ enabled: value.enabled, saved_ok: true });
      } catch { return json({ error: "Non è stato possibile salvare le impostazioni Barcode." }, 503); }
    },
  };
}
