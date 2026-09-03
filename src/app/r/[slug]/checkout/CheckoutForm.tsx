"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import type { MenuItem, Restaurant, RestaurantLocation } from "@/lib/types";
import { money } from "@/lib/format";
import { LocationPicker, clearStoredLocation, loadStoredLocation, type ResolvedLocation } from "./LocationPicker";

type EmbeddedCheckout = { mount: (selector: string) => void };

declare global {
  interface Window {
    Stripe?: (key: string) => {
      initEmbeddedCheckout: (opts: { clientSecret: string }) => Promise<EmbeddedCheckout>;
    };
  }
}

type Cart = Record<string, number>;

function loadCart(slug: string): Cart {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(`ordernest_cart_${slug}`) ?? "{}");
  } catch {
    return {};
  }
}

export function CheckoutForm({
  restaurant,
  items,
  locations,
}: {
  restaurant: Restaurant;
  items: MenuItem[];
  locations: RestaurantLocation[];
}) {
  const [cart, setCart] = useState<Cart>({});
  const [hydrated, setHydrated] = useState(false);
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [fulfillmentMode, setFulfillmentMode] = useState<"delivery" | "pickup">("delivery");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<EmbeddedCheckout | null>(null);

  // Fewer than 2 locations: skip the picker entirely, exactly today's behavior
  // (no radius check, both fulfillment modes always available).
  const needsPicker = locations.length > 1;
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedLocation | null>(null);

  useEffect(() => {
    if (needsPicker) setResolvedLocation(loadStoredLocation(restaurant.slug, locations));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant.slug, needsPicker]);

  const activeLocation = needsPicker
    ? (locations.find((l) => l.id === resolvedLocation?.locationId) ?? null)
    : (locations[0] ?? null);

  const deliveryAllowed = needsPicker
    ? !!activeLocation?.supports_delivery &&
      (restaurant.delivery_radius_km == null || (resolvedLocation?.distanceKm ?? Infinity) <= restaurant.delivery_radius_km)
    : true;
  const pickupAllowed = needsPicker ? !!activeLocation?.supports_pickup : true;

  useEffect(() => {
    if (fulfillmentMode === "delivery" && !deliveryAllowed && pickupAllowed) setFulfillmentMode("pickup");
    else if (fulfillmentMode === "pickup" && !pickupAllowed && deliveryAllowed) setFulfillmentMode("delivery");
  }, [deliveryAllowed, pickupAllowed, fulfillmentMode]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postal, setPostal] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pickupTime, setPickupTime] = useState("As soon as possible");

  useEffect(() => {
    setCart(loadCart(restaurant.slug));
    setHydrated(true);
  }, [restaurant.slug]);

  useEffect(() => {
    if (pendingCheckout) pendingCheckout.mount("#checkout-container");
  }, [pendingCheckout]);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const { subtotalCents, deliveryFeeCents, taxCents, totalCents, count } = useMemo(() => {
    let subtotal = 0;
    let count = 0;
    for (const [id, qty] of Object.entries(cart)) {
      const item = itemsById.get(id);
      if (item) {
        subtotal += item.price_cents * qty;
        count += qty;
      }
    }
    const freeThreshold = restaurant.free_delivery_threshold_cents;
    const deliveryFee =
      fulfillmentMode === "delivery" && (freeThreshold === null || subtotal < freeThreshold)
        ? restaurant.delivery_fee_cents
        : 0;
    const tax = Math.round((subtotal + deliveryFee) * Number(restaurant.tax_rate));
    return { subtotalCents: subtotal, deliveryFeeCents: deliveryFee, taxCents: tax, totalCents: subtotal + deliveryFee + tax, count };
  }, [cart, itemsById, fulfillmentMode, restaurant]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Please enter a valid phone number.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Please enter a valid email.");
    if (fulfillmentMode === "delivery") {
      if (address1.trim().length < 4) return setError("Please enter your delivery address.");
      if (postal.trim().length < 4) return setError("Please enter a valid postal code.");
    }
    if (!stripeLoaded || !window.Stripe) return setError("Payment is still loading — try again in a moment.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: restaurant.slug,
          cart,
          fulfillmentMode,
          customer: { name: name.trim(), phone: phone.trim(), email: email.trim() },
          delivery:
            fulfillmentMode === "delivery"
              ? { address1: address1.trim(), city: city.trim(), province: province.trim(), postal: postal.trim().toUpperCase(), instructions: instructions.trim() }
              : null,
          pickupTime: fulfillmentMode === "pickup" ? pickupTime : null,
          locationId: activeLocation?.id ?? null,
          customerLat: needsPicker ? (resolvedLocation?.lat ?? null) : null,
          customerLng: needsPicker ? (resolvedLocation?.lng ?? null) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to start checkout");

      const stripe = window.Stripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
      const embeddedCheckout = await stripe.initEmbeddedCheckout({ clientSecret: data.clientSecret });
      // Store the instance; the effect below mounts it once React has actually
      // committed the #checkout-container div (a raw setTimeout(0) isn't a
      // strong enough guarantee — DOM commit can still lag behind it).
      setPendingCheckout(embeddedCheckout);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!hydrated) return null;

  if (count === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-neutral-900">Your cart is empty</h1>
          <Link href={`/r/${restaurant.slug}/order`} className="mt-4 inline-block text-sm font-medium text-neutral-900 underline">
            ← Back to menu
          </Link>
        </div>
      </div>
    );
  }

  if (needsPicker && !resolvedLocation) {
    return (
      <div className="min-h-screen bg-neutral-50 pb-20">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-2xl px-6 py-5">
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Checkout</p>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-6 py-8">
          <LocationPicker slug={restaurant.slug} locations={locations} onResolved={setResolvedLocation} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <Script src="https://js.stripe.com/v3/" onLoad={() => setStripeLoaded(true)} />

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-5">
          <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
          <p className="text-sm text-neutral-500">Checkout</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {!pendingCheckout ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="font-medium text-neutral-900">Delivery or pickup</h2>

              {needsPicker && activeLocation && (
                <div className="mt-2 flex items-center justify-between text-sm text-neutral-500">
                  <span>Nearest location: {activeLocation.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearStoredLocation(restaurant.slug);
                      setResolvedLocation(null);
                    }}
                    className="text-neutral-500 underline hover:text-neutral-900"
                  >
                    Change location
                  </button>
                </div>
              )}

              <div className="mt-3 flex overflow-hidden rounded-full border border-neutral-200">
                {(["delivery", "pickup"] as const).map((mode) => {
                  const allowed = mode === "delivery" ? deliveryAllowed : pickupAllowed;
                  return (
                    <button
                      type="button"
                      key={mode}
                      disabled={!allowed}
                      onClick={() => setFulfillmentMode(mode)}
                      className={`flex-1 py-2 text-sm font-medium capitalize disabled:cursor-not-allowed disabled:opacity-40 ${
                        fulfillmentMode === mode ? "bg-neutral-900 text-white" : "text-neutral-600"
                      }`}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>

              {needsPicker && !deliveryAllowed && activeLocation && (
                <p className="mt-2 text-sm text-amber-700">
                  {!activeLocation.supports_delivery
                    ? `${activeLocation.name} doesn't offer delivery — pickup only.`
                    : resolvedLocation?.distanceKm != null
                      ? `You're ${resolvedLocation.distanceKm.toFixed(1)} km from ${activeLocation.name} — outside our ${restaurant.delivery_radius_km}km delivery area, but pickup is available there.`
                      : `Share your location above to check delivery availability at ${activeLocation.name}, or choose pickup.`}
                </p>
              )}

              {fulfillmentMode === "delivery" ? (
                <div className="mt-4 space-y-3">
                  <input placeholder="Street address" value={address1} onChange={(e) => setAddress1(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                  <div className="grid grid-cols-3 gap-3">
                    <input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                    <input placeholder="Province" value={province} onChange={(e) => setProvince(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                    <input placeholder="Postal code" value={postal} onChange={(e) => setPostal(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                  </div>
                  <textarea placeholder="Delivery instructions (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                </div>
              ) : (
                <div className="mt-4">
                  <label className="block text-sm text-neutral-600">Pickup time</label>
                  <select value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
                    <option>As soon as possible</option>
                    <option>Today, 5:00 PM – 5:30 PM</option>
                    <option>Today, 6:00 PM – 6:30 PM</option>
                    <option>Tomorrow, 11:00 AM – 11:30 AM</option>
                  </select>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="font-medium text-neutral-900">Contact details</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                <input placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
              </div>
              <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="font-medium text-neutral-900">Order summary</h2>
              <div className="mt-3 space-y-1 text-sm">
                {Object.entries(cart).map(([id, qty]) => {
                  const item = itemsById.get(id);
                  if (!item) return null;
                  return (
                    <div key={id} className="flex justify-between text-neutral-600">
                      <span>{qty} × {item.name}</span>
                      <span>{money(item.price_cents * qty, restaurant.currency)}</span>
                    </div>
                  );
                })}
                <div className="mt-2 border-t border-neutral-100 pt-2 flex justify-between text-neutral-600">
                  <span>Subtotal</span>
                  <span>{money(subtotalCents, restaurant.currency)}</span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>Delivery</span>
                  <span>{deliveryFeeCents === 0 ? "FREE" : money(deliveryFeeCents, restaurant.currency)}</span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>Tax</span>
                  <span>{money(taxCents, restaurant.currency)}</span>
                </div>
                <div className="flex justify-between pt-1 text-base font-semibold text-neutral-900">
                  <span>Total</span>
                  <span>{money(totalCents, restaurant.currency)}</span>
                </div>
              </div>
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full py-3 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: restaurant.brand_color }}
            >
              {submitting ? "Preparing secure payment…" : `Pay ${money(totalCents, restaurant.currency)}`}
            </button>
          </form>
        ) : (
          <div id="checkout-container" />
        )}
      </main>
    </div>
  );
}
