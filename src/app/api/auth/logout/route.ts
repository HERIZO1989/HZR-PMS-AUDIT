import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, getSessionFromRequest } from '@/lib/session';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/** BUG-06 - Le logout revoque reellement le jti courant, pas seulement le cookie client. */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (session) {
    const supabase = getSupabaseAdmin();
    await supabase.rpc('revoke_session', {
      p_jti: session.jti,
      p_staff_user_id: session.staffUserId,
      p_expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      p_reason: 'logout',
    });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
