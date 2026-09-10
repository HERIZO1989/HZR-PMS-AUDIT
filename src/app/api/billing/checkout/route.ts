import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSessionFromRequest, hasPermission } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasPermission(session, 'admin.full')) {
    return NextResponse.json({ error: 'Seul un administrateur peut gérer la facturation' }, { status: 403 });
  }

  const { planCode } = await req.json();
  if (!planCode) return NextResponse.json({ error: 'planCode requis' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  const { data: plan } = await supabase
    .from('billing_plans')
    .select('code, name, stripe_price_id')
    .eq('code', planCode)
    .single();

  if (!plan) return NextResponse.json({ error: 'Plan inconnu' }, { status: 404 });
  if (!plan.stripe_price_id) {
    return NextResponse.json(
      { error: 'Ce plan nécessite un contact commercial (Enterprise) — pas de paiement en self-service.' },
      { status: 422 }
    );
  }

  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', session!.tenantId).single();
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', session!.tenantId)
    .maybeSingle();

  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  let customerId = existingSub?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session!.email,
      name: tenant?.name ?? undefined,
      metadata: { tenant_id: session!.tenantId },
    });
    customerId = customer.id;
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${appUrl}/billing?success=1`,
    cancel_url: `${appUrl}/billing?canceled=1`,
    metadata: { tenant_id: session!.tenantId, plan_code: plan.code },
    subscription_data: { metadata: { tenant_id: session!.tenantId, plan_code: plan.code } },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
