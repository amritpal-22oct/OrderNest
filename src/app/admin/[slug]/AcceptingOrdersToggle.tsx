"use client";

import { toggleAcceptingOrdersAction } from "./actions";

// Pausing blocks every customer from ordering at all (see accepting_orders
// in schema.sql) — worth a confirm on the way to *pausing* specifically.
// Resuming has no confirm; it's the safe direction.
export function AcceptingOrdersToggle({ slug, acceptingOrders }: { slug: string; acceptingOrders: boolean }) {
  return (
    <form
      action={toggleAcceptingOrdersAction}
      onSubmit={(e) => {
        if (acceptingOrders && !confirm("Pause ordering? Customers won't be able to place any new orders until you resume.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="next" value={(!acceptingOrders).toString()} />
      <button
        type="submit"
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
          acceptingOrders ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50" : "bg-amber-600 text-white hover:bg-amber-700"
        }`}
      >
        {acceptingOrders ? "Pause ordering" : "Resume ordering"}
      </button>
    </form>
  );
}
