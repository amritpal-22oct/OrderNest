import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MenuItem, RestaurantLocation } from "@/lib/types";
import { CheckoutForm } from "./CheckoutForm";

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: restaurant } = await supabase.from("restaurants").select("*").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  if (!restaurant.stripe_account_id || !restaurant.stripe_onboarding_complete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-neutral-900">Checkout is coming soon</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {restaurant.name} isn&apos;t accepting online payments yet.
          </p>
          <Link href={`/r/${slug}`} className="mt-6 inline-block text-sm font-medium text-neutral-900 underline">
            ← Back to menu
          </Link>
        </div>
      </div>
    );
  }

  const { data: items } = await supabase
    .from("menu_items")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .returns<MenuItem[]>();

  const { data: locations } = await supabase
    .from("restaurant_locations")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at")
    .returns<RestaurantLocation[]>();

  return <CheckoutForm restaurant={restaurant} items={items ?? []} locations={locations ?? []} />;
}
