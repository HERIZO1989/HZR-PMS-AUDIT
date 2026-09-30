-- TASK 12 - Login non ambigu entre tenants.
--
-- Probleme : verify_staff_login cherchait le compte par email seul. Un meme email pouvant exister
-- dans plusieurs tenants (contrainte d'unicite = (tenant_id, email)), la base retenait une ligne
-- arbitraire : le login pouvait echouer alors que le mot de passe etait correct dans un autre tenant.
--
-- Correctif (retrocompatible) :
--  * p_tenant_code OPTIONNEL (code du tenant, ex. ANJARY) pour cibler un etablissement ;
--  * sans code : on evalue TOUS les comptes actifs portant cet email ; le login reussit seulement
--    si exactement UN compte correspond au mot de passe. 0 = identifiants invalides ;
--    plusieurs = ambigu -> refuse (il faut alors preciser le code du tenant) ;
--  * aucun acces inter-tenant possible : le mot de passe doit correspondre au compte retenu.
-- Les anciennes signatures sont supprimees pour eviter toute ambiguite de surcharge (RPC).

DROP FUNCTION IF EXISTS public.attempt_staff_login(text, text, inet, text);
DROP FUNCTION IF EXISTS public.verify_staff_login(text, text);

CREATE OR REPLACE FUNCTION public.verify_staff_login(
  p_email text, p_password text, p_tenant_code text DEFAULT NULL
)
RETURNS TABLE(staff_user_id uuid, tenant_id uuid, hotel_id uuid, display_name text, email text, permissions text[])
LANGUAGE plpgsql
-- 'extensions' requis : pgcrypto (crypt) est installe dans le schema extensions sur Supabase
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_match record;
  v_matches int := 0;
  v_id uuid; v_tenant uuid; v_hotel uuid; v_name text; v_email text;
BEGIN
  FOR v_match IN
    SELECT su.id, su.password_hash, su.tenant_id, su.hotel_id, su.display_name, su.email
    FROM public.staff_users su
    JOIN public.tenants t ON t.id = su.tenant_id
    WHERE lower(su.email) = lower(p_email)
      AND su.status = 'active'
      AND (p_tenant_code IS NULL OR upper(t.code) = upper(p_tenant_code))
  LOOP
    IF v_match.password_hash IS NOT NULL AND v_match.password_hash = crypt(p_password, v_match.password_hash) THEN
      v_matches := v_matches + 1;
      v_id := v_match.id; v_tenant := v_match.tenant_id; v_hotel := v_match.hotel_id;
      v_name := v_match.display_name; v_email := v_match.email;
    END IF;
  END LOOP;

  -- 0 correspondance : identifiants invalides. Plusieurs : ambigu, refuse (preciser p_tenant_code).
  IF v_matches <> 1 THEN
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
$fn$;

CREATE OR REPLACE FUNCTION public.attempt_staff_login(
  p_email text, p_password text, p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL,
  p_tenant_code text DEFAULT NULL
) RETURNS TABLE(staff_user_id uuid, tenant_id uuid, hotel_id uuid, display_name text, email text, permissions text[], locked boolean)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
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

  SELECT * INTO v_result FROM public.verify_staff_login(p_email, p_password, p_tenant_code) LIMIT 1;
  INSERT INTO public.login_attempts(email, ip_address, success) VALUES (p_email, p_ip_address, v_result.staff_user_id IS NOT NULL);

  IF v_result.staff_user_id IS NOT NULL THEN
    PERFORM public.record_security_event(v_result.tenant_id, v_result.hotel_id, v_result.staff_user_id, 'auth.login', 'success',
      p_ip_address, p_user_agent, jsonb_build_object('email', p_email));
    RETURN QUERY SELECT v_result.staff_user_id, v_result.tenant_id, v_result.hotel_id, v_result.display_name, v_result.email, v_result.permissions, false;
  ELSE
    PERFORM public.record_security_event(NULL, NULL, NULL, 'auth.login', 'failure', p_ip_address, p_user_agent,
      jsonb_build_object('email', p_email, 'tenant_code', p_tenant_code));
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text[], false;
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.verify_staff_login(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attempt_staff_login(text, text, inet, text, text) TO anon, authenticated, service_role;
