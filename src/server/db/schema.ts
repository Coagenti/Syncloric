import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Modello dati minimo Syncloric — docs/ARCHITECTURE.md § 4.
 * Idempotenza sync per coppia utente/item: ADR-0008 (nessuna unicità globale
 * su diary_entries.norish_item_id).
 *
 * Convenzioni: PK uuid default gen_random_uuid(); timestamp con timezone;
 * ricette norish mirroate localmente (ADR-0005); macro snapshottati (§ 4.5).
 */

export const slotEnum = pgEnum("slot", ["Breakfast", "Lunch", "Dinner", "Snack"]);
export const entryTypeEnum = pgEnum("entry_type", ["food", "recipe"]);
export const diarySourceEnum = pgEnum("diary_source", [
  "manual",
  "barcode",
  "ai_label",
  "norish_sync",
]);
export const sexEnum = pgEnum("sex", ["f", "m"]);
export const activityLevelEnum = pgEnum("activity_level", [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);
export const goalEnum = pgEnum("goal", ["lose", "maintain", "gain"]);
export const targetSourceEnum = pgEnum("target_source", ["manual", "calculated"]);
export const foodSourceEnum = pgEnum("food_source", ["manual", "barcode_off", "ai_label"]);
export const syncStatusEnum = pgEnum("sync_status", ["ok", "error", "partial"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** § 4.1 — Better Auth (username+password): core schema v1.7 — users/sessions/accounts/verifications. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    username: text("username").notNull().unique(),
    email: text("email"), // display-only, mai verificata (nessun SMTP, § 1)
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name"),
    // 'user' | 'admin' — il primo utente su istanza vuota diventa admin (§ 4.1);
    // plugin `admin` di Better Auth gestisce ruoli e ban.
    role: text("role").notNull().default("user"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    displayUsername: text("display_username"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    image: text("image"),
    ...timestamps,
  },
  (t) => [index("users_role_idx").on(t.role)],
);

export const sessions = pgTable("sessions", {
  // tabelle standard Better Auth: colonne core + plugin (admin → ban)
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  activeOrganizationId: text("active_organization_id"),
  ...timestamps,
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"), // hash scrypt (default Better Auth, § 6.3)
  ...timestamps,
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/** § 4.2 — Profilo e obiettivo calorico (Mifflin-St Jeor, § 4.3). */
export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    sex: sexEnum("sex").notNull(),
    heightCm: integer("height_cm").notNull(),
    weightKg: numeric("weight_kg", { precision: 5, scale: 1 }).notNull(),
    birthYear: integer("birth_year").notNull(),
    activityLevel: activityLevelEnum("activity_level").notNull(),
    goal: goalEnum("goal").notNull(),
    targetSource: targetSourceEnum("target_source").notNull().default("calculated"),
    manualTargetKcal: integer("manual_target_kcal"),
    calculatedTargetKcal: integer("calculated_target_kcal"),
    recalculatedAt: timestamp("recalculated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("profiles_user_id_unique").on(t.userId)],
);

/** § 4.4 — Cibi (convenzione UE: nutrienti per 100 g/ml; cibi condivisi nell'istanza). */
export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode"),
    kcalPer100g: integer("kcal_per_100g").notNull(),
    proteinPer100g: numeric("protein_per_100g", { precision: 6, scale: 2 }),
    fatPer100g: numeric("fat_per_100g", { precision: 6, scale: 2 }),
    carbsPer100g: numeric("carbs_per_100g", { precision: 6, scale: 2 }),
    servingGrams: integer("serving_grams"),
    servingLabel: text("serving_label"),
    source: foodSourceEnum("source").notNull().default("manual"),
    sourcePayload: jsonb("source_payload"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("foods_barcode_unique").on(t.barcode),
    index("foods_name_idx").on(t.name),
  ],
);

/** § 4.4 — Mirror ricette norish con snapshot JSONB completo (ADR-0005). */
export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    norishRecipeId: uuid("norish_recipe_id"),
    name: text("name").notNull(),
    servings: integer("servings").notNull(),
    kcalPerServing: integer("kcal_per_serving"),
    // nota § 5.3: norish serializza i macro come stringhe decimali ("27.40")
    proteinPerServing: text("protein_per_serving"),
    fatPerServing: text("fat_per_serving"),
    carbsPerServing: text("carbs_per_serving"),
    snapshot: jsonb("snapshot").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("recipes_norish_recipe_id_unique").on(t.norishRecipeId)],
);

/** § 4.5 — Diario (tabella centrale): macro snapshottati, idempotenza ADR-0008. */
export const diaryEntries = pgTable(
  "diary_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(), // YYYY-MM-DD: chiave stringa, nessun re-fuso (§ 10.2)
    slot: slotEnum("slot").notNull(),
    entryType: entryTypeEnum("entry_type").notNull(),
    foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    quantityGrams: numeric("quantity_grams", { precision: 8, scale: 2 }),
    servings: numeric("servings", { precision: 8, scale: 2 }),
    kcal: integer("kcal"),
    protein: numeric("protein", { precision: 8, scale: 2 }),
    fat: numeric("fat", { precision: 8, scale: 2 }),
    carbs: numeric("carbs", { precision: 8, scale: 2 }),
    source: diarySourceEnum("source").notNull().default("manual"),
    // ADR-0008: NULL = voce manuale non sincronizzata. MAI unique globale.
    norishItemId: uuid("norish_item_id"),
    // § 5.4: item upstream non più nel payload → marcato, non cancellato (no-autodelete)
    norishDeleted: boolean("norish_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    // Indici di query non-univoci (dashboard/registro, § 4.5)
    index("diary_entries_user_date_idx").on(t.userId, t.date),
    index("diary_entries_user_date_slot_item_idx").on(
      t.userId,
      t.date,
      t.slot,
      t.norishItemId,
    ),
    // Vincolo d'idempotenza sync: UNICO posto in cui l'unicità esiste (ADR-0008).
    // Conflict target dell'upsert § 5.4: la coppia (user_id, norish_item_id)
    // con questo WHERE; date/slot fuori dalla chiave (possono cambiare upstream).
    uniqueIndex("diary_entries_user_norish_item_unique")
      .on(t.userId, t.norishItemId)
      .where(sql`norish_item_id IS NOT NULL`),
  ],
);

/** § 4.6 — Audit/diagnostica dei run sync (audit + circuit breaker, § 5.5). */
export const norishSyncRuns = pgTable(
  "norish_sync_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: syncStatusEnum("status").notNull(),
    itemsUpserted: integer("items_upserted").notNull().default(0),
    errorMessage: text("error_message"),
    reason: text("reason"), // 'auth' per HTTP 401/403; null per altri esiti
  },
  (t) => [index("norish_sync_runs_user_started_idx").on(t.userId, t.startedAt)],
);

/** § 4.6 — Impostazioni admin singleton (chiavi: ai.*, barcode.*). */
export const adminSettings = pgTable("admin_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
});

/** Relations per drizzle query API (relational queries). */
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  diaryEntries: many(diaryEntries),
  syncRuns: many(norishSyncRuns),
}));

export const diaryEntriesRelations = relations(diaryEntries, ({ one }) => ({
  user: one(users, { fields: [diaryEntries.userId], references: [users.id] }),
  food: one(foods, { fields: [diaryEntries.foodId], references: [foods.id] }),
  recipe: one(recipes, { fields: [diaryEntries.recipeId], references: [recipes.id] }),
}));