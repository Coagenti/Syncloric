import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pagina /settings — scheda Norish URL (task GUI t_2bd5557f).
 * Il markup iniziale è verificato con renderToString/RSC-safe: etichetta,
 * placeholder, nessun valore precompilato, indicazione della fonte.
 * Le interazioni (salva/cancella) passano dagli helper esportati, qui testati
 * come contratto HTTP; il feedback è una funzione pura (feedbackMessage).
 */

const fetchJsonMock = vi.fn();

vi.mock("@/lib/http-client", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...(args as [unknown, unknown?])),
}));

import { renderToStaticMarkup } from "react-dom/server";
import {
  SettingsNorishCard,
  clearNorishUrl,
  feedbackMessage,
  saveNorishUrl,
} from "@/components/settings/settings-norish-card";

function lastCall(): { input: unknown; init: { method: string; body?: string } } {
  const call = fetchJsonMock.mock.calls.at(-1);
  if (!call) throw new Error("fetchJson non chiamato");
  return {
    input: call[0],
    init: (call[1] ?? {}) as { method: string; body?: string },
  };
}

describe("SettingsNorishCard — markup iniziale", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("etichetta 'Norish URL', placeholder 'your norish url', nessun valore precompilato", () => {
    const html = renderToStaticMarkup(
      <SettingsNorishCard
        initialSaved={null}
        initialStatus={{ enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false }}
      />,
    );
    expect(html).toContain("Norish URL");
    expect(html).toContain("your norish url");
    expect(html).toContain("border-cyber-border");
    expect(html).toContain("bg-cyber-surface");
    expect(html).not.toMatch(/value="http/);
  });

  it("stato unset: 'Norish non configurato', nessuna fonte mostrata", () => {
    const html = renderToStaticMarkup(
      <SettingsNorishCard
        initialSaved={null}
        initialStatus={{ enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false }}
      />,
    );
    expect(html).toContain("Norish non configurato");
    expect(html).not.toContain("Configurato da");
  });

  it("stato env: 'Configurato da: .env' e istruzione per l'override", () => {
    const html = renderToStaticMarkup(
      <SettingsNorishCard
        initialSaved={null}
        initialStatus={{ enabled: true, source: "env", urlPresent: true, apiKeyPresent: true }}
      />,
    );
    expect(html).toContain("Configurato da: .env");
    expect(html).toContain("Norish configurato");
  });

  it("stato gui: 'Configurato da: Impostazioni'", () => {
    const html = renderToStaticMarkup(
      <SettingsNorishCard
        initialSaved="https://from-gui.example.invalid"
        initialStatus={{ enabled: true, source: "gui", urlPresent: true, apiKeyPresent: false }}
      />,
    );
    expect(html).toContain("Configurato da: Impostazioni");
  });

  it("il Bottone salva e il bottone cancella sono presenti con etichette chiare", () => {
    const html = renderToStaticMarkup(
      <SettingsNorishCard
        initialSaved="https://x.example.invalid"
        initialStatus={{ enabled: true, source: "gui", urlPresent: true, apiKeyPresent: false }}
      />,
    );
    expect(html).toContain("Salva");
    expect(html).toContain("Cancella");
  });
});

describe("saveNorishUrl / clearNorishUrl (contratto API)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("saveNorishUrl fa PUT con { url } e ritorna il payload del server", async () => {
    fetchJsonMock.mockResolvedValue({
      saved: "https://new.example.invalid",
      saved_ok: true,
      status: { enabled: true, source: "gui", urlPresent: true, apiKeyPresent: false },
    });
    const result = await saveNorishUrl("https://new.example.invalid");
    const { input, init } = lastCall();
    expect(input).toBe("/api/v1/settings/norish-url");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body ?? "")).toEqual({ url: "https://new.example.invalid" });
    expect((result as { saved_ok: boolean }).saved_ok).toBe(true);
  });

  it("clearNorishUrl fa DELETE e ritorna lo stato aggiornato", async () => {
    fetchJsonMock.mockResolvedValue({
      saved: null,
      saved_ok: true,
      status: { enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false },
    });
    await clearNorishUrl();
    const { input, init } = lastCall();
    expect(input).toBe("/api/v1/settings/norish-url");
    expect(init.method).toBe("DELETE");
  });

  it("un 422 con messaggio è propagato per la visualizzazione dell'errore", async () => {
    fetchJsonMock.mockRejectedValue(
      new Error("URL non valido: inserisci un indirizzo completo con https o lascia il campo vuoto."),
    );
    await expect(saveNorishUrl("your norish url")).rejects.toThrow(/URL non valido/);
  });
});

describe("feedbackMessage (feedback di conferma, senza valori sensibili)", () => {
  it("avvisa subito quando cambia host", () => {
    expect(feedbackMessage({ ok: true, hostChanged: true, status: { enabled: true, source: "gui", urlPresent: true, apiKeyPresent: false } })).toBe("URL aggiornato: verifica le tue chiavi Norish");
  });
  it("campo vuoto con env conferma il fallback corretto", () => {
    expect(feedbackMessage({ ok: true, status: { enabled: true, source: "env", urlPresent: true, apiKeyPresent: false } })).toBe("URL Norish rimosso: ora l'app usa il file .env.");
  });
  it("salvataggio riuscito fonte GUI: conferma chiara", () => {
    expect(
      feedbackMessage({ ok: true, status: { enabled: true, source: "gui", urlPresent: true, apiKeyPresent: false } }),
    ).toBe("URL Norish salvato: ora l'app usa Impostazioni.");
  });

  it("salvataggio con campo vuoto: conferma il fallback su .env", () => {
    expect(
      feedbackMessage({ ok: true, status: { enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false } }),
    ).toBe("URL Norish rimosso: nessun URL configurato.");
  });

  it("errore di validazione: messaggio della API mostrato all'utente", () => {
    expect(feedbackMessage({ ok: false, error: "URL non valido" })).toBe("URL non valido");
  });
});