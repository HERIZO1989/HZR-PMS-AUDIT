-- TASK 49 : acomptes sur reservation (avant l'arrivee).
-- Un acompte est une avance, pas du chiffre d'affaires : il est encaisse sur la reservation, puis
--   * reporte comme paiement sur le folio au check-in (apply_reservation_deposits), ou
--   * rembourse / conserve apres annulation ou no-show (resolve_deposit).
-- Aucune fonction existante n'est modifiee (check_in_reservation, cancel_reservation, add_payment restent identiques).
-- Table reservee au backend (cle service) : RLS activee sans politique pour les roles API.

CREATE TABLE IF NOT EXISTS public.reservation_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code character(3) NOT NULL,
  method text NOT NULL CHECK (method IN ('cash','card','bank_transfer','online','voucher','other')),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','applied','refunded','forfeited')),
  transaction_reference text,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
  resolution_note text,
  applied_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_deposits_hotel_idempotency_key UNIQUE (hotel_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS reservation_deposits_reservation_idx ON public.reservation_deposits (hotel_id, reservation_id);
CREATE INDEX IF NOT EXISTS reservation_deposits_received_idx ON public.reservation_deposits (hotel_id, received_at);
CREATE INDEX IF NOT EXISTS reservation_deposits_held_idx ON public.reservation_deposits (hotel_id) WHERE status = 'held';

ALTER TABLE public.reservation_deposits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_deposits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_deposits TO service_role;

-- Enregistre un acompte sur une reservation non encore arrivee ; refuse un total d'acomptes superieur au montant du sejour.
CREATE OR REPLACE FUNCTION public.record_deposit(
  p_reservation_id uuid, p_hotel_id uuid, p_amount numeric, p_method text,
  p_staff_user_id uuid DEFAULT NULL, p_idempotency_key text DEFAULT NULL, p_reference text DEFAULT NULL)
RETURNS public.reservation_deposits
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations;
  v_dep public.reservation_deposits;
  v_held numeric;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_dep FROM public.reservation_deposits WHERE hotel_id = p_hotel_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_dep; END IF;
  END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id AND hotel_id = p_hotel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % introuvable pour cet hotel', p_reservation_id;
  END IF;
  IF v_res.status NOT IN ('tentative','confirmed') THEN
    RAISE EXCEPTION 'Acompte impossible : reservation au statut %', v_res.status;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant de l''acompte doit etre positif';
  END IF;
  IF p_method NOT IN ('cash','card','bank_transfer','online','voucher','other') THEN
    RAISE EXCEPTION 'Methode de paiement invalide: %', p_method;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_held FROM public.reservation_deposits
    WHERE reservation_id = p_reservation_id AND status = 'held';
  IF v_held + p_amount > v_res.total_amount THEN
    RAISE EXCEPTION 'Les acomptes (%) depasseraient le montant du sejour (%)', v_held + p_amount, v_res.total_amount;
  END IF;

  BEGIN
    INSERT INTO public.reservation_deposits(tenant_id, hotel_id, reservation_id, amount, currency_code, method,
      transaction_reference, received_by, idempotency_key)
    VALUES (v_res.tenant_id, p_hotel_id, p_reservation_id, round(p_amount, 2), v_res.currency_code, p_method,
      NULLIF(btrim(p_reference), ''), p_staff_user_id, p_idempotency_key)
    RETURNING * INTO v_dep;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_dep FROM public.reservation_deposits WHERE hotel_id = p_hotel_id AND idempotency_key = p_idempotency_key;
    RETURN v_dep;
  END;

  PERFORM public.log_audit_event(v_res.tenant_id, p_hotel_id, p_staff_user_id, 'reservation','deposit','reservation_deposit', v_dep.id,
    jsonb_build_object('reservation_id', p_reservation_id, 'amount', v_dep.amount, 'method', p_method));
  RETURN v_dep;
END;
$function$;

-- Au check-in : reporte chaque acompte « held » comme paiement capture sur le folio (sans cloturer le folio).
-- Idempotente : un second appel ne reporte plus rien. Retourne le total reporte.
CREATE OR REPLACE FUNCTION public.apply_reservation_deposits(
  p_reservation_id uuid, p_hotel_id uuid, p_staff_user_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations;
  v_folio public.folios;
  v_dep public.reservation_deposits;
  v_payment_id uuid;
  v_total numeric := 0;
BEGIN
  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id AND hotel_id = p_hotel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % introuvable pour cet hotel', p_reservation_id;
  END IF;
  IF v_res.status <> 'checked_in' THEN
    RAISE EXCEPTION 'Report des acomptes impossible : reservation au statut %', v_res.status;
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE reservation_id = p_reservation_id AND hotel_id = p_hotel_id ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun folio pour la reservation %', p_reservation_id;
  END IF;
  IF v_folio.status <> 'open' THEN
    RAISE EXCEPTION 'Folio % non ouvert (%)', v_folio.id, v_folio.status;
  END IF;

  FOR v_dep IN SELECT * FROM public.reservation_deposits
    WHERE reservation_id = p_reservation_id AND hotel_id = p_hotel_id AND status = 'held' ORDER BY received_at, id FOR UPDATE
  LOOP
    INSERT INTO public.payments(tenant_id, hotel_id, folio_id, method, amount, currency_code, status, transaction_reference, processed_by, idempotency_key)
    VALUES (v_folio.tenant_id, p_hotel_id, v_folio.id, v_dep.method, v_dep.amount, v_folio.currency_code, 'captured',
      'ACOMPTE ' || COALESCE(v_dep.transaction_reference, v_dep.id::text), p_staff_user_id, 'deposit:' || v_dep.id)
    RETURNING id INTO v_payment_id;

    UPDATE public.reservation_deposits
      SET status = 'applied', applied_payment_id = v_payment_id, resolved_at = now(), resolved_by = p_staff_user_id, updated_at = now()
      WHERE id = v_dep.id;
    v_total := v_total + v_dep.amount;
  END LOOP;

  IF v_total > 0 THEN
    PERFORM public.recompute_folio_balance(v_folio.id);
    PERFORM public.log_audit_event(v_folio.tenant_id, p_hotel_id, p_staff_user_id, 'folio','deposit_applied','folio', v_folio.id,
      jsonb_build_object('reservation_id', p_reservation_id, 'amount', v_total));
  END IF;
  RETURN v_total;
END;
$function$;

-- Apres annulation ou no-show : rembourse l'acompte au client ou le conserve (penalite).
CREATE OR REPLACE FUNCTION public.resolve_deposit(
  p_deposit_id uuid, p_hotel_id uuid, p_action text,
  p_staff_user_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS public.reservation_deposits
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dep public.reservation_deposits;
  v_status text;
BEGIN
  IF p_action NOT IN ('refund','forfeit') THEN
    RAISE EXCEPTION 'Action invalide: % (refund ou forfeit)', p_action;
  END IF;

  SELECT * INTO v_dep FROM public.reservation_deposits WHERE id = p_deposit_id AND hotel_id = p_hotel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acompte % introuvable pour cet hotel', p_deposit_id;
  END IF;
  IF v_dep.status <> 'held' THEN
    RAISE EXCEPTION 'Acompte deja traite (statut %)', v_dep.status;
  END IF;

  SELECT status INTO v_status FROM public.reservations WHERE id = v_dep.reservation_id;
  IF v_status NOT IN ('cancelled','no_show') THEN
    RAISE EXCEPTION 'Un acompte ne peut etre rembourse ou conserve qu''apres une annulation ou un no-show (statut %)', v_status;
  END IF;

  UPDATE public.reservation_deposits
    SET status = CASE p_action WHEN 'refund' THEN 'refunded' ELSE 'forfeited' END,
        resolved_at = now(), resolved_by = p_staff_user_id, resolution_note = NULLIF(btrim(p_note), ''), updated_at = now()
    WHERE id = p_deposit_id RETURNING * INTO v_dep;

  PERFORM public.log_audit_event(v_dep.tenant_id, p_hotel_id, p_staff_user_id, 'reservation','deposit_' || p_action, 'reservation_deposit', v_dep.id,
    jsonb_build_object('reservation_id', v_dep.reservation_id, 'amount', v_dep.amount));
  RETURN v_dep;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_deposit(uuid,uuid,numeric,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_reservation_deposits(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_deposit(uuid,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_deposit(uuid,uuid,numeric,text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_reservation_deposits(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_deposit(uuid,uuid,text,uuid,text) TO service_role;
