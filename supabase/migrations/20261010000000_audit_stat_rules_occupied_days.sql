-- TASK 25 : les regles statistiques ADR / RevPAR de run_hotel_audit ne doivent juger que les jours reellement occupes,
-- et seulement si l'echantillon est suffisant (>= 7 jours occupes). Avant : un hotel vide (ADR = 0, par definition) etait
-- signale "anomalie tarifaire" chaque jour, et 17 faux positifs noyaient les vraies alertes (cas Anjary, 4-19/09).
-- Patch idempotent de la definition existante ; le reste de la fonction est inchange.
DO $patch$
DECLARE
  d text;
  min_days constant text := '(SELECT count(*) FROM public.kpi_daily_snapshots x WHERE x.hotel_id = p_hotel_id AND x.business_date BETWEEN p_start_date AND p_end_date AND x.rooms_occupied > 0) >= 7';
  a1 text := 'AND stats.s > 0 AND abs(k.adr - stats.a) > 1.5 * stats.s;';
  a2 text := 'AND stats.s > 0 AND abs(k.revpar - stats.a) > 1.5 * stats.s;';
  c3 text := E'SELECT avg(revpar) a, stddev_samp(revpar) s\n    FROM public.kpi_daily_snapshots\n    WHERE hotel_id = p_hotel_id AND business_date BETWEEN p_start_date AND p_end_date\n';
BEGIN
  d := pg_get_functiondef('public.run_hotel_audit'::regproc);
  IF position('x.rooms_occupied > 0' IN d) > 0 THEN
    RETURN; -- deja applique
  END IF;
  IF position(a1 IN d) = 0 OR position(a2 IN d) = 0 OR position(c3 IN d) = 0 THEN
    RAISE EXCEPTION 'run_hotel_audit : marqueurs ADR/RevPAR introuvables, patch annule';
  END IF;
  d := replace(d, a1, 'AND k.rooms_occupied > 0 AND ' || min_days || ' ' || a1);
  d := replace(d, c3, c3 || E'      AND rooms_occupied > 0\n');
  d := replace(d, a2, 'AND k.rooms_occupied > 0 AND ' || min_days || ' ' || a2);
  EXECUTE d;
END
$patch$;
