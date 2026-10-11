-- TASK 37 : annulation d'un import termine (filet de securite avant d'importer dans un hotel reel).
-- Supprime les reservations importees auxquelles rien ne s'est rattache depuis (folio, sejour, conciergerie : la cle etrangere protege),
-- puis les clients crees pendant le lot qui n'ont plus aucune reservation. Refuse un lot d'un autre hotel, non termine ou deja annule.
-- Limite connue : un client cree a la main pendant la courte duree de l'import (quelques secondes) et sans reservation serait supprime.
CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id uuid, p_hotel_id uuid)
 RETURNS TABLE(reservations_deleted integer, reservations_kept integer, guests_deleted integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_batch record; v_summary jsonb; v_del integer := 0; v_kept integer := 0; v_guests integer := 0; r record;
BEGIN
  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id AND hotel_id = p_hotel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot d''import introuvable pour cet hotel'; END IF;
  IF v_batch.status <> 'completed' THEN RAISE EXCEPTION 'Seul un lot termine peut etre annule'; END IF;

  v_summary := coalesce(v_batch.error_summary, '[]'::jsonb);
  IF jsonb_typeof(v_summary) = 'object' THEN v_summary := jsonb_build_array(v_summary); END IF;
  IF jsonb_path_exists(v_summary, '$[*].rolled_back_at') THEN RAISE EXCEPTION 'Ce lot a deja ete annule'; END IF;

  -- Reservations importees : supprimees si rien ne s'y est rattache depuis (folio, sejour, demande de conciergerie...).
  -- Une reservation deja utilisee est conservee : la base refuse sa suppression (cle etrangere) et elle est comptee.
  FOR r IN
    SELECT ir.id AS row_id, ir.target_entity_id AS res_id
    FROM public.import_rows ir
    WHERE ir.import_batch_id = p_batch_id AND ir.status = 'imported' AND ir.target_entity_type = 'reservation' AND ir.target_entity_id IS NOT NULL
  LOOP
    BEGIN
      DELETE FROM public.reservations WHERE id = r.res_id AND hotel_id = p_hotel_id;
      UPDATE public.import_rows SET status = 'skipped', target_entity_id = NULL,
        validation_errors = validation_errors || jsonb_build_array('Import annule : reservation supprimee')
      WHERE id = r.row_id;
      v_del := v_del + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      v_kept := v_kept + 1;
    END;
  END LOOP;

  -- Clients crees pendant le lot (entre son debut et sa fin) et qui n'ont plus aucune reservation.
  DELETE FROM public.guests g
  WHERE g.tenant_id = v_batch.tenant_id
    AND g.created_at BETWEEN v_batch.started_at AND coalesce(v_batch.completed_at, now())
    AND NOT EXISTS (SELECT 1 FROM public.reservations x WHERE x.guest_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM public.concierge_requests c WHERE c.guest_id = g.id);
  GET DIAGNOSTICS v_guests = ROW_COUNT;

  UPDATE public.import_batches
  SET error_summary = v_summary || jsonb_build_array(jsonb_build_object(
        'rolled_back_at', now(), 'reservations_deleted', v_del, 'reservations_kept', v_kept, 'guests_deleted', v_guests))
  WHERE id = p_batch_id;

  RETURN QUERY SELECT v_del, v_kept, v_guests;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid, uuid) TO service_role;
