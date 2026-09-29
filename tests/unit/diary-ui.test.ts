import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
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
  it("renders dashboard summary and all four meal slots", () => {
    const html = renderToStaticMarkup(createElement(DashboardView, { entries: demoEntries, date: "2026-09-29", target: 2100 }));
    expect(html).toContain("Bilancio energetico");
    expect(html).toContain("Colazione");
    expect(html).toContain("Pranzo");
    expect(html).toContain("Spuntino");
    expect(html).toContain("Cena");
  });
  it("renders dated diary entries with imported provenance and edit controls", () => {
    const html = renderToStaticMarkup(createElement(DiaryView, { entries: demoEntries, date: "2026-09-29", onEdit: () => {}, onAdd: () => {} }));
    expect(html).toContain("Da norish");
    expect(html).toContain("Modifica");
    expect(html).toContain("Aggiungi voce");
  });
  it("renders imported meals in the calendar with navigable day links", () => {
    const html = renderToStaticMarkup(createElement(CalendarView, { entries: demoEntries, date: "2026-09-29", onSelect: () => {} }));
    expect(html).toContain("Pasti importati");
    expect(html).toContain("29");
    expect(html).toContain("norish");
  });
});
