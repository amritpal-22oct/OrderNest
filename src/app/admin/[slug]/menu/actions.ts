"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Every mutation below relies on RLS (is_restaurant_admin) as the real
// authorization boundary — restaurant_id/category_id/item_id come from
// hidden form fields, but a tampered id just gets rejected by the database,
// not trusted blindly. Uses the session-scoped client, not the service-role
// one: restaurant admins already have full CRUD on their own menu per
// existing policies (see supabase/schema.sql), no bypass needed here.

function parseTags(raw: FormDataEntryValue | null) {
  return String(raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function addCategoryAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const title = (formData.get("title") as string)?.trim();
  const icon = (formData.get("icon") as string)?.trim() || null;
  if (!title) return;

  const supabase = await createClient();
  await supabase.from("menu_categories").insert({ restaurant_id: restaurantId, title, icon });
  revalidatePath(`/admin/${slug}/menu`);
}

export async function deleteCategoryAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const categoryId = formData.get("categoryId") as string;

  const supabase = await createClient();
  await supabase.from("menu_categories").delete().eq("id", categoryId);
  revalidatePath(`/admin/${slug}/menu`);
}

export async function addItemAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const categoryId = (formData.get("categoryId") as string) || null;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const priceDollars = parseFloat(formData.get("price") as string);
  const emoji = (formData.get("emoji") as string)?.trim() || null;
  const unit = (formData.get("unit") as string)?.trim() || null;
  const tags = parseTags(formData.get("tags"));

  if (!name || !Number.isFinite(priceDollars) || priceDollars < 0) return;

  const supabase = await createClient();
  await supabase.from("menu_items").insert({
    restaurant_id: restaurantId,
    category_id: categoryId,
    name,
    description,
    price_cents: Math.round(priceDollars * 100),
    emoji,
    unit,
    tags,
  });
  revalidatePath(`/admin/${slug}/menu`);
}

export async function updateItemAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const itemId = formData.get("itemId") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const priceDollars = parseFloat(formData.get("price") as string);
  const emoji = (formData.get("emoji") as string)?.trim() || null;
  const unit = (formData.get("unit") as string)?.trim() || null;
  const tags = parseTags(formData.get("tags"));
  const categoryId = (formData.get("categoryId") as string) || null;

  if (!name || !Number.isFinite(priceDollars) || priceDollars < 0) return;

  const supabase = await createClient();
  await supabase
    .from("menu_items")
    .update({
      name,
      description,
      price_cents: Math.round(priceDollars * 100),
      emoji,
      unit,
      tags,
      category_id: categoryId,
    })
    .eq("id", itemId);
  revalidatePath(`/admin/${slug}/menu`);
}

export async function toggleItemAvailabilityAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const itemId = formData.get("itemId") as string;
  const isAvailable = formData.get("isAvailable") === "true";

  const supabase = await createClient();
  await supabase.from("menu_items").update({ is_available: !isAvailable }).eq("id", itemId);
  revalidatePath(`/admin/${slug}/menu`);
}

export async function deleteItemAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const itemId = formData.get("itemId") as string;

  const supabase = await createClient();
  await supabase.from("menu_items").delete().eq("id", itemId);
  revalidatePath(`/admin/${slug}/menu`);
}
