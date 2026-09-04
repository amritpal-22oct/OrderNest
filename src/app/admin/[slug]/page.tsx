import Link from "next/link";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import type { Order, OrderStatus, RestaurantLocation } from "@/lib/types";
import { money } from "@/lib/format";
import { connectStripeAction, updateOrderStatusAction } from "./actions";
import { CancelOrderButton } from "./CancelOrderButton";
import { DispatchDeliveryButton } from "./DispatchDeliveryButton";
import { AdminHeader } from "./AdminHeader";
import { BagIcon, MailIcon, PhoneIcon, PinIcon, RefundIcon, SearchIcon, TruckIcon } from "./icons";

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-neutral-100 text-neutral-700",
  paid: "bg-blue-100 text-blue-700",
  preparing: "bg-amber-100 text-amber-700",
  ready: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

// Left accent border on each order card, same color family as its status
// badge — a quick "scan the left edge" signal on a long list, before ever
// reading the badge text itself.
const STATUS_ACCENTS: Record<OrderStatus, string> = {
  pending: "border-l-neutral-300",
  paid: "border-l-blue-400",
  preparing: "border-l-amber-400",
  ready: "border-l-purple-400",
  completed: "border-l-green-400",
  cancelled: "border-l-red-400",
};

// Quick-filter shortcuts above the order list — same `status` query param the
// full filter form's own Status dropdown uses, just one click away. "New"
// maps to `paid` rather than `pending`: every order in this app is inserted
// already paid (see actions.ts's VALID_STATUSES comment) — `pending` is
// never actually set by anything, so a quick filter for it would always be
// empty.
const QUICK_STATUS_FILTERS: { label: string; value: OrderStatus }[] = [
  { label: "New", value: "paid" },
  { label: "Preparing", value: "preparing" },
  { label: "Ready", value: "ready" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

// Full list, used only for the search filter — past cancelled orders should
// still be searchable/filterable by that status.
const STATUS_OPTIONS: OrderStatus[] = ["pending", "paid", "preparing", "ready", "completed", "cancelled"];
// "cancelled" excluded here — see the VALID_STATUSES comment in actions.ts:
// cancelling a real (always-paid) order must go through cancelAndRefundOrderAction,
// never this plain per-order status dropdown.
const SETTABLE_STATUS_OPTIONS: OrderStatus[] = ["pending", "paid", "preparing", "ready", "completed"];
const PAGE_SIZE = 20;

// Chrome's native <select> box ignores line-height entirely when rendering
// its closed/collapsed state (confirmed directly — even an inline
// line-height override has no effect), so it renders ~2px shorter than a
// same-padding <input> and throws off the search filter row's alignment.
// appearance-none on the <select> fixes that (it then sizes like a normal
// box, matching the inputs exactly), but that also strips the browser's own
// dropdown arrow — this is that arrow's replacement, absolutely positioned
// over the now-plain select.
function SelectChevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
    >
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
    </svg>
  );
}

type SearchParams = {
  q?: string;
  status?: string;
  mode?: string;
  from?: string;
  to?: string;
  location?: string;
  sort?: string;
  page?: string;
  cancelError?: string;
  dispatchError?: string;
};

function buildHref(current: SearchParams, overrides: Partial<SearchParams>) {
  // cancelError/dispatchError are one-time flash messages, not real filters —
  // drop them so paginating away doesn't drag a stale error banner along.
  const rest = { ...current };
  delete rest.cancelError;
  delete rest.dispatchError;
  const merged: SearchParams = { ...rest, ...overrides };
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
  const { supabase, restaurant, user, role } = await requireRestaurantAdmin(slug);

  const q = sp.q?.trim() || "";
  const status = sp.status && STATUS_OPTIONS.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : "";
  const mode = sp.mode === "delivery" || sp.mode === "pickup" ? sp.mode : "";
  const from = sp.from || "";
  const to = sp.to || "";
  const locationId = sp.location || "";
  const sort = sp.sort === "oldest" ? "oldest" : "newest";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const hasFilters = !!(q || status || mode || from || to || locationId);

  const { data: locations } = await supabase
    .from("restaurant_locations")
    .select("id, name")
    .eq("restaurant_id", restaurant.id)
    .order("sort_order")
    .returns<Pick<RestaurantLocation, "id" | "name">[]>();

  const { data: deliveryAccount } = await supabase
    .from("restaurant_delivery_accounts")
    .select("id")
    .eq("restaurant_id", restaurant.id)
    .eq("provider", "doordash")
    .eq("is_active", true)
    .maybeSingle<{ id: string }>();

  let query = supabase
    .from("orders")
    .select("*, order_items(*), location:restaurant_locations(name)", { count: "exact" })
    .eq("restaurant_id", restaurant.id);

  // Matches name, email, or phone. PostgREST's or() filter string treats `,`
  // and `()` as syntax (condition separator / grouping) — wrapping each
  // value in double quotes lets those appear literally in q instead of
  // letting a customer's search text splice in extra filter conditions of
  // its own; \ and " within q are escaped so the quoting itself can't be
  // broken out of either.
  if (q) {
    const escaped = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    query = query.or(`customer_name.ilike."%${escaped}%",customer_email.ilike."%${escaped}%",customer_phone.ilike."%${escaped}%"`);
  }
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
    .order("created_at", { ascending: sort === "oldest" })
    .range(offset, offset + PAGE_SIZE - 1)
    .returns<(Order & { location: { name: string } | null })[]>();

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-neutral-50">
      <AdminHeader slug={slug} restaurant={restaurant} userEmail={user.email ?? ""} role={role} active="orders" />

      <main className="mx-auto max-w-5xl px-6 py-8">
        {sp.cancelError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <p className="font-medium text-red-900">Couldn&apos;t cancel that order</p>
            <p className="text-sm text-red-700">{sp.cancelError}</p>
          </div>
        )}

        {sp.dispatchError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <p className="font-medium text-red-900">Couldn&apos;t dispatch that delivery</p>
            <p className="text-sm text-red-700">{sp.dispatchError}</p>
          </div>
        )}

        {!restaurant.accepting_orders && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="font-medium text-amber-900">Ordering is paused</p>
            <p className="text-sm text-amber-700">
              Customers can browse your menu but can&apos;t place new orders right now. Resume ordering above when you&apos;re ready.
            </p>
          </div>
        )}

        {!restaurant.stripe_onboarding_complete && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div>
              <p className="font-medium text-amber-900">Stripe isn&apos;t connected yet</p>
              <p className="text-sm text-amber-700">
                Connect a Stripe account to start accepting payments on your ordering page.
              </p>
            </div>
            {role === "owner" ? (
              <form action={connectStripeAction}>
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className="whitespace-nowrap rounded-md bg-amber-900 px-3 py-1.5 text-sm text-white hover:bg-amber-800">
                  Connect Stripe
                </button>
              </form>
            ) : (
              <p className="whitespace-nowrap text-sm text-amber-700">Ask the owner to connect it.</p>
            )}
          </div>
        )}

        {/* key: same uncontrolled-defaultValue issue as the per-order status
            select above — the quick-filter/sort links below navigate by
            changing just one query param, and without a key tied to the
            actual filter values, React reuses this form's DOM across that
            client-side transition instead of remounting it, so fields like
            Status silently kept showing "All statuses" after a quick-filter
            click even though the URL (and the results) had changed. */}
        <form
          key={`${q}-${status}-${mode}-${from}-${to}-${locationId}`}
          method="get"
          className="mb-6 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="col-span-2 block text-xs text-neutral-500 sm:col-span-1">
              Search by customer
              <div className="relative mt-1">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Name, email or phone…"
                  className="w-full rounded-md border border-neutral-300 py-1.5 pl-8 pr-2 text-sm text-neutral-900"
                />
              </div>
            </label>
            <label className="block text-xs text-neutral-500">
              From
              <input type="date" name="from" defaultValue={from} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900" />
            </label>
            <label className="block text-xs text-neutral-500">
              To
              <input type="date" name="to" defaultValue={to} className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900" />
            </label>
            <label className="block text-xs text-neutral-500">
              Status
              <div className="relative mt-1">
                <select
                  name="status"
                  defaultValue={status}
                  className="w-full appearance-none rounded-md border border-neutral-300 px-2 py-1.5 pr-7 text-sm text-neutral-900"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </label>
            <label className="block text-xs text-neutral-500">
              Fulfillment
              <div className="relative mt-1">
                <select
                  name="mode"
                  defaultValue={mode}
                  className="w-full appearance-none rounded-md border border-neutral-300 px-2 py-1.5 pr-7 text-sm text-neutral-900"
                >
                  <option value="">Delivery &amp; pickup</option>
                  <option value="delivery">Delivery only</option>
                  <option value="pickup">Pickup only</option>
                </select>
                <SelectChevron />
              </div>
            </label>
            {locations && locations.length > 0 && (
              <label className="block text-xs text-neutral-500">
                Location
                <div className="relative mt-1">
                  <select
                    name="location"
                    defaultValue={locationId}
                    className="w-full appearance-none rounded-md border border-neutral-300 px-2 py-1.5 pr-7 text-sm text-neutral-900"
                  >
                    <option value="">All locations</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </label>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
              Search
            </button>
            {hasFilters && (
              <Link href={`/admin/${slug}`} className="text-sm text-neutral-500 underline hover:text-neutral-900">
                Clear filters
              </Link>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
            <span className="text-xs font-medium text-neutral-500">Quick filters:</span>
            {QUICK_STATUS_FILTERS.map((f) => {
              const active = status === f.value;
              return (
                <Link
                  key={f.value}
                  href={active ? buildHref(sp, { status: undefined, page: undefined }) : buildHref(sp, { status: f.value, page: undefined })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? f.value === "cancelled"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </form>

        {!orders || orders.length === 0 ? (
          <p className="text-sm text-neutral-500">{hasFilters ? "No orders match your search." : "No orders yet."}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-neutral-500">
                Showing {offset + 1}–{Math.min(offset + orders.length, totalCount)} of {totalCount} order
                {totalCount === 1 ? "" : "s"}
              </p>
              <label className="flex items-center gap-2 text-sm text-neutral-500">
                Sort by
                <Link
                  href={buildHref(sp, { sort: sort === "newest" ? "oldest" : "newest", page: undefined })}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  {sort === "newest" ? "Newest first" : "Oldest first"}
                </Link>
              </label>
            </div>
            <div className="space-y-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-xl border border-l-4 border-neutral-200 bg-white p-5 shadow-sm ${STATUS_ACCENTS[order.status]}`}
                >
                  <div className="grid gap-4 md:grid-cols-[1.1fr_1.3fr_auto]">
                    {/* Customer + fulfillment */}
                    <div>
                      <p className="font-mono text-xs text-neutral-400">{order.id.slice(-10).toUpperCase()}</p>
                      <p className="font-medium text-neutral-900">{order.customer_name}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-neutral-500">
                        <MailIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        {order.customer_email}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-500">
                        <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        {order.customer_phone}
                      </p>

                      <div className="mt-3 border-t border-neutral-100 pt-3">
                        <p className="flex items-start gap-1.5 text-sm text-neutral-700">
                          <PinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                          <span>
                            {order.fulfillment_mode === "delivery"
                              ? `${order.delivery_address?.address1 ?? ""}, ${order.delivery_address?.city ?? ""}`
                              : "Pickup"}
                            {order.pickup_time && <span className="text-neutral-400"> · {order.pickup_time}</span>}
                            {order.location?.name && <span className="text-neutral-400"> · {order.location.name}</span>}
                          </span>
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                          {order.fulfillment_mode === "delivery" ? <TruckIcon className="h-3 w-3" /> : <BagIcon className="h-3 w-3" />}
                          {order.fulfillment_mode === "delivery" ? "Delivery" : "Pickup"}
                        </span>
                        {(order.promo_code || order.discount_cents > 0) && (
                          <p className="mt-2 text-xs text-green-700">
                            Promo {order.promo_code} applied · −{money(order.discount_cents, order.currency)}
                          </p>
                        )}
                        {order.dispatch_external_delivery_id && (
                          <p className="mt-2 text-xs text-neutral-500">
                            DoorDash: {order.dispatch_status}
                            {order.dispatch_tracking_url && (
                              <>
                                {" · "}
                                <a href={order.dispatch_tracking_url} target="_blank" rel="noreferrer" className="underline">
                                  Track
                                </a>
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Items */}
                    <div className="border-t border-neutral-100 pt-3 text-sm md:border-t-0 md:border-l md:pl-4 md:pt-0">
                      <p className="text-xs font-medium text-neutral-500">Items ({order.order_items?.length ?? 0})</p>
                      <ul className="mt-2 space-y-1 text-neutral-600">
                        {order.order_items?.map((item) => (
                          <li key={item.id} className="flex justify-between gap-3">
                            <span>
                              {item.quantity} × {item.name_snapshot}
                            </span>
                            <span>{money(item.price_cents_snapshot * item.quantity, order.currency)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 flex justify-between border-t border-neutral-100 pt-2 font-medium text-neutral-900">
                        <span>Total</span>
                        <span>{money(order.total_cents, order.currency)}</span>
                      </p>
                    </div>

                    {/* Status + actions */}
                    <div className="flex flex-col items-start gap-3 border-t border-neutral-100 pt-3 md:items-end md:border-t-0 md:border-l md:pl-4 md:pt-0 md:text-right">
                      <div>
                        <div className="flex items-center gap-2 md:justify-end">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}>
                            {order.status}
                          </span>
                          <span className="whitespace-nowrap text-sm text-neutral-500">{new Date(order.created_at).toLocaleString()}</span>
                        </div>
                        {order.refunded_at && (
                          <p
                            className={`mt-1 flex items-center gap-1 text-xs md:justify-end ${
                              order.refund_status === "failed" || order.refund_status === "canceled" ? "font-medium text-red-700" : "text-red-600"
                            }`}
                          >
                            <RefundIcon className="h-3.5 w-3.5 shrink-0" />
                            {order.refund_status === "succeeded"
                              ? `Refunded ${money(order.total_cents, order.currency)} on ${new Date(order.refunded_at).toLocaleDateString()}`
                              : order.refund_status === "failed" || order.refund_status === "canceled"
                                ? `Refund failed — money wasn't returned. Try again below.`
                                : `Refund pending since ${new Date(order.refunded_at).toLocaleDateString()}`}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        {order.status !== "cancelled" && (
                      <form action={updateOrderStatusAction} className="flex items-center gap-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="orderId" value={order.id} />
                        {/* key={order.status}: an uncontrolled <select>'s defaultValue only
                            applies on mount — after Update submits and revalidatePath()
                            re-renders this same list, React reuses the existing DOM node
                            (same position, no key change) rather than remounting it, so the
                            dropdown was silently keeping whatever the browser last showed
                            instead of the new order.status. Forcing a remount on status
                            change fixes it. */}
                        <select
                          key={order.status}
                          name="status"
                          defaultValue={order.status}
                          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                        >
                          {SETTABLE_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-800">
                          Update
                        </button>
                      </form>
                    )}
                    {order.status !== "cancelled" &&
                      order.refund_status !== "succeeded" &&
                      order.refund_status !== "pending" &&
                      order.refund_status !== "requires_action" && <CancelOrderButton slug={slug} orderId={order.id} />}
                        {order.fulfillment_mode === "delivery" &&
                          order.status !== "cancelled" &&
                          !order.dispatch_external_delivery_id &&
                          deliveryAccount && <DispatchDeliveryButton slug={slug} orderId={order.id} />}
                      </div>
                    </div>
                  </div>
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
