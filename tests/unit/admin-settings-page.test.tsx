import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsContent } from "@/components/settings/settings-content";
it("admin initially sees general preferences and tabs for global administration", () => {
  const html = renderToStaticMarkup(<SettingsContent initialSaved={null} initialStatus={{ enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false }} />);
  expect(html).toContain("configurazione globale dell’istanza");
  expect(html).toContain('id="settings-tab-scansione"');
  expect(html).toContain('id="settings-tab-utenti"');
  expect(html).toContain("Riduci animazioni");
  expect(html).not.toContain("Provider AI");
});
it("members manage their own Norish key without administrative controls", () => {
  const html = renderToStaticMarkup(<SettingsContent access="requires-admin" />);
  expect(html).toContain('id="settings-tab-norish"');
  expect(html).not.toContain('id="settings-tab-scansione"'); expect(html).not.toContain('id="settings-tab-utenti"');
  expect(html).not.toContain("Provider AI");
});
