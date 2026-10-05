import { describe, it, expect, vi } from 'vitest';
import { runAuditAlerts } from '../src/lib/alerts/auditAlerts';
import { buildCriticalAlertHtml } from '../src/lib/email';

type Fresh = { fingerprint: string; title: string; description: string; business_date: string | null; recommendation: string | null };

function fakeClient(opts: {
  hotels: { id: string; tenant_id: string; name: string }[];
  fresh: Record<string, Fresh[]>;
  recipients: Record<string, { email: string }[]>;
  failAuditFor?: string;
}) {
  const upserts: any[] = [];
  const client: any = {
    from(table: string) {
      if (table === 'hotels') return { select: () => ({ eq: async () => ({ data: opts.hotels, error: null }) }) };
      if (table === 'audit_alert_notifications') {
        return { upsert: async (rows: any[]) => { upserts.push(...rows); return { error: null }; } };
      }
      throw new Error(`table inattendue ${table}`);
    },
    async rpc(name: string, args: any) {
      const id = args.p_hotel_id;
      if (name === 'run_hotel_audit') return opts.failAuditFor === id ? { data: null, error: { message: 'boom' } } : { data: [{}], error: null };
      if (name === 'new_critical_findings') return { data: opts.fresh[id] ?? [], error: null };
      if (name === 'alert_recipients') return { data: opts.recipients[id] ?? [], error: null };
      throw new Error(`rpc inattendue ${name}`);
    },
  };
  return { client, upserts };
}

const f = (n: number): Fresh => ({ fingerprint: `fp${n}`, title: 'Facture non soldée', description: `d${n}`, business_date: '2026-09-30', recommendation: 'r' });
const H1 = { id: 'h1', tenant_id: 't1', name: 'Hôtel Un' };
const H2 = { id: 'h2', tenant_id: 't1', name: 'Hôtel Deux' };

describe('Alertes critiques par e-mail', () => {
  it('envoie un seul digest par hotel puis memorise les empreintes', async () => {
    const { client, upserts } = fakeClient({ hotels: [H1], fresh: { h1: [f(1), f(2)] }, recipients: { h1: [{ email: 'a@x.mg' }, { email: 'b@x.mg' }] } });
    const send = vi.fn().mockResolvedValue(true);
    const r = await runAuditAlerts(client, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toEqual(['a@x.mg', 'b@x.mg']);
    expect(send.mock.calls[0][0].items).toHaveLength(2);
    expect(upserts.map((u) => u.fingerprint)).toEqual(['fp1', 'fp2']);
    expect(r[0]).toMatchObject({ newCritical: 2, recipients: 2, sent: true });
  });

  it("n'envoie rien quand il n'y a aucune nouvelle anomalie critique", async () => {
    const { client, upserts } = fakeClient({ hotels: [H1], fresh: {}, recipients: { h1: [{ email: 'a@x.mg' }] } });
    const send = vi.fn();
    const r = await runAuditAlerts(client, send);
    expect(send).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(r[0]).toMatchObject({ newCritical: 0, sent: false });
    expect(r[0].error).toBeUndefined();
  });

  it("ne memorise rien si l'envoi echoue (nouvelle tentative au prochain passage)", async () => {
    const { client, upserts } = fakeClient({ hotels: [H1], fresh: { h1: [f(1)] }, recipients: { h1: [{ email: 'a@x.mg' }] } });
    const r = await runAuditAlerts(client, vi.fn().mockResolvedValue(false));
    expect(upserts).toHaveLength(0);
    expect(r[0].sent).toBe(false);
    expect(r[0].error).toMatch(/envoi/);
  });

  it("ignore sans erreur un hotel sans destinataire joignable (ex. demo), sans rien memoriser", async () => {
    const { client, upserts } = fakeClient({ hotels: [H1], fresh: { h1: [f(1)] }, recipients: { h1: [] } });
    const send = vi.fn();
    const r = await runAuditAlerts(client, send);
    expect(send).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(r[0].error).toBeUndefined();
    expect(r[0].skipped).toMatch(/destinataire/);
  });

  it("un hotel en erreur n'empeche pas les autres", async () => {
    const { client } = fakeClient({
      hotels: [H1, H2], failAuditFor: 'h1',
      fresh: { h2: [f(9)] }, recipients: { h2: [{ email: 'c@x.mg' }] },
    });
    const send = vi.fn().mockResolvedValue(true);
    const r = await runAuditAlerts(client, send);
    expect(r[0].error).toMatch(/run_hotel_audit/);
    expect(r[1]).toMatchObject({ hotelId: 'h2', sent: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("echappe le HTML des descriptions dans l'e-mail", () => {
    const html = buildCriticalAlertHtml('Hôtel <b>X</b>', [
      { title: 'T', description: '<script>alert(1)</script> & "x"', businessDate: null, recommendation: null },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Hôtel &lt;b&gt;X&lt;/b&gt;');
  });
});
