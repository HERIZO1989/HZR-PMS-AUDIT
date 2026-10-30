-- TASK 60 : check-in automatique des arrivees du jour et annulation d'un check-in (no-show, annulation, retour en attente).
-- Cause du blocage : les reservations importees d'Odoo n'ont pas de chambre assignee, et check_in_reservation exige une chambre.
-- Aucune fonction existante n'est modifiee (check_in_reservation, cancel_reservation, add_payment restent identiques).

ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS auto_check_in_enabled boolean NOT NULL DEFAULT false;
-- Verrou : une reservation remise « en attente » apres un check-in annule n'est plus enregistree automatiquement (sinon la routine la remettrait en check-in aussitot).
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS skip_auto_check_in boolean NOT NULL DEFAULT false;

-- Check-in d'UNE reservation en choisissant automatiquement une chambre libre (propre, non occupee, sans chevauchement) du type reserve.
CREATE OR REPLACE FUNCTION public.auto_check_in_reservation(
  p_reservation_id uuid, p_hotel_id uuid, p_staff_user_id uuid DEFAULT NULL)
RETURNS public.reservations
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations;
  v_room record;
  v_type text;
BEGIN
  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id AND hotel_id = p_hotel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % introuvable pour cet hotel', p_reservation_id;
  END IF;
  IF v_res.status NOT IN ('tentative','confirmed') THEN
    RAISE EXCEPTION 'Check-in impossible : statut actuel %', v_res.status;
  END IF;
  IF v_res.assigned_room_id IS NOT NULL THEN
    RETURN public.check_in_reservation(p_reservation_id, p_hotel_id, NULL, p_staff_user_id);
  END IF;
  IF v_res.room_type_id IS NULL THEN
    RAISE EXCEPTION 'Type de chambre manquant : choisir une chambre';
  END IF;

  FOR v_room IN
    SELECT r.id FROM public.rooms r
    WHERE r.hotel_id = p_hotel_id AND r.room_type_id = v_res.room_type_id AND r.status = 'vacant_clean'
    ORDER BY r.room_number
  LOOP
    BEGIN
      RETURN public.check_in_reservation(p_reservation_id, p_hotel_id, v_room.id, p_staff_user_id);
    EXCEPTION
      WHEN exclusion_violation THEN CONTINUE;
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'Chambre %' THEN CONTINUE; END IF;
        RAISE;
    END;
  END LOOP;

  SELECT name INTO v_type FROM public.room_types WHERE id = v_res.room_type_id;
  RAISE EXCEPTION 'Aucune chambre libre du type %', COALESCE(v_type, '?');
END;
$function$;

-- Check-in de toutes les arrivees d'une date. Ignore : les reservations provisoires et les « blocs entiers » dont les lignes par chambre existent deja (doublons).
-- Retourne le detail par reservation ; les acomptes sont reportes par l'application apres coup (apply_reservation_deposits).
CREATE OR REPLACE FUNCTION public.auto_check_in_arrivals(
  p_hotel_id uuid, p_date date, p_staff_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res record;
  v_new public.reservations;
  v_room text;
  v_out jsonb := '[]'::jsonb;
  v_ci integer := 0;
  v_sk integer := 0;
  v_fail integer := 0;
BEGIN
  FOR v_res IN
    SELECT r.id, r.confirmation_number, r.status, r.skip_auto_check_in FROM public.reservations r
    WHERE r.hotel_id = p_hotel_id AND r.arrival_date = p_date AND r.status IN ('tentative','confirmed')
    ORDER BY r.confirmation_number
  LOOP
    IF v_res.status = 'tentative' THEN
      v_sk := v_sk + 1;
      v_out := v_out || jsonb_build_object('reservation_id', v_res.id, 'confirmation_number', v_res.confirmation_number, 'outcome', 'skipped', 'reason', 'Provisoire : à confirmer avant le check-in');
      CONTINUE;
    END IF;
    IF v_res.skip_auto_check_in THEN
      v_sk := v_sk + 1;
      v_out := v_out || jsonb_build_object('reservation_id', v_res.id, 'confirmation_number', v_res.confirmation_number, 'outcome', 'skipped', 'reason', 'Check-in annulé : à refaire manuellement');
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.reservations s
      WHERE s.hotel_id = p_hotel_id AND s.confirmation_number LIKE v_res.confirmation_number || '-%'
        AND substr(s.confirmation_number, length(v_res.confirmation_number) + 2) ~ '^[0-9]+$'
    ) THEN
      v_sk := v_sk + 1;
      v_out := v_out || jsonb_build_object('reservation_id', v_res.id, 'confirmation_number', v_res.confirmation_number, 'outcome', 'skipped', 'reason', 'Doublon : les lignes par chambre de cette réservation existent déjà');
      CONTINUE;
    END IF;

    BEGIN
      v_new := public.auto_check_in_reservation(v_res.id, p_hotel_id, p_staff_user_id);
      SELECT room_number INTO v_room FROM public.rooms WHERE id = v_new.assigned_room_id;
      v_ci := v_ci + 1;
      v_out := v_out || jsonb_build_object('reservation_id', v_res.id, 'confirmation_number', v_res.confirmation_number, 'outcome', 'checked_in', 'room', v_room);
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
      v_out := v_out || jsonb_build_object('reservation_id', v_res.id, 'confirmation_number', v_res.confirmation_number, 'outcome', 'failed', 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'checked_in', v_ci, 'skipped', v_sk, 'failed', v_fail, 'results', v_out);
END;
$function$;

-- Annule un check-in fait par erreur ou pour un client qui ne vient pas : retour en « confirmee », ou no-show, ou annulation.
-- Refuse des qu'une nuitee ou un frais est deja pose sur le folio (la facturation de nuit passe vers 03:00 le lendemain) ou qu'un paiement autre qu'un acompte a ete encaisse.
-- Les acomptes reportes au check-in retournent « en attente ». Libere la chambre et supprime le sejour ouvert.
CREATE OR REPLACE FUNCTION public.revert_check_in(
  p_reservation_id uuid, p_hotel_id uuid, p_to_status text,
  p_staff_user_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS public.reservations
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations;
  v_stay public.reservation_stays;
  v_folio public.folios;
  v_pay record;
BEGIN
  IF p_to_status NOT IN ('confirmed','no_show','cancelled') THEN
    RAISE EXCEPTION 'Statut cible invalide: % (confirmed, no_show ou cancelled)', p_to_status;
  END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id AND hotel_id = p_hotel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % introuvable pour cet hotel', p_reservation_id;
  END IF;
  IF v_res.status <> 'checked_in' THEN
    RAISE EXCEPTION 'Annulation du check-in impossible : statut actuel %', v_res.status;
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE reservation_id = p_reservation_id AND hotel_id = p_hotel_id ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_folio.status <> 'open' THEN
      RAISE EXCEPTION 'Folio non ouvert (%) : annulation du check-in impossible', v_folio.status;
    END IF;
    IF EXISTS (SELECT 1 FROM public.folio_lines WHERE folio_id = v_folio.id) THEN
      RAISE EXCEPTION 'Des nuitees ou frais sont deja factures sur le folio : annulation du check-in impossible ici';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payments
      WHERE folio_id = v_folio.id AND status = 'captured' AND COALESCE(transaction_reference, '') NOT LIKE 'ACOMPTE%'
    ) THEN
      RAISE EXCEPTION 'Un paiement est deja encaisse sur le folio : annulation du check-in impossible ici';
    END IF;

    FOR v_pay IN SELECT id FROM public.payments WHERE folio_id = v_folio.id AND COALESCE(transaction_reference, '') LIKE 'ACOMPTE%' LOOP
      UPDATE public.reservation_deposits
        SET status = 'held', applied_payment_id = NULL, resolved_at = NULL, resolved_by = NULL, updated_at = now()
        WHERE applied_payment_id = v_pay.id;
      DELETE FROM public.payments WHERE id = v_pay.id;
    END LOOP;
    PERFORM public.recompute_folio_balance(v_folio.id);
    IF p_to_status <> 'confirmed' THEN
      UPDATE public.folios SET status = 'void', updated_at = now() WHERE id = v_folio.id;
    END IF;
  END IF;

  SELECT * INTO v_stay FROM public.reservation_stays WHERE reservation_id = p_reservation_id AND check_out_at IS NULL ORDER BY check_in_at DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.rooms SET status = 'vacant_clean', updated_at = now() WHERE id = v_stay.room_id AND hotel_id = p_hotel_id AND status = 'occupied';
    DELETE FROM public.reservation_stays WHERE id = v_stay.id;
  END IF;

  UPDATE public.reservations
    SET status = p_to_status, assigned_room_id = NULL, updated_at = now(), skip_auto_check_in = (p_to_status = 'confirmed'),
        cancelled_at = CASE WHEN p_to_status = 'cancelled' THEN now() ELSE cancelled_at END,
        cancellation_reason = CASE WHEN p_to_status IN ('cancelled','no_show') THEN NULLIF(btrim(p_reason), '') ELSE cancellation_reason END
    WHERE id = p_reservation_id RETURNING * INTO v_res;

  PERFORM public.log_audit_event(v_res.tenant_id, p_hotel_id, p_staff_user_id, 'reservation', 'check_in_reverted', 'reservation', p_reservation_id,
    jsonb_build_object('to_status', p_to_status, 'reason', p_reason, 'room_id', v_stay.room_id));
  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_check_in_reservation(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_check_in_arrivals(uuid,date,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_check_in(uuid,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_check_in_reservation(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_check_in_arrivals(uuid,date,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_check_in(uuid,uuid,text,uuid,text) TO service_role;
