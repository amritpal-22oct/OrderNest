"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geocode";

// Same authorization model as menu/actions.ts: RLS (is_restaurant_admin) is the
// real boundary, hidden slug/restaurantId/locationId form fields are just plumbing.

function readAddressFields(formData: FormData) {
  return {
    name: (formData.get("name") as string)?.trim(),
    addressLine1: (formData.get("addressLine1") as string)?.trim(),
    addressLine2: (formData.get("addressLine2") as string)?.trim() || null,
    city: (formData.get("city") as string)?.trim(),
    province: (formData.get("province") as string)?.trim(),
    postalCode: (formData.get("postalCode") as string)?.trim(),
    country: (formData.get("country") as string)?.trim() || "CA",
    supportsDelivery: formData.get("supportsDelivery") === "on",
    supportsPickup: formData.get("supportsPickup") === "on",
  };
}

// Manual lat/lng (from the admin's own "Edit" details block) win when present
// and finite; otherwise the typed address is geocoded server-side via Mapbox.
async function resolveLatLng(formData: FormData, fields: ReturnType<typeof readAddressFields>) {
  const manualLat = parseFloat(formData.get("lat") as string);
  const manualLng = parseFloat(formData.get("lng") as string);
  if (Number.isFinite(manualLat) && Number.isFinite(manualLng)) {
    return { lat: manualLat, lng: manualLng };
  }

  const query = [fields.addressLine1, fields.city, fields.province, fields.postalCode, fields.country]
    .filter(Boolean)
    .join(", ");
  const geocoded = await geocodeAddress(query);
  return geocoded ? { lat: geocoded.lat, lng: geocoded.lng } : null;
}

export async function addLocationAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const fields = readAddressFields(formData);
  if (!fields.name || !fields.addressLine1 || !fields.city || !fields.province || !fields.postalCode) return;

  const latLng = await resolveLatLng(formData, fields);
  if (!latLng) return;

  const supabase = await createClient();
  await supabase.from("restaurant_locations").insert({
    restaurant_id: restaurantId,
    name: fields.name,
    address_line1: fields.addressLine1,
    address_line2: fields.addressLine2,
    city: fields.city,
    province: fields.province,
    postal_code: fields.postalCode,
    country: fields.country,
    lat: latLng.lat,
    lng: latLng.lng,
    supports_delivery: fields.supportsDelivery,
    supports_pickup: fields.supportsPickup,
  });
  revalidatePath(`/admin/${slug}/locations`);
}

export async function updateLocationAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const locationId = formData.get("locationId") as string;
  const fields = readAddressFields(formData);
  if (!fields.name || !fields.addressLine1 || !fields.city || !fields.province || !fields.postalCode) return;

  const latLng = await resolveLatLng(formData, fields);
  if (!latLng) return;

  const supabase = await createClient();
  await supabase
    .from("restaurant_locations")
    .update({
      name: fields.name,
      address_line1: fields.addressLine1,
      address_line2: fields.addressLine2,
      city: fields.city,
      province: fields.province,
      postal_code: fields.postalCode,
      country: fields.country,
      lat: latLng.lat,
      lng: latLng.lng,
      supports_delivery: fields.supportsDelivery,
      supports_pickup: fields.supportsPickup,
    })
    .eq("id", locationId);
  revalidatePath(`/admin/${slug}/locations`);
}

export async function toggleLocationActiveAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const locationId = formData.get("locationId") as string;
  const isActive = formData.get("isActive") === "true";

  const supabase = await createClient();
  await supabase.from("restaurant_locations").update({ is_active: !isActive }).eq("id", locationId);
  revalidatePath(`/admin/${slug}/locations`);
}

export async function deleteLocationAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const locationId = formData.get("locationId") as string;

  const supabase = await createClient();
  await supabase.from("restaurant_locations").delete().eq("id", locationId);
  revalidatePath(`/admin/${slug}/locations`);
}

export async function updateDeliveryRadiusAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const raw = (formData.get("deliveryRadiusKm") as string)?.trim();
  const deliveryRadiusKm = raw ? parseFloat(raw) : null;
  if (raw && (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm! < 0)) return;

  const supabase = await createClient();
  await supabase.from("restaurants").update({ delivery_radius_km: deliveryRadiusKm }).eq("id", restaurantId);
  revalidatePath(`/admin/${slug}/locations`);
}
