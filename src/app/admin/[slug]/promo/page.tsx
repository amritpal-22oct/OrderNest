import Link from "next/link";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import { money } from "@/lib/format";
import type { PromoCode } from "@/lib/types";
import { addPromoAction, deletePromoAction, togglePromoActiveAction } from "./actions";

export default async function PromoManagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, restaurant } = await requireRestaurantAdmin(slug);

  const { data: promoCodes } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: false })
    .returns<PromoCode[]>();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Promo codes</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/admin/${slug}/menu`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Menu
            </Link>
            <Link href={`/admin/${slug}/hours`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Hours
            </Link>
            <Link href={`/admin/${slug}/locations`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Locations
            </Link>
            <Link href={`/admin/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-900">
              ← Orders
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="font-medium text-neutral-900">Codes</h2>
          {!promoCodes || promoCodes.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No promo codes yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {promoCodes.map((promo) => (
                <li key={promo.id} className="rounded-md border border-neutral-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <span className={`font-mono font-medium ${promo.is_active ? "text-neutral-900" : "text-neutral-400 line-through"}`}>
                        {promo.code}
                      </span>
                      <span className="ml-2 text-neutral-500">
                        {promo.discount_type === "percent" ? `${promo.discount_value}% off` : `${money(promo.discount_value, restaurant.currency)} off`}
                      </span>
                      <span className="ml-2 text-neutral-400">
                        · {promo.uses_count} used{promo.max_uses != null ? ` / ${promo.max_uses}` : ""}
                        {promo.expires_at ? ` · expires ${new Date(promo.expires_at).toLocaleDateString()}` : ""}
                        {promo.min_subtotal_cents > 0 ? ` · min ${money(promo.min_subtotal_cents, restaurant.currency)}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <form action={togglePromoActiveAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="promoId" value={promo.id} />
                        <input type="hidden" name="isActive" value={String(promo.is_active)} />
                        <button type="submit" className="text-neutral-500 hover:underline">
                          {promo.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                      <form action={deletePromoAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="promoId" value={promo.id} />
                        <button type="submit" className="text-red-600 hover:underline">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-dashed border-neutral-300 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">Add a code</h2>
          <form action={addPromoAction} className="mt-3 space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="restaurantId" value={restaurant.id} />
            <div className="grid grid-cols-2 gap-2">
              <input
                name="code"
                required
                placeholder="CODE"
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm uppercase"
              />
              <select name="discountType" defaultValue="percent" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
                <option value="percent">% off</option>
                <option value="fixed">$ off</option>
              </select>
              <input
                name="discountValue"
                required
                type="number"
                step="0.01"
                min="0"
                placeholder="Discount value"
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <input
                name="minSubtotal"
                type="number"
                step="0.01"
                min="0"
                placeholder="Minimum order (optional)"
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <input
                name="maxUses"
                type="number"
                min="1"
                placeholder="Max uses (optional)"
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
              <input name="expiresAt" type="date" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
              Add code
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
