import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/lib/types";

export type PricedLine = { name: string; unitAmountCents: number; quantity: number };

export type PricedCart = {
  lines: PricedLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
};

// Looks up every cart item's price from the restaurant's own menu_items table
// — client-submitted prices are never trusted. Silently drops ids that don't
// belong to this restaurant or aren't available.
export async function priceCart(
  restaurant: Restaurant,
  cart: Record<string, number>,
  fulfillmentMode: "delivery" | "pickup"
): Promise<PricedCart> {
  const supabase = await createClient();
  const ids = Object.keys(cart);

  const { data: items } = await supabase
    .from("menu_items")
    .select("id, name, price_cents")
    .eq("restaurant_id", restaurant.id)
    .eq("is_available", true)
    .in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const lines: PricedLine[] = [];
  let subtotalCents = 0;

  for (const item of items ?? []) {
    const qty = Math.max(0, Math.min(50, Math.floor(Number(cart[item.id]) || 0)));
    if (qty <= 0) continue;
    lines.push({ name: item.name, unitAmountCents: item.price_cents, quantity: qty });
    subtotalCents += item.price_cents * qty;
  }

  const isDelivery = fulfillmentMode === "delivery";
  const freeThreshold = restaurant.free_delivery_threshold_cents;
  const deliveryFeeCents =
    isDelivery && (freeThreshold === null || subtotalCents < freeThreshold) ? restaurant.delivery_fee_cents : 0;
  const taxCents = Math.round((subtotalCents + deliveryFeeCents) * Number(restaurant.tax_rate));

  return {
    lines,
    subtotalCents,
    deliveryFeeCents,
    taxCents,
    totalCents: subtotalCents + deliveryFeeCents + taxCents,
  };
}
