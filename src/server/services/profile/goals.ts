import { calculateCalorieTarget, type ActivityLevel } from "@/server/services/norish/sync";
import type { GoalCalculation, WeightGoal } from "@/lib/goal-targets";
type Input = { sex: "f" | "m"; heightCm: number; weightKg: number; birthYear: number; activityLevel: ActivityLevel; goal: "lose" | "maintain" | "gain"; weightGoal?: WeightGoal | null };
const DAY = 86400000;
/** Population-level Hall 2011 approximation, not the full NIH simulator or an individual forecast.
 * App policy: <=500 kcal/day, <=20% maintenance, <=0.5 kg/week, existing calorie floors.
 * Dates never create an unlimited deficit; expired/reached plans return to maintenance.
 */
export function calculateGoal(input: Input, now = new Date()): GoalCalculation {
  const maintenanceKcal = calculateCalorieTarget({ ...input, goal: "maintain" });
  const normal = calculateCalorieTarget(input);
  const base: GoalCalculation = { maintenanceKcal, calculatedTargetKcal: normal, appliedDeficitKcal: Math.max(0, maintenanceKcal - normal), requestedDeficitKcal: null, weeklyKg: null, suggestedDate: null, status: "standard", message: "" };
  if (input.goal !== "lose" || !input.weightGoal) return base;
  const today = Date.parse(now.toISOString().slice(0, 10));
  const days = (Date.parse(input.weightGoal.targetDate) - today) / DAY;
  const loss = input.weightKg - input.weightGoal.targetWeightKg;
  const maintenance = { ...base, calculatedTargetKcal: maintenanceKcal, appliedDeficitKcal: 0 };
  if (loss <= 0) return { ...maintenance, status: "reached", message: "Peso obiettivo raggiunto: il target torna al mantenimento." };
  if (days <= 0) return { ...maintenance, status: "expired", message: "Periodo concluso: il target torna al mantenimento. Puoi impostare un nuovo traguardo." };
  const bmi = input.weightKg / (input.heightCm / 100) ** 2;
  const targetBmi = input.weightGoal.targetWeightKg / (input.heightCm / 100) ** 2;
  if (now.getUTCFullYear() - input.birthYear < 18 || bmi < 25 || targetBmi < 18.5 || loss > input.weightKg * .1 + .0001 || days > 1096) return { ...maintenance, status: "unavailable", message: "La stima temporale è prevista per adulti con sovrappeso, in una prima fase fino al 10% del peso e senza un obiettivo di sottopeso. Per altri casi definisci il percorso con un professionista." };
  // The published rule gives ~22 kcal/day per kg at steady state and a ~1-year half-time.
  const requested = 22 * loss / -Math.expm1(-Math.LN2 * days / 365);
  const floor = input.sex === "f" ? 1200 : 1500;
  const cap = Math.max(0, Math.min(500, maintenanceKcal * .2, maintenanceKcal - floor));
  const target = Math.ceil((maintenanceKcal - Math.min(requested, cap)) / 5) * 5;
  const limited = requested > cap || loss / days * 7 > .5;
  const earliest = cap > 22 * loss ? Math.ceil(Math.max(-365 / Math.LN2 * Math.log1p(-22 * loss / cap), loss * 14)) : null;
  return { ...base, calculatedTargetKcal: target, appliedDeficitKcal: maintenanceKcal - target, requestedDeficitKcal: Math.round(requested), weeklyKg: Math.round(loss / days * 700) / 100, suggestedDate: limited && earliest !== null ? new Date(today + earliest * DAY).toISOString().slice(0, 10) : null, status: limited ? "limited" : "timeline", message: limited ? "La data richiede un deficit oltre i limiti prudenti dell’app. Allunga il periodo o riduci il primo traguardo." : "Stima orientativa: il peso cambia anche con metabolismo, attività e aderenza. La data non è una garanzia." };
}
