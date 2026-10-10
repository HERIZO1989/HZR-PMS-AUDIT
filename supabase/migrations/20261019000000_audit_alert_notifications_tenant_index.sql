-- Index couvrant la cle etrangere tenant_id de audit_alert_notifications (signale par le linter de performance Supabase) :
-- sans lui, supprimer un tenant relit toute la table.
CREATE INDEX IF NOT EXISTS audit_alert_notifications_tenant_idx ON public.audit_alert_notifications (tenant_id);
