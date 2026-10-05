import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendCriticalAlertDigest } from '@/lib/email';
import { runAuditAlerts } from '@/lib/alerts/auditAlerts';

export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // non configure
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** POST /api/cron/audit-alerts — appele par GitHub Actions (Authorization: Bearer CRON_SECRET). */
export async function POST(req: NextRequest) {
  const ok = authorized(req);
  if (ok === null) return NextResponse.json({ error: 'CRON_SECRET non configuré sur le serveur' }, { status: 503 });
  if (!ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  try {
    const results = await runAuditAlerts(getSupabaseAdmin(), sendCriticalAlertDigest);
    const failed = results.filter((r) => r.error).length;
    return NextResponse.json({ hotels: results.length, failed, results }, { status: failed ? 207 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}
