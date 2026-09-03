import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { money } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";
import { ClearCart } from "./ClearCart";

// Customer-facing copy for the admin-set order status. This page is the
// customer's only way to check status today (no notification emails yet) —
// they revisit this same URL (bookmarked or from browser history) and get a
// fresh server-rendered snapshot each load, since the route is already
// dynamic (no caching to fight).
const STATUS_COPY: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-neutral-100 text-neutral-700" },
  paid: { label: "Order received", className: "bg-blue-100 text-blue-700" },
  preparing: { label: "Being prepared", className: "bg-amber-100 text-amber-700" },
  ready: { label: "Ready!", className: "bg-purple-100 text-purple-700" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

export default async function SuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { slug } = await params;
  const { session_id: sessionId } = await searchParams;

  const supabase = await createClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name, currency, stripe_account_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!restaurant) notFound();

  if (!sessionId) {
    return <NoOrder slug={slug} restaurantName={restaurant.name} />;
  }

  let session;
  try {
    // Direct charge — the session lives on the restaurant's connected
    // account, not the platform, so it can only be retrieved with the
    // matching stripeAccount context.
    session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["line_items"] },
      { stripeAccount: restaurant.stripe_account_id ?? undefined },
    );
  } catch {
    return <NoOrder slug={slug} restaurantName={restaurant.name} />;
  }

  if (session.payment_status !== "paid") {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-neutral-900">Payment not completed</h1>
        <p className="mt-2 text-sm text-neutral-500">We couldn&apos;t confirm this payment. If you were charged, please contact us.</p>
        <Link href={`/r/${slug}/checkout`} className="mt-6 inline-block text-sm font-medium text-neutral-900 underline">
          ← Back to checkout
        </Link>
      </Centered>
    );
  }

  const meta = session.metadata ?? {};
  const isDelivery = meta.fulfillment_mode === "delivery";
  const address = meta.delivery_address ? JSON.parse(meta.delivery_address) : null;
  const firstName = (meta.customer_name || "").split(" ")[0] || "there";

  const lines = session.line_items?.data ?? [];
  const itemLines = lines.filter((li) => li.description !== "Delivery Fee" && li.description !== "Tax");
  const deliveryLine = lines.find((li) => li.description === "Delivery Fee");
  const taxLine = lines.find((li) => li.description === "Tax");

  // A session-level discount (promo code) proportionally distributes across
  // every line item, so amount_total per line is no longer that line's true
  // pre-discount price. Prefer the authoritative amounts computed server-side
  // at session-creation time (same metadata the webhook reads) — amount_total
  // per line is only a safe fallback for older sessions created before promo
  // codes existed, when metadata.subtotal_cents wasn't set.
  const discountCents = Number(meta.discount_cents || 0);
  const promoCode = meta.promo_code || null;
  const subtotalCents = meta.subtotal_cents ? Number(meta.subtotal_cents) : itemLines.reduce((sum, li) => sum + (li.amount_total ?? 0), 0);
  const deliveryFeeCents = meta.delivery_fee_cents ? Number(meta.delivery_fee_cents) : (deliveryLine?.amount_total ?? 0);
  const taxCents = meta.tax_cents ? Number(meta.tax_cents) : (taxLine?.amount_total ?? 0);

  // orders has no public select policy (customers have no session/account) —
  // same sanctioned service-role bypass already used by /api/onboard and
  // promo lookups. Scoped to this exact session id, which only the paying
  // customer has (functions as the access token, same trust model as the
  // rest of this page already relying on an unguessable session_id in the URL).
  const { data: order } = await createAdminClient()
    .from("orders")
    .select("status")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle<{ status: OrderStatus }>();
  const statusCopy = order ? STATUS_COPY[order.status] : null;

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-12">
      <ClearCart slug={slug} />
      <div className="mx-auto max-w-lg rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">✓</div>
        <h1 className="mt-4 text-center text-xl font-semibold text-neutral-900">Thank you, {firstName}!</h1>
        <p className="mt-1 text-center text-sm text-neutral-500">
          A confirmation has been sent to {session.customer_details?.email ?? "your email"}.
        </p>

        <div className="mt-4 flex justify-center">
          {statusCopy ? (
            <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${statusCopy.className}`}>{statusCopy.label}</span>
          ) : (
            // Webhook hasn't landed yet (async, usually a second or two behind
            // the redirect) — reassure rather than show nothing or an error.
            <span className="text-sm text-neutral-400">Finalizing your order — refresh in a moment to see status.</span>
          )}
        </div>

        <div className="mt-6 rounded-lg bg-neutral-50 p-4 text-sm">
          {isDelivery && address ? (
            <p>
              <strong>Delivering to:</strong> {address.address1}, {address.city} {address.province} {address.postal}
            </p>
          ) : (
            <p>
              <strong>Pickup time:</strong> {meta.pickup_time || "As soon as possible"}
            </p>
          )}
        </div>

        <h2 className="mt-6 text-sm font-medium text-neutral-900">Order summary</h2>
        <div className="mt-2 space-y-1 text-sm">
          {itemLines.map((li) => (
            <div key={li.id} className="flex justify-between text-neutral-600">
              <span>{li.quantity} × {li.description}</span>
              <span>{money(li.amount_subtotal ?? li.amount_total ?? 0, restaurant.currency)}</span>
            </div>
          ))}
          <div className="mt-2 border-t border-neutral-100 pt-2 flex justify-between text-neutral-600">
            <span>Subtotal</span>
            <span>{money(subtotalCents, restaurant.currency)}</span>
          </div>
          {discountCents > 0 && (
            <div className="flex justify-between text-green-700">
              <span>Promo {promoCode}</span>
              <span>−{money(discountCents, restaurant.currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-neutral-600">
            <span>Delivery</span>
            <span>{deliveryFeeCents > 0 ? money(deliveryFeeCents, restaurant.currency) : "FREE"}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Tax</span>
            <span>{money(taxCents, restaurant.currency)}</span>
          </div>
          <div className="flex justify-between pt-1 text-base font-semibold text-neutral-900">
            <span>Total paid</span>
            <span>{money(session.amount_total ?? 0, restaurant.currency)}</span>
          </div>
        </div>

        <Link
          href={`/r/${slug}/order`}
          className="mt-8 block rounded-full bg-neutral-900 py-3 text-center text-sm font-medium text-white"
        >
          Order again
        </Link>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">{children}</div>
    </div>
  );
}

function NoOrder({ slug, restaurantName }: { slug: string; restaurantName: string }) {
  return (
    <Centered>
      <h1 className="text-lg font-semibold text-neutral-900">No recent order found</h1>
      <p className="mt-2 text-sm text-neutral-500">Looks like you haven&apos;t placed an order at {restaurantName} yet.</p>
      <Link href={`/r/${slug}/order`} className="mt-6 inline-block text-sm font-medium text-neutral-900 underline">
        ← Back to menu
      </Link>
    </Centered>
  );
}
