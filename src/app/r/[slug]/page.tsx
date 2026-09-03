import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RestaurantHours, RestaurantLocation } from "@/lib/types";
import { formatTimeLabel, getTodayHours, isRestaurantOpen } from "@/lib/hours";

export default async function RestaurantLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: restaurant } = await supabase.from("restaurants").select("*").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  const [{ data: hours }, { data: locations }] = await Promise.all([
    supabase.from("restaurant_hours").select("*").eq("restaurant_id", restaurant.id).returns<RestaurantHours[]>(),
    supabase
      .from("restaurant_locations")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at")
      .returns<RestaurantLocation[]>(),
  ]);

  const hoursConfigured = (hours ?? []).length > 0;
  const open = isRestaurantOpen(hours ?? [], restaurant.timezone);
  const todayHours = getTodayHours(hours ?? [], restaurant.timezone);
  const activeLocations = locations ?? [];
  const supportsDelivery = activeLocations.length === 0 || activeLocations.some((l) => l.supports_delivery);
  const supportsPickup = activeLocations.length === 0 || activeLocations.some((l) => l.supports_pickup);

  return (
    <div className="min-h-screen bg-white">
      <section
        className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-24 text-center text-white"
        style={{ background: `linear-gradient(135deg, ${restaurant.brand_color}, #1a1a1a)` }}
      >
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{restaurant.name}</h1>
        {restaurant.description && (
          <p className="mt-4 max-w-xl text-lg text-white/80">{restaurant.description}</p>
        )}
        <Link
          href={`/r/${slug}/order`}
          className="mt-8 rounded-full bg-white px-8 py-3 text-sm font-semibold text-neutral-900 shadow-lg transition hover:scale-105"
        >
          Order Now →
        </Link>
        {hoursConfigured && (
          <p className="mt-6 text-sm text-white/70">
            {open ? "Open now" : "Closed now"}
            {todayHours && !todayHours.is_closed && todayHours.open_time && todayHours.close_time && (
              <> · Today {formatTimeLabel(todayHours.open_time)}–{formatTimeLabel(todayHours.close_time)}</>
            )}
          </p>
        )}
      </section>

      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-8 px-6 py-16 sm:grid-cols-3">
        <FeatureCard
          emoji="🛍️"
          title="Order online"
          body={
            supportsDelivery && supportsPickup
              ? "Pickup or delivery, with secure checkout."
              : supportsDelivery
                ? "Delivery, with secure checkout."
                : "Pickup, with secure checkout."
          }
        />
        {activeLocations.length > 1 ? (
          <FeatureCard
            emoji="📍"
            title={`${activeLocations.length} locations`}
            body="We'll find the one nearest you when you check out."
          />
        ) : activeLocations.length === 1 ? (
          <FeatureCard
            emoji="📍"
            title={activeLocations[0].name}
            body={`${activeLocations[0].address_line1}, ${activeLocations[0].city}`}
          />
        ) : (
          <FeatureCard emoji="⚡" title="Fast & fresh" body="Made to order, every time." />
        )}
        {hoursConfigured ? (
          <FeatureCard
            emoji="🕒"
            title={open ? "Open now" : "Currently closed"}
            body={
              todayHours && !todayHours.is_closed && todayHours.open_time && todayHours.close_time
                ? `Today ${formatTimeLabel(todayHours.open_time)}–${formatTimeLabel(todayHours.close_time)}`
                : "Closed today"
            }
          />
        ) : (
          <FeatureCard emoji="💳" title="Secure checkout" body="Payments handled securely by Stripe." />
        )}
      </section>

      <section className="border-t border-neutral-100 bg-neutral-50 px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold text-neutral-900">Hungry? Let&apos;s get you fed.</h2>
        <Link
          href={`/r/${slug}/order`}
          className="mt-6 inline-block rounded-full px-8 py-3 text-sm font-semibold text-white shadow-md"
          style={{ backgroundColor: restaurant.brand_color }}
        >
          View menu & order →
        </Link>
      </section>

      <footer className="px-6 py-8 text-center text-xs text-neutral-400">
        {restaurant.name} · Powered by OrderNest
      </footer>
    </div>
  );
}

function FeatureCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-2xl">{emoji}</div>
      <h3 className="mt-4 font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 text-sm text-neutral-500">{body}</p>
    </div>
  );
}
