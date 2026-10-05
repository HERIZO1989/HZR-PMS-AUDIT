-- TASK 30 : les adresses reservees (.local, .invalid, .test, .example, example.com/org/net) ne sont jamais joignables.
-- Elles equipent les hotels de demonstration (ex. owner@demo.local) et faisaient echouer l'envoi a chaque passage.
CREATE OR REPLACE FUNCTION public.alert_recipients(p_hotel_id uuid)
 RETURNS TABLE(email text, display_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT DISTINCT su.email, su.display_name
  FROM public.staff_users su
  JOIN public.hotels h ON h.id = p_hotel_id AND h.tenant_id = su.tenant_id
  JOIN public.staff_user_roles sur ON sur.staff_user_id = su.id
  JOIN public.roles r ON r.id = sur.role_id
  WHERE su.status = 'active' AND su.email IS NOT NULL
    AND (su.hotel_id = p_hotel_id OR su.hotel_id IS NULL)
    AND r.code IN ('OWNER', 'GM')
    AND su.email !~* '@([a-z0-9-]+\.)*(local|invalid|test|example)$'
    AND su.email !~* '@example\.(com|org|net)$';
$fn$;
REVOKE ALL ON FUNCTION public.alert_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_recipients(uuid) TO service_role;
