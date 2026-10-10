import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/platformAdmin';
import { parseDemoRequest } from '@/lib/demoHotels';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function guard(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  if (!isPlatformAdmin(session)) return { error: NextResponse.json({ error: 'Réservé à l’administrateur de la plateforme' }, { status: 403 }) };
  return { session };
}

/** GET : liste des hotels de demonstration (jamais les vrais etablissements). */
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const supabase = getSupabaseAdmin();
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, code, name, created_at')
    .eq('is_demo', true)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const demos = await Promise.all(
    (tenants ?? []).map(async (t) => {
      const { data: hotel } = await supabase.from('hotels').select('id, name, currency_code').eq('tenant_id', t.id).limit(1).maybeSingle();
      const count = async (table: string, col: string, val: string) =>
        (await supabase.from(table).select('*', { count: 'exact', head: true }).eq(col, val)).count ?? 0;
      return {
        tenantId: t.id,
        tenantCode: t.code,
        tenantName: t.name,
        hotelName: hotel?.name ?? '—',
        currency: hotel?.currency_code ?? null,
        createdAt: t.created_at,
        rooms: hotel ? await count('rooms', 'hotel_id', hotel.id) : 0,
        reservations: hotel ? await count('reservations', 'hotel_id', hotel.id) : 0,
      };
    })
  );
  return NextResponse.json({ demos });
}

/** POST : cree un hotel de demonstration complet et retourne les identifiants UNE SEULE FOIS (le mot de passe n'est pas conserve en clair). */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const parsed = parseDemoRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { hotelName, currency, rooms, guests, reservations } = parsed.value;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('create_demo_hotel', {
    p_tenant_name: `${hotelName} (démo)`,
    p_hotel_name: hotelName,
    p_room_count: rooms,
    p_guest_count: guests,
    p_reservation_count: reservations,
    p_currency: currency,
  });
  if (error || !data?.[0]) {
    return NextResponse.json({ error: error?.message ?? 'Création impossible' }, { status: error?.message?.includes('Limite') ? 409 : 500 });
  }
  const d = data[0];

  const { data: staff } = await supabase
    .from('staff_users')
    .select('email, display_name, staff_user_roles(roles(code))')
    .eq('tenant_id', d.out_tenant_id)
    .order('email');

  console.log(`[demo-hotels] ${g.session!.email} a cree l'hôtel de démo ${d.out_tenant_code}`);
  return NextResponse.json(
    {
      tenantId: d.out_tenant_id,
      tenantCode: d.out_tenant_code,
      hotelName,
      currency: d.out_currency,
      rooms: d.out_rooms,
      guests: d.out_guests,
      reservations: d.out_reservations,
      password: d.out_password,
      accounts: (staff ?? []).map((s: any) => ({
        email: s.email,
        displayName: s.display_name,
        role: s.staff_user_roles?.[0]?.roles?.code ?? null,
      })),
    },
    { status: 201 }
  );
}
