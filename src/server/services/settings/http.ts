import { NextResponse } from "next/server";
import { type Db } from "@/server/db";
import {
  NORISH_SETTINGS_KEY,
  norishConfigStatus,
  norishBaseUrl,
  type NorishSettingsOverride,
} from "@/server/config";
import {
  deleteAdminSetting,
  getAdminSetting,
  setAdminSetting,
} from "@/server/db/repositories/settings";
import {
  buildAdminSettingsOverride,
  parseNorishUrlInput,
} from "@/server/services/settings/norish-url";

export const dynamic = "force-dynamic";

/** Dipendenze del modulo settings norish-url (composizione root testabile). */
export interface NorishUrlRouteDeps {
  /** Client DB (postgres.js in runtime, PGlite nei test di integrazione). */
  getDb: () => Db;
  /** Sessione Better Auth dal cookie (null se non autenticato). */
  getSession: (headers: Headers) => Promise<{
    user: { id: string; role?: string | null };
  } | null>;
}

function buildNorishUrlHandlers(deps: NorishUrlRouteDeps) {
  function effectiveOrigin(saved: string | null) {
    const url = norishBaseUrl(buildAdminSettingsOverride(saved ?? undefined));
    return url ? new URL(url).origin : null;
  }
  /**
   * Proiezione per la pagina Impostazioni: valore salvato dalla GUI (o null) +
   * norishConfigStatus (MAI segreti: l'API key resta solo in env, § 5.0). Il DB
   * passa dai repositories e l'override ai getter è la proiezione
   * { adminSettings } della tabella — nessuna mappa extra (t_797de62f).
   */
  async function settingsPayload(db: Db): Promise<{
    saved: string | null;
    status: ReturnType<typeof norishConfigStatus>;
  }> {
    const saved = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
    const override = buildAdminSettingsOverride(
      saved ?? undefined,
    ) as unknown as NorishSettingsOverride;
    return { saved, status: norishConfigStatus(override) };
  }

  async function requireAdmin(
    headers: Headers,
  ): Promise<NextResponse | null> {
    const session = await deps.getSession(headers);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Autenticazione richiesta." },
        { status: 401 },
      );
    }
    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Solo un amministratore può modificare le impostazioni dell'istanza." },
        { status: 403 },
      );
    }
    return null;
  }

  /** GET: proiezione per la pagina Impostazioni. */
  async function GET(request: Request): Promise<NextResponse> {
    const denied = await requireAdmin(request.headers);
    if (denied) return denied;
    return NextResponse.json(await settingsPayload(deps.getDb()), { status: 200 });
  }

  /** PUT: salva l'URL validato; stringa vuota = cancellazione (fallback su .env). */
  async function PUT(request: Request): Promise<NextResponse> {
    const denied = await requireAdmin(request.headers);
    if (denied) return denied;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Corpo della richiesta non valido (JSON atteso).", saved: false },
        { status: 400 },
      );
    }
    const url = (payload as { url?: unknown } | null)?.url;
    const parsed = parseNorishUrlInput(url);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, saved: false }, { status: 422 });
    }

    const db = deps.getDb();
    const before = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
    const previousOrigin = effectiveOrigin(before);
    if (parsed.value === "") {
      await deleteAdminSetting(db, NORISH_SETTINGS_KEY);
    } else {
      await setAdminSetting(db, NORISH_SETTINGS_KEY, parsed.value);
    }

    // Feedback di conferma per la GUI: nuovo valore + nuova fonte (Impostazioni / .env).
    return NextResponse.json(
      { ...(await settingsPayload(db)), saved_ok: true,
        hostChanged: previousOrigin !== effectiveOrigin(parsed.value || null) },
      { status: 200 },
    );
  }

  /** DELETE: cancella l'URL impostato (equivale a salvare il campo vuoto). */
  async function DELETE(request: Request): Promise<NextResponse> {
    const denied = await requireAdmin(request.headers);
    if (denied) return denied;
    const db = deps.getDb();
    const before = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
    await deleteAdminSetting(db, NORISH_SETTINGS_KEY);
    return NextResponse.json(
      { ...(await settingsPayload(db)), saved_ok: true,
        hostChanged: effectiveOrigin(before) !== effectiveOrigin(null) },
      { status: 200 },
    );
  }

  return { GET, PUT, DELETE };
}

export { buildNorishUrlHandlers };