import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteAdminSetting,
  getAdminSetting,
  getAdminSettingOrDefault,
  setAdminSetting,
} from "@/server/db/repositories/settings";
import { closeTestDb, makeTestDb, resetTables, type TestDb } from "./setup";

/**
 * Repository admin_settings (§ 4.6) — contratto per il task GUI t_2bd5557f:
 * la pagina Impostazioni persiste l'URL Norish tramite queste funzioni.
 * Proietta la tabella singleton key/value (value jsonb); nessun default e
 * nessuna costruzione di mappe (il consumatore usa la proiezione
 * { adminSettings: Record<chiave, valore> } dei getter di @/server/config).
 */

describe("repository admin_settings", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
    await resetTables(db);
  });

  afterEach(async () => {
    await resetTables(db);
    await closeTestDb();
  });

  it("getAdminSetting su chiave assente ritorna null, senza lanciare", async () => {
    expect(await getAdminSetting(db, "norish.base_url")).toBeNull();
  });

  it("setAdminSetting + getAdminSetting round-trip della stringa", async () => {
    await setAdminSetting(db, "ai.provider", "openai");
    expect(await getAdminSetting(db, "ai.provider")).toBe("openai");
  });

  it("setAdminSetting è un upsert idempotente (sovrascrive il valore)", async () => {
    await setAdminSetting(db, "norish.base_url", "https://uno.example.invalid");
    await setAdminSetting(db, "norish.base_url", "https://due.example.invalid");
    expect(await getAdminSetting(db, "norish.base_url")).toBe("https://due.example.invalid");
  });

  it("il round-trip preserva il valore esatto (niente slash né trim impliciti)", async () => {
    await setAdminSetting(db, "norish.base_url", "https://norish.example.invalid");
    expect(await getAdminSetting(db, "norish.base_url")).toBe("https://norish.example.invalid");
    await setAdminSetting(db, "norish.base_url", "http://localhost:8080");
    expect(await getAdminSetting(db, "norish.base_url")).toBe("http://localhost:8080");
  });

  it("getAdminSettingOrDefault ritorna il default su chiave assente", async () => {
    expect(await getAdminSettingOrDefault(db, "barcode.timeout_ms", 5000)).toBe(5000);
  });

  it("getAdminSettingOrDefault ritorna il valore salvato quando esiste", async () => {
    await setAdminSetting(db, "barcode.timeout_ms", 9000);
    expect(await getAdminSettingOrDefault(db, "barcode.timeout_ms", 5000)).toBe(9000);
  });

  it("deleteAdminSetting rimuove la chiave e ritorna true", async () => {
    await setAdminSetting(db, "norish.base_url", "https://x.example.invalid");
    expect(await deleteAdminSetting(db, "norish.base_url")).toBe(true);
    expect(await getAdminSetting(db, "norish.base_url")).toBeNull();
  });

  it("deleteAdminSetting su chiave già assente ritorna false senza lanciare", async () => {
    expect(await deleteAdminSetting(db, "norish.base_url")).toBe(false);
  });
});