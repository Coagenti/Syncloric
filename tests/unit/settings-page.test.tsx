import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: session } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => { throw new Error(`redirect:${target}`); },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NORISH_BASE_URL", "");
  vi.stubEnv("NORISH_API_KEY", undefined);
  resetEnvConfigCache();
  session.mockResolvedValue({ user: { id: "admin", role: "admin" } });
});

/**
 * Pagina /settings (server component, task GUI t_2bd5557f): legge il valore
 * salvato dai repositories e la proiezione norishConfigStatus, e passa gli
 * initial props alla client component SettingsNorishCard. Nessuna API call
 * client al primo render (nessun flash, § 2: i componenti UI non toccano il DB
 * direttamente — la pagina passa dai repositories server-side).
 */

vi.mock("@/server/db/repositories/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db/repositories/settings")>()),
  getAdminSetting: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDb: vi.fn(),
}));

import { GET as getNorishUrlRoute } from "@/app/api/v1/settings/norish-url/route";
import { getAdminSetting } from "@/server/db/repositories/settings";
import { settingsPageProps } from "@/server/services/settings/page-data";
import { NORISH_SETTINGS_KEY, resetEnvConfigCache } from "@/server/config";


// Env minima per norishConfigStatus → loadEnvConfig (fail-fast § 5.0): stessi
// valori fittizi del `base` di tests/unit/config.test.ts, senza segreti reali.
process.env.DATABASE_URL ??= "postgres://test@localhost:5432/syncloric";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(64);
process.env.ENCRYPTION_KEY ??= "a".repeat(64);

describe("settingsPageProps", () => {
  it("nega la lettura DB senza sessione", async () => {
    session.mockResolvedValue(null);
    await expect(settingsPageProps({} as never)).rejects.toThrow("redirect:/login");
    expect(getAdminSetting).not.toHaveBeenCalled();
  });

  it("nega la lettura DB a un non admin", async () => {
    session.mockResolvedValue({ user: { id: "user", role: "user" } });
    await expect(settingsPageProps({} as never)).resolves.toEqual({ access: "requires-admin" });
    expect(getAdminSetting).not.toHaveBeenCalled();
  });
  it("con chiave assente: initialSaved null e stato unset", async () => {
    const db = {
      select: undefined, // getAdminSetting mockato non USA questo db
    } as never;
    (getAdminSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const props = await settingsPageProps(db as never);
    if (!props.initialStatus) throw new Error("Expected administrator settings");
    expect(props.initialSaved).toBeNull();
    expect(props.initialStatus.enabled).toBe(false);
    expect(props.initialStatus.source).toBe("unset");
    expect(props.initialStatus.apiKeyPresent).toBe(false);
  });

  it("con chiave salvata: initialSaved = valore e stato source=gui via norishConfigStatus", async () => {
    (getAdminSetting as ReturnType<typeof vi.fn>).mockResolvedValue("https://gui.example.invalid");
    const props = await settingsPageProps({} as never);
    if (!props.initialStatus) throw new Error("Expected administrator settings");
    expect(props.initialSaved).toBe("https://gui.example.invalid");
    expect(props.initialStatus.source).toBe("gui");
    expect(props.initialStatus.enabled).toBe(true);
    expect(props.initialStatus.urlPresent).toBe(true);
    void NORISH_SETTINGS_KEY;
    void getNorishUrlRoute;
  });

  it("usa NORISH_SETTINGS_KEY ('norish.base_url') come chiave di persistenza", async () => {
    (getAdminSetting as ReturnType<typeof vi.fn>).mockClear();
    (getAdminSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await settingsPageProps({} as never);
    expect((getAdminSetting as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(NORISH_SETTINGS_KEY);
  });
});