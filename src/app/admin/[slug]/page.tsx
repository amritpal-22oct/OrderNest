import { requireRestaurantAdmin } from "@/lib/restaurant";
import type { Order, OrderStatus } from "@/lib/types";
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

export default async function AdminOrdersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, restaurant, user } = await requireRestaurantAdmin(slug);

  const { data: orders } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: false })
    .returns<Order[]>();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Orders · signed in as {user.email}</p>
          </div>
          <form action={signOutAction}>
            <input type="hidden" name="slug" value={slug} />
            <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
              Sign out
            </button>
          </form>
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

        {!orders || orders.length === 0 ? (
          <p className="text-sm text-neutral-500">No orders yet.</p>
        ) : (
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
        )}
      </main>
    </div>
  );
}
