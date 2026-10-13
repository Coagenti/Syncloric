CREATE TABLE "food_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"portions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "portion_label" text;--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "portion_grams" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "portion_quantity" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "portions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "food_preferences" ADD CONSTRAINT "food_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_preferences" ADD CONSTRAINT "food_preferences_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_preferences_user_food_unique" ON "food_preferences" USING btree ("user_id","food_id");--> statement-breakpoint
CREATE INDEX "diary_entries_user_slot_food_idx" ON "diary_entries" USING btree ("user_id","slot","food_id");