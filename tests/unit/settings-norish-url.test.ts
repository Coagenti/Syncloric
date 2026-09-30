import { describe, expect, it } from "vitest";
import {
  buildAdminSettingsOverride,
  emptySettingsView,
  parseNorishUrlInput,
  toSettingsView,
} from "@/server/services/settings/norish-url";
import { NORISH_SETTINGS_KEY } from "@/server/config";

/**
 * Logica pura del servizio settings (contratto GUI t_2bd5557f, card backend
 * t_797de62f): validazione dell'input della pagina Impostazioni, proiezione
 * della vista (stato, MAI valori sensibili; l'URL NON è un segreto) e forma di
 * override { adminSettings } per i getter di @/server/config.
 */

describe("parseNorishUrlInput", () => {
  it("accetta la stringa vuota (cancellazione: fallback su .env)", () => {
    expect(parseNorishUrlInput("")).toEqual({ ok: true, value: "" });
    expect(parseNorishUrlInput("   ")).toEqual({ ok: true, value: "" });
  });

  it("trimma gli spazi esterni di un URL valido", () => {
    expect(parseNorishUrlInput("  https://norish.example.invalid  ")).toEqual({
      ok: true,
      value: "https://norish.example.invalid",
    });
  });

  it.each([
    "https://norish.coagenti.it",
    "http://localhost:8080",
    "https://norish.example.invalid/norish",
  ])("accetta un URL sintatticamente valido: %s", (value) => {
    expect(parseNorishUrlInput(value)).toEqual({ ok: true, value });
  });

  it.each([
    "your norish url",
    "norish.your.domain",
    "not-a-url",
    "ftp://example.invalid",
    "https://",
    "https://norish.coagenti.it/",
    "http://norish.example.invalid",
  ])("rifiuta un input non valido con un messaggio comprensibile: %s", (value) => {
    const parsed = parseNorishUrlInput(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("URL");
      expect(parsed.error).toContain("https");
    }
  });
});

describe("buildAdminSettingsOverride", () => {
  it("proietta il valore GUI nella forma dei getter @/server/config", () => {
    const override = buildAdminSettingsOverride("https://norish.example.invalid");
    expect(override).toEqual({
      adminSettings: { [NORISH_SETTINGS_KEY]: "https://norish.example.invalid" },
    });
  });

  it("con stringa vuota proietta la chiave VUOTA (non la omette)", () => {
    const override = buildAdminSettingsOverride("");
    expect(override).toEqual({ adminSettings: { [NORISH_SETTINGS_KEY]: "" } });
  });

  it("nessun valore → nessuna vista configurata (unset)", () => {
    expect(buildAdminSettingsOverride(undefined)).toEqual({ adminSettings: {} });
  });
});

describe("toSettingsView", () => {
  it("stato unset: nessun URL, niente placeholder di valore", () => {
    const view = toSettingsView({ enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false });
    expect(view).toEqual({
      statusText: "Norish non configurato",
      sourceText: null,
      enabled: false,
      urlPresent: false,
      apiKeyPresent: false,
    });
  });

  it("stato env: 'Configurato da: .env', senza esporre l'URL", () => {
    const view = toSettingsView({ enabled: true, source: "env", urlPresent: true, apiKeyPresent: false });
    expect(view.statusText).toBe("Norish configurato");
    expect(view.sourceText).toBe("Configurato da: .env");
    expect(JSON.stringify(view)).not.toContain("http");
  });

  it("stato gui: 'Configurato da: Impostazioni', abilitato", () => {
    const view = toSettingsView({ enabled: true, source: "gui", urlPresent: true, apiKeyPresent: true });
    expect(view.enabled).toBe(true);
    expect(view.sourceText).toBe("Configurato da: Impostazioni");
    expect(view.apiKeyPresent).toBe(true);
  });
});

describe("emptySettingsView", () => {
  it("è la vista di partenza prima del primo caricamento", () => {
    expect(emptySettingsView()).toEqual({
      statusText: "",
      sourceText: null,
      enabled: false,
      urlPresent: false,
      apiKeyPresent: false,
    });
  });
});