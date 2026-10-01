import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncNotice } from "@/components/sync-notice";

describe("last Norish sync outcome", () => {
  it("shows auth failure and settings link without credential mutations or raw keys", () => {
    const html = renderToStaticMarkup(createElement(SyncNotice, { sync: { status: "error", reason: "auth", origin: "https://norish.example.invalid" } }));
    expect(html).toContain("Norish ha rifiutato la chiave");
    expect(html).toContain("norish.example.invalid");
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain("DELETE");
  });
  it("does not advise key reassociation for an older auth failure followed by success", () => {
    const html = renderToStaticMarkup(createElement(SyncNotice, { sync: { status: "ok", reason: null, origin: null } }));
    expect(html).not.toContain("Riassocia");
  });
});
