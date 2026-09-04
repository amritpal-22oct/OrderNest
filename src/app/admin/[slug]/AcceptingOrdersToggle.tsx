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
        className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
          acceptingOrders
            ? "border-red-300 text-red-600 hover:bg-red-50"
            : "border-transparent bg-green-600 text-white hover:bg-green-700"
        }`}
      >
        {acceptingOrders ? "Pause ordering" : "Resume ordering"}
      </button>
    </form>
  );
}
