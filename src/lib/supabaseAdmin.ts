import { createClient } from '@supabase/supabase-js';

/**
 * Backend-only client using the service role key: bypasses RLS by design.
 * Every query in the API routes MUST filter explicitly by hotel_id/tenant_id —
 * RLS is a second line of defense for any future client-side access, not the
 * only one here.
 */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans les variables d\'environnement');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getHotelBrand(hotelId: string): Promise<{ name: string; currencyCode: string }> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from('hotels').select('name, currency_code').eq('id', hotelId).single();
  return { name: data?.name ?? 'Hôtel', currencyCode: data?.currency_code ?? 'EUR' };
}

export function getDemoHotelId(): string {
  const id = process.env.NEXT_PUBLIC_DEMO_HOTEL_ID;
  if (!id) throw new Error('NEXT_PUBLIC_DEMO_HOTEL_ID manquant');
  return id;
}
