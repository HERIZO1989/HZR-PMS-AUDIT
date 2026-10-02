-- TASK 14 - Tarification des reservations et devise.
--
-- Defauts corriges :
--  1. create_reservation calculait le montant avec room_types.base_rate x nuits et IGNORAIT le
--     calendrier tarifaire (rate_calendar) et le plan choisi (BAR/BB/NRF/CORP, saisons...).
--     p_rate_plan_id n'etait meme pas verifie (plan d'un autre hotel/tenant accepte).
--  2. currency_code etait code en dur a 'EUR' (create_reservation et apply_import_row) :
--     les reservations d'un hotel en MGA etaient etiquetees EUR.
--
-- Nouveau comportement (signature inchangee, donc aucune surcharge) :
--  * plan fourni : doit appartenir au meme tenant/hotel, etre actif et applicable au type de chambre ;
--  * plan absent : plan actif 'BAR' de l'hotel s'il existe, sinon tarif de base ;
--  * montant = somme, pour chaque nuit, du tarif du calendrier (plan, type, date) ; une nuit sans
--    ligne de calendrier retombe sur le tarif de base du type de chambre ;
--  * devise = devise de l'hotel (hotels.currency_code) ;
--  * le plan retenu est enregistre sur la reservation.

CREATE OR REPLACE FUNCTION public.create_reservation(
  p_tenant_id uuid, p_hotel_id uuid, p_room_type_id uuid, p_arrival_date date, p_departure_date date,
  p_guest_id uuid DEFAULT NULL::uuid, p_guest_first_name text DEFAULT NULL::text, p_guest_last_name text DEFAULT NULL::text,
  p_guest_email text DEFAULT NULL::text, p_assigned_room_id uuid DEFAULT NULL::uuid, p_adults integer DEFAULT 1,
  p_children integer DEFAULT 0, p_channel text DEFAULT 'direct'::text, p_rate_plan_id uuid DEFAULT NULL::uuid,
  p_special_requests text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS reservations
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_guest_id uuid;
  v_base_rate numeric;
  v_currency text;
  v_plan_id uuid;
  v_nights int;
  v_total numeric;
  v_confirmation text;
  v_res public.reservations;
BEGIN
  IF p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION 'departure_date doit etre posterieure a arrival_date';
  END IF;

  SELECT h.currency_code INTO v_currency FROM public.hotels h
  WHERE h.id = p_hotel_id AND h.tenant_id = p_tenant_id;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'hotel_id % introuvable pour ce tenant', p_hotel_id;
  END IF;

  SELECT base_rate INTO v_base_rate FROM public.room_types
  WHERE id = p_room_type_id AND hotel_id = p_hotel_id;
  IF v_base_rate IS NULL THEN
    RAISE EXCEPTION 'room_type_id % introuvable pour cet hotel', p_room_type_id;
  END IF;

  IF p_rate_plan_id IS NOT NULL THEN
    SELECT rp.id INTO v_plan_id FROM public.rate_plans rp
    WHERE rp.id = p_rate_plan_id AND rp.tenant_id = p_tenant_id AND rp.hotel_id = p_hotel_id
      AND rp.status = 'active' AND (rp.room_type_id IS NULL OR rp.room_type_id = p_room_type_id);
    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'rate_plan_id % introuvable, inactif ou non applicable a ce type de chambre', p_rate_plan_id;
    END IF;
  ELSE
    SELECT rp.id INTO v_plan_id FROM public.rate_plans rp
    WHERE rp.tenant_id = p_tenant_id AND rp.hotel_id = p_hotel_id AND rp.code = 'BAR' AND rp.status = 'active'
      AND (rp.room_type_id IS NULL OR rp.room_type_id = p_room_type_id)
    ORDER BY rp.created_at LIMIT 1;
  END IF;

  IF p_assigned_room_id IS NOT NULL THEN
    PERFORM 1 FROM public.rooms WHERE id = p_assigned_room_id AND hotel_id = p_hotel_id AND room_type_id = p_room_type_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'assigned_room_id % introuvable pour cet hotel/type de chambre', p_assigned_room_id;
    END IF;
  END IF;

  IF p_guest_id IS NOT NULL THEN
    SELECT id INTO v_guest_id FROM public.guests WHERE id = p_guest_id AND tenant_id = p_tenant_id;
    IF v_guest_id IS NULL THEN
      RAISE EXCEPTION 'guest_id % introuvable pour ce tenant', p_guest_id;
    END IF;
  ELSIF p_guest_email IS NOT NULL THEN
    SELECT id INTO v_guest_id FROM public.guests WHERE tenant_id = p_tenant_id AND email = p_guest_email LIMIT 1;
    IF v_guest_id IS NULL THEN
      INSERT INTO public.guests(tenant_id, first_name, last_name, email)
      VALUES (p_tenant_id, COALESCE(p_guest_first_name,'Guest'), COALESCE(p_guest_last_name,'Sans nom'), p_guest_email)
      RETURNING id INTO v_guest_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'guest_id ou guest_email requis';
  END IF;

  v_nights := p_departure_date - p_arrival_date;

  -- Somme des tarifs nuit par nuit ; sans ligne de calendrier (ou sans plan) : tarif de base du type.
  SELECT COALESCE(sum(COALESCE(rc.rate, v_base_rate)), 0) INTO v_total
  FROM generate_series(p_arrival_date, p_departure_date - 1, interval '1 day') AS d(night)
  LEFT JOIN public.rate_calendar rc
    ON rc.rate_plan_id = v_plan_id AND rc.room_type_id = p_room_type_id
   AND rc.hotel_id = p_hotel_id AND rc.date = d.night::date;
  v_total := round(v_total, 2);

  v_confirmation := 'RES-' || to_char(now(),'YYYY') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  BEGIN
    INSERT INTO public.reservations(
      tenant_id, hotel_id, guest_id, confirmation_number, channel, status,
      arrival_date, departure_date, adults, children, rate_plan_id, room_type_id,
      assigned_room_id, total_amount, currency_code, created_by, special_requests
    ) VALUES (
      p_tenant_id, p_hotel_id, v_guest_id, v_confirmation, p_channel, 'confirmed',
      p_arrival_date, p_departure_date, p_adults, p_children, v_plan_id, p_room_type_id,
      p_assigned_room_id, v_total, v_currency, p_created_by, p_special_requests
    ) RETURNING * INTO v_res;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Chambre deja reservee sur cette periode (conflit de disponibilite)' USING ERRCODE = '23P01';
  END;

  PERFORM public.log_audit_event(p_tenant_id, p_hotel_id, p_created_by, 'reservation','create','reservation', v_res.id,
    jsonb_build_object('confirmation_number', v_confirmation, 'arrival_date', p_arrival_date, 'departure_date', p_departure_date,
                       'rate_plan_id', v_plan_id, 'total_amount', v_total, 'currency_code', v_currency));

  RETURN v_res;
END;
$function$;

-- Import : la devise par defaut d'une ligne importee est celle de l'hotel (et non 'EUR').
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.apply_import_row(uuid)'::regprocedure);
  v_new := replace(v_def,
    'COALESCE(v_data->>''currency_code'',''EUR'')',
    'COALESCE(v_data->>''currency_code'', (SELECT h.currency_code FROM public.hotels h WHERE h.id = v_hotel_id), ''EUR'')');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'apply_import_row : motif currency_code EUR introuvable (fonction deja modifiee ?)';
  END IF;
  EXECUTE v_new;
END
$patch$;

-- Donnees deja creees avec la mauvaise devise : alignement sur la devise de l'hotel (MGA pour Anjary).
UPDATE public.reservations r SET currency_code = h.currency_code
FROM public.hotels h WHERE h.id = r.hotel_id AND r.currency_code <> h.currency_code AND h.currency_code = 'MGA';
UPDATE public.folios f SET currency_code = h.currency_code
FROM public.hotels h WHERE h.id = f.hotel_id AND f.currency_code <> h.currency_code AND h.currency_code = 'MGA';
