import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { signSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('verify_staff_login', { p_email: email, p_password: password });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data?.[0];
  if (!row) return NextResponse.json({ error: 'Identifiants invalides' }, { status: 401 });

  const token = await signSession({
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
