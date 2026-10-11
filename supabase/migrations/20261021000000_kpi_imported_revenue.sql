-- TASK 38 : revenu des sejours importes (Odoo) dans les indicateurs.
-- Un import de reservations ne cree pas de folio : les nuits importees comptaient dans l'occupation mais avec un revenu de 0.
-- Resultat a Anjary : ADR moyen sur 30 jours a 29 343 Ar au lieu de ~134 000 Ar, donc de fausses alertes « Anomalie tarifaire ».
-- Correctif : pour une reservation IMPORTEE (import_rows) en checked_in / checked_out et SANS ligne de nuitee dans un folio, le « Montant total »
-- est reparti sur les nuits du sejour. Si l'hotel est en prix TTC (prices_include_vat), le montant est ramene HT avec hotels.vat_rate,
-- comme les lignes de nuitee postees par le PMS. Les reservations creees dans le PMS ne sont jamais concernees.
-- Hypothese a verifier : le « Montant total » d'Odoo est un total taxes comprises. S'il etait hors taxes, mettre prices_include_vat a false pour l'hotel.
CREATE INDEX IF NOT EXISTS import_rows_target_entity_idx ON public.import_rows (target_entity_id) WHERE status = 'imported';
CREATE INDEX IF NOT EXISTS folios_reservation_idx ON public.folios (reservation_id);

DO $patch$
DECLARE
  d text;
  decl_old text := E'  v_count int := 0;\nBEGIN\n  SELECT h.tenant_id INTO v_tenant_id FROM public.hotels h WHERE h.id = p_hotel_id;\n';
  decl_new text := E'  v_count int := 0;\n  v_vat_factor numeric := 1;\nBEGIN\n  SELECT h.tenant_id, CASE WHEN h.prices_include_vat THEN 1 / (1 + COALESCE(h.vat_rate, 0)) ELSE 1 END\n    INTO v_tenant_id, v_vat_factor FROM public.hotels h WHERE h.id = p_hotel_id;\n';
  rev_old text := E'      AND fl.posted_at::date = d;\n';
  rev_new text := E'      AND fl.posted_at::date = d;\n\n    -- Sejours importes sans facture : montant total reparti sur les nuits, ramene HT si les prix sont TTC.\n    SELECT v_revenue + COALESCE(sum(COALESCE(res.total_amount, 0) / GREATEST(res.departure_date - res.arrival_date, 1)), 0) * v_vat_factor\n    INTO v_revenue\n    FROM public.reservations res\n    WHERE res.hotel_id = p_hotel_id\n      AND res.status IN (''checked_in'',''checked_out'')\n      AND res.arrival_date <= d AND res.departure_date > d\n      AND EXISTS (SELECT 1 FROM public.import_rows ir WHERE ir.target_entity_id = res.id AND ir.status = ''imported'')\n      AND NOT EXISTS (\n        SELECT 1 FROM public.folios f2 JOIN public.folio_lines l2 ON l2.folio_id = f2.id\n        WHERE f2.reservation_id = res.id AND l2.line_type = ''room_charge''\n      );\n';
BEGIN
  d := pg_get_functiondef('public.compute_kpi_snapshots'::regproc);
  IF position('Sejours importes sans facture' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position(decl_old IN d) = 0 OR position(rev_old IN d) = 0 THEN
    RAISE EXCEPTION 'compute_kpi_snapshots : marqueurs introuvables, patch annule';
  END IF;
  EXECUTE replace(replace(d, decl_old, decl_new), rev_old, rev_new);
END
$patch$;
