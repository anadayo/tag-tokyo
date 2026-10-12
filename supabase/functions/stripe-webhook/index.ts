import Stripe from "npm:stripe@22.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

function stringId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET");
  if (!stripeKey || !webhookSecret) return new Response("Webhook not configured", { status: 503 });

  const stripe = new Stripe(stripeKey);
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature ?? "",
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let orderId: string | null = null;
  let checkoutSessionId: string | null = null;
  let paymentIntentId: string | null = null;
  let paymentStatus = "";
  let amount = 0;
  let currency = "jpy";
  let amountRefunded = 0;

  if (event.type.startsWith("checkout.session.")) {
    const session = event.data.object as Stripe.Checkout.Session;
    orderId = session.metadata?.order_id ?? null;
    checkoutSessionId = session.id;
    paymentIntentId = stringId(session.payment_intent as string | Stripe.PaymentIntent | null);
    paymentStatus = session.payment_status;
    amount = session.amount_total ?? 0;
    currency = session.currency ?? "jpy";
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    orderId = charge.metadata?.order_id ?? null;
    paymentIntentId = stringId(charge.payment_intent as string | Stripe.PaymentIntent | null);
    paymentStatus = charge.paid ? "paid" : "unpaid";
    amount = charge.amount;
    amountRefunded = charge.amount_refunded;
    currency = charge.currency;
    if (!orderId && paymentIntentId) {
      const { data } = await client.from("payment_orders").select("id").eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
      orderId = data?.id ?? null;
    }
  } else {
    return Response.json({ received: true, ignored: true });
  }

  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return new Response("Order metadata missing", { status: 400 });
  const { data, error } = await client.rpc("process_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_order_id: orderId,
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_payment_status: paymentStatus,
    p_amount: amount,
    p_currency: currency,
    p_amount_refunded: amountRefunded,
  });
  if (error) return new Response("Processing failed", { status: 500 });
  return Response.json({ received: true, result: data });
});
