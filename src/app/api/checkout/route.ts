import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { priceCart } from "@/lib/cart-pricing";
import { haversineDistanceKm } from "@/lib/geo";
import { isRestaurantOpen } from "@/lib/hours";
import { isValidScheduledTime } from "@/lib/scheduling";
import { validatePromoCode } from "@/lib/promo";
import type { Restaurant, RestaurantDeliveryAccount, RestaurantHours, RestaurantLocation } from "@/lib/types";

function randomLetters(n: number) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}

export async function POST(request: NextRequest) {
  let body: {
    slug?: string;
    cart?: Record<string, number>;
    fulfillmentMode?: "delivery" | "pickup";
    customer?: { name?: string; email?: string; phone?: string };
    delivery?: { address1?: string; city?: string; province?: string; postal?: string; instructions?: string } | null;
    pickupTime?: string | null;
    scheduledFor?: string | null;
    timeLabel?: string | null;
    promoCode?: string | null;
    locationId?: string | null;
    customerLat?: number | null;
    customerLng?: number | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { slug, cart, fulfillmentMode, customer, delivery, scheduledFor, timeLabel, promoCode, locationId, customerLat, customerLng } = body;

  if (!slug || !cart || Object.keys(cart).length === 0) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }
  if (!customer?.name || !customer?.email || !customer?.phone) {
    return NextResponse.json({ error: "Missing contact details" }, { status: 400 });
  }
  if (fulfillmentMode !== "delivery" && fulfillmentMode !== "pickup") {
    return NextResponse.json({ error: "Invalid fulfillment mode" }, { status: 400 });
  }
  if (fulfillmentMode === "delivery" && (!delivery?.address1 || !delivery?.postal)) {
    return NextResponse.json({ error: "Missing delivery address" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Restaurant>();

  if (!restaurant) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }
  if (!restaurant.stripe_account_id || !restaurant.stripe_onboarding_complete) {
    return NextResponse.json({ error: "This restaurant isn't accepting payments yet" }, { status: 400 });
  }
  // Same "never trust the client alone" pattern as every other checkout gate
  // — a page loaded before the admin paused ordering could still submit
  // after. Unlike hours-of-operation, there's no scheduling workaround here:
  // pausing blocks ASAP and scheduled orders alike.
  if (!restaurant.accepting_orders) {
    return NextResponse.json({ error: `${restaurant.name} isn't taking orders right now.` }, { status: 400 });
  }

  // Re-checked here even though the checkout page itself already blocks when
  // closed — a page loaded before closing time could still submit after.
  // Only gates ASAP orders, though: a *scheduled* order is validated below
  // against the scheduled time itself (isValidScheduledTime), not against
  // right now — the whole point of scheduling ahead is placing an order
  // while currently closed for a future slot the restaurant will be open for.
  const { data: hoursRows } = await supabase
    .from("restaurant_hours")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .returns<RestaurantHours[]>();
  if (!scheduledFor && !isRestaurantOpen(hoursRows ?? [], restaurant.timezone)) {
    return NextResponse.json({ error: `${restaurant.name} is currently closed.` }, { status: 400 });
  }

  let scheduledForDate: Date | null = null;
  if (scheduledFor) {
    scheduledForDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledForDate.getTime())) {
      return NextResponse.json({ error: "Invalid scheduled time" }, { status: 400 });
    }
    const check = isValidScheduledTime(hoursRows ?? [], restaurant.timezone, scheduledForDate);
    if (!check.ok) {
      const message =
        check.reason === "past"
          ? "That time has already passed."
          : check.reason === "too_far"
            ? "You can only schedule an order up to 7 days ahead."
            : `${restaurant.name} is closed at that time.`;
      return NextResponse.json(
        { error: message },
        { status: 400 }
      );
    }
  }

  // Multi-location gating: menu/pricing stay restaurant-wide regardless of
  // location (see priceCart below), this only decides whether the chosen
  // fulfillment mode is actually offered at the resolved location. Fewer than
  // 2 active locations mirrors the client's "skip entirely" behavior — no
  // gating, same as before this feature existed.
  const { data: locations } = await supabase
    .from("restaurant_locations")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("is_active", true)
    .returns<RestaurantLocation[]>();

  let resolvedLocation: RestaurantLocation | null = null;
  if (locations && locations.length > 1) {
    resolvedLocation = locations.find((l) => l.id === locationId) ?? null;
    if (!resolvedLocation) {
      return NextResponse.json({ error: "Invalid location" }, { status: 400 });
    }
    if (fulfillmentMode === "delivery") {
      if (!resolvedLocation.supports_delivery) {
        return NextResponse.json({ error: `${resolvedLocation.name} doesn't offer delivery.` }, { status: 400 });
      }
      // Coordinates are only needed to check a radius that's actually
      // configured — a location picked directly from the list (no real
      // customer coordinates) is still valid for delivery when the
      // restaurant has no radius restriction at all.
      if (restaurant.delivery_radius_km != null) {
        if (typeof customerLat !== "number" || typeof customerLng !== "number") {
          return NextResponse.json({ error: "Missing delivery location" }, { status: 400 });
        }
        const distanceKm = haversineDistanceKm({ lat: customerLat, lng: customerLng }, resolvedLocation);
        if (distanceKm > restaurant.delivery_radius_km) {
          return NextResponse.json(
            {
              error: `You're outside ${restaurant.name}'s ${restaurant.delivery_radius_km}km delivery radius from ${resolvedLocation.name}. Please choose pickup instead.`,
            },
            { status: 400 },
          );
        }
      }
    } else if (!resolvedLocation.supports_pickup) {
      return NextResponse.json({ error: `${resolvedLocation.name} doesn't offer pickup.` }, { status: 400 });
    }
  } else if (locations && locations.length === 1) {
    resolvedLocation = locations[0];
  }

  // Active DoorDash Drive account, if the restaurant has connected one — see
  // CLAUDE.md "DoorDash Drive". priceCart uses it to fetch a live quote for
  // this exact dropoff instead of the flat delivery_fee_cents; restaurants
  // with no account keep today's flat-fee behavior unchanged.
  let deliveryAccount: RestaurantDeliveryAccount | null = null;
  if (fulfillmentMode === "delivery") {
    const { data } = await supabase
      .from("restaurant_delivery_accounts")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("provider", "doordash")
      .eq("is_active", true)
      .maybeSingle<RestaurantDeliveryAccount>();
    deliveryAccount = data;
  }

  const priced = await priceCart(
    restaurant,
    cart,
    fulfillmentMode,
    deliveryAccount,
    fulfillmentMode === "delivery" && delivery
      ? { address1: delivery.address1 ?? "", city: delivery.city ?? "", province: delivery.province ?? "", postal: delivery.postal ?? "" }
      : null,
  );
  if (priced.unavailableNames.length > 0) {
    return NextResponse.json(
      { error: `No longer available: ${priced.unavailableNames.join(", ")}. Please remove from your cart and try again.` },
      { status: 400 },
    );
  }
  if (priced.lines.length === 0) {
    return NextResponse.json({ error: "No valid items in cart" }, { status: 400 });
  }

  // Never trusted from the client — re-validated here against the promo's
  // own rules, same "server re-derives everything" pattern as pricing/radius/hours.
  let discountCents = 0;
  let appliedPromoCode: string | null = null;
  if (promoCode) {
    const adminForPromo = createAdminClient();
    const result = await validatePromoCode(adminForPromo, restaurant.id, promoCode, priced.subtotalCents);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    discountCents = result.discountCents;
    appliedPromoCode = result.promo.code;
  }

  const discountedSubtotalCents = priced.subtotalCents - discountCents;
  const taxCents = Math.round((discountedSubtotalCents + priced.deliveryFeeCents) * Number(restaurant.tax_rate));

  const line_items = priced.lines.map((line) => ({
    quantity: line.quantity,
    price_data: {
      currency: restaurant.currency,
      unit_amount: line.unitAmountCents,
      product_data: { name: line.name },
    },
  }));

  if (priced.deliveryFeeCents > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: restaurant.currency, unit_amount: priced.deliveryFeeCents, product_data: { name: "Delivery Fee" } },
    });
  }
  if (taxCents > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: restaurant.currency, unit_amount: taxCents, product_data: { name: "Tax" } },
    });
  }

  // Session-level discount, not a negative line item (Stripe forbids negative
  // unit_amount). Always amount_off, even for percent-type promos — the
  // percent math already happened authoritatively against our own
  // subtotalCents; handing Stripe a raw percent_off would have it re-derive
  // against the full line-item sum (including Delivery/Tax), which isn't
  // what was computed.
  // Created in the connected account's own context — the coupon must live on
  // the same account as the Checkout Session that references it, since this
  // is now a direct charge (see stripeAccount below).
  let discounts: { coupon: string }[] | undefined;
  if (discountCents > 0) {
    const coupon = await stripe.coupons.create(
      {
        amount_off: discountCents,
        currency: restaurant.currency,
        duration: "once",
      },
      { stripeAccount: restaurant.stripe_account_id },
    );
    discounts = [{ coupon: coupon.id }];
  }

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  try {
    // Created directly on the restaurant's connected account (stripeAccount)
    // — a direct charge, not a destination charge. The restaurant is
    // merchant of record and funds never touch the platform's balance; no
    // application_fee_amount/transfer_data needed since OrderNest takes no
    // cut. Stripe bills its own processing fee straight to the restaurant.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // ui_mode: "elements" (Custom Checkout) — the client mounts just the
        // Payment Element inline inside CheckoutForm.tsx's own layout via
        // stripe.initCheckoutElementsSdk(), instead of "embedded_page"'s
        // distinct Stripe-branded full-width takeover. Same client_secret
        // contract either way. https://docs.stripe.com/payments/quickstart
        ui_mode: "elements",
        // Card only — Apple Pay/Google Pay surface automatically as wallets
        // within the card payment method for eligible browsers/devices, no
        // separate PMT entry needed. Klarna/Affirm/Link intentionally excluded.
        payment_method_types: ["card"],
        line_items,
        discounts,
        customer_email: customer.email,
        return_url: `${origin}/r/${slug}/success?session_id={CHECKOUT_SESSION_ID}`,
        integration_identifier: `ordernest-checkout-${randomLetters(8)}`,
        metadata: {
          restaurant_id: restaurant.id,
          fulfillment_mode: fulfillmentMode,
          customer_name: customer.name,
          customer_phone: customer.phone,
          pickup_time: timeLabel || "",
          scheduled_for: scheduledForDate?.toISOString() ?? "",
          delivery_address: fulfillmentMode === "delivery" ? JSON.stringify(delivery) : "",
          location_id: resolvedLocation?.id ?? "",
          promo_code: appliedPromoCode ?? "",
          discount_cents: String(discountCents),
          subtotal_cents: String(priced.subtotalCents),
          delivery_fee_cents: String(priced.deliveryFeeCents),
          tax_cents: String(taxCents),
        },
      },
      { stripeAccount: restaurant.stripe_account_id },
    );

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error("Stripe error creating checkout session:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 500 });
  }
}
