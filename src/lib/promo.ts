import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromoCode } from "./types";

export type PromoValidationResult =
  | { ok: true; discountCents: number; promo: PromoCode }
  | { ok: false; error: string };

// Takes the admin (service-role) client — promo_codes has no public select
// policy on purpose (the one table in this app that must not be scrapeable),
// same sanctioned service-role bypass /api/onboard already uses.
export async function validatePromoCode(
  supabase: SupabaseClient,
  restaurantId: string,
  rawCode: string,
  subtotalCents: number
): Promise<PromoValidationResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a promo code" };

  const { data: promo } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("code", code)
    .maybeSingle<PromoCode>();

  if (!promo || !promo.is_active) return { ok: false, error: "Invalid promo code" };
  if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This promo code has expired" };
  }
  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
    return { ok: false, error: "This promo code has reached its usage limit" };
  }
  if (subtotalCents < promo.min_subtotal_cents) {
    return { ok: false, error: `This code requires a minimum order of ${(promo.min_subtotal_cents / 100).toFixed(2)}` };
  }

  const rawDiscount = promo.discount_type === "percent" ? Math.round((subtotalCents * promo.discount_value) / 100) : promo.discount_value;
  const discountCents = Math.min(rawDiscount, subtotalCents);

  return { ok: true, discountCents, promo };
}

export type ActivePromoSummary = {
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  min_subtotal_cents: number;
};

// For advertising promos to customers (e.g. a banner on the ordering page) —
// deliberately returns only what's safe/useful to show (code + discount
// shape), never uses_count or id. Same admin-client bypass as
// validatePromoCode, for the same reason (no public select policy).
// Excludes anything expired or already at its usage limit — no point
// advertising a code a customer can't actually apply.
export async function getActivePromoCodes(supabase: SupabaseClient, restaurantId: string): Promise<ActivePromoSummary[]> {
  const { data } = await supabase
    .from("promo_codes")
    .select("code, discount_type, discount_value, min_subtotal_cents, expires_at, max_uses, uses_count")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const now = Date.now();
  return (data ?? [])
    .filter((p) => (!p.expires_at || new Date(p.expires_at).getTime() > now) && (p.max_uses == null || p.uses_count < p.max_uses))
    .map(({ code, discount_type, discount_value, min_subtotal_cents }) => ({ code, discount_type, discount_value, min_subtotal_cents }));
}
