"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import type { RestaurantDeliveryAccount } from "@/lib/types";

// Same authorization model as locations/actions.ts and hours/actions.ts: RLS
// (is_restaurant_admin) is the real boundary, hidden slug/restaurantId fields
// are just plumbing. Owner-only editing is enforced here explicitly though
// (unlike locations/hours) since DoorDash credentials are a real secret, not
// just restaurant-configurable data — same bar as connectStripeAction.
export async function saveDeliveryAccountAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const { role } = await requireRestaurantAdmin(slug);
  if (role !== "owner") return;

  const developerId = (formData.get("developerId") as string)?.trim();
  const keyId = (formData.get("keyId") as string)?.trim();
  const signingSecretInput = (formData.get("signingSecret") as string)?.trim();
  const pickupBusinessName = (formData.get("pickupBusinessName") as string)?.trim();
  const pickupPhone = (formData.get("pickupPhone") as string)?.trim();
  const pickupAddressLine1 = (formData.get("pickupAddressLine1") as string)?.trim();
  const pickupAddressLine2 = (formData.get("pickupAddressLine2") as string)?.trim() || null;
  const pickupCity = (formData.get("pickupCity") as string)?.trim();
  const pickupProvince = (formData.get("pickupProvince") as string)?.trim();
  const pickupPostalCode = (formData.get("pickupPostalCode") as string)?.trim();
  const pickupCountry = (formData.get("pickupCountry") as string)?.trim() || "CA";

  if (
    !developerId ||
    !keyId ||
    !pickupBusinessName ||
    !pickupPhone ||
    !pickupAddressLine1 ||
    !pickupCity ||
    !pickupProvince ||
    !pickupPostalCode
  ) {
    return;
  }

  const supabase = await createClient();

  // "Leave blank to keep current" for the signing secret on an edit — an
  // empty input isn't a valid signing secret to write, and requiring it on
  // every save would mean the admin re-pasting a value they can't see again
  // (it's only ever shown once by DoorDash) just to update, say, the pickup
  // phone number.
  let signingSecret = signingSecretInput;
  if (!signingSecret) {
    const { data: existing } = await supabase
      .from("restaurant_delivery_accounts")
      .select("signing_secret")
      .eq("restaurant_id", restaurantId)
      .eq("provider", "doordash")
      .maybeSingle<Pick<RestaurantDeliveryAccount, "signing_secret">>();
    if (!existing) return; // no existing secret to fall back to — can't save
    signingSecret = existing.signing_secret;
  }

  await supabase.from("restaurant_delivery_accounts").upsert(
    {
      restaurant_id: restaurantId,
      provider: "doordash",
      developer_id: developerId,
      key_id: keyId,
      signing_secret: signingSecret,
      pickup_business_name: pickupBusinessName,
      pickup_phone: pickupPhone,
      pickup_address_line1: pickupAddressLine1,
      pickup_address_line2: pickupAddressLine2,
      pickup_city: pickupCity,
      pickup_province: pickupProvince,
      pickup_postal_code: pickupPostalCode,
      pickup_country: pickupCountry,
      is_active: true,
    },
    { onConflict: "restaurant_id,provider" }
  );

  revalidatePath(`/admin/${slug}/delivery`);
}

export async function deactivateDeliveryAccountAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const accountId = formData.get("accountId") as string;
  const { role } = await requireRestaurantAdmin(slug);
  if (role !== "owner") return;

  const supabase = await createClient();
  await supabase.from("restaurant_delivery_accounts").update({ is_active: false }).eq("id", accountId);
  revalidatePath(`/admin/${slug}/delivery`);
}
