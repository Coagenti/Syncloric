DROP INDEX IF EXISTS "foods_barcode_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "foods_barcode_unique" ON "foods" USING btree ("barcode") WHERE "foods"."barcode" IS NOT NULL;