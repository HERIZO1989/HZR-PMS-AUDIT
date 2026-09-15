import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * BUG-16 - Route de health check reelle : verifie non seulement que le process
 * repond, mais qu'il peut effectivement joindre Supabase. Sans cela Render ne
 * distingue pas "demarre" de "fonctionnel".
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('billing_plans').select('code').limit(1);
    if (error) {
      return NextResponse.json({ status: 'degraded', database: 'error', message: error.message }, { status: 503 });
    }
    return NextResponse.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ status: 'degraded', message: err.message }, { status: 503 });
  }
}
