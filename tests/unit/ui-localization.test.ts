import { describe, expect, it } from "vitest";
import { english } from "@/lib/i18n/en";
import { translate } from "@/lib/i18n/translate";
import { normalizeUiPreferences } from "@/lib/ui-preferences";
import { parseLabel } from "@/server/services/ai/extract";

describe("UI localization and label barcodes", () => {
  it("translates interface copy without translating interpolated user data", () => {
    expect(translate("en", "Scegli {0}", { 0: "Colazione" })).toBe("Choose Colazione");
    expect(translate("it", "Scegli {0}", { 0: "Colazione" })).toBe("Scegli Colazione");
    expect(translate("en", " Obiettivo ")).toBe(" Target ");
    expect(translate("en", "Unknown server message")).toBe("Unknown server message");
    expect(translate("en", "Inserisci un anno di nascita intero tra 1926 e 2016 (età da 10 a 100 anni)."))
      .toBe("Enter a whole-number birth year between 1926 and 2016 (age 10 to 100).");
  });
  it("preserves all interpolation placeholders in the English catalog", () => {
    const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];
    for (const [source, translated] of Object.entries(english)) expect(placeholders(translated), source).toEqual(placeholders(source));
  });
  it("limits persisted appearance values to supported themes and languages", () => {
    expect(normalizeUiPreferences({ theme: "terminal", locale: "en" })).toEqual({ theme: "terminal", locale: "en" });
    expect(normalizeUiPreferences({ theme: "arasaka-red", locale: "it" })).toEqual({ theme: "arasaka-red", locale: "it" });
    expect(normalizeUiPreferences({ theme: "javascript:alert(1)", locale: "xx" })).toEqual({ theme: "cyberpunk", locale: "it" });
  });
  it("keeps visible barcode digits and leading zeros, while omitting unreadable optional codes", () => {
    const label = { name: "Latte", per100g: { kcal: 50, protein: 3, carbs: 5, fat: 2 } };
    expect(parseLabel(JSON.stringify({ ...label, barcode: "0001234567890" })).barcode).toBe("0001234567890");
    expect(parseLabel(JSON.stringify(label)).barcode).toBeUndefined();
    expect(parseLabel(JSON.stringify({ ...label, barcode: "123???" })).barcode).toBeUndefined();
    expect(() => parseLabel(JSON.stringify({ ...label, per100g: {} }))).toThrow();
  });
});
