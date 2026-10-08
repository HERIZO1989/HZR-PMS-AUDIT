-- TASK 32 : application d'un lot d'import par tranches.
-- apply_import_batch traite toutes les lignes en une seule requete (~1 ms/ligne mesure) ; l'API Supabase coupe a 8 s.
-- Le fichier reel d'Anjary compte ~4 400 reservations valides : trop proche de la limite. Cette fonction en traite
-- p_limit par appel et indique ce qu'il reste ; le service l'appelle en boucle. apply_import_batch est conservee.
CREATE OR REPLACE FUNCTION public.apply_import_batch_chunk(p_batch_id uuid, p_limit integer DEFAULT 500)
 RETURNS TABLE(processed integer, remaining integer, imported integer, invalid integer, skipped integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  n integer := 0;
  rem integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 500; END IF;

  UPDATE public.import_batches
  SET status = 'importing', started_at = COALESCE(started_at, now())
  WHERE id = p_batch_id AND status <> 'completed';

  FOR r IN
    SELECT id FROM public.import_rows
    WHERE import_batch_id = p_batch_id AND status = 'valid'
    ORDER BY row_number
    LIMIT p_limit
  LOOP
    PERFORM public.apply_import_row(r.id);
    n := n + 1;
  END LOOP;

  SELECT count(*)::int INTO rem FROM public.import_rows WHERE import_batch_id = p_batch_id AND status = 'valid';

  IF rem = 0 THEN
    UPDATE public.import_batches ib SET
      valid_rows = (SELECT count(*) FROM public.import_rows WHERE import_batch_id = p_batch_id AND status = 'imported'),
      error_rows = (SELECT count(*) FROM public.import_rows WHERE import_batch_id = p_batch_id AND status IN ('invalid', 'skipped')),
      status = 'completed',
      completed_at = now()
    WHERE ib.id = p_batch_id;
  END IF;

  RETURN QUERY
  SELECT n, rem,
    (count(*) FILTER (WHERE status = 'imported'))::int,
    (count(*) FILTER (WHERE status = 'invalid'))::int,
    (count(*) FILTER (WHERE status = 'skipped'))::int
  FROM public.import_rows WHERE import_batch_id = p_batch_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_import_batch_chunk(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_import_batch_chunk(uuid, integer) TO service_role;
