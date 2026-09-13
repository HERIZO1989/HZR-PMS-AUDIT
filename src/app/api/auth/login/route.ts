import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { signSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/session';

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 });
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent');

  const supabase = getSupabaseAdmin();
  // BUG-04/BUG-05 - attempt_staff_login applique le rate limiting (5 echecs / 15 min)
  // et trace chaque tentative (succes/echec/refus) dans security_events.
  const { data, error } = await supabase.rpc('attempt_staff_login', {
    p_email: email,
    p_password: password,
    p_ip_address: ip,
    p_user_agent: userAgent,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data?.[0];

  if (row?.locked) {
    return NextResponse.json(
      { error: 'Trop de tentatives échouées. Réessayez dans quelques minutes.' },
      { status: 429 }
    );
  }

  if (!row?.staff_user_id) {
    return NextResponse.json({ error: 'Identifiants invalides' }, { status: 401 });
  }

  const { token } = await signSession({
    staffUserId: row.staff_user_id,
    tenantId: row.tenant_id,
    hotelId: row.hotel_id,
    displayName: row.display_name,
    email: row.email,
    permissions: row.permissions ?? [],
  });

  const res = NextResponse.json({ ok: true, displayName: row.display_name });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
