import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsContent } from "@/components/settings/settings-content";
it("admin sees four ordered sections and global administration description", () => {
  const html = renderToStaticMarkup(<SettingsContent initialSaved={null} initialStatus={{ enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false }} />);
  expect(html).toContain("Configurazione globale dell’istanza.");
  expect(html.indexOf('id="norish-url-heading"')).toBeLessThan(html.indexOf('id="ai-settings-title"'));
  expect(html.indexOf('id="ai-settings-title"')).toBeLessThan(html.indexOf('id="barcode-settings-title"'));
  expect(html.indexOf('id="barcode-settings-title"')).toBeLessThan(html.indexOf('id="admin-users-heading"'));
  expect(html).toContain(">Barcode</h2>");
  expect(html).toContain(">Utenti</h2>");
});
it("members see only the access notice and never administrative inputs or list", () => {
  const html = renderToStaticMarkup(<SettingsContent access="requires-admin" />);
  expect(html).toContain("Richiede amministratore"); expect(html).not.toContain("<input"); expect(html).not.toContain(">Utenti</h2>");
});
