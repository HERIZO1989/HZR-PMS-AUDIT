-- TASK 26 : alertes e-mail sur les anomalies critiques d'audit, sans doublon.
-- run_hotel_audit supprime et recree les findings ouverts a chaque lancement (ids neufs) : la deduplication
-- se fait donc sur une empreinte du contenu (titre + date + description), pas sur l'id du finding.

CREATE TABLE IF NOT EXISTS public.audit_alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, fingerprint)
);
ALTER TABLE public.audit_alert_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_alert_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.audit_alert_notifications TO service_role;

-- Anomalies critiques ouvertes qui n'ont pas encore ete notifiees.
CREATE OR REPLACE FUNCTION public.new_critical_findings(p_hotel_id uuid)
 RETURNS TABLE(fingerprint text, title text, description text, business_date date, recommendation text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT md5(af.title || '|' || coalesce(af.business_date::text, '') || '|' || af.description),
         af.title, af.description, af.business_date, af.recommendation
  FROM public.audit_findings af
  WHERE af.hotel_id = p_hotel_id AND af.status = 'open' AND af.severity = 'critical'
    AND NOT EXISTS (
      SELECT 1 FROM public.audit_alert_notifications n
      WHERE n.hotel_id = p_hotel_id
        AND n.fingerprint = md5(af.title || '|' || coalesce(af.business_date::text, '') || '|' || af.description)
    )
  ORDER BY af.business_date NULLS LAST, af.title;
$fn$;

-- Destinataires : OWNER et GM actifs de l'hotel (ou rattaches a tout le tenant).
CREATE OR REPLACE FUNCTION public.alert_recipients(p_hotel_id uuid)
 RETURNS TABLE(email text, display_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT DISTINCT su.email, su.display_name
  FROM public.staff_users su
  JOIN public.hotels h ON h.id = p_hotel_id AND h.tenant_id = su.tenant_id
  JOIN public.staff_user_roles sur ON sur.staff_user_id = su.id
  JOIN public.roles r ON r.id = sur.role_id
  WHERE su.status = 'active' AND su.email IS NOT NULL
    AND (su.hotel_id = p_hotel_id OR su.hotel_id IS NULL)
    AND r.code IN ('OWNER', 'GM');
$fn$;

REVOKE ALL ON FUNCTION public.new_critical_findings(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.new_critical_findings(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.alert_recipients(uuid) TO service_role;
