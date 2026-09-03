import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Source of truth for "did this order actually get paid" — never the browser.
// Handles both checkout.session.completed (most payment methods) and
// checkout.session.async_payment_succeeded (delayed-notification methods),
// gated on payment_status either way, per Stripe's guidance. Idempotent via
// the unique index on orders.stripe_checkout_session_id, so Stripe's retries
// (or receiving both event types for one session) can't create duplicates.
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Webhook signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const sessionSummary = event.data.object as Stripe.Checkout.Session;
    if (sessionSummary.payment_status === "paid") {
      await fulfillOrder(sessionSummary.id);
    }
  }

  return NextResponse.json({ received: true });
}

async function fulfillOrder(sessionId: string) {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existing) return; // already processed — Stripe retried, or both event types fired

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items", "payment_intent"],
  });

  const meta = session.metadata ?? {};
  const restaurantId = meta.restaurant_id;
  if (!restaurantId) {
    console.error("Webhook: checkout session missing restaurant_id metadata", sessionId);
    return;
  }

  const lines = session.line_items?.data ?? [];
  const deliveryLine = lines.find((li) => li.description === "Delivery Fee");
  const taxLine = lines.find((li) => li.description === "Tax");
  const itemLines = lines.filter((li) => li !== deliveryLine && li !== taxLine);

  const subtotalCents = itemLines.reduce((sum, li) => sum + (li.amount_total ?? 0), 0);
  const deliveryFeeCents = deliveryLine?.amount_total ?? 0;
  const taxCents = taxLine?.amount_total ?? 0;

  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      restaurant_id: restaurantId,
      customer_name: meta.customer_name ?? "",
      customer_email: session.customer_details?.email ?? "",
      customer_phone: meta.customer_phone ?? "",
      fulfillment_mode: meta.fulfillment_mode ?? "pickup",
      delivery_address: meta.delivery_address ? JSON.parse(meta.delivery_address) : null,
      pickup_time: meta.pickup_time || null,
      subtotal_cents: subtotalCents,
      delivery_fee_cents: deliveryFeeCents,
      tax_cents: taxCents,
      total_cents: session.amount_total ?? 0,
      currency: session.currency ?? "cad",
      status: "paid",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntent?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !order) {
    console.error("Webhook: failed to insert order", sessionId, error);
    return;
  }

  const orderItems = itemLines.map((li) => ({
    order_id: order.id,
    name_snapshot: li.description ?? "Item",
    price_cents_snapshot: li.quantity ? Math.round((li.amount_total ?? 0) / li.quantity) : (li.amount_total ?? 0),
    quantity: li.quantity ?? 1,
  }));

  if (orderItems.length > 0) {
    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) console.error("Webhook: failed to insert order_items", sessionId, itemsError);
  }
}
