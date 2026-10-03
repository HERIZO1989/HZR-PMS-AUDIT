-- TASK 18 - Night audit : posting des nuitees (charges chambre) et devise des messages d'anomalie.
--
-- Constat : ADR/RevPAR sont calcules (compute_kpi_snapshots) a partir des folio_lines 'room_charge' dont
-- posted_at::date = jour d'exploitation, mais aucune fonction ne postait ces nuitees : ADR et RevPAR
-- restaient a 0 tant que le personnel ne les saisissait pas une par une.
--
-- post_room_charges(hotel, date_exploitation, staff) : pour chaque reservation en sejour ('checked_in')
-- a cette date, avec un folio ouvert, poste UNE ligne 'room_charge' = tarif du calendrier du plan de la
-- reservation (sinon tarif de base) + supplements d'occupation, puis recalcule le solde du folio et les
-- indicateurs du jour. Idempotent : un index unique sur (folio, reference) empeche tout doublon.
-- Non inclus : taxes de sejour / TVA (taux non definis).

CREATE UNIQUE INDEX IF NOT EXISTS folio_lines_room_charge_night_uniq
  ON public.folio_lines (folio_id, reference)
  WHERE line_type = 'room_charge' AND reference LIKE 'NIGHT:%';

CREATE OR REPLACE FUNCTION public.post_room_charges(
  p_hotel_id uuid, p_business_date date, p_staff_user_id uuid DEFAULT NULL
) RETURNS TABLE(posted integer, skipped integer, total_posted numeric, currency_code text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid; v_currency text; v_tz text;
  rec record;
  v_amount numeric; v_extra numeric;
  v_posted int := 0; v_skipped int := 0; v_total numeric := 0;
  v_ref text; v_at timestamptz; v_line uuid;
BEGIN
  SELECT h.tenant_id, h.currency_code, COALESCE(h.timezone, 'UTC') INTO v_tenant, v_currency, v_tz
  FROM public.hotels h WHERE h.id = p_hotel_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'hotel_id % introuvable', p_hotel_id;
  END IF;

  v_ref := 'NIGHT:' || to_char(p_business_date, 'YYYY-MM-DD');
  -- midi heure locale de l'hotel : posted_at::date reste le jour d'exploitation
  v_at := (p_business_date::timestamp + interval '12 hours') AT TIME ZONE v_tz;

  FOR rec IN
    SELECT r.id AS reservation_id, r.rate_plan_id, r.room_type_id, r.adults, r.children, r.confirmation_number,
           f.id AS folio_id, rt.base_rate, rt.base_occupancy, rt.extra_adult_fee, rt.extra_child_fee, rt.name AS type_name,
           rm.room_number
    FROM public.reservations r
    JOIN public.folios f ON f.reservation_id = r.id AND f.status = 'open'
    JOIN public.room_types rt ON rt.id = r.room_type_id
    LEFT JOIN public.rooms rm ON rm.id = r.assigned_room_id
    WHERE r.hotel_id = p_hotel_id AND r.status = 'checked_in'
      AND r.arrival_date <= p_business_date AND r.departure_date > p_business_date
    ORDER BY r.confirmation_number
  LOOP
    SELECT COALESCE(
      (SELECT rc.rate FROM public.rate_calendar rc
        WHERE rc.rate_plan_id = rec.rate_plan_id AND rc.room_type_id = rec.room_type_id
          AND rc.hotel_id = p_hotel_id AND rc.date = p_business_date),
      rec.base_rate) INTO v_amount;
    v_extra := greatest(rec.adults - rec.base_occupancy, 0) * rec.extra_adult_fee
      + greatest(COALESCE(rec.children, 0) - greatest(rec.base_occupancy - rec.adults, 0), 0) * rec.extra_child_fee;
    v_amount := round(v_amount + v_extra, 2);

    INSERT INTO public.folio_lines (tenant_id, hotel_id, folio_id, line_type, description, quantity, amount, reference, posted_by, posted_at)
    VALUES (v_tenant, p_hotel_id, rec.folio_id, 'room_charge',
            'Nuitee du ' || to_char(p_business_date, 'DD/MM/YYYY') || ' - ' || rec.type_name || COALESCE(' ch. ' || rec.room_number, ''),
            1, v_amount, v_ref, p_staff_user_id, v_at)
    ON CONFLICT (folio_id, reference) WHERE line_type = 'room_charge' AND reference LIKE 'NIGHT:%' DO NOTHING
    RETURNING id INTO v_line;

    IF v_line IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_posted := v_posted + 1;
      v_total := v_total + v_amount;
      PERFORM public.recompute_folio_balance(rec.folio_id);
    END IF;
    v_line := NULL;
  END LOOP;

  PERFORM public.compute_kpi_snapshots(p_hotel_id, p_business_date, p_business_date);

  PERFORM public.log_audit_event(v_tenant, p_hotel_id, p_staff_user_id, 'night_audit', 'post_room_charges', 'hotel', p_hotel_id,
    jsonb_build_object('business_date', p_business_date, 'posted', v_posted, 'skipped', v_skipped,
                       'total_posted', v_total, 'currency_code', v_currency));

  RETURN QUERY SELECT v_posted, v_skipped, v_total, v_currency;
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_room_charges(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_room_charges(uuid, date, uuid) TO service_role;

-- Messages d'anomalie ADR : devise de l'hotel au lieu d'un symbole euro en dur.
DO $patch$
DECLARE
  v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.run_hotel_audit(uuid,date,date)'::regprocedure);
  v_new := replace(v_def, E''' € contre une moyenne de ''',
    E''' ''||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||'' contre une moyenne de ''');
  v_new := replace(v_new, E''' € sur la période (écart-type ''',
    E''' ''||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||'' sur la période (écart-type ''');
  v_new := replace(v_new, E''' € sur la période.''',
    E''' ''||(SELECT h.currency_code FROM public.hotels h WHERE h.id = p_hotel_id)||'' sur la période.''');
  IF v_new = v_def OR position('€' IN v_new) > 0 THEN
    RAISE EXCEPTION 'run_hotel_audit : un symbole euro subsiste ou motifs introuvables (fonction deja modifiee ?)';
  END IF;
  EXECUTE v_new;
END
$patch$;
