-- TASK 19 - TVA sur les nuitees postees.
--
-- hotels.vat_rate (0 a 1, defaut 0) et hotels.prices_include_vat (defaut true).
-- post_room_charges :
--  * vat_rate = 0 : comportement inchange (une ligne room_charge = montant du tarif) ;
--  * prix TTC (prices_include_vat) : room_charge = HT (= TTC / (1 + taux)), puis une ligne 'tax' = TTC - HT ;
--  * prix HT : room_charge = tarif, puis une ligne 'tax' = tarif x taux.
-- Le solde du folio (room_charge + tax) reste le montant TTC ; ADR / RevPAR (room_charge uniquement)
-- sont donc calcules HORS TVA, comme le veut la pratique hoteliere. Idempotent (index unique par type de ligne).
-- Anjary : TVA 20 %, tarifs TTC. Non inclus : taxe de sejour (montant non communique).

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 1),
  ADD COLUMN IF NOT EXISTS prices_include_vat boolean NOT NULL DEFAULT true;

UPDATE public.hotels SET vat_rate = 0.20, prices_include_vat = true
WHERE id = '232568ba-61b6-4f5b-9c8c-1ae7bc8a834c';

CREATE UNIQUE INDEX IF NOT EXISTS folio_lines_tax_night_uniq
  ON public.folio_lines (folio_id, reference)
  WHERE line_type = 'tax' AND reference LIKE 'NIGHT:%';

CREATE OR REPLACE FUNCTION public.post_room_charges(
  p_hotel_id uuid, p_business_date date, p_staff_user_id uuid DEFAULT NULL
) RETURNS TABLE(posted integer, skipped integer, total_posted numeric, currency_code text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid; v_currency text; v_tz text; v_vat numeric; v_incl boolean;
  rec record;
  v_gross numeric; v_net numeric; v_tax numeric; v_extra numeric;
  v_posted int := 0; v_skipped int := 0; v_total numeric := 0;
  v_ref text; v_at timestamptz; v_line uuid; v_label text;
BEGIN
  SELECT h.tenant_id, h.currency_code, COALESCE(h.timezone, 'UTC'), h.vat_rate, h.prices_include_vat
    INTO v_tenant, v_currency, v_tz, v_vat, v_incl
  FROM public.hotels h WHERE h.id = p_hotel_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'hotel_id % introuvable', p_hotel_id;
  END IF;

  v_ref := 'NIGHT:' || to_char(p_business_date, 'YYYY-MM-DD');
  v_at := (p_business_date::timestamp + interval '12 hours') AT TIME ZONE v_tz;
  v_label := trim(to_char(v_vat * 100, 'FM990.##'), '.');

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
      rec.base_rate) INTO v_gross;
    v_extra := greatest(rec.adults - rec.base_occupancy, 0) * rec.extra_adult_fee
      + greatest(COALESCE(rec.children, 0) - greatest(rec.base_occupancy - rec.adults, 0), 0) * rec.extra_child_fee;
    v_gross := round(v_gross + v_extra, 2);

    IF v_vat = 0 THEN
      v_net := v_gross; v_tax := 0;
    ELSIF v_incl THEN
      v_net := round(v_gross / (1 + v_vat), 2); v_tax := v_gross - v_net;
    ELSE
      v_net := v_gross; v_tax := round(v_gross * v_vat, 2); v_gross := v_net + v_tax;
    END IF;

    INSERT INTO public.folio_lines (tenant_id, hotel_id, folio_id, line_type, description, quantity, amount, reference, posted_by, posted_at)
    VALUES (v_tenant, p_hotel_id, rec.folio_id, 'room_charge',
            'Nuitee du ' || to_char(p_business_date, 'DD/MM/YYYY') || ' - ' || rec.type_name || COALESCE(' ch. ' || rec.room_number, ''),
            1, v_net, v_ref, p_staff_user_id, v_at)
    ON CONFLICT (folio_id, reference) WHERE line_type = 'room_charge' AND reference LIKE 'NIGHT:%' DO NOTHING
    RETURNING id INTO v_line;

    IF v_line IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      IF v_tax > 0 THEN
        INSERT INTO public.folio_lines (tenant_id, hotel_id, folio_id, line_type, description, quantity, amount, reference, posted_by, posted_at)
        VALUES (v_tenant, p_hotel_id, rec.folio_id, 'tax',
                'TVA ' || v_label || ' % - nuitee du ' || to_char(p_business_date, 'DD/MM/YYYY'),
                1, v_tax, v_ref, p_staff_user_id, v_at)
        ON CONFLICT (folio_id, reference) WHERE line_type = 'tax' AND reference LIKE 'NIGHT:%' DO NOTHING;
      END IF;
      v_posted := v_posted + 1;
      v_total := v_total + v_gross;
      PERFORM public.recompute_folio_balance(rec.folio_id);
    END IF;
    v_line := NULL;
  END LOOP;

  PERFORM public.compute_kpi_snapshots(p_hotel_id, p_business_date, p_business_date);

  PERFORM public.log_audit_event(v_tenant, p_hotel_id, p_staff_user_id, 'night_audit', 'post_room_charges', 'hotel', p_hotel_id,
    jsonb_build_object('business_date', p_business_date, 'posted', v_posted, 'skipped', v_skipped,
                       'total_posted_incl_vat', v_total, 'vat_rate', v_vat, 'currency_code', v_currency));

  RETURN QUERY SELECT v_posted, v_skipped, v_total, v_currency;
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_room_charges(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_room_charges(uuid, date, uuid) TO service_role;
