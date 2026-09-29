CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'active', 'very_active');--> statement-breakpoint
CREATE TYPE "public"."diary_source" AS ENUM('manual', 'barcode', 'ai_label', 'norish_sync');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('food', 'recipe');--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('manual', 'barcode_off', 'ai_label');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('lose', 'maintain', 'gain');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('f', 'm');--> statement-breakpoint
CREATE TYPE "public"."slot" AS ENUM('Breakfast', 'Lunch', 'Dinner', 'Snack');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('ok', 'error', 'partial');--> statement-breakpoint
CREATE TYPE "public"."target_source" AS ENUM('manual', 'calculated');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" "slot" NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"food_id" uuid,
	"recipe_id" uuid,
	"quantity_grams" numeric(8, 2),
	"servings" numeric(8, 2),
	"kcal" integer,
	"protein" numeric(8, 2),
	"fat" numeric(8, 2),
	"carbs" numeric(8, 2),
	"source" "diary_source" DEFAULT 'manual' NOT NULL,
	"norish_item_id" uuid,
	"norish_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"kcal_per_100g" integer NOT NULL,
	"protein_per_100g" numeric(6, 2),
	"fat_per_100g" numeric(6, 2),
	"carbs_per_100g" numeric(6, 2),
	"serving_grams" integer,
	"serving_label" text,
	"source" "food_source" DEFAULT 'manual' NOT NULL,
	"source_payload" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "norish_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" NOT NULL,
	"items_upserted" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sex" "sex" NOT NULL,
	"height_cm" integer NOT NULL,
	"weight_kg" numeric(5, 1) NOT NULL,
	"birth_year" integer NOT NULL,
	"activity_level" "activity_level" NOT NULL,
	"goal" "goal" NOT NULL,
	"target_source" "target_source" DEFAULT 'calculated' NOT NULL,
	"manual_target_kcal" integer,
	"calculated_target_kcal" integer,
	"recalculated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"norish_recipe_id" uuid,
	"name" text NOT NULL,
	"servings" integer NOT NULL,
	"kcal_per_serving" integer,
	"protein_per_serving" text,
	"fat_per_serving" text,
	"carbs_per_serving" text,
	"snapshot" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"active_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"display_username" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "norish_sync_runs" ADD CONSTRAINT "norish_sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_entries_user_date_idx" ON "diary_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "diary_entries_user_date_slot_item_idx" ON "diary_entries" USING btree ("user_id","date","slot","norish_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diary_entries_user_norish_item_unique" ON "diary_entries" USING btree ("user_id","norish_item_id") WHERE norish_item_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "foods_barcode_unique" ON "foods" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "foods_name_idx" ON "foods" USING btree ("name");--> statement-breakpoint
CREATE INDEX "norish_sync_runs_user_started_idx" ON "norish_sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_id_unique" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_norish_recipe_id_unique" ON "recipes" USING btree ("norish_recipe_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");