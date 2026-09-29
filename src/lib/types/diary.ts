/**
 * Tipi condivisi del diario (§ 4.5, § 5.4). Gli ENUM vivono in
 * src/server/db/schema.ts come colonne PG; qui i tipi TS puri per UI/client.
 */
export const DIARY_SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;
export type DiarySlot = (typeof DIARY_SLOTS)[number];

export const ENTRY_TYPES = ["food", "recipe"] as const;
export type DiaryEntryType = (typeof ENTRY_TYPES)[number];

export const DIARY_ENTRY_SOURCES = [
  "manual",
  "barcode",
  "ai_label",
  "norish_sync",
] as const;
export type DiaryEntrySource = (typeof DIARY_ENTRY_SOURCES)[number];

/** Data del diario come stringa YYYY-MM-DD (§ 10.2: nessun re-fuso). */
export type DiaryDate = string;

/** Chiave d'idempotenza sync per coppia utente/item (ADR-0008). */
export type NorishIdempotencyKey = {
  userId: string;
  norishItemId: string;
};