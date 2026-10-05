-- TASK 27 : moindre privilege pour les roles API Supabase (anon / authenticated).
-- Constat (audit RLS du 04/10/2026) : l'isolation par RLS tient (aucune fuite inter-tenant, ecritures croisees refusees),
-- MAIS anon et authenticated avaient TOUS les privileges sur toutes les tables, dont TRUNCATE (que le RLS ne filtre pas),
-- et EXECUTE sur 28 fonctions. L'application n'utilise que service_role : ces droits n'ont aucun usage legitime.

-- 1) Tables
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.billing_plans, public.permissions TO anon;            -- lecture publique voulue (policies *_public_read)
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON public.login_attempts, public.revoked_sessions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.staff_users, public.staff_user_roles, public.roles, public.role_permissions,
  public.permissions, public.audit_events, public.security_events, public.subscriptions, public.tenants FROM authenticated;
-- password_hash ne doit jamais etre lisible via l'API, meme sous RLS
REVOKE SELECT ON public.staff_users FROM authenticated;
GRANT SELECT (id, tenant_id, hotel_id, email, display_name, status, email_verified_at, last_login_at, created_at, updated_at,
              sessions_revoked_at) ON public.staff_users TO authenticated;

-- 2) Fonctions : seul service_role ; les helpers evalues par les policies RLS restent accessibles
DO $d$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    IF f.proname IN ('app_current_tenant_id', 'app_current_hotel_id', 'app_current_user_id', 'app_has_permission') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.sig);
    END IF;
  END LOOP;
END
$d$;

-- 3) Futurs objets : plus d'attribution automatique a anon / authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
