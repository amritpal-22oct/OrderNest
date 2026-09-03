"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// RLS (is_restaurant_admin) is the real authorization boundary — session-scoped
// client, no service-role bypass, same pattern as hours/actions.ts and
// menu/actions.ts. Codes are normalized to uppercase at the app layer.

export async function addPromoAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const code = (formData.get("code") as string)?.trim().toUpperCase();
  const discountType = formData.get("discountType") as string;
  const discountValueRaw = formData.get("discountValue") as string;
  const maxUsesRaw = (formData.get("maxUses") as string)?.trim();
  const expiresAtRaw = (formData.get("expiresAt") as string)?.trim();
  const minSubtotalDollars = (formData.get("minSubtotal") as string)?.trim();

  const discountValue =
    discountType === "percent" ? parseInt(discountValueRaw, 10) : Math.round(parseFloat(discountValueRaw) * 100);

  if (!code || (discountType !== "percent" && discountType !== "fixed") || !Number.isFinite(discountValue) || discountValue <= 0) {
    return;
  }

  const supabase = await createClient();
  await supabase.from("promo_codes").insert({
    restaurant_id: restaurantId,
    code,
    discount_type: discountType,
    discount_value: discountValue,
    max_uses: maxUsesRaw ? parseInt(maxUsesRaw, 10) : null,
    expires_at: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null,
    min_subtotal_cents: minSubtotalDollars ? Math.round(parseFloat(minSubtotalDollars) * 100) : 0,
  });
  revalidatePath(`/admin/${slug}/promo`);
}

export async function togglePromoActiveAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const promoId = formData.get("promoId") as string;
  const isActive = formData.get("isActive") === "true";

  const supabase = await createClient();
  await supabase.from("promo_codes").update({ is_active: !isActive }).eq("id", promoId);
  revalidatePath(`/admin/${slug}/promo`);
}

export async function deletePromoAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const promoId = formData.get("promoId") as string;

  const supabase = await createClient();
  await supabase.from("promo_codes").delete().eq("id", promoId);
  revalidatePath(`/admin/${slug}/promo`);
}
