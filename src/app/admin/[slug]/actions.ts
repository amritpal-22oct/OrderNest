"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAccountLinkForRestaurant } from "@/lib/stripe-connect";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import { stripe } from "@/lib/stripe";
import { createDelivery } from "@/lib/doordash";
import type { Order, OrderStatus, RestaurantDeliveryAccount } from "@/lib/types";

export async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host")}`;
}

// Sends the admin to Stripe's hosted onboarding for this restaurant's
// connected account (creating the account first if it doesn't exist yet).
// Owner-only — see openStripeDashboardAction below for why.
export async function connectStripeAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const { role } = await requireRestaurantAdmin(slug);
  if (role !== "owner") return;
  const url = await createAccountLinkForRestaurant(slug, await siteOrigin());
  redirect(url);
}

// Generates a single-use Express Dashboard login link and redirects there —
// the restaurant's own view of their balance, payouts, and (per the account's
// configured Express features) refunds/disputes. Owner-only: this is the one
// button that reaches money-moving controls (payout bank account, manual
// payouts) beyond what OrderNest's own UI exposes, so it's gated to the
// `role: "owner"` row on restaurant_admins rather than any admin login for
// the restaurant — Stripe's own OTP to the account's phone/email is a real
// second factor, but it doesn't substitute for OrderNest deciding who should
// be allowed to click the button in the first place.
export async function openStripeDashboardAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const { role, restaurant } = await requireRestaurantAdmin(slug);
  if (role !== "owner" || !restaurant.stripe_account_id) return;

  const loginLink = await stripe.accounts.createLoginLink(restaurant.stripe_account_id);
  redirect(loginLink.url);
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

// Manual, admin-triggered dispatch — not automatic inside the Stripe webhook
// (see CLAUDE.md "DoorDash Drive" for why: keeps fulfillOrder() single-
// purpose and puts a DoorDash failure in front of a human immediately, same
// bar as the refund action above).
export async function dispatchDeliveryAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const orderId = formData.get("orderId") as string;

  const supabase = await createClient();

  // RLS (is_restaurant_admin) already scopes both selects to the caller's own
  // restaurant — no separate ownership check needed before acting on them.
  const [{ data: order }, { data: restaurant }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, fulfillment_mode, delivery_address, customer_name, customer_phone, total_cents, dispatch_external_delivery_id")
      .eq("id", orderId)
      .maybeSingle<Pick<Order, "id" | "fulfillment_mode" | "delivery_address" | "customer_name" | "customer_phone" | "total_cents" | "dispatch_external_delivery_id">>(),
    supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle<{ id: string }>(),
  ]);

  if (!order) redirect(`/admin/${slug}?dispatchError=${encodeURIComponent("Order not found.")}`);
  if (order.fulfillment_mode !== "delivery" || !order.delivery_address) {
    redirect(`/admin/${slug}?dispatchError=${encodeURIComponent("This isn't a delivery order.")}`);
  }
  // Idempotency guard, same shape as the refund-status guard above — DoorDash
  // bills on every Create Delivery call, so a second dispatch for the same
  // order must never happen.
  if (order.dispatch_external_delivery_id) {
    redirect(`/admin/${slug}?dispatchError=${encodeURIComponent("This order was already dispatched.")}`);
  }

  const { data: account } = await supabase
    .from("restaurant_delivery_accounts")
    .select("*")
    .eq("restaurant_id", restaurant?.id ?? "")
    .eq("provider", "doordash")
    .eq("is_active", true)
    .maybeSingle<RestaurantDeliveryAccount>();

  if (!account) {
    redirect(`/admin/${slug}?dispatchError=${encodeURIComponent("DoorDash Drive isn't connected for this restaurant.")}`);
  }

  const address = order.delivery_address as Record<string, string>;

  try {
    const delivery = await createDelivery(
      account,
      order.id,
      { address1: address.address1 ?? "", city: address.city ?? "", province: address.province ?? "", postal: address.postal ?? "", instructions: address.instructions ?? null },
      order.customer_name,
      order.customer_phone,
      order.total_cents,
    );

    await supabase
      .from("orders")
      .update({
        dispatch_provider: "doordash",
        dispatch_external_delivery_id: delivery.externalDeliveryId,
        dispatch_status: delivery.status,
        dispatch_tracking_url: delivery.trackingUrl,
        dispatch_fee_cents: delivery.feeCents,
        dispatched_at: new Date().toISOString(),
      })
      .eq("id", orderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dispatch failed. Please try again.";
    redirect(`/admin/${slug}?dispatchError=${encodeURIComponent(message)}`);
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
