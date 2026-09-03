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
      // Direct charge — this event fires for a session that lives on the
      // restaurant's connected account, so event.account carries which one;
      // fulfillOrder needs it to retrieve the session in the right context.
      await fulfillOrder(sessionSummary.id, event.account ?? null);
    }
  }

  // Keeps orders.refund_status honest after cancelAndRefundOrderAction
  // (src/app/admin/[slug]/actions.ts) initiates a refund — that action can
  // only record the *initial* status Stripe returns synchronously (often
  // "pending", not final), and a pending refund can still resolve to
  // "succeeded" or fail later. These are the unified events for all refund
  // types as of Stripe's 2024-10-28 API version (refund.created also exists
  // but isn't needed here — we already have the refund id from the create
  // call's own response).
  if (event.type === "refund.updated" || event.type === "refund.failed") {
    const refund = event.data.object as Stripe.Refund;
    await syncRefundStatus(refund.id, refund.status);
  }

  return NextResponse.json({ received: true });
}

async function syncRefundStatus(refundId: string, status: string | null) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("orders").update({ refund_status: status }).eq("stripe_refund_id", refundId);
  if (error) console.error("Webhook: failed to sync refund_status", refundId, error);
}

async function fulfillOrder(sessionId: string, accountId: string | null) {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existing) return; // already processed — Stripe retried, or both event types fired

  const session = await stripe.checkout.sessions.retrieve(
    sessionId,
    { expand: ["line_items", "payment_intent"] },
    accountId ? { stripeAccount: accountId } : undefined,
  );

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

  // Once any session-level discount exists, Stripe proportionally distributes
  // it across every line item, so summing li.amount_total per bucket would be
  // wrong. subtotal/delivery/tax are instead read straight from the metadata
  // computed authoritatively at session-creation time (src/app/api/checkout).
  const subtotalCents = Number(meta.subtotal_cents ?? 0);
  const deliveryFeeCents = Number(meta.delivery_fee_cents ?? 0);
  const taxCents = Number(meta.tax_cents ?? 0);
  const discountCents = Number(meta.discount_cents ?? 0);
  const promoCode = meta.promo_code || null;

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
      scheduled_for: meta.scheduled_for || null,
      location_id: meta.location_id || null,
      subtotal_cents: subtotalCents,
      delivery_fee_cents: deliveryFeeCents,
      tax_cents: taxCents,
      promo_code: promoCode,
      discount_cents: discountCents,
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

  // Snapshot each item's price from amount_subtotal (pre-discount, per-line)
  // rather than amount_total — correct whether or not a promo was applied,
  // since amount_total would otherwise carry a fraction of the discount.
  const orderItems = itemLines.map((li) => ({
    order_id: order.id,
    name_snapshot: li.description ?? "Item",
    price_cents_snapshot: li.quantity ? Math.round((li.amount_subtotal ?? 0) / li.quantity) : (li.amount_subtotal ?? 0),
    quantity: li.quantity ?? 1,
  }));

  if (orderItems.length > 0) {
    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) console.error("Webhook: failed to insert order_items", sessionId, itemsError);
  }

  // Webhook-time only, never at session-creation — an abandoned checkout must
  // not count against the code's usage limit.
  if (promoCode) {
    const { data: promo } = await supabase
      .from("promo_codes")
      .select("id, uses_count")
      .eq("restaurant_id", restaurantId)
      .eq("code", promoCode)
      .maybeSingle();
    if (promo) {
      await supabase.from("promo_codes").update({ uses_count: promo.uses_count + 1 }).eq("id", promo.id);
    }
  }
}
