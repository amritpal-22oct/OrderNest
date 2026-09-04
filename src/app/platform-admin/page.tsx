import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { money } from "@/lib/format";
import { stripe } from "@/lib/stripe";
import type { Restaurant } from "@/lib/types";
import { signOutAction, updateStripeCustomerIdAction, setUpPlatformBillingAction, addRestaurantAdminAction } from "./actions";

// Subscriptions are created/managed by hand in the Stripe Dashboard (no
// in-app Checkout/webhook integration by design — see stripe_customer_id
// comment in schema.sql), so status is looked up live from Stripe rather
// than tracked in the DB, which would drift out of sync with the Dashboard.
const SUBSCRIPTION_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  trialing: "bg-blue-100 text-blue-700",
  past_due: "bg-amber-100 text-amber-700",
  unpaid: "bg-amber-100 text-amber-700",
  incomplete: "bg-amber-100 text-amber-700",
  paused: "bg-neutral-100 text-neutral-600",
  canceled: "bg-red-100 text-red-700",
  incomplete_expired: "bg-red-100 text-red-700",
  none: "bg-neutral-100 text-neutral-600",
  error: "bg-red-100 text-red-700",
};

async function lookupSubscriptionStatus(customerId: string): Promise<string> {
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
    return subs.data[0]?.status ?? "none";
  } catch {
    // Most likely a mistyped/deleted customer id — surface as an error badge
    // rather than silently showing "no subscription".
    return "error";
  }
}

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<{ adminError?: string }> }) {
  const { supabase, user } = await requirePlatformAdmin();
  const { adminError } = await searchParams;

  // RLS grants a platform admin's session read access to every restaurant's
  // orders (is_restaurant_admin() short-circuits to true via is_platform_admin()),
  // so this genuinely returns orders across all tenants, not just one.
  const [{ data: restaurants }, { data: orders }, { data: adminLinks }] = await Promise.all([
    supabase.from("restaurants").select("*").order("created_at", { ascending: false }).returns<Restaurant[]>(),
    supabase.from("orders").select("restaurant_id, total_cents, status"),
    // Same RLS grant as above extends to restaurant_admins ("platform admins
    // manage restaurant_admins"), so this is every restaurant's admin roster
    // in one query rather than per-restaurant.
    supabase.from("restaurant_admins").select("restaurant_id, user_id, role").returns<{ restaurant_id: string; user_id: string; role: string }[]>(),
  ]);

  // restaurant_admins only has user_id — resolving to an email needs the
  // service-role client (session client has no access to auth.users), same
  // pattern as setUpPlatformBillingAction below. One lookup per distinct
  // user, not per row, since the same person can admin multiple restaurants.
  const adminClient = createAdminClient();
  const distinctUserIds = [...new Set((adminLinks ?? []).map((a) => a.user_id))];
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    distinctUserIds.map(async (id) => {
      const { data } = await adminClient.auth.admin.getUserById(id);
      if (data.user?.email) emailByUserId.set(id, data.user.email);
    }),
  );
  const adminsByRestaurant = new Map<string, { email: string; role: string }[]>();
  for (const link of adminLinks ?? []) {
    const list = adminsByRestaurant.get(link.restaurant_id) ?? [];
    list.push({ email: emailByUserId.get(link.user_id) ?? link.user_id, role: link.role });
    adminsByRestaurant.set(link.restaurant_id, list);
  }

  const statsByRestaurant = new Map<string, { count: number; revenueCents: number }>();
  for (const order of orders ?? []) {
    const stats = statsByRestaurant.get(order.restaurant_id) ?? { count: 0, revenueCents: 0 };
    stats.count += 1;
    if (order.status === "paid" || order.status === "preparing" || order.status === "ready" || order.status === "completed") {
      stats.revenueCents += order.total_cents;
    }
    statsByRestaurant.set(order.restaurant_id, stats);
  }

  // Platform-billing status (cus_... on OrderNest's own account, unrelated to
  // stripe_account_id) — fetched live per restaurant that has a customer id
  // saved, in parallel.
  const subscriptionStatusByRestaurant = new Map<string, string>();
  await Promise.all(
    (restaurants ?? [])
      .filter((r) => r.stripe_customer_id)
      .map(async (r) => {
        subscriptionStatusByRestaurant.set(r.id, await lookupSubscriptionStatus(r.stripe_customer_id!));
      }),
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">OrderNest platform admin</h1>
            <p className="text-sm text-neutral-500">Signed in as {user.email}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/onboard" className="text-sm text-neutral-500 hover:text-neutral-900">
              + Add restaurant
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {adminError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <p className="font-medium text-red-900">Couldn&apos;t add that admin</p>
            <p className="text-sm text-red-700">{adminError}</p>
          </div>
        )}

        {!restaurants || restaurants.length === 0 ? (
          <p className="text-sm text-neutral-500">No restaurants yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Restaurant</th>
                  <th className="px-5 py-3 font-medium">Stripe</th>
                  <th className="px-5 py-3 font-medium">Subscription</th>
                  <th className="px-5 py-3 font-medium">Orders</th>
                  <th className="px-5 py-3 font-medium">Revenue</th>
                  <th className="px-5 py-3 font-medium">Admins</th>
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
                      <td className="px-5 py-3">
                        {restaurant.stripe_customer_id ? (
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              SUBSCRIPTION_STYLES[subscriptionStatusByRestaurant.get(restaurant.id) ?? "none"]
                            }`}
                          >
                            {(subscriptionStatusByRestaurant.get(restaurant.id) ?? "none").replace("_", " ")}
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                            Not set
                          </span>
                        )}
                        {!restaurant.stripe_customer_id && (
                          <form action={setUpPlatformBillingAction} className="mt-1.5">
                            <input type="hidden" name="restaurantId" value={restaurant.id} />
                            <button type="submit" className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white hover:bg-neutral-800">
                              Set up billing
                            </button>
                          </form>
                        )}
                        <form action={updateStripeCustomerIdAction} className="mt-1.5 flex items-center gap-1">
                          <input type="hidden" name="restaurantId" value={restaurant.id} />
                          <input
                            name="stripeCustomerId"
                            defaultValue={restaurant.stripe_customer_id ?? ""}
                            placeholder="cus_..."
                            className="w-28 rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-xs text-neutral-700"
                          />
                          <button type="submit" className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200">
                            Save
                          </button>
                        </form>
                      </td>
                      <td className="px-5 py-3 text-neutral-700">{stats.count}</td>
                      <td className="px-5 py-3 text-neutral-700">{money(stats.revenueCents, restaurant.currency)}</td>
                      <td className="px-5 py-3">
                        <ul className="space-y-0.5">
                          {(adminsByRestaurant.get(restaurant.id) ?? []).map((admin) => (
                            <li key={admin.email} className="whitespace-nowrap text-neutral-700">
                              {admin.email} <span className="text-xs text-neutral-400">({admin.role})</span>
                            </li>
                          ))}
                        </ul>
                        <form action={addRestaurantAdminAction} className="mt-1.5 flex flex-col gap-1">
                          <input type="hidden" name="restaurantId" value={restaurant.id} />
                          <input
                            name="email"
                            type="email"
                            placeholder="email"
                            className="w-36 rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-700"
                          />
                          <input
                            name="password"
                            type="text"
                            placeholder="password (set or reset)"
                            className="w-36 rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-700"
                          />
                          <div className="flex items-center gap-1">
                            <select name="role" defaultValue="staff" className="rounded border border-neutral-300 px-1 py-0.5 text-xs text-neutral-700">
                              <option value="owner">owner</option>
                              <option value="staff">staff</option>
                            </select>
                            <button type="submit" className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200">
                              Add
                            </button>
                          </div>
                        </form>
                      </td>
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
