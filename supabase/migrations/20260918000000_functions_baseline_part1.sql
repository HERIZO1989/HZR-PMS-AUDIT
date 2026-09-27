-- Genere par introspection directe (pg_get_functiondef) depuis le projet Supabase
-- NYAROTIKO le jour de TASK 8. Garanti identique a ce qui tournait en production
-- au moment de la generation. Rejouable avec CREATE OR REPLACE.
--
-- Ordre : sans dependances -> avec dependances (les fonctions utilitaires d'abord).

-- === Contexte RBAC / session ===

CREATE OR REPLACE FUNCTION public.app_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_current_hotel_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.hotel_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.app_has_permission(perm_code text) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_user_roles sur
    JOIN public.role_permissions rp ON rp.role_id = sur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE sur.staff_user_id = public.app_current_user_id()
      AND p.code = perm_code
  )
$$;

-- === Authentification (TASK 2) ===

CREATE OR REPLACE FUNCTION public.verify_staff_login(p_email text, p_password text)
RETURNS TABLE(staff_user_id uuid, tenant_id uuid, hotel_id uuid, display_name text, email text, permissions text[])
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid; v_hash text; v_tenant uuid; v_hotel uuid; v_name text; v_status text; v_email text;
BEGIN
  SELECT su.id, su.password_hash, su.tenant_id, su.hotel_id, su.display_name, su.status, su.email
  INTO v_id, v_hash, v_tenant, v_hotel, v_name, v_status, v_email
  FROM public.staff_users su WHERE lower(su.email) = lower(p_email);

  IF v_id IS NULL OR v_status <> 'active' THEN
    RETURN;
  END IF;

  IF v_hash IS NULL OR v_hash <> crypt(p_password, v_hash) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v_id, v_tenant, v_hotel, v_name, v_email,
    COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[])
  FROM public.staff_users su
  LEFT JOIN public.staff_user_roles sur ON sur.staff_user_id = su.id
  LEFT JOIN public.role_permissions rp ON rp.role_id = sur.role_id
  LEFT JOIN public.permissions p ON p.id = rp.permission_id
  WHERE su.id = v_id
  GROUP BY v_id, v_tenant, v_hotel, v_name, v_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_security_event(
  p_tenant_id uuid, p_hotel_id uuid, p_actor_user_id uuid,
  p_event_type text, p_outcome text,
  p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.security_events(tenant_id, hotel_id, actor_user_id, event_type, outcome, ip_address, user_agent, metadata)
  VALUES (p_tenant_id, p_hotel_id, p_actor_user_id, p_event_type, p_outcome, p_ip_address, p_user_agent, p_metadata);
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_staff_login(
  p_email text, p_password text, p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS TABLE(staff_user_id uuid, tenant_id uuid, hotel_id uuid, display_name text, email text, permissions text[], locked boolean)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent_failures int;
  v_result record;
BEGIN
  SELECT count(*) INTO v_recent_failures
  FROM public.login_attempts la
  WHERE lower(la.email) = lower(p_email) AND la.success = false
    AND la.attempted_at > now() - interval '15 minutes';

  IF v_recent_failures >= 5 THEN
    INSERT INTO public.login_attempts(email, ip_address, success) VALUES (p_email, p_ip_address, false);
    PERFORM public.record_security_event(NULL, NULL, NULL, 'auth.login', 'denied', p_ip_address, p_user_agent,
      jsonb_build_object('email', p_email, 'reason', 'rate_limited'));
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text[], true;
    RETURN;
  END IF;

  SELECT * INTO v_result FROM public.verify_staff_login(p_email, p_password) LIMIT 1;
  INSERT INTO public.login_attempts(email, ip_address, success) VALUES (p_email, p_ip_address, v_result.staff_user_id IS NOT NULL);

  IF v_result.staff_user_id IS NOT NULL THEN
    PERFORM public.record_security_event(v_result.tenant_id, v_result.hotel_id, v_result.staff_user_id, 'auth.login', 'success',
      p_ip_address, p_user_agent, jsonb_build_object('email', p_email));
    RETURN QUERY SELECT v_result.staff_user_id, v_result.tenant_id, v_result.hotel_id, v_result.display_name, v_result.email, v_result.permissions, false;
  ELSE
    PERFORM public.record_security_event(NULL, NULL, NULL, 'auth.login', 'failure', p_ip_address, p_user_agent,
      jsonb_build_object('email', p_email));
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text[], false;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_session(p_jti uuid, p_staff_user_id uuid, p_expires_at timestamptz, p_reason text DEFAULT 'logout')
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.revoked_sessions(jti, staff_user_id, expires_at, reason)
  VALUES (p_jti, p_staff_user_id, p_expires_at, p_reason)
  ON CONFLICT (jti) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_session_revoked(p_jti uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.revoked_sessions WHERE jti = p_jti);
$$;

CREATE OR REPLACE FUNCTION public.is_session_valid(p_jti uuid, p_staff_user_id uuid, p_issued_at timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revoked_individually boolean;
  v_account_revoked_at timestamptz;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.revoked_sessions WHERE jti = p_jti) INTO v_revoked_individually;
  IF v_revoked_individually THEN RETURN false; END IF;

  SELECT sessions_revoked_at INTO v_account_revoked_at FROM public.staff_users WHERE id = p_staff_user_id;
  IF v_account_revoked_at IS NOT NULL AND v_account_revoked_at > p_issued_at THEN RETURN false; END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_all_sessions_for_user(p_staff_user_id uuid, p_reason text DEFAULT 'account_disabled')
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.staff_users SET sessions_revoked_at = now() WHERE id = p_staff_user_id;
  PERFORM public.record_security_event(
    (SELECT tenant_id FROM public.staff_users WHERE id = p_staff_user_id),
    (SELECT hotel_id FROM public.staff_users WHERE id = p_staff_user_id),
    p_staff_user_id, 'auth.revoke_all_sessions', 'success', NULL, NULL,
    jsonb_build_object('reason', p_reason));
END;
$$;

-- === Facturation SaaS ===

CREATE OR REPLACE FUNCTION public.tenant_can_add_hotel(p_tenant_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found boolean := false;
  v_max_hotels integer;
  v_current_count integer;
BEGIN
  SELECT true, bp.max_hotels INTO v_found, v_max_hotels
  FROM public.subscriptions s JOIN public.billing_plans bp ON bp.code = s.plan_code
  WHERE s.tenant_id = p_tenant_id AND s.status IN ('trialing','active');

  IF NOT v_found THEN RETURN false; END IF;
  IF v_max_hotels IS NULL THEN RETURN true; END IF;

  SELECT count(*) INTO v_current_count FROM public.hotels h WHERE h.tenant_id = p_tenant_id;
  RETURN v_current_count < v_max_hotels;
END;
$$;
