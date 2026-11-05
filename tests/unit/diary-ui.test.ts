import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
import { MealDetailView } from "@/components/meal-detail";
import { addEntry, dailySummary, demoEntries, editEntry, monthDays, type DiaryEntry } from "@/lib/diary";

const entry: DiaryEntry = { id: "a", date: "2026-09-29", slot: "Breakfast", entryType: "food", name: "Avena", quantityGrams: 50, servings: null, kcal: 190, protein: 5, fat: 3, carbs: 30, source: "manual", norishDeleted: false };

describe("diario calorie", () => {
  it("aggregates four slots and leaves undefined energy out of totals", () => {
    const summary = dailySummary([entry, { ...entry, id: "b", slot: "Lunch", kcal: null }, { ...entry, id: "c", slot: "Snack", kcal: 90 }], "2026-09-29", 2100);
    expect(summary.consumed).toBe(280);
    expect(summary.remaining).toBe(1820);
    expect(summary.bySlot).toEqual({ Breakfast: 190, Lunch: 0, Snack: 90, Dinner: 0 });
    expect(summary.unknownCount).toBe(1);
  });
  it("adds a manual entry and edits only the selected entry without mutating the source", () => {
    const added = addEntry([entry], { ...entry, id: "b", slot: "Dinner", kcal: 420 });
    const edited = editEntry(added, "b", { name: "Pasta", kcal: 450 });
    expect(edited[0]).toEqual(entry);
    expect(edited[1].name).toBe("Pasta");
    expect(edited[1].kcal).toBe(450);
    expect(added[1].kcal).toBe(420);
  });
  it("builds a Monday-first month across year boundaries", () => {
    const days = monthDays("2026-01-15");
    expect(days[0]).toBe("2025-12-29");
    expect(days).toContain("2026-01-31");
    expect(days.length % 7).toBe(0);
  });
  it("uses singular Italian copy for one registered entry", () => {
    const html = renderToStaticMarkup(createElement(DashboardView, { entries: [entry], date: entry.date, target: null }));
    expect(html).toContain("1 voce registrata");
    expect(html).not.toContain("1 voce registrate");
  });
  it("renders dashboard summary and all four meal slots", () => {
    const html = renderToStaticMarkup(createElement(DashboardView, { entries: demoEntries, date: "2026-09-29", target: 2100 }));
    expect(html).toContain("Bilancio energetico");
    expect(html).toContain("Colazione");
    expect(html).toContain("Pranzo");
    expect(html).toContain("Spuntino");
    expect(html).toContain("Cena");
  });
  it("keeps the diary compact and links each meal to its dated detail", () => {
    const html = renderToStaticMarkup(createElement(DiaryView, { entries: demoEntries, date: "2026-09-29" }));
    expect(html).not.toContain("Yogurt greco e mirtilli");
    expect(html).not.toContain("entry-row");
    expect(html).toContain("/diary/meal?date=2026-09-29&amp;slot=Breakfast");
    expect(html).toContain("Proteine");
  });
  it("renders meal details with imported provenance and no unsupported edit controls", () => {
    const html = renderToStaticMarkup(createElement(MealDetailView, { entries: demoEntries, date: "2026-09-29", slot: "Lunch" }));
    expect(html).toContain("Da norish");
    expect(html).not.toContain("Modifica");
    expect(html).not.toContain("Aggiungi voce");
  });
  it("renders all diary sources in the calendar with an optional Norish filter", () => {
    const html = renderToStaticMarkup(createElement(CalendarView, { entries: demoEntries, date: "2026-09-29", onSelect: () => {} }));
    expect(html).toContain("Tutte le registrazioni");
    expect(html).toContain("Yogurt greco e mirtilli");
    expect(html).toContain("29");
    expect(html).toContain("norish");
  });
  it("does not round small known macro and micronutrient amounts to a false zero", () => {
    const html = renderToStaticMarkup(createElement(MealDetailView, { entries: [{ ...entry, nutrients: { protein: .01, vitaminD: .0001 } }], date: entry.date, slot: "Breakfast" }));
    expect(html).toContain("&lt;0,1");
    expect(html).toContain("0,0001");
  });
});
