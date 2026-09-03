import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { money } from "@/lib/format";
import type { Restaurant } from "@/lib/types";
import { signOutAction } from "./actions";

export default async function PlatformAdminPage() {
  const { supabase, user } = await requirePlatformAdmin();

  // RLS grants a platform admin's session read access to every restaurant's
  // orders (is_restaurant_admin() short-circuits to true via is_platform_admin()),
  // so this genuinely returns orders across all tenants, not just one.
  const [{ data: restaurants }, { data: orders }] = await Promise.all([
    supabase.from("restaurants").select("*").order("created_at", { ascending: false }).returns<Restaurant[]>(),
    supabase.from("orders").select("restaurant_id, total_cents, status"),
  ]);

  const statsByRestaurant = new Map<string, { count: number; revenueCents: number }>();
  for (const order of orders ?? []) {
    const stats = statsByRestaurant.get(order.restaurant_id) ?? { count: 0, revenueCents: 0 };
    stats.count += 1;
    if (order.status === "paid" || order.status === "preparing" || order.status === "ready" || order.status === "completed") {
      stats.revenueCents += order.total_cents;
    }
    statsByRestaurant.set(order.restaurant_id, stats);
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">OrderNest platform admin</h1>
            <p className="text-sm text-neutral-500">Signed in as {user.email}</p>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {!restaurants || restaurants.length === 0 ? (
          <p className="text-sm text-neutral-500">No restaurants yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Restaurant</th>
                  <th className="px-5 py-3 font-medium">Stripe</th>
                  <th className="px-5 py-3 font-medium">Orders</th>
                  <th className="px-5 py-3 font-medium">Revenue</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {restaurants.map((restaurant) => {
                  const stats = statsByRestaurant.get(restaurant.id) ?? { count: 0, revenueCents: 0 };
                  return (
                    <tr key={restaurant.id} className="border-b border-neutral-100 last:border-0">
                      <td className="px-5 py-3">
                        <div className="font-medium text-neutral-900">{restaurant.name}</div>
                        <div className="text-neutral-400">/{restaurant.slug}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            restaurant.stripe_onboarding_complete ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {restaurant.stripe_onboarding_complete ? "Connected" : "Not connected"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-neutral-700">{stats.count}</td>
                      <td className="px-5 py-3 text-neutral-700">{money(stats.revenueCents, restaurant.currency)}</td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/admin/${restaurant.slug}`} className="text-neutral-500 underline hover:text-neutral-900">
                          Dashboard
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
