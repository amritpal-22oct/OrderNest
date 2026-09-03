"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import type { MenuItem, Restaurant, RestaurantHours, RestaurantLocation } from "@/lib/types";
import { money } from "@/lib/format";
import { DAYS_AHEAD, getSchedulingAvailability } from "@/lib/scheduling";
import { isRestaurantOpen } from "@/lib/hours";
import { LocationPicker, clearStoredLocation, loadStoredLocation, type ResolvedLocation } from "./LocationPicker";

// Custom Checkout (ui_mode: "elements") — the Payment Element mounts inline
// within our own page/layout, unlike initEmbeddedCheckout's ui_mode:
// "embedded_page", which renders as a distinct Stripe-branded full-width
// card. https://docs.stripe.com/payments/quickstart
//
// initCheckout is synchronous as of the "Clover" Stripe.js release (loaded
// below via the versioned script URL, not the generic v3 build, which
// doesn't have this method at all) — confirmed against Stripe's own
// changelog rather than assumed, since this API has changed shape across
// releases (was async initCheckoutElementsSdk pre-Clover).
type StripeElement = { mount: (selector: string) => void; unmount: () => void };
type CheckoutConfirmResult = { error?: { message?: string } } | undefined;
type LoadActionsResult = { type: "success"; actions: { confirm: () => Promise<CheckoutConfirmResult> } } | { type: "error"; error?: { message?: string } };
type StripeCheckout = {
  createPaymentElement: () => StripeElement;
  loadActions: () => Promise<LoadActionsResult>;
};

declare global {
  interface Window {
    Stripe?: (key: string, opts?: { stripeAccount: string }) => {
      initCheckout: (opts: { clientSecret: string }) => StripeCheckout;
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
  hours,
}: {
  restaurant: Restaurant;
  items: MenuItem[];
  locations: RestaurantLocation[];
  hours: RestaurantHours[];
}) {
  const [cart, setCart] = useState<Cart>({});
  const [hydrated, setHydrated] = useState(false);
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [fulfillmentMode, setFulfillmentMode] = useState<"delivery" | "pickup">("delivery");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the Checkout Session exists and the Payment Element is mounted
  // — the rest of the form (order summary, contact details, etc.) stays
  // visible and disabled rather than being replaced, so payment reads as a
  // continuation of the same page instead of a separate step.
  const [checkout, setCheckout] = useState<StripeCheckout | null>(null);
  const [confirming, setConfirming] = useState(false);

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

  // TEMP dev convenience (requested this session): prefilled with static
  // test data so manual checkout runs don't need retyping every time.
  // Revert to empty strings before this goes anywhere near real customers.
  const [name, setName] = useState("Test Customer");
  const [phone, setPhone] = useState("9055551234");
  const [email, setEmail] = useState("test.customer@example.com");
  const [address1, setAddress1] = useState("123 Test Street");
  const [city, setCity] = useState("Brampton");
  const [province, setProvince] = useState("ON");
  const [postal, setPostal] = useState("L6T 0A1");
  const [instructions, setInstructions] = useState("");

  const availability = useMemo(() => getSchedulingAvailability(hours, restaurant.timezone), [hours, restaurant.timezone]);
  // Computed once at mount, not live-updated while the page sits open — same
  // tradeoff as the rest of this form's client-side checks; /api/checkout
  // re-validates against the actual submit time regardless.
  const openNow = useMemo(() => isRestaurantOpen(hours, restaurant.timezone), [hours, restaurant.timezone]);
  const [scheduleMode, setScheduleMode] = useState<"asap" | "schedule">(openNow ? "asap" : "schedule");
  const [selectedDate, setSelectedDate] = useState(availability.mode === "slots" ? (availability.days[0]?.date ?? "") : "");
  const [selectedSlotValue, setSelectedSlotValue] = useState(
    availability.mode === "slots" ? (availability.days[0]?.slots[0]?.value ?? "") : ""
  );
  // Split date/time (native <input type="date"/"time">) instead of a single
  // datetime-local field — datetime-local's combined browser widget renders
  // with an unstyled, oddly-truncated placeholder ("yyyy-mm-dd, --:-- --")
  // that reads as broken next to the rest of this form's custom controls.
  const [scheduleDateStr, setScheduleDateStr] = useState("");
  const [scheduleTimeStr, setScheduleTimeStr] = useState("");
  const datetimeLocal = scheduleDateStr && scheduleTimeStr ? `${scheduleDateStr}T${scheduleTimeStr}` : "";
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const maxDateStr = new Date(Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const selectedDay = availability.mode === "slots" ? availability.days.find((d) => d.date === selectedDate) : undefined;

  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountCents: number } | null>(null);
  const [promoStatus, setPromoStatus] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [removedItemNames, setRemovedItemNames] = useState<string[]>([]);

  // A cart persisted in localStorage can outlive the menu — an item an admin
  // marked unavailable stays in a returning customer's cart otherwise, and
  // would get silently dropped from the total right at payment time
  // (priceCart does the same server-side, but the customer should find out
  // here, not get a smaller total as a surprise). Strip + tell them upfront.
  useEffect(() => {
    const loaded = loadCart(restaurant.slug);
    const removedNames: string[] = [];
    const stripped: Cart = {};
    for (const [id, qty] of Object.entries(loaded)) {
      const item = itemsById.get(id);
      if (item && !item.is_available) {
        removedNames.push(item.name);
        continue;
      }
      stripped[id] = qty;
    }
    setCart(stripped);
    if (removedNames.length > 0) {
      setRemovedItemNames(removedNames);
      window.localStorage.setItem(`ordernest_cart_${restaurant.slug}`, JSON.stringify(stripped));
    }
    setHydrated(true);
  }, [restaurant.slug, itemsById]);

  useEffect(() => {
    if (checkout) checkout.createPaymentElement().mount("#payment-element");
  }, [checkout]);

  const { subtotalCents, deliveryFeeCents, discountCents, taxCents, totalCents, count } = useMemo(() => {
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
    // Mirrors the server's post-discount formula exactly (never authoritative
    // — /api/checkout recomputes this independently) so the preview matches
    // what Stripe's mounted embedded Checkout will actually charge.
    const discount = appliedPromo ? Math.min(appliedPromo.discountCents, subtotal) : 0;
    const discountedSubtotal = subtotal - discount;
    const tax = Math.round((discountedSubtotal + deliveryFee) * Number(restaurant.tax_rate));
    return {
      subtotalCents: subtotal,
      deliveryFeeCents: deliveryFee,
      discountCents: discount,
      taxCents: tax,
      totalCents: discountedSubtotal + deliveryFee + tax,
      count,
    };
  }, [cart, itemsById, fulfillmentMode, restaurant, appliedPromo]);

  async function applyPromoCode() {
    const code = promoCodeInput.trim();
    if (!code) return;
    setPromoStatus({ loading: true, error: null });
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: restaurant.slug, code, subtotalCents }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAppliedPromo(null);
        setPromoStatus({ loading: false, error: data.error || "Invalid promo code" });
        return;
      }
      setAppliedPromo({ code: code.toUpperCase(), discountCents: data.discountCents });
      setPromoStatus({ loading: false, error: null });
    } catch {
      setAppliedPromo(null);
      setPromoStatus({ loading: false, error: "Unable to apply code right now" });
    }
  }

  // Resolves the ASAP/schedule UI state into what /api/checkout expects:
  // scheduledFor (ISO instant or null) and timeLabel (human string, also
  // stored on the order as pickup_time for both fulfillment modes now).
  function resolveScheduling(): { scheduledFor: string | null; timeLabel: string } {
    if (scheduleMode === "asap") return { scheduledFor: null, timeLabel: "As soon as possible" };
    if (availability.mode === "unrestricted") {
      if (!datetimeLocal) return { scheduledFor: null, timeLabel: "As soon as possible" };
      const date = new Date(datetimeLocal);
      return { scheduledFor: date.toISOString(), timeLabel: date.toLocaleString() };
    }
    const slot = selectedDay?.slots.find((s) => s.value === selectedSlotValue);
    if (!selectedDay || !slot) return { scheduledFor: null, timeLabel: "As soon as possible" };
    return { scheduledFor: slot.value, timeLabel: `${selectedDay.label}, ${slot.label}` };
  }

  async function handleContinueToPayment(e: React.FormEvent) {
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
    if (scheduleMode === "schedule" && availability.mode === "unrestricted" && !datetimeLocal) {
      return setError("Please choose a time.");
    }
    if (scheduleMode === "schedule" && availability.mode === "slots" && !selectedDay?.slots.some((s) => s.value === selectedSlotValue)) {
      return setError("Please choose a time.");
    }

    const { scheduledFor, timeLabel } = resolveScheduling();

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
          scheduledFor,
          timeLabel,
          promoCode: appliedPromo?.code ?? null,
          locationId: activeLocation?.id ?? null,
          customerLat: needsPicker ? (resolvedLocation?.lat ?? null) : null,
          customerLng: needsPicker ? (resolvedLocation?.lng ?? null) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to start checkout");

      // Direct charge — the session lives on the restaurant's connected
      // account, not the platform, so Stripe.js needs that account context
      // too, or it 404s ("No such checkout.session") trying to look the
      // session up in the platform's own account.
      const stripe = window.Stripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!, {
        stripeAccount: restaurant.stripe_account_id!,
      });
      const checkoutInstance = stripe.initCheckout({ clientSecret: data.clientSecret });
      // Store the instance; the effect below mounts the Payment Element once
      // React has actually committed the #payment-element div (a raw
      // setTimeout(0) isn't a strong enough guarantee — DOM commit can still
      // lag behind it).
      setCheckout(checkoutInstance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmPayment() {
    if (!checkout) return;
    setError(null);
    setConfirming(true);
    try {
      const loadActionsResult = await checkout.loadActions();
      if (loadActionsResult.type === "error") {
        setError(loadActionsResult.error?.message || "Payment failed. Please try again.");
        setConfirming(false);
        return;
      }
      const result = await loadActionsResult.actions.confirm();
      if (result?.error) {
        setError(result.error.message || "Payment failed. Please try again.");
        setConfirming(false);
      }
      // On success Stripe redirects to return_url itself — nothing further to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed. Please try again.");
      setConfirming(false);
    }
  }

  if (!hydrated) return null;

  if (count === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-neutral-900">Your cart is empty</h1>
          {removedItemNames.length > 0 && (
            <p className="mt-2 text-sm text-amber-700">
              {removedItemNames.join(", ")} {removedItemNames.length === 1 ? "is" : "are"} no longer available and{" "}
              {removedItemNames.length === 1 ? "was" : "were"} removed from your cart.
            </p>
          )}
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
      {/* Versioned build required for initCheckout (Custom Checkout) — the
          generic v3 evergreen build doesn't have this method at all.
          onReady, not onLoad: if this component unmounts and remounts (e.g.
          the customer hits the browser back button, then forward again),
          next/script's loadScript() sees the src already in its module-level
          LoadCache and bails out before ever calling onLoad again — onReady
          is the prop Next.js specifically built to still fire in that
          remount case (see node_modules/next/dist/client/script.js). With
          onLoad, stripeLoaded would stay false forever on remount and the
          button would be permanently stuck on "Loading payment…". */}
      <Script src="https://js.stripe.com/clover/stripe.js" onReady={() => setStripeLoaded(true)} />

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-2xl px-6 py-5">
          <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
          <p className="text-sm text-neutral-500">Checkout</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {/* gap-based, not space-y-6: the fieldset's own reset (border-0 p-0
            m-0) zeroes the margin space-y relies on, collapsing the gap
            before the submit button/payment card to 0. Flex gap doesn't
            depend on children's margins, so it isn't affected. */}
        <form onSubmit={handleContinueToPayment} className="flex flex-col gap-6">
          {/* Disabled (not hidden) once the payment step starts — the order
              details stay visible and readable, but locked, so payment reads
              as a continuation of this same page rather than a separate one. */}
          <fieldset disabled={!!checkout} className="space-y-6 border-0 p-0 m-0 min-w-0 disabled:opacity-60">
            {removedItemNames.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {removedItemNames.join(", ")} {removedItemNames.length === 1 ? "is" : "are"} no longer available and{" "}
                {removedItemNames.length === 1 ? "was" : "were"} removed from your order.
              </p>
            )}
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

              {fulfillmentMode === "delivery" && (
                <div className="mt-4 space-y-3">
                  <input placeholder="Street address" value={address1} onChange={(e) => setAddress1(e.target.value)} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                  <div className="grid grid-cols-3 gap-3">
                    <input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                    <input placeholder="Province" value={province} onChange={(e) => setProvince(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                    <input placeholder="Postal code" value={postal} onChange={(e) => setPostal(e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                  </div>
                  <textarea placeholder="Delivery instructions (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                </div>
              )}

              <div className="mt-4">
                <label className="block text-sm text-neutral-600">When</label>
                {!openNow && (
                  <p className="mt-1 text-xs text-amber-700">
                    {restaurant.name} is closed right now — you can still schedule an order for when we&apos;re open.
                  </p>
                )}
                <div className="mt-1 flex overflow-hidden rounded-full border border-neutral-200">
                  {(["asap", "schedule"] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      disabled={mode === "asap" && !openNow}
                      onClick={() => setScheduleMode(mode)}
                      className={`flex-1 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                        scheduleMode === mode ? "bg-neutral-900 text-white" : "text-neutral-600"
                      }`}
                    >
                      {mode === "asap" ? "As soon as possible" : "Schedule for later"}
                    </button>
                  ))}
                </div>

                {scheduleMode === "schedule" &&
                  (availability.mode === "unrestricted" ? (
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-neutral-500">Date</label>
                        <input
                          type="date"
                          min={todayDateStr}
                          max={maxDateStr}
                          value={scheduleDateStr}
                          onChange={(e) => setScheduleDateStr(e.target.value)}
                          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-neutral-500">Time</label>
                        <input
                          type="time"
                          value={scheduleTimeStr}
                          onChange={(e) => setScheduleTimeStr(e.target.value)}
                          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-3">
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {availability.days.map((day) => (
                          <button
                            type="button"
                            key={day.date}
                            onClick={() => {
                              setSelectedDate(day.date);
                              setSelectedSlotValue(day.slots[0]?.value ?? "");
                            }}
                            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                              selectedDate === day.date
                                ? "border-neutral-900 bg-neutral-900 text-white"
                                : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                            }`}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                      {selectedDay && selectedDay.slots.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedDay.slots.map((slot) => (
                            <button
                              type="button"
                              key={slot.value}
                              onClick={() => setSelectedSlotValue(slot.value)}
                              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                                selectedSlotValue === slot.value
                                  ? "border-neutral-900 bg-neutral-900 text-white"
                                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                              }`}
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
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
                {appliedPromo && (
                  <div className="flex justify-between text-green-700">
                    <span>Promo {appliedPromo.code}</span>
                    <span>−{money(discountCents, restaurant.currency)}</span>
                  </div>
                )}
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

              <div className="mt-3 border-t border-neutral-100 pt-3">
                {appliedPromo ? (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-700">Code {appliedPromo.code} applied</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedPromo(null);
                        setPromoCodeInput("");
                        setPromoStatus({ loading: false, error: null });
                      }}
                      className="text-neutral-500 underline hover:text-neutral-900"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      placeholder="Promo code"
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value)}
                      className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm uppercase"
                    />
                    <button
                      type="button"
                      onClick={applyPromoCode}
                      disabled={promoStatus.loading || !promoCodeInput.trim()}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
                    >
                      {promoStatus.loading ? "Applying…" : "Apply"}
                    </button>
                  </div>
                )}
                {promoStatus.error && <p className="mt-1 text-xs text-red-600">{promoStatus.error}</p>}
              </div>
            </div>
          </fieldset>

          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {!checkout ? (
            <button
              type="submit"
              disabled={submitting || !stripeLoaded}
              className="w-full rounded-full py-3 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: restaurant.brand_color }}
            >
              {submitting ? "Preparing secure payment…" : !stripeLoaded ? "Loading payment…" : "Continue to payment"}
            </button>
          ) : (
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h2 className="font-medium text-neutral-900">Payment</h2>
              <div id="payment-element" className="mt-3" />
              <button
                type="button"
                onClick={handleConfirmPayment}
                disabled={confirming}
                className="mt-4 w-full rounded-full py-3 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: restaurant.brand_color }}
              >
                {confirming ? "Processing…" : `Pay ${money(totalCents, restaurant.currency)}`}
              </button>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
