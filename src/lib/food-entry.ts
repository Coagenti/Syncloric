import type { Nutrition } from "@/lib/nutrition";
import type { FoodPortion } from "@/lib/food-portions";
import type { Slot } from "@/lib/diary";

export type EntryFood = {
  id?: string; barcode?: string | null; name: string; brand: string | null;
  kcalPer100g: number | null; nutrientsPer100g: Nutrition;
  portions: FoodPortion[]; canEdit?: boolean; source?: string;
};
export type EntryRecipe = { id: string; name: string; kcalPerServing: number | null; nutrientsPerServing?: Nutrition };
export type FrequentFood = EntryFood & { id: string; uses: number; lastGrams: number | null };
export type EntryTab = "ricerca" | "scansione" | "etichetta";
export const entryTabs = ["ricerca", "scansione", "etichetta"] as const;
export function foodEntryUrl(date: string, slot: Slot, tab: EntryTab = "ricerca") {
  return `/diary/add?date=${encodeURIComponent(date)}&slot=${slot}#${tab}`;
}
export function foodEntryError(status: number) {
  if (status === 401) return "Autenticazione richiesta. Accedi per continuare.";
  if (status === 403) return "Operazione non consentita. Controlla l’accesso o ricarica la pagina.";
  if (status === 404) return "Alimento non trovato. Seleziona un altro prodotto o inseriscilo manualmente.";
  if (status === 400) return "Controlla nome, calorie, nutrienti, quantità e porzioni, poi riprova.";
  if (status === 409) return "I dati sono cambiati. Ricarica il prodotto prima di riprovare.";
  return "Non è stato possibile salvare. Verifica il diario prima di riprovare.";
}
