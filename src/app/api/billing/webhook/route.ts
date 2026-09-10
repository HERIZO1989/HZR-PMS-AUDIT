import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

async function upsertSubscriptionFromStripe(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  params: {
    tenantId: string;
    planCode?: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: string;
    currentPeriodStart?: number | null;
    currentPeriodEnd?: number | null;
    cancelAtPeriodEnd?: boolean;
  }
) {
  let planCode = params.planCode;

  if (!planCode) {
    // Retrouve le plan via l'abonnement existant si l'event ne le fournit pas
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('plan_code')
      .eq('tenant_id', params.tenantId)
      .maybeSingle();
    planCode = existing?.plan_code ?? 'starter';
  }

  await supabase.from('subscriptions').upsert(
    {
      tenant_id: params.tenantId,
      plan_code: planCode,
      stripe_customer_id: params.stripeCustomerId,
      stripe_subscription_id: params.stripeSubscriptionId,
      status: params.status,
      current_period_start: params.currentPeriodStart ? new Date(params.currentPeriodStart * 1000).toISOString() : null,
      current_period_end: params.currentPeriodEnd ? new Date(params.currentPeriodEnd * 1000).toISOString() : null,
      cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  );
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Signature Stripe manquante ou secret non configuré' }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    return NextResponse.json({ error: `Signature invalide: ${err.message}` }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenant_id;
      const planCode = session.metadata?.plan_code;
      if (tenantId && session.subscription && session.customer) {
        const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
        await upsertSubscriptionFromStripe(supabase, {
          tenantId,
          planCode,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: stripeSub.id,
          status: stripeSub.status,
          currentPeriodStart: stripeSub.current_period_start,
          currentPeriodEnd: stripeSub.current_period_end,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        });
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) {
        await upsertSubscriptionFromStripe(supabase, {
          tenantId,
          planCode: sub.metadata?.plan_code,
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          currentPeriodStart: sub.current_period_start,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) {
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      await supabase
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', customerId);
      break;
    }

    default:
      break; // événements non gérés — pas d'erreur, on accuse simplement réception
  }

  return NextResponse.json({ received: true });
}
