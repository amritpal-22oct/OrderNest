"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MenuCategory, MenuItem, Restaurant } from "@/lib/types";
import type { ActivePromoSummary } from "@/lib/promo";
import { money } from "@/lib/format";

type Cart = Record<string, number>;

function cartKey(slug: string) {
  return `ordernest_cart_${slug}`;
}

function loadCart(slug: string): Cart {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(cartKey(slug)) ?? "{}");
  } catch {
    return {};
  }
}

export function RestaurantMenu({
  restaurant,
  categories,
  items,
  isOpen,
  hoursLabel,
  locationSummary,
  activePromos,
}: {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
  isOpen: boolean;
  hoursLabel?: string | null;
  locationSummary?: string | null;
  activePromos?: ActivePromoSummary[];
}) {
  const [cart, setCart] = useState<Cart>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");

  // Cart lives in localStorage per-restaurant so it survives a refresh but
  // never leaks between tenants. Read only after mount to avoid SSR/client
  // markup mismatches (localStorage doesn't exist on the server).
  useEffect(() => {
    setCart(loadCart(restaurant.slug));
    setHydrated(true);
  }, [restaurant.slug]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(cartKey(restaurant.slug), JSON.stringify(cart));
  }, [cart, hydrated, restaurant.slug]);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const { subtotalCents, deliveryFeeCents, taxCents, totalCents, count } = useMemo(() => {
    let subtotal = 0;
    let count = 0;
    for (const [id, qty] of Object.entries(cart)) {
      const item = itemsById.get(id);
      if (item) {
        subtotal += item.price_cents * qty;
        count += qty;
      }
    }
    const freeThreshold = restaurant.free_delivery_threshold_cents;
    const deliveryFee = subtotal === 0 || (freeThreshold !== null && subtotal >= freeThreshold) ? 0 : restaurant.delivery_fee_cents;
    const tax = Math.round(subtotal * Number(restaurant.tax_rate));
    return { subtotalCents: subtotal, deliveryFeeCents: deliveryFee, taxCents: tax, totalCents: subtotal + deliveryFee + tax, count };
  }, [cart, itemsById, restaurant]);

  function addToCart(id: string, delta: number) {
    setCart((prev) => {
      const next = { ...prev };
      const qty = Math.max(0, (next[id] ?? 0) + delta);
      if (qty === 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) => item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q),
    );
  }, [items, search]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of filteredItems) {
      const key = item.category_id ?? "uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [filteredItems]);

  const noSearchResults = search.trim().length > 0 && filteredItems.length === 0;

  const cartItemRows = (
    <div className="space-y-3">
      {count === 0 ? (
        <p className="text-sm text-neutral-500">Your cart is empty.</p>
      ) : (
        Object.entries(cart).map(([id, qty]) => {
          const item = itemsById.get(id);
          if (!item) return null;
          return (
            <div key={id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900">{item.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    onClick={() => addToCart(item.id, -1)}
                    className="h-6 w-6 rounded-full border border-neutral-300 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-xs text-neutral-600">{qty}</span>
                  <button
                    onClick={() => addToCart(item.id, 1)}
                    className="h-6 w-6 rounded-full border border-neutral-300 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
                  >
                    +
                  </button>
                </div>
              </div>
              <span className="shrink-0 font-medium text-neutral-700">{money(item.price_cents * qty, restaurant.currency)}</span>
            </div>
          );
        })
      )}
    </div>
  );

  const cartTotals = count > 0 && (
    <div className="mt-4 space-y-1 border-t border-neutral-200 pt-4 text-sm">
      <div className="flex justify-between text-neutral-600">
        <span>Subtotal</span>
        <span>{money(subtotalCents, restaurant.currency)}</span>
      </div>
      <div className="flex justify-between text-neutral-600">
        <span>Delivery</span>
        <span>{deliveryFeeCents === 0 ? "FREE" : money(deliveryFeeCents, restaurant.currency)}</span>
      </div>
      <div className="flex justify-between text-neutral-600">
        <span>Tax</span>
        <span>{money(taxCents, restaurant.currency)}</span>
      </div>
      <div className="flex justify-between pt-1 text-base font-semibold text-neutral-900">
        <span>Total</span>
        <span>{money(totalCents, restaurant.currency)}</span>
      </div>

      <Link
        href={`/r/${restaurant.slug}/checkout`}
        className="mt-4 block rounded-full py-3 text-center text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: restaurant.brand_color }}
      >
        Proceed to checkout
      </Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-50 pb-24">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <Link href={`/r/${restaurant.slug}`} className="text-xs font-medium text-neutral-400 hover:text-neutral-600">
              ← Home
            </Link>
            <h1 className="text-xl font-semibold text-neutral-900">{restaurant.name}</h1>
            {restaurant.description && <p className="text-sm text-neutral-500">{restaurant.description}</p>}
            {(hoursLabel || locationSummary) && (
              <p className="mt-1 text-xs text-neutral-400">
                {hoursLabel}
                {hoursLabel && locationSummary && " · "}
                {locationSummary}
              </p>
            )}
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="relative rounded-full px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 lg:hidden"
            style={{ backgroundColor: restaurant.brand_color }}
          >
            Cart
            {count > 0 && (
              <span className="ml-2 rounded-full bg-white/25 px-2 py-0.5 text-xs">{count}</span>
            )}
          </button>
        </div>
      </header>

      {!restaurant.accepting_orders ? (
        <div className="mx-auto max-w-7xl px-6 pt-6">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {restaurant.name} isn&apos;t taking orders right now — you can browse the menu, but ordering is
            temporarily paused.
          </p>
        </div>
      ) : (
        !isOpen && (
          <div className="mx-auto max-w-7xl px-6 pt-6">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {restaurant.name} is currently closed — you can browse the menu, but ordering isn&apos;t available
              right now.
            </p>
          </div>
        )
      )}

      {activePromos && activePromos.length > 0 && (
        <div className="mx-auto max-w-7xl px-6 pt-6">
          <div className="flex items-center gap-4 rounded-xl bg-green-50 px-5 py-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-2xl">🎉</div>
            <div className="space-y-0.5">
              {activePromos.map((promo) => (
                <p key={promo.code} className="text-sm text-green-800">
                  <span className="text-base font-semibold text-green-900">
                    {promo.discount_type === "percent" ? `${promo.discount_value}% off` : `${money(promo.discount_value, restaurant.currency)} off`}
                  </span>{" "}
                  with code <span className="font-mono font-semibold">{promo.code}</span>
                  {promo.min_subtotal_cents > 0 ? ` on orders over ${money(promo.min_subtotal_cents, restaurant.currency)}` : ""}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-8">
        {categories.length > 0 && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="mb-6 w-full rounded-full border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none"
          />
        )}

        {categories.length === 0 ? (
          <p className="text-sm text-neutral-500">This restaurant hasn&apos;t added a menu yet.</p>
        ) : noSearchResults ? (
          <p className="text-sm text-neutral-500">No items match &quot;{search}&quot;.</p>
        ) : (
          <div className="flex items-start gap-8">
            {/* Hidden while searching — simpler and more honest than keeping it
                in sync with filtered-out categories. No scroll-spy active-state
                yet (would need an IntersectionObserver), out of scope for now. */}
            {!search.trim() && (
              <aside className="hidden w-48 shrink-0 md:block">
                <nav className="sticky top-6 space-y-1 text-sm">
                  {categories.map((category) => {
                    const categoryItems = itemsByCategory.get(category.id) ?? [];
                    if (categoryItems.length === 0) return null;
                    return (
                      <a
                        key={category.id}
                        href={`#cat-${category.id}`}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {category.icon && <span>{category.icon}</span>}
                          {category.title}
                        </span>
                        <span className="text-xs text-neutral-400">{categoryItems.length}</span>
                      </a>
                    );
                  })}
                </nav>
              </aside>
            )}

            <div className="min-w-0 flex-1">
              {categories.map((category) => {
                const categoryItems = itemsByCategory.get(category.id) ?? [];
                if (categoryItems.length === 0) return null;
                return (
                  <section key={category.id} id={`cat-${category.id}`} className="mb-10 scroll-mt-24">
                    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-neutral-900">
                      {category.icon && <span>{category.icon}</span>}
                      {category.title}
                    </h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {categoryItems.map((item) => {
                        const qty = cart[item.id] ?? 0;
                        return (
                          <div
                            key={item.id}
                            className="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
                          >
                            {item.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.image_url}
                                alt={item.name}
                                className="h-14 w-14 shrink-0 rounded-lg object-cover transition-transform duration-150 group-hover:scale-105"
                              />
                            ) : (
                              item.emoji && (
                                <div className="text-3xl transition-transform duration-150 group-hover:scale-110">{item.emoji}</div>
                              )
                            )}
                            <div className="flex-1">
                              <p className="font-medium text-neutral-900">{item.name}</p>
                              {item.description && <p className="mt-0.5 text-sm text-neutral-500">{item.description}</p>}
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-sm font-medium text-neutral-700">
                                  {money(item.price_cents, restaurant.currency)}
                                  {item.unit && <span className="text-neutral-400"> · {item.unit}</span>}
                                </span>
                                {qty === 0 ? (
                                  <button
                                    onClick={() => addToCart(item.id, 1)}
                                    className="rounded-full border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
                                  >
                                    Add
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => addToCart(item.id, -1)}
                                      className="h-7 w-7 rounded-full border border-neutral-300 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
                                    >
                                      −
                                    </button>
                                    <span className="w-4 text-center text-sm">{qty}</span>
                                    <button
                                      onClick={() => addToCart(item.id, 1)}
                                      className="h-7 w-7 rounded-full border border-neutral-300 text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* Persistent cart panel, always visible on wide screens — no
                click-to-open drawer needed there. Below lg, the header's
                Cart button + slide-over drawer (below) is used instead,
                since there isn't room for a third column. */}
            <aside className="sticky top-6 hidden w-80 shrink-0 lg:block">
              <div className="rounded-xl border border-neutral-200 bg-white p-5">
                <h2 className="text-base font-semibold text-neutral-900">Your order</h2>
                <div className="mt-4">{cartItemRows}</div>
                {cartTotals}
              </div>
            </aside>
          </div>
        )}
      </main>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="flex h-full w-full max-w-sm flex-col bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">Your order</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                ✕
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto">{cartItemRows}</div>

            {cartTotals}
          </div>
        </div>
      )}
    </div>
  );
}
