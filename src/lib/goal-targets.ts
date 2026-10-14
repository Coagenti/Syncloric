import { z } from "zod";
export const weightGoalSchema = z.object({ targetWeightKg: z.number().positive().max(999.9).multipleOf(.1), targetDate: z.iso.date() }).strict();
export type WeightGoal = z.infer<typeof weightGoalSchema>;
export const macroSettingsSchema = z.object({ mode: z.enum(["auto", "custom"]), style: z.enum(["balanced", "strength", "endurance"]), carbs: z.number().int().min(45).max(60), protein: z.number().int().min(10).max(35), fat: z.number().int().min(20).max(35) }).strict().refine(v => v.carbs + v.protein + v.fat === 100, "Le percentuali devono sommare 100.");
export type MacroSettings = z.infer<typeof macroSettingsSchema>;
export const defaultMacroSettings: MacroSettings = { mode: "auto", style: "balanced", carbs: 55, protein: 15, fat: 30 };
export type MacroGoals = { percentages: { carbs: number; protein: number; fat: number }; grams: { carbs: number; protein: number; fat: number }; kcal: number; source: "auto" | "custom"; label: string };
function presetPercentages(settings: MacroSettings, goal = "maintain", activity = "sedentary") {
  if (settings.mode === "custom") return { carbs: settings.carbs, protein: settings.protein, fat: settings.fat, label: "Personalizzato" };
  if (settings.style === "strength" || goal === "gain") return { carbs: 45, protein: 25, fat: 30, label: "Forza e massa" };
  if (settings.style === "endurance") return { carbs: 55, protein: 20, fat: 25, label: "Attività di resistenza" };
  if (goal === "lose") return { carbs: 50, protein: 20, fat: 30, label: "Perdita di peso" };
  if (["moderate", "active", "very_active"].includes(activity)) return { carbs: 50, protein: 20, fat: 30, label: "Vita attiva" };
  return { carbs: 55, protein: 15, fat: 30, label: "Equilibrato" };
}
/** Convert a protein reference in g/kg to energy %, then fit the adult intake ranges.
 * Factors within published ranges are app starting points, not individualized prescriptions.
 */
export function macroPercentages(settings: MacroSettings, goal = "maintain", activity = "sedentary", weightKg?: number, kcal?: number | null) {
  const preset = presetPercentages(settings, goal, activity);
  if (settings.mode === "custom" || !weightKg || !kcal || weightKg <= 0 || kcal <= 0) return preset;
  const factor = settings.style !== "balanced" || goal === "gain" ? 1.6 : goal === "lose" ? 1.4 : ["active", "very_active"].includes(activity) ? 1.2 : activity === "moderate" ? 1 : .83;
  const protein = Math.max(10, Math.min(35, Math.ceil(weightKg * factor * 400 / kcal)));
  const fat = Math.max(20, Math.min(preset.fat, 100 - protein - 45));
  const carbs = Math.min(60, 100 - protein - fat);
  return { carbs, protein, fat: 100 - carbs - protein, label: preset.label };
}
export function macroGoals(kcal: number | null, settings: MacroSettings, goal?: string, activity?: string, weightKg?: number): MacroGoals | null {
  if (kcal === null || !Number.isFinite(kcal) || kcal <= 0) return null;
  const { label, ...percentages } = macroPercentages(settings, goal, activity, weightKg, kcal);
  return { kcal, percentages, grams: { carbs: Math.round(kcal * percentages.carbs / 4) / 100, protein: Math.round(kcal * percentages.protein / 4) / 100, fat: Math.round(kcal * percentages.fat / 9) / 100 }, label, source: settings.mode };
}
export type GoalCalculation = { maintenanceKcal: number; calculatedTargetKcal: number; appliedDeficitKcal: number; requestedDeficitKcal: number | null; weeklyKg: number | null; suggestedDate: string | null; status: "standard" | "timeline" | "limited" | "expired" | "reached" | "unavailable"; message: string };
export const goalSources = {
  who: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
  weight: "https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program",
  dynamics: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/",
  carbs: "https://www.efsa.europa.eu/en/efsajournal/pub/1462",
  fat: "https://www.efsa.europa.eu/en/efsajournal/pub/1461",
  protein: "https://www.efsa.europa.eu/en/efsajournal/pub/2557",
  sport: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/",
  lossProtein: "https://pubmed.ncbi.nlm.nih.gov/25926512/",
  amdr: "https://www.ncbi.nlm.nih.gov/books/NBK610333/",
};
