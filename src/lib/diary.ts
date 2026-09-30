/** View model mirrors diary_entries in ARCHITECTURE.md §4.5; demo only, no DB writes. */
export type Slot = "Breakfast" | "Lunch" | "Snack" | "Dinner";
export const slots: Slot[] = ["Breakfast", "Lunch", "Snack", "Dinner"];
export const slotLabels: Record<Slot, string> = { Breakfast: "Colazione", Lunch: "Pranzo", Snack: "Spuntino", Dinner: "Cena" };
export type DiaryEntry = {
  id: string; date: string; slot: Slot; entryType: "food" | "recipe";
  name: string; quantityGrams: number | null; servings: number | null;
  kcal: number | null; protein: number | null; fat: number | null; carbs: number | null;
  source: "manual" | "barcode" | "ai_label" | "norish_sync"; norishDeleted: boolean;
};

/** Calendar keys use the visitor's local day, not UTC or locale-dependent formatting. */
export function localDateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const demoDate = "2026-09-29";
export const demoEntries: DiaryEntry[] = [
  { id: "demo-1", date: demoDate, slot: "Breakfast", entryType: "food", name: "Yogurt greco e mirtilli", quantityGrams: 220, servings: null, kcal: 245, protein: 19, fat: 6, carbs: 28, source: "manual", norishDeleted: false },
  { id: "demo-2", date: demoDate, slot: "Lunch", entryType: "recipe", name: "Bowl di riso e verdure", quantityGrams: null, servings: 1, kcal: 620, protein: 24, fat: 18, carbs: 88, source: "norish_sync", norishDeleted: false },
  { id: "demo-3", date: demoDate, slot: "Snack", entryType: "food", name: "Mela e mandorle", quantityGrams: 160, servings: null, kcal: 195, protein: 5, fat: 11, carbs: 23, source: "manual", norishDeleted: false },
  { id: "demo-4", date: demoDate, slot: "Dinner", entryType: "recipe", name: "Pasta al pomodoro", quantityGrams: null, servings: 1, kcal: 540, protein: 18, fat: 14, carbs: 79, source: "norish_sync", norishDeleted: false },
  { id: "demo-5", date: "2026-09-28", slot: "Dinner", entryType: "recipe", name: "Zuppa di lenticchie", quantityGrams: null, servings: 1, kcal: null, protein: null, fat: null, carbs: null, source: "norish_sync", norishDeleted: false },
  { id: "demo-6", date: "2026-10-02", slot: "Lunch", entryType: "recipe", name: "Insalata mediterranea", quantityGrams: null, servings: 1, kcal: 460, protein: 14, fat: 22, carbs: 51, source: "norish_sync", norishDeleted: false },
];

export function dailySummary(entries: DiaryEntry[], date: string, target: number | null) {
  const today = entries.filter((entry) => entry.date === date);
  const bySlot = Object.fromEntries(slots.map((slot) => [slot, today.filter((entry) => entry.slot === slot).reduce((total, entry) => total + (entry.kcal ?? 0), 0)])) as Record<Slot, number>;
  const consumed = Object.values(bySlot).reduce((sum, value) => sum + value, 0);
  return { bySlot, consumed, remaining: target === null ? null : target - consumed, unknownCount: today.filter((entry) => entry.kcal === null).length, count: today.length };
}
export function addEntry(entries: DiaryEntry[], entry: DiaryEntry) { return [...entries, entry]; }
export function editEntry(entries: DiaryEntry[], id: string, update: Partial<DiaryEntry>) {
  return entries.map((entry) => entry.id === id ? { ...entry, ...update, source: "manual" as const } : entry);
}
/** Calendar date keys stay YYYY-MM-DD; UTC arithmetic avoids timezone-dependent shifts. */
export function shiftDate(date: string, delta: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}
export function monthDays(date: string) {
  const [year, month] = date.split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const last = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const length = Math.ceil((offset + last) / 7) * 7;
  return Array.from({ length }, (_, i) => shiftDate(first, i - offset));
}
export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", ...options }).format(new Date(`${date}T12:00:00Z`));
}
