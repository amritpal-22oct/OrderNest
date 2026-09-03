import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MenuCategory, MenuItem, RestaurantHours, RestaurantLocation } from "@/lib/types";
import { formatTimeLabel, getTodayHours, isRestaurantOpen } from "@/lib/hours";
import { getActivePromoCodes } from "@/lib/promo";
import { RestaurantMenu } from "../RestaurantMenu";

export default async function RestaurantOrderingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: restaurant } = await supabase.from("restaurants").select("*").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  const [{ data: categories }, { data: items }, { data: hours }, { data: locations }, activePromos] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("sort_order")
      .returns<MenuCategory[]>(),
    supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("is_available", true)
      .order("sort_order")
      .returns<MenuItem[]>(),
    supabase.from("restaurant_hours").select("*").eq("restaurant_id", restaurant.id).returns<RestaurantHours[]>(),
    supabase
      .from("restaurant_locations")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at")
      .returns<RestaurantLocation[]>(),
    getActivePromoCodes(createAdminClient(), restaurant.id),
  ]);

  const open = isRestaurantOpen(hours ?? [], restaurant.timezone);
  const todayHours = getTodayHours(hours ?? [], restaurant.timezone);
  const hoursLabel =
    (hours ?? []).length === 0
      ? null
      : open && todayHours?.open_time && todayHours?.close_time
        ? `Open now · until ${formatTimeLabel(todayHours.close_time)}`
        : "Closed now";

  const activeLocations = locations ?? [];
  const locationSummary =
    activeLocations.length === 1
      ? `${activeLocations[0].address_line1}, ${activeLocations[0].city}`
      : activeLocations.length > 1
        ? `${activeLocations.length} locations`
        : null;

  return (
    <RestaurantMenu
      restaurant={restaurant}
      categories={categories ?? []}
      items={items ?? []}
      isOpen={open}
      hoursLabel={hoursLabel}
      locationSummary={locationSummary}
      activePromos={activePromos}
    />
  );
}
