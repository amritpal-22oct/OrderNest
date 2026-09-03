import Link from "next/link";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import type { Order, OrderStatus, RestaurantLocation } from "@/lib/types";
import { money } from "@/lib/format";
import { connectStripeAction, signOutAction, updateOrderStatusAction } from "./actions";

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-neutral-100 text-neutral-700",
  paid: "bg-blue-100 text-blue-700",
  preparing: "bg-amber-100 text-amber-700",
  ready: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS: OrderStatus[] = ["pending", "paid", "preparing", "ready", "completed", "cancelled"];
const PAGE_SIZE = 20;

type SearchParams = {
  q?: string;
  status?: string;
  mode?: string;
  from?: string;
  to?: string;
  location?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>) {
  const merged: SearchParams = { ...current, ...overrides };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { supabase, restaurant, user } = await requireRestaurantAdmin(slug);

  const q = sp.q?.trim() || "";
  const status = sp.status && STATUS_OPTIONS.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : "";
  const mode = sp.mode === "delivery" || sp.mode === "pickup" ? sp.mode : "";
  const from = sp.from || "";
  const to = sp.to || "";
  const locationId = sp.location || "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const hasFilters = !!(q || status || mode || from || to || locationId);

  const { data: locations } = await supabase
    .from("restaurant_locations")
    .select("id, name")
    .eq("restaurant_id", restaurant.id)
    .order("sort_order")
    .returns<Pick<RestaurantLocation, "id" | "name">[]>();

  let query = supabase
    .from("orders")
    .select("*, order_items(*), location:restaurant_locations(name)", { count: "exact" })
    .eq("restaurant_id", restaurant.id);

  if (q) query = query.ilike("customer_name", `%${q}%`);
  if (status) query = query.eq("status", status);
  if (mode) query = query.eq("fulfillment_mode", mode);
  // Date boundaries are treated as UTC — a restaurant far from UTC may see a
  // day's orders spill slightly into the adjacent calendar day. Acceptable
  // for an admin search filter (not an enforcement path like hours-of-operation).
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);
  if (locationId) query = query.eq("location_id", locationId);

  const offset = (page - 1) * PAGE_SIZE;
  const { data: orders, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)
    .returns<(Order & { location: { name: string } | null })[]>();

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Orders · signed in as {user.email}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/admin/${slug}/menu`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Menu
            </Link>
            <Link href={`/admin/${slug}/locations`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Locations
            </Link>
            <Link href={`/admin/${slug}/hours`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Hours
            </Link>
            <form action={signOutAction}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {!restaurant.stripe_onboarding_complete && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div>
              <p className="font-medium text-amber-900">Stripe isn&apos;t connected yet</p>
              <p className="text-sm text-amber-700">
                Connect a Stripe account to start accepting payments on your ordering page.
              </p>
            </div>
            <form action={connectStripeAction}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="whitespace-nowrap rounded-md bg-amber-900 px-3 py-1.5 text-sm text-white hover:bg-amber-800">
                Connect Stripe
              </button>
            </form>
          </div>
        )}

        <form method="get" className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <input
              name="q"
              defaultValue={q}
              placeholder="Customer name"
              className="col-span-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm sm:col-span-1"
            />
            <input type="date" name="from" defaultValue={from} className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <input type="date" name="to" defaultValue={to} className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            <select name="status" defaultValue={status} className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select name="mode" defaultValue={mode} className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
              <option value="">Delivery &amp; pickup</option>
              <option value="delivery">Delivery only</option>
              <option value="pickup">Pickup only</option>
            </select>
            {locations && locations.length > 0 && (
              <select name="location" defaultValue={locationId} className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
              Filter
            </button>
            {hasFilters && (
              <Link href={`/admin/${slug}`} className="text-sm text-neutral-500 underline hover:text-neutral-900">
                Clear filters
              </Link>
            )}
          </div>
        </form>

        {!orders || orders.length === 0 ? (
          <p className="text-sm text-neutral-500">{hasFilters ? "No orders match your filters." : "No orders yet."}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-neutral-500">
              Showing {offset + 1}–{Math.min(offset + orders.length, totalCount)} of {totalCount} order
              {totalCount === 1 ? "" : "s"}
            </p>
            <div className="space-y-4">
              {orders.map((order) => (
                <div key={order.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-neutral-400">{order.id.slice(-10).toUpperCase()}</p>
                      <p className="font-medium text-neutral-900">{order.customer_name}</p>
                      <p className="text-sm text-neutral-500">
                        {order.customer_email} · {order.customer_phone}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}>
                        {order.status}
                      </span>
                      <p className="mt-1 text-sm text-neutral-500">{new Date(order.created_at).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-neutral-100 pt-3 text-sm">
                    <p className="text-neutral-700">
                      {order.fulfillment_mode === "delivery"
                        ? `Delivering to: ${order.delivery_address?.address1 ?? ""}, ${order.delivery_address?.city ?? ""}`
                        : `Pickup: ${order.pickup_time ?? ""}`}
                      {order.location?.name && <span className="text-neutral-400"> · {order.location.name}</span>}
                    </p>
                    <ul className="mt-2 space-y-1 text-neutral-600">
                      {order.order_items?.map((item) => (
                        <li key={item.id} className="flex justify-between">
                          <span>
                            {item.quantity} × {item.name_snapshot}
                          </span>
                          <span>{money(item.price_cents_snapshot * item.quantity, order.currency)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 flex justify-between font-medium text-neutral-900">
                      <span>Total</span>
                      <span>{money(order.total_cents, order.currency)}</span>
                    </p>
                  </div>

                  <form action={updateOrderStatusAction} className="mt-4 flex items-center gap-2">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <select
                      name="status"
                      defaultValue={order.status}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-800">
                      Update
                    </button>
                  </form>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between text-sm">
                {page > 1 ? (
                  <Link href={buildHref(sp, { page: String(page - 1) })} className="text-neutral-700 underline hover:text-neutral-900">
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-neutral-500">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link href={buildHref(sp, { page: String(page + 1) })} className="text-neutral-700 underline hover:text-neutral-900">
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
