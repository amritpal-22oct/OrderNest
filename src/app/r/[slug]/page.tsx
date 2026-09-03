import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MenuCategory, MenuItem, RestaurantHours } from "@/lib/types";
import { isRestaurantOpen } from "@/lib/hours";
import { RestaurantMenu } from "./RestaurantMenu";

export default async function RestaurantOrderingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: restaurant } = await supabase.from("restaurants").select("*").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  const [{ data: categories }, { data: items }, { data: hours }] = await Promise.all([
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
  ]);

  return (
    <RestaurantMenu
      restaurant={restaurant}
      categories={categories ?? []}
      items={items ?? []}
      isOpen={isRestaurantOpen(hours ?? [], restaurant.timezone)}
    />
  );
}
