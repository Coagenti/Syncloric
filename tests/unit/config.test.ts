import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadEnvConfig,
  norishBaseUrl,
  norishConfigStatus,
  resetEnvConfigCache,
} from "@/server/config";

const base = {
  NODE_ENV: "test" as const,
  NORISH_BASE_URL: "https://norish.example.com",
  DATABASE_URL: "postgres://REDACTED@localhost:5432/syncloric",
  BETTER_AUTH_SECRET: "x".repeat(64),
  ENCRYPTION_KEY: "a".repeat(64),
};

describe("loadEnvConfig", () => {
  afterEach(() => {
    resetEnvConfigCache();
  });

  it("parsa un env valido con default PORT", () => {
    const config = loadEnvConfig({ ...base });
    expect(config.NORISH_BASE_URL).toBe("https://norish.example.com");
    expect(config.PORT).toBe(3000);
  });

  it.each([undefined, "", "   ", "\t\n"])(
    "lascia Norish non configurato (stringa vuota, niente fallback) per %j",
    (value) => {
      const config = loadEnvConfig({ ...base, NORISH_BASE_URL: value });
      expect(config.NORISH_BASE_URL).toBe("");
    },
  );

  it.each(["not-a-url", "ftp://example.invalid", "https://", "https:example.invalid", "https:///example.invalid", "https://norish.example.com/"])(
    "rifiuta NORISH_BASE_URL esplicitamente malformata: %j",
    (value) => {
      expect(() => loadEnvConfig({ ...base, NORISH_BASE_URL: value })).toThrow(/ADR-0007/);
      expect(() => loadEnvConfig({ ...base, NORISH_BASE_URL: value })).toThrow(/NORISH_BASE_URL/);
    },
  );

  it("rifiuta http non-locale (§ 9.2)", () => {
    expect(() =>
      loadEnvConfig({ ...base, NORISH_BASE_URL: "http://norish.example.com" }),
    ).toThrow(/localhost/);
  });

  it("accetta http su localhost (sviluppo, § 9.2)", () => {
    const config = loadEnvConfig({ ...base, NORISH_BASE_URL: "http://localhost:8080" });
    expect(config.NORISH_BASE_URL).toBe("http://localhost:8080");
  });

  it("rifiuta ENCRYPTION_KEY non hex-64", () => {
    expect(() =>
      loadEnvConfig({ ...base, ENCRYPTION_KEY: "z".repeat(64) }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it("rifiuta BETTER_AUTH_SECRET troppo corto", () => {
    expect(() =>
      loadEnvConfig({ ...base, BETTER_AUTH_SECRET: "corto" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("precedenza URL/chiave Norish (GUI > .env > vuoto)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfigCache();
  });

  /** Prepara process.env con le sole chiavi richieste (+ opzionali richieste dai casi). */
  function stubBaseEnv(extra: Record<string, string | undefined> = {}): void {
    vi.stubEnv("DATABASE_URL", base.DATABASE_URL);
    vi.stubEnv("BETTER_AUTH_SECRET", base.BETTER_AUTH_SECRET);
    vi.stubEnv("ENCRYPTION_KEY", base.ENCRYPTION_KEY);
    vi.stubEnv("NORISH_BASE_URL", extra.NORISH_BASE_URL ?? undefined);
    vi.stubEnv("NORISH_API_KEY", extra.NORISH_API_KEY ?? undefined);
  }

  it("usa l'env quando non c'è override GUI (source: env)", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    expect(norishBaseUrl()).toBe("https://from-env.example.invalid");
    expect(norishConfigStatus()).toEqual({
      enabled: true,
      source: "env",
      urlPresent: true,
      apiKeyPresent: false,
    });
  });

  it("senza env e senza GUI: URL vuoto, chiave assente, Norish disabilitato senza crash", () => {
    stubBaseEnv();
    resetEnvConfigCache();
    expect(norishBaseUrl()).toBe("");
    expect(norishConfigStatus()).toEqual({
      enabled: false,
      source: "unset",
      urlPresent: false,
      apiKeyPresent: false,
    });
  });

  it("l'URL salvato dalla GUI (sorgente settings DB, task GUI) prevale sull'env", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    const override = { adminSettings: { "norish.base_url": "https://from-gui.example.invalid" } };
    expect(norishBaseUrl(override)).toBe("https://from-gui.example.invalid");
    expect(norishConfigStatus(override)).toEqual({
      enabled: true,
      source: "gui",
      urlPresent: true,
      apiKeyPresent: false,
    });
    // Contratto di questa card: nessuna chiave API via GUI; resta quella env.
  });

  it.each(["", "   "])("override GUI vuoto (%j) NON copre l'env: ricade su .env", (empty) => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    const override = { adminSettings: { "norish.base_url": empty } };
    expect(norishBaseUrl(override)).toBe("https://from-env.example.invalid");
    expect(norishConfigStatus(override).source).toBe("env");
  });

  it("override GUI per chiave assente dall'oggetto ricade su env", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    expect(norishBaseUrl({ adminSettings: {} })).toBe("https://from-env.example.invalid");
    expect(norishConfigStatus({ adminSettings: {} }).source).toBe("env");
  });

  it("override GUI malformato è ignorato (fail-safe: ricade su env)", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    const override = { adminSettings: { "norish.base_url": "not-a-url" } };
    expect(norishBaseUrl(override)).toBe("https://from-env.example.invalid");
    expect(norishConfigStatus(override).source).toBe("env");
  });

  it("override GUI con URL valido ma senza chiave: enabled, chiave assente", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid" });
    resetEnvConfigCache();
    const override = { adminSettings: { "norish.base_url": "https://from-gui.example.invalid" } };
    expect(norishConfigStatus(override)).toEqual({
      enabled: true,
      source: "gui",
      urlPresent: true,
      apiKeyPresent: false,
    });
  });

  it("la proiezione per la GUI non espone i valori, solo il loro stato", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    expect(Object.keys(norishConfigStatus()).sort()).toEqual([
      "apiKeyPresent",
      "enabled",
      "source",
      "urlPresent",
    ]);
    expect(norishConfigStatus()).not.toHaveProperty("url");
    expect(norishConfigStatus()).not.toHaveProperty("apiKey");
  });

  it("la configurazione dell'URL non espone una chiave globale legacy", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid" });
    resetEnvConfigCache();
    const override = {
      adminSettings: {
        "norish.base_url": "https://from-gui.example.invalid",
        "norish.api_key": "gui-secret",
      },
    };
    expect(norishConfigStatus(override).apiKeyPresent).toBe(false);
    expect(JSON.stringify(norishConfigStatus(override))).not.toContain("gui-secret");
    expect(loadEnvConfig()).not.toHaveProperty("NORISH_API_KEY");
  });

  it("la cache del primo carico resta memorizzata (l'env non viene riletta implicitamente)", () => {
    stubBaseEnv({ NORISH_BASE_URL: "https://from-env.example.invalid", NORISH_API_KEY: "k1" });
    resetEnvConfigCache();
    expect(norishBaseUrl()).toBe("https://from-env.example.invalid");
    vi.stubEnv("NORISH_BASE_URL", "https://other.example.invalid");
    expect(loadEnvConfig().NORISH_BASE_URL).toBe("https://from-env.example.invalid");
  });
});
