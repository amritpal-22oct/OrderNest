"use client";

import { cancelAndRefundOrderAction } from "./actions";

// A real Stripe refund fires on submit — worth one native confirm() rather
// than a silent one-click action, same bar as any other irreversible action
// in this app. Kept as its own tiny Client Component since the rest of the
// orders page is a Server Component and this is the only spot that needs
// interactivity before submit.
export function CancelOrderButton({ slug, orderId }: { slug: string; orderId: string }) {
  return (
    <form
      action={cancelAndRefundOrderAction}
      onSubmit={(e) => {
        if (!confirm("Cancel this order and refund the customer in full? This can't be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" className="rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50">
        Cancel &amp; refund
      </button>
    </form>
  );
}
