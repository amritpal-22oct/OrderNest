"use client";

import { dispatchDeliveryAction } from "./actions";

// DoorDash bills the restaurant's card immediately on dispatch — same
// money-adjacent, irreversible-in-practice bar as CancelOrderButton's refund,
// so it gets the same native confirm() rather than a silent one-click action.
export function DispatchDeliveryButton({ slug, orderId }: { slug: string; orderId: string }) {
  return (
    <form
      action={dispatchDeliveryAction}
      onSubmit={(e) => {
        if (!confirm("Dispatch a DoorDash courier for this order? DoorDash will bill your account for the delivery.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
        Dispatch to DoorDash
      </button>
    </form>
  );
}
