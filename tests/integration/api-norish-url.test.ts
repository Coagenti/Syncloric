import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route GET/PUT/DELETE /api/v1/settings/norish-url (contratto GUI t_2bd5557f).
 * La sessione Better Auth è mockata (il plugin admin è già testato dalla
 * libreria) e il DB è PGlite: qui verifichiamo autorizzazione (role=admin),
 * proiezione di stato via norishConfigStatus, validazione input e persistenza.
 */

import { buildNorishUrlHandlers } from "@/server/services/settings/http";
import { NORISH_SETTINGS_KEY, norishConfigStatus, resetEnvConfigCache } from "@/server/config";
import { getAdminSetting, setAdminSetting, deleteAdminSetting } from "@/server/db/repositories/settings";
import type { Db } from "@/server/db";
import { closeTestDb, makeTestDb, resetTables, type TestDb } from "./setup";

const ADMIN = { user: { id: "u-admin", role: "admin" } };
const USER = { user: { id: "u-user", role: "user" } };

// Env minima per norishConfigStatus → loadEnvConfig (fail-fast § 5.0): gli
// stessi valori fittizi del `base` di tests/unit/config.test.ts, senza segreti.
process.env.DATABASE_URL ??= "postgres://test@localhost:5432/syncloric";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(64);
process.env.ENCRYPTION_KEY ??= "a".repeat(64);

describe("/api/v1/settings/norish-url (deps iniettate)", () => {
  let db: TestDb;
  let getSessionMock: ReturnType<typeof vi.fn<(headers: Headers) => Promise<{ user: { id: string; role?: string | null } } | null>>>;
  let handlers: ReturnType<typeof buildNorishUrlHandlers>;

  const makeRequest = (
    init: RequestInit = {},
  ): Request => new Request("http://localhost:3000/api/v1/settings/norish-url", init);

  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(closeTestDb);

  beforeEach(async () => {
    vi.stubEnv("NORISH_BASE_URL", "");
    vi.stubEnv("NORISH_API_KEY", undefined);
    resetEnvConfigCache();
    await resetTables(db);
    getSessionMock = vi.fn<
      (headers: Headers) => Promise<{ user: { id: string; role?: string | null } } | null>
    >();
    handlers = buildNorishUrlHandlers({
      getDb: () => db as unknown as Db,
      getSession: (headers: Headers) => getSessionMock(headers),
    });
  });

  afterEach(async () => {
    await resetTables(db);
    vi.unstubAllEnvs();
    resetEnvConfigCache();
  });

  it("GET risponde 401 senza sessione", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await handlers.GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("GET risponde 403 a un utente non admin", async () => {
    getSessionMock.mockResolvedValue(USER);
    const res = await handlers.GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("GET risponde 200 a un admin con proiezione di stato (nessun valore)", async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      saved: string | null;
      status: { enabled: boolean; source: string };
    };
    expect(body.saved).toBeNull();
    expect(body.status.enabled).toBe(false);
    expect(body.status.source).toBe("unset");
  });

  it("GET legge dal DB e usa l'override adminSettings (source=gui)", async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    await setAdminSetting(db, "norish.base_url", "https://from-db.example.invalid");
    const res = await handlers.GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: string | null; status: { source: string; enabled: boolean } };
    expect(body.saved).toBe("https://from-db.example.invalid");
    expect(body.status.source).toBe("gui");
    expect(body.status.enabled).toBe(true);
  });

  it("la proiezione non contiene mai valori di chiavi API", async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.GET(makeRequest());
    const text = JSON.stringify(await res.json());
    // ammesso SOLO il flag booleano di presenza (apiKeyPresent), mai un valore:
    expect(text).not.toMatch(/"apiKey"/);
    expect(text).not.toMatch(/"key":\s*"/);
    expect(text).not.toContain("secret");
  });

  it("PUT con URL valido persiste e conferma (200, stato coerente)", async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.PUT(
      makeRequest({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://round-trip.example.invalid" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      saved_ok: boolean;
      saved: string | null;
      status: { source: string; enabled: boolean };
    };
    expect(body.saved_ok).toBe(true);
    expect(body.saved).toBe("https://round-trip.example.invalid");
    expect(body.status.source).toBe("gui");
    expect(body.status.enabled).toBe(true);
    expect(await getAdminSetting(db, NORISH_SETTINGS_KEY)).toBe("https://round-trip.example.invalid");
  });

  it("PUT accetta il campo vuoto: cancellazione (fallback su .env)", async () => {
    await setAdminSetting(db, NORISH_SETTINGS_KEY, "https://to-clear.example.invalid");
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.PUT(
      makeRequest({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: " " }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await getAdminSetting(db, NORISH_SETTINGS_KEY)).toBeNull();
    const body = (await res.json()) as { saved: string | null; status: { source: string } };
    expect(body.saved).toBeNull();
    expect(body.status.source).toBe("unset");
  });

  it("PUT rifiuta un URL malformato con 422 e messaggio comprensibile, senza salvare", async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    await setAdminSetting(db, NORISH_SETTINGS_KEY, "https://unchanged.example.invalid");
    const res = await handlers.PUT(
      makeRequest({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "your norish url" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; saved: boolean };
    expect(body.error).toContain("URL");
    expect(body.saved).toBe(false);
    expect(await getAdminSetting(db, NORISH_SETTINGS_KEY)).toBe("https://unchanged.example.invalid");
  });

  it("PUT con corpo non-JSON risponde 400", async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.PUT(makeRequest({ method: "PUT", body: "not-json" }));
    expect(res.status).toBe(400);
  });

  it("PUT/DELETE senza autorizzazione NON toccano il DB", async () => {
    getSessionMock.mockResolvedValue(USER);
    await setAdminSetting(db, NORISH_SETTINGS_KEY, "https://keep.example.invalid");

    const putRes = await handlers.PUT(
      makeRequest({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://attacker.example.invalid" }),
      }),
    );
    expect(putRes.status).toBe(403);
    const delRes = await handlers.DELETE(makeRequest({ method: "DELETE" }));
    expect(delRes.status).toBe(403);
    expect(await getAdminSetting(db, NORISH_SETTINGS_KEY)).toBe("https://keep.example.invalid");
  });

  it("DELETE rimuove la chiave salvata (ritorno al fallback env)", async () => {
    await setAdminSetting(db, NORISH_SETTINGS_KEY, "https://to-delete.example.invalid");
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.DELETE(makeRequest({ method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await getAdminSetting(db, NORISH_SETTINGS_KEY)).toBeNull();
    expect(await deleteAdminSetting(db, NORISH_SETTINGS_KEY)).toBe(false);
  });

  it.each([
    [null, "https://new.example.invalid", true],
    ["https://old.example.invalid", "https://new.example.invalid", true],
    ["https://same.example.invalid/a", "https://same.example.invalid/b", false],
    ["https://same.example.invalid", "https://same.example.invalid:443", false],
    ["https://same.example.invalid", "https://same.example.invalid:8443", true],
    ["http://localhost:3000", "https://localhost:3000", true],
    ["https://old.example.invalid", "", true],
    [null, "", false],
  ])("PUT confronta l'origine effettiva %s → %s (hostChanged=%s)", async (before, url, changed) => {
    if (before) await setAdminSetting(db, NORISH_SETTINGS_KEY, before);
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.PUT(makeRequest({ method: "PUT", body: JSON.stringify({ url }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).hostChanged).toBe(changed);
  });

  it("PUT confronta anche il fallback env quando cancella l'override", async () => {
    vi.stubEnv("NORISH_BASE_URL", "https://fallback.example.invalid");
    resetEnvConfigCache();
    try {
      await setAdminSetting(db, NORISH_SETTINGS_KEY, "https://fallback.example.invalid/path");
      getSessionMock.mockResolvedValue(ADMIN);
      const res = await handlers.PUT(makeRequest({ method: "PUT", body: JSON.stringify({ url: "" }) }));
      const body = await res.json();
      expect(body.hostChanged).toBe(false);
      expect(body.status.source).toBe("env");
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["GET", "PUT", "DELETE"] as const)("%s senza sessione: 401 prima del DB", async (method) => {
    const getDb = vi.fn(() => db as unknown as Db);
    const routes = buildNorishUrlHandlers({ getDb, getSession: async () => null });
    expect((await routes[method](makeRequest({ method }))).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("DELETE avvisa se cambia origine tornando all'env", async () => {
    vi.stubEnv("NORISH_BASE_URL", "https://fallback.example.invalid");
    resetEnvConfigCache();
    await setAdminSetting(db, NORISH_SETTINGS_KEY, "https://gui.example.invalid");
    getSessionMock.mockResolvedValue(ADMIN);
    const res = await handlers.DELETE(makeRequest({ method: "DELETE" }));
    expect((await res.json()).hostChanged).toBe(true);
  });

  // Lo stato mostrato alla GUI passa da norishConfigStatus (contratto backend):
  it("lo stato della GUI è la proiezione norishConfigStatus dell'override", async () => {
    expect(norishConfigStatus({ adminSettings: { [NORISH_SETTINGS_KEY]: "https://x.example.invalid" } }).source).toBe("gui");
  });
});