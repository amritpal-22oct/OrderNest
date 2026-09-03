import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe, STRIPE_FEE_PERCENT, STRIPE_FEE_FIXED_CENTS } from "@/lib/stripe";
import { priceCart } from "@/lib/cart-pricing";
import { haversineDistanceKm } from "@/lib/geo";
import type { Restaurant, RestaurantLocation } from "@/lib/types";

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
    locationId?: string | null;
    customerLat?: number | null;
    customerLng?: number | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { slug, cart, fulfillmentMode, customer, delivery, pickupTime, locationId, customerLat, customerLng } = body;

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
      if (typeof customerLat !== "number" || typeof customerLng !== "number") {
        return NextResponse.json({ error: "Missing delivery location" }, { status: 400 });
      }
      if (restaurant.delivery_radius_km != null) {
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

  const priced = await priceCart(restaurant, cart, fulfillmentMode);
  if (priced.lines.length === 0) {
    return NextResponse.json({ error: "No valid items in cart" }, { status: 400 });
  }

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
  if (priced.taxCents > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: restaurant.currency, unit_amount: priced.taxCents, product_data: { name: "Tax" } },
    });
  }

  // Pass-through only, not platform revenue — see src/lib/stripe.ts. Nets to
  // ~$0 for the platform; the restaurant's payout absorbs Stripe's own fee,
  // same as if they'd connected to Stripe directly.
  const stripeFeePassThroughCents = Math.round(priced.totalCents * STRIPE_FEE_PERCENT) + STRIPE_FEE_FIXED_CENTS;
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded_page",
      line_items,
      customer_email: customer.email,
      return_url: `${origin}/r/${slug}/success?session_id={CHECKOUT_SESSION_ID}`,
      integration_identifier: `ordernest-checkout-${randomLetters(8)}`,
      payment_intent_data: {
        application_fee_amount: stripeFeePassThroughCents,
        transfer_data: { destination: restaurant.stripe_account_id },
      },
      metadata: {
        restaurant_id: restaurant.id,
        fulfillment_mode: fulfillmentMode,
        customer_name: customer.name,
        customer_phone: customer.phone,
        pickup_time: pickupTime || "",
        delivery_address: fulfillmentMode === "delivery" ? JSON.stringify(delivery) : "",
        location_id: resolvedLocation?.id ?? "",
      },
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error("Stripe error creating checkout session:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 500 });
  }
}
