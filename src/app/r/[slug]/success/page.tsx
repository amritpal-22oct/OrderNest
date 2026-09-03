import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { money } from "@/lib/format";
import { ClearCart } from "./ClearCart";

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
  const { data: restaurant } = await supabase.from("restaurants").select("name, currency").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  if (!sessionId) {
    return <NoOrder slug={slug} restaurantName={restaurant.name} />;
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
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
  const subtotalCents = itemLines.reduce((sum, li) => sum + (li.amount_total ?? 0), 0);

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-12">
      <ClearCart slug={slug} />
      <div className="mx-auto max-w-lg rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">✓</div>
        <h1 className="mt-4 text-center text-xl font-semibold text-neutral-900">Thank you, {firstName}!</h1>
        <p className="mt-1 text-center text-sm text-neutral-500">
          A confirmation has been sent to {session.customer_details?.email ?? "your email"}.
        </p>

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
              <span>{money(li.amount_total ?? 0, restaurant.currency)}</span>
            </div>
          ))}
          <div className="mt-2 border-t border-neutral-100 pt-2 flex justify-between text-neutral-600">
            <span>Subtotal</span>
            <span>{money(subtotalCents, restaurant.currency)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Delivery</span>
            <span>{deliveryLine ? money(deliveryLine.amount_total ?? 0, restaurant.currency) : "FREE"}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Tax</span>
            <span>{taxLine ? money(taxLine.amount_total ?? 0, restaurant.currency) : money(0, restaurant.currency)}</span>
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
