CREATE TABLE "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" text NOT NULL,
  "action" text NOT NULL,
  "target" text NOT NULL,
  "detail" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Same dedicated lock as repositories/admin-users.ts; not bootstrap lock 19373301.
-- Volatile PL/pgSQL queries obtain fresh snapshots after the lock under READ COMMITTED.
CREATE FUNCTION protect_last_active_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.banned IS NOT TRUE THEN
    IF TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'admin' OR NEW.banned IS TRUE THEN
      PERFORM pg_advisory_xact_lock(19373302);
      IF NOT EXISTS (SELECT 1 FROM users WHERE id <> OLD.id AND role = 'admin' AND banned IS NOT TRUE) THEN
        RAISE EXCEPTION 'LAST_ACTIVE_ADMIN' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_last_active_admin BEFORE UPDATE OF role, banned OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION protect_last_active_admin();
