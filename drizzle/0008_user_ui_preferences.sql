CREATE TABLE "user_ui_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'it' NOT NULL,
	"theme" text DEFAULT 'cyberpunk' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_ui_preferences" ADD CONSTRAINT "user_ui_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;