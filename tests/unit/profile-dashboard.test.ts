import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "@/components/calorie-views";
it("offers profile configuration without prescribing a remaining number", () => {
  const html = renderToStaticMarkup(createElement(DashboardView, { entries: [], date: "2026-01-01", target: null }));
  expect(html).toContain('href="/profile#obiettivo"');
  expect(html).toContain("Configura obiettivo");
  expect(html).not.toContain("kcal di differenza");
});
it("shows the configured target and coherent energy difference", () => {
  const html = renderToStaticMarkup(createElement(DashboardView, { entries: [], date: "2026-01-01", target: 2100 }));
  expect(html).toContain("Rimanenti");
  expect(html).toContain("2.100");
});
