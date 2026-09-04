import { createClient } from "@/lib/supabase/server";
import { getDeliveryQuote, type DeliveryAccount } from "@/lib/doordash";
import type { Restaurant } from "@/lib/types";

export type PricedLine = { name: string; unitAmountCents: number; quantity: number };

export type DeliveryAddressInput = { address1: string; city: string; province: string; postal: string };

export type PricedCart = {
  lines: PricedLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  // Items that were in the cart, belong to this restaurant, but are no
  // longer available (e.g. an admin toggled them off while a customer's
  // cart sat in localStorage across visits) — never silently dropped from
  // the total; the caller must surface these and block checkout instead.
  unavailableNames: string[];
};

// Looks up every cart item's price from the restaurant's own menu_items table
// — client-submitted prices are never trusted. Ids that don't belong to this
// restaurant (or were deleted) are silently ignored, same as before — there's
// nothing meaningful to tell the customer about an id that was never a real
// item for this restaurant. Ids that ARE a real item but unavailable are
// reported back via unavailableNames instead of being dropped quietly.
export async function priceCart(
  restaurant: Restaurant,
  cart: Record<string, number>,
  fulfillmentMode: "delivery" | "pickup",
  // When present (restaurant has an active DoorDash Drive account) and the
  // order is delivery, deliveryFeeCents is a live DoorDash quote for this
  // exact dropoff instead of the flat restaurants.delivery_fee_cents — see
  // CLAUDE.md "DoorDash Drive". Any quote failure (network error, address
  // outside DoorDash's coverage) falls back to the flat fee; priceCart must
  // never throw because DoorDash was unreachable.
  deliveryAccount?: DeliveryAccount | null,
  deliveryAddress?: DeliveryAddressInput | null
): Promise<PricedCart> {
  const supabase = await createClient();
  const ids = Object.keys(cart);

  const { data: items } = await supabase
    .from("menu_items")
    .select("id, name, price_cents, is_available")
    .eq("restaurant_id", restaurant.id)
    .in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const lines: PricedLine[] = [];
  const unavailableNames: string[] = [];
  let subtotalCents = 0;

  for (const item of items ?? []) {
    const qty = Math.max(0, Math.min(50, Math.floor(Number(cart[item.id]) || 0)));
    if (qty <= 0) continue;
    if (!item.is_available) {
      unavailableNames.push(item.name);
      continue;
    }
    lines.push({ name: item.name, unitAmountCents: item.price_cents, quantity: qty });
    subtotalCents += item.price_cents * qty;
  }

  const isDelivery = fulfillmentMode === "delivery";
  const freeThreshold = restaurant.free_delivery_threshold_cents;
  const waived = freeThreshold !== null && subtotalCents >= freeThreshold;
  let deliveryFeeCents = isDelivery && !waived ? restaurant.delivery_fee_cents : 0;

  if (isDelivery && !waived && deliveryAccount && deliveryAddress) {
    try {
      const quote = await getDeliveryQuote(deliveryAccount, deliveryAddress);
      deliveryFeeCents = quote.feeCents;
    } catch (err) {
      console.error("DoorDash quote failed, falling back to flat delivery fee:", err instanceof Error ? err.message : err);
    }
  }

  const taxCents = Math.round((subtotalCents + deliveryFeeCents) * Number(restaurant.tax_rate));

  return {
    lines,
    subtotalCents,
    deliveryFeeCents,
    taxCents,
    totalCents: subtotalCents + deliveryFeeCents + taxCents,
    unavailableNames,
  };
}
