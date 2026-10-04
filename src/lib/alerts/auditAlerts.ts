import type { SupabaseClient } from '@supabase/supabase-js';
import type { CriticalAlertItem } from '../email';

export interface AlertHotelResult {
  hotelId: string;
  newCritical: number;
  recipients: number;
  sent: boolean;
  error?: string;
}

export type SendDigest = (p: { to: string[]; hotelName: string; items: CriticalAlertItem[] }) => Promise<boolean>;

/**
 * Pour chaque hotel actif : relance l'audit, isole les anomalies critiques jamais notifiees, envoie UN digest
 * aux OWNER/GM actifs, puis memorise les empreintes. Si l'envoi echoue, rien n'est memorise (nouvelle tentative au prochain passage).
 * Un hotel en erreur n'empeche jamais les autres.
 */
export async function runAuditAlerts(supabase: SupabaseClient, send: SendDigest): Promise<AlertHotelResult[]> {
  const { data: hotels, error } = await supabase.from('hotels').select('id, tenant_id, name').eq('status', 'active');
  if (error) throw new Error(`Lecture des hôtels impossible : ${error.message}`);

  const results: AlertHotelResult[] = [];
  for (const h of hotels ?? []) {
    const r: AlertHotelResult = { hotelId: h.id, newCritical: 0, recipients: 0, sent: false };
    try {
      const audit = await supabase.rpc('run_hotel_audit', {
        p_hotel_id: h.id,
        p_start_date: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        p_end_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      });
      if (audit.error) throw new Error(`run_hotel_audit : ${audit.error.message}`);

      const found = await supabase.rpc('new_critical_findings', { p_hotel_id: h.id });
      if (found.error) throw new Error(`new_critical_findings : ${found.error.message}`);
      const fresh = (found.data ?? []) as {
        fingerprint: string; title: string; description: string; business_date: string | null; recommendation: string | null;
      }[];
      r.newCritical = fresh.length;
      if (fresh.length === 0) { results.push(r); continue; }

      const rec = await supabase.rpc('alert_recipients', { p_hotel_id: h.id });
      if (rec.error) throw new Error(`alert_recipients : ${rec.error.message}`);
      const to = ((rec.data ?? []) as { email: string }[]).map((x) => x.email);
      r.recipients = to.length;
      if (to.length === 0) throw new Error('aucun destinataire OWNER/GM actif');

      const ok = await send({
        to,
        hotelName: h.name,
        items: fresh.map((f) => ({ title: f.title, description: f.description, businessDate: f.business_date, recommendation: f.recommendation })),
      });
      if (!ok) throw new Error("envoi de l'e-mail échoué");

      const ins = await supabase.from('audit_alert_notifications').upsert(
        fresh.map((f) => ({ tenant_id: h.tenant_id, hotel_id: h.id, fingerprint: f.fingerprint, severity: 'critical', title: f.title, recipients: to.length })),
        { onConflict: 'hotel_id,fingerprint', ignoreDuplicates: true }
      );
      if (ins.error) throw new Error(`mémorisation impossible : ${ins.error.message}`);
      r.sent = true;
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
    }
    results.push(r);
  }
  return results;
}
