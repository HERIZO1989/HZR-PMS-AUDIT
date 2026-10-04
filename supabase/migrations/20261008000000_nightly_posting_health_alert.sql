-- TASK 24 : alerte d'audit quand le posting automatique des nuitees est en defaut.
-- Detecte : job pg_cron absent/desactive, executions en echec (24 h), absence d'execution reussie (3 h),
-- et absence de posting enregistre pour la date d'exploitation de la veille (apres 04h locale), ce qui couvre
-- aussi le cas d'un hotel en erreur que post_room_charges_nightly avale (RAISE WARNING).

CREATE OR REPLACE FUNCTION public.nightly_posting_health(p_hotel_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $fn$
DECLARE
  h record;
  v_local timestamp;
  v_yday date;
  v_last_ok timestamptz;
  v_failed int;
BEGIN
  SELECT hh.auto_post_room_charges AS auto_post, COALESCE(hh.timezone, 'UTC') AS tz
    INTO h FROM public.hotels hh WHERE hh.id = p_hotel_id;
  IF NOT FOUND OR NOT COALESCE(h.auto_post, false) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'post-room-charges-nightly' AND j.active) THEN
    RETURN 'le job pg_cron post-room-charges-nightly est absent ou désactivé';
  END IF;

  SELECT max(d.start_time) FILTER (WHERE d.status = 'succeeded'),
         count(*) FILTER (WHERE d.status = 'failed' AND d.start_time > now() - interval '24 hours')
    INTO v_last_ok, v_failed
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname = 'post-room-charges-nightly' AND d.start_time > now() - interval '48 hours';

  IF v_failed > 0 THEN
    RETURN v_failed || ' exécution(s) du job en échec sur les dernières 24 h';
  END IF;
  IF v_last_ok IS NULL OR v_last_ok < now() - interval '3 hours' THEN
    RETURN 'aucune exécution réussie du job depuis plus de 3 h';
  END IF;

  v_local := now() AT TIME ZONE h.tz;
  IF extract(hour FROM v_local) >= 4 THEN
    v_yday := v_local::date - 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_events e
      WHERE e.hotel_id = p_hotel_id AND e.action = 'post_room_charges'
        AND e.metadata->>'business_date' = v_yday::text
    ) THEN
      RETURN 'aucun posting enregistré pour la date d''exploitation ' || v_yday;
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.audit_nightly_posting_findings(p_hotel_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_problem text;
BEGIN
  v_problem := public.nightly_posting_health(p_hotel_id);
  IF v_problem IS NOT NULL THEN
    INSERT INTO public.audit_findings(tenant_id,hotel_id,business_date,category,severity,title,description,recommendation,status)
    VALUES (p_tenant_id, p_hotel_id, current_date, 'compliance', 'critical',
      'Posting automatique des nuitées en défaut',
      'Le posting automatique est activé mais : ' || v_problem || '.',
      'Contrôler cron.job_run_details puis poster la veille depuis Night Audit (bouton « Poster les nuitées »).',
      'open');
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.nightly_posting_health(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_nightly_posting_findings(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nightly_posting_health(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_nightly_posting_findings(uuid, uuid) TO service_role;

-- run_hotel_audit : appel ajoute avant le RETURN QUERY final (idempotent, le reste de la fonction est inchange).
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.run_hotel_audit'::regproc);
  IF position('audit_nightly_posting_findings' IN d) = 0 THEN
    IF position(E'  RETURN QUERY' IN d) = 0 THEN
      RAISE EXCEPTION 'run_hotel_audit : marqueur RETURN QUERY introuvable';
    END IF;
    d := replace(d, E'  RETURN QUERY', E'  PERFORM public.audit_nightly_posting_findings(p_hotel_id, v_tenant_id);\n\n  RETURN QUERY');
    EXECUTE d;
  END IF;
END
$patch$;
