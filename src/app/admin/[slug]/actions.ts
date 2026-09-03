"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAccountLinkForRestaurant } from "@/lib/stripe-connect";
import { stripe } from "@/lib/stripe";
import type { Order, OrderStatus } from "@/lib/types";

export async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host")}`;
}

// Sends the admin to Stripe's hosted onboarding for this restaurant's
// connected account (creating the account first if it doesn't exist yet).
export async function connectStripeAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const url = await createAccountLinkForRestaurant(slug, await siteOrigin());
  redirect(url);
}

export async function signOutAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/admin/${slug}/login`);
}

// "cancelled" deliberately excluded — every order in this app is inserted
// already `paid` (fulfillOrder() in the Stripe webhook only ever creates a
// row after payment_status === "paid"), so cancelling one always means real
// money needs to come back. Routing that only through cancelAndRefundOrderAction
// below (never this plain label-swap) prevents an admin from marking a paid
// order "cancelled" via the ordinary dropdown while the customer's charge —
// and the restaurant's payout — silently stay exactly as they were.
const VALID_STATUSES: OrderStatus[] = ["pending", "paid", "preparing", "ready", "completed"];

export async function updateOrderStatusAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const orderId = formData.get("orderId") as string;
  const status = formData.get("status") as OrderStatus;

  if (!VALID_STATUSES.includes(status)) return;

  // RLS (is_restaurant_admin) enforces that only this restaurant's admins
  // can update this row — this update is a no-op for anyone else's session.
  const supabase = await createClient();
  await supabase.from("orders").update({ status }).eq("id", orderId);

  revalidatePath(`/admin/${slug}`);
}

// Full refund only (matches "cancellation" semantics — a cancelled order
// isn't partially fulfilled). Direct charge, so the refund comes straight
// out of the restaurant's own connected-account balance — no
// reverse_transfer/refund_application_fee needed (there's no transfer to
// reverse and no application fee to refund, since OrderNest never held the
// funds or took a cut).
export async function cancelAndRefundOrderAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const orderId = formData.get("orderId") as string;

  const supabase = await createClient();

  // RLS (is_restaurant_admin) already scopes this select to the caller's own
  // restaurant — no separate ownership check needed before acting on it.
  const [{ data: order }, { data: restaurant }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, total_cents, currency, stripe_payment_intent_id, refund_status")
      .eq("id", orderId)
      .maybeSingle<Pick<Order, "id" | "status" | "total_cents" | "currency" | "stripe_payment_intent_id" | "refund_status">>(),
    supabase.from("restaurants").select("stripe_account_id").eq("slug", slug).maybeSingle(),
  ]);

  if (!order) redirect(`/admin/${slug}?cancelError=${encodeURIComponent("Order not found.")}`);
  if (!restaurant?.stripe_account_id) redirect(`/admin/${slug}?cancelError=${encodeURIComponent("This restaurant isn't connected to Stripe.")}`);
  // Only "succeeded"/"pending"/"requires_action" block a retry — those mean
  // Stripe already has money in motion (or fully moved) against this same
  // payment_intent, and a second refunds.create() would error or double up.
  // "failed"/"canceled" (or never attempted) mean no money actually moved
  // yet, so the admin needs to be able to try again.
  if (order.refund_status === "succeeded" || order.refund_status === "pending" || order.refund_status === "requires_action") {
    redirect(`/admin/${slug}?cancelError=${encodeURIComponent("A refund for this order is already succeeded or in progress.")}`);
  }
  if (!order.stripe_payment_intent_id) {
    // Shouldn't happen in practice (see VALID_STATUSES comment above) — every
    // real order has one by the time it exists — but never silently mark a
    // charge "cancelled" without actually being able to refund it.
    redirect(`/admin/${slug}?cancelError=${encodeURIComponent("This order has no associated payment to refund.")}`);
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        reason: "requested_by_customer",
      },
      { stripeAccount: restaurant.stripe_account_id },
    );

    // refund.status, not an assumed "succeeded" — Stripe can return this as
    // pending (or, rarely, requires_action) rather than final; the
    // refund.updated/refund.failed webhook (src/app/api/webhooks/stripe/route.ts)
    // updates refund_status again if/when it resolves further.
    await supabase
      .from("orders")
      .update({
        status: "cancelled",
        stripe_refund_id: refund.id,
        refunded_at: new Date().toISOString(),
        refund_status: refund.status,
      })
      .eq("id", orderId);
  } catch (err) {
    // Most likely real-world failure: the connected account's Stripe balance
    // no longer has enough to cover the refund (e.g. it already paid out to
    // the restaurant's bank) — Stripe returns a hard error in that case
    // rather than a partial/pending refund, so surface it rather than
    // guessing at a friendlier message that might hide what actually happened.
    const message = err instanceof Error ? err.message : "Refund failed. Please try again.";
    redirect(`/admin/${slug}?cancelError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/admin/${slug}`);
}

export async function toggleAcceptingOrdersAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const next = formData.get("next") === "true";

  // RLS (restaurant admins update their own restaurant) scopes this to the
  // caller's own restaurant via the `slug` match below.
  const supabase = await createClient();
  await supabase.from("restaurants").update({ accepting_orders: next }).eq("slug", slug);

  revalidatePath(`/admin/${slug}`);
}
