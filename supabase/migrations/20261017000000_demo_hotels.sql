-- TASK 34 : hotels de demonstration crees a la demande.
-- generate_demo_hotel (existant) cree un hotel complet mais laisse les comptes avec 'DEMO_PLACEHOLDER_HASH' (connexion impossible)
-- et rien dans l'application ne l'appelait. create_demo_hotel l'encapsule : bornes, plafond de 25 hotels de demo, mot de passe
-- aleatoire (hash bcrypt) pose sur les 6 comptes, tenant marque is_demo. delete_demo_tenant supprime un tenant de demo,
-- et refuse tout tenant qui n'est pas marque is_demo (jamais un vrai hotel).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- generate_demo_hotel tire chambre et dates au hasard et echouait en bloc (contrainte reservations_no_room_overlap) des que deux sejours
-- tombaient sur la meme chambre : constate des 40 reservations pour 30 chambres. Chaque reservation est maintenant retentee (autre chambre,
-- autres dates) jusqu'a 10 fois ; le generateur ne s'arrete plus et cree toujours un hotel coherent, sans chevauchement.
DO $patch$
DECLARE
  d text;
  start_old text := E'    v_room_id := v_rooms_arr[1+floor(random()*array_length(v_rooms_arr,1))::int];\n';
  start_new text := E'    <<attempts>>\n    FOR v_try IN 1..10 LOOP\n    BEGIN\n    v_room_id := v_rooms_arr[1+floor(random()*array_length(v_rooms_arr,1))::int];\n';
  end_old text := E'    END IF;\n  END LOOP;\n\n  UPDATE public.rooms SET status=''out_of_order''';
  end_new text := E'    END IF;\n    EXIT attempts;\n    EXCEPTION WHEN exclusion_violation THEN\n      NULL; -- chambre deja prise sur ces dates : nouvel essai\n    END;\n    END LOOP attempts;\n  END LOOP;\n\n  UPDATE public.rooms SET status=''out_of_order''';
BEGIN
  d := pg_get_functiondef('public.generate_demo_hotel'::regproc);
  IF position('<<attempts>>' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position(start_old IN d) = 0 OR position(end_old IN d) = 0 OR position(E'DECLARE\n' IN d) = 0 THEN
    RAISE EXCEPTION 'generate_demo_hotel : marqueurs introuvables, patch annule';
  END IF;
  d := regexp_replace(d, E'DECLARE\n', E'DECLARE\n  v_try integer;\n');
  d := replace(replace(d, start_old, start_new), end_old, end_new);
  EXECUTE d;
END
$patch$;

CREATE OR REPLACE FUNCTION public.create_demo_hotel(
  p_tenant_name text,
  p_hotel_name text,
  p_room_count integer DEFAULT 40,
  p_guest_count integer DEFAULT 60,
  p_reservation_count integer DEFAULT 120
)
 RETURNS TABLE(out_tenant_id uuid, out_tenant_code text, out_hotel_id uuid, out_password text,
               out_rooms integer, out_guests integer, out_reservations integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  g record;
  v_password text;
BEGIN
  IF p_tenant_name IS NULL OR length(btrim(p_tenant_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Nom du groupe invalide (2 a 80 caracteres)';
  END IF;
  IF p_hotel_name IS NULL OR length(btrim(p_hotel_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Nom de l''hotel invalide (2 a 80 caracteres)';
  END IF;
  IF p_room_count NOT BETWEEN 5 AND 200 THEN RAISE EXCEPTION 'Nombre de chambres hors limites (5 a 200)'; END IF;
  IF p_guest_count NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Nombre de clients hors limites (5 a 500)'; END IF;
  IF p_reservation_count NOT BETWEEN 0 AND 2000 THEN RAISE EXCEPTION 'Nombre de reservations hors limites (0 a 2000)'; END IF;
  IF (SELECT count(*) FROM public.tenants WHERE is_demo) >= 25 THEN
    RAISE EXCEPTION 'Limite de 25 hotels de demonstration atteinte : supprimez-en avant d''en creer un autre';
  END IF;

  SELECT * INTO g FROM public.generate_demo_hotel(btrim(p_tenant_name), btrim(p_hotel_name), p_room_count, p_guest_count, p_reservation_count);

  UPDATE public.tenants SET is_demo = true WHERE id = g.out_tenant_id;

  -- 12 caracteres alphanumeriques, hash bcrypt (meme methode que verify_staff_login)
  v_password := substr(translate(encode(gen_random_bytes(18), 'base64'), '+/=', 'xyz'), 1, 12);
  UPDATE public.staff_users
  SET password_hash = crypt(v_password, gen_salt('bf'))
  WHERE tenant_id = g.out_tenant_id AND password_hash = 'DEMO_PLACEHOLDER_HASH';

  -- nombres reels, comptes dans la base
  RETURN QUERY
  SELECT g.out_tenant_id, (SELECT t.code FROM public.tenants t WHERE t.id = g.out_tenant_id), g.out_hotel_id, v_password,
         (SELECT count(*)::int FROM public.rooms WHERE hotel_id = g.out_hotel_id),
         (SELECT count(*)::int FROM public.guests WHERE tenant_id = g.out_tenant_id),
         (SELECT count(*)::int FROM public.reservations WHERE hotel_id = g.out_hotel_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.delete_demo_tenant(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hotels uuid[];
  v_staff uuid[];
  v_roles uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND is_demo) THEN
    RAISE EXCEPTION 'Suppression refusee : ce tenant n''est pas un hotel de demonstration';
  END IF;
  SELECT coalesce(array_agg(id), '{}') INTO v_hotels FROM public.hotels WHERE tenant_id = p_tenant_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_staff FROM public.staff_users WHERE tenant_id = p_tenant_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_roles FROM public.roles WHERE tenant_id = p_tenant_id;

  DELETE FROM public.audit_events WHERE tenant_id = p_tenant_id;
  DELETE FROM public.housekeeping_tasks WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.payments WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.folio_lines WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.folios WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.reservation_stays WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.reservations WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.import_rows WHERE tenant_id = p_tenant_id;
  DELETE FROM public.import_batches WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.concierge_requests WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.audit_findings WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.audit_alert_notifications WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.kpi_daily_snapshots WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.night_audit_checks WHERE tenant_id = p_tenant_id;
  DELETE FROM public.night_audit_runs WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.revoked_sessions WHERE staff_user_id = ANY(v_staff);
  DELETE FROM public.security_events WHERE actor_user_id = ANY(v_staff) OR tenant_id = p_tenant_id;
  DELETE FROM public.staff_user_roles WHERE staff_user_id = ANY(v_staff);
  DELETE FROM public.role_permissions WHERE role_id = ANY(v_roles);
  DELETE FROM public.staff_users WHERE tenant_id = p_tenant_id;
  DELETE FROM public.roles WHERE tenant_id = p_tenant_id;
  DELETE FROM public.guests WHERE tenant_id = p_tenant_id;
  DELETE FROM public.rooms WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.rate_calendar WHERE tenant_id = p_tenant_id;
  DELETE FROM public.rate_plans WHERE tenant_id = p_tenant_id;
  DELETE FROM public.room_types WHERE hotel_id = ANY(v_hotels);
  DELETE FROM public.subscriptions WHERE tenant_id = p_tenant_id;
  DELETE FROM public.hotels WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenants WHERE id = p_tenant_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_demo_hotel(text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_demo_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_demo_hotel(text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_demo_tenant(uuid) TO service_role;
