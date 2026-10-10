-- TASK 36 : hotels de demonstration en ariary, avec TVA, et mot de passe reinitialisable.
-- * p_currency : 'EUR' (par defaut, inchange) ou 'MGA'. En MGA tous les montants generes sont multiplies par 1 000 (chambre classique ~180 000 Ar,
--   presidentielle ~950 000 Ar, ordre de grandeur d'Anjary), le fuseau devient Indian/Antananarivo et la TVA 20 % TTC comme a Anjary.
-- * reset_demo_password : nouveau mot de passe aleatoire pour les 6 comptes d'un hotel de demo (l'ancien n'est jamais conserve en clair) ;
--   les sessions ouvertes sont invalidees.
DROP FUNCTION IF EXISTS public.create_demo_hotel(text, text, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.create_demo_hotel(
  p_tenant_name text,
  p_hotel_name text,
  p_room_count integer DEFAULT 40,
  p_guest_count integer DEFAULT 60,
  p_reservation_count integer DEFAULT 120,
  p_currency text DEFAULT 'EUR'
)
 RETURNS TABLE(out_tenant_id uuid, out_tenant_code text, out_hotel_id uuid, out_password text,
               out_rooms integer, out_guests integer, out_reservations integer, out_currency text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  g record;
  v_password text;
  v_hotel uuid;
  v_tenant uuid;
  c_factor constant numeric := 1000;
BEGIN
  IF p_tenant_name IS NULL OR length(btrim(p_tenant_name)) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Nom du groupe invalide (2 a 80 caracteres)'; END IF;
  IF p_hotel_name IS NULL OR length(btrim(p_hotel_name)) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Nom de l''hotel invalide (2 a 80 caracteres)'; END IF;
  IF p_room_count NOT BETWEEN 5 AND 200 THEN RAISE EXCEPTION 'Nombre de chambres hors limites (5 a 200)'; END IF;
  IF p_guest_count NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Nombre de clients hors limites (5 a 500)'; END IF;
  IF p_reservation_count NOT BETWEEN 0 AND 2000 THEN RAISE EXCEPTION 'Nombre de reservations hors limites (0 a 2000)'; END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('EUR', 'MGA') THEN RAISE EXCEPTION 'Devise non prise en charge (EUR ou MGA)'; END IF;
  IF (SELECT count(*) FROM public.tenants WHERE is_demo) >= 25 THEN
    RAISE EXCEPTION 'Limite de 25 hotels de demonstration atteinte : supprimez-en avant d''en creer un autre';
  END IF;

  SELECT * INTO g FROM public.generate_demo_hotel(btrim(p_tenant_name), btrim(p_hotel_name), p_room_count, p_guest_count, p_reservation_count);
  v_tenant := g.out_tenant_id;
  v_hotel := g.out_hotel_id;
  UPDATE public.tenants SET is_demo = true WHERE id = v_tenant;

  IF p_currency = 'MGA' THEN
    UPDATE public.hotels
    SET currency_code = 'MGA', vat_rate = 0.20, prices_include_vat = true, timezone = 'Indian/Antananarivo'
    WHERE id = v_hotel;
    UPDATE public.room_types
    SET base_rate = base_rate * c_factor, extra_adult_fee = extra_adult_fee * c_factor, extra_child_fee = extra_child_fee * c_factor
    WHERE hotel_id = v_hotel;
    UPDATE public.rate_calendar SET rate = rate * c_factor WHERE tenant_id = v_tenant;
    UPDATE public.reservation_stays SET rate_per_night = rate_per_night * c_factor WHERE hotel_id = v_hotel;
    UPDATE public.reservations SET total_amount = total_amount * c_factor, currency_code = 'MGA' WHERE hotel_id = v_hotel;
    UPDATE public.folio_lines SET amount = amount * c_factor WHERE hotel_id = v_hotel;
    UPDATE public.payments SET amount = amount * c_factor, currency_code = 'MGA' WHERE hotel_id = v_hotel;
    UPDATE public.folios SET balance = balance * c_factor, currency_code = 'MGA' WHERE hotel_id = v_hotel;
  END IF;

  v_password := substr(translate(encode(gen_random_bytes(18), 'base64'), '+/=', 'xyz'), 1, 12);
  UPDATE public.staff_users SET password_hash = crypt(v_password, gen_salt('bf'))
  WHERE tenant_id = v_tenant AND password_hash = 'DEMO_PLACEHOLDER_HASH';

  RETURN QUERY
  SELECT v_tenant, (SELECT t.code FROM public.tenants t WHERE t.id = v_tenant), v_hotel, v_password,
         (SELECT count(*)::int FROM public.rooms WHERE hotel_id = v_hotel),
         (SELECT count(*)::int FROM public.guests WHERE tenant_id = v_tenant),
         (SELECT count(*)::int FROM public.reservations WHERE hotel_id = v_hotel),
         p_currency;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reset_demo_password(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  v_password text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND is_demo) THEN
    RAISE EXCEPTION 'Reinitialisation refusee : ce tenant n''est pas un hotel de demonstration';
  END IF;
  v_password := substr(translate(encode(gen_random_bytes(18), 'base64'), '+/=', 'xyz'), 1, 12);
  UPDATE public.staff_users
  SET password_hash = crypt(v_password, gen_salt('bf')), sessions_revoked_at = now()
  WHERE tenant_id = p_tenant_id;
  RETURN v_password;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_demo_hotel(text, text, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_demo_password(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_demo_hotel(text, text, integer, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_demo_password(uuid) TO service_role;
