import { describe, expect, it } from "vitest";
import { diaryDateUrl, mealDetailUrl } from "@/lib/diary";
import { foodEntryUrl, offProductUrl } from "@/lib/food-entry";

/**
 * Regressione CodeQL js/xss-through-dom: ogni href costruito da un valore dinamico
 * (data da <input type="date">, codice a barre digitato o letto dalla fotocamera)
 * deve passare da encodeURIComponent, così i meta-caratteri non arrivano mai
 * all'attributo href. Se qualcuno torna a interpolare a mano, questi test falliscono.
 *
 * Nota: encodeURIComponent non tocca l'apostrofo (insieme a ! ~ * ( )), che in un
 * attributo href delimitato da doppi apici non è pericoloso; la classe controllata
 * qui è quella che può chiudere l'attributo o iniettare markup.
 */
const htmlMeta = /[<>"&#]/;

describe("diaryDateUrl", () => {
  it("lascia intatta una data ISO valida", () => {
    expect(diaryDateUrl("2026-09-29")).toBe("/diary?date=2026-09-29");
  });
  it("gestisce la data vuota senza rompere il path", () => {
    expect(diaryDateUrl("")).toBe("/diary?date=");
  });
  it("percent-encoda i meta-caratteri invece di iniettarli nell'href", () => {
    const url = diaryDateUrl("2026-09-29&slot=Dinner#x\"<>");
    expect(htmlMeta.test(url)).toBe(false);
    expect(url).toBe("/diary?date=2026-09-29%26slot%3DDinner%23x%22%3C%3E");
    expect(url.startsWith("/diary?date=")).toBe(true);
  });
});

describe("offProductUrl", () => {
  it("lascia intatto un codice a barre numerico", () => {
    expect(offProductUrl("8001120001234")).toBe("https://world.openfoodfacts.org/product/8001120001234");
  });
  it("resta sull'host Open Food Facts anche con input ostile", () => {
    const url = offProductUrl("../../evil?x=<script>alert(1)</script>");
    expect(url.startsWith("https://world.openfoodfacts.org/product/")).toBe(true);
    expect(htmlMeta.test(url)).toBe(false);
    expect(url).not.toContain("/../");
  });
  it("non può diventare un URL javascript:", () => {
    const url = offProductUrl("javascript:alert(1)");
    expect(url.startsWith("https://")).toBe(true);
    expect(url).toBe("https://world.openfoodfacts.org/product/javascript%3Aalert(1)");
  });
});

describe("altri builder di href nello stesso modulo", () => {
  it("foodEntryUrl e mealDetailUrl encodano la data", () => {
    expect(foodEntryUrl("2026-09-29", "Lunch")).toBe("/diary/add?date=2026-09-29&slot=Lunch#ricerca");
    expect(mealDetailUrl("2026-09-29", "Dinner")).toBe("/diary/meal?date=2026-09-29&slot=Dinner");
    expect(foodEntryUrl("<x>", "Lunch")).toBe("/diary/add?date=%3Cx%3E&slot=Lunch#ricerca");
    expect(mealDetailUrl("<x>", "Lunch")).toBe("/diary/meal?date=%3Cx%3E&slot=Lunch");
  });
});
