"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MenuCategory, MenuItem, Restaurant } from "@/lib/types";
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
}: {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
  isOpen: boolean;
}) {
  const [cart, setCart] = useState<Cart>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

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

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const key = item.category_id ?? "uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  return (
    <div className="min-h-screen bg-neutral-50 pb-24">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{restaurant.name}</h1>
            {restaurant.description && <p className="text-sm text-neutral-500">{restaurant.description}</p>}
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="relative rounded-full px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: restaurant.brand_color }}
          >
            Cart
            {count > 0 && (
              <span className="ml-2 rounded-full bg-white/25 px-2 py-0.5 text-xs">{count}</span>
            )}
          </button>
        </div>
      </header>

      {!isOpen && (
        <div className="mx-auto max-w-4xl px-6 pt-6">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {restaurant.name} is currently closed — you can browse the menu, but ordering isn&apos;t available right
            now.
          </p>
        </div>
      )}

      <main className="mx-auto max-w-4xl px-6 py-8">
        {categories.length === 0 ? (
          <p className="text-sm text-neutral-500">This restaurant hasn&apos;t added a menu yet.</p>
        ) : (
          categories.map((category) => {
            const categoryItems = itemsByCategory.get(category.id) ?? [];
            if (categoryItems.length === 0) return null;
            return (
              <section key={category.id} className="mb-10">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-neutral-900">
                  {category.icon && <span>{category.icon}</span>}
                  {category.title}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {categoryItems.map((item) => {
                    const qty = cart[item.id] ?? 0;
                    return (
                      <div key={item.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4">
                        {item.emoji && <div className="text-3xl">{item.emoji}</div>}
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
                                className="rounded-full border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 hover:border-neutral-400"
                              >
                                Add
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => addToCart(item.id, -1)}
                                  className="h-7 w-7 rounded-full border border-neutral-300 text-neutral-700 hover:border-neutral-400"
                                >
                                  −
                                </button>
                                <span className="w-4 text-center text-sm">{qty}</span>
                                <button
                                  onClick={() => addToCart(item.id, 1)}
                                  className="h-7 w-7 rounded-full border border-neutral-300 text-neutral-700 hover:border-neutral-400"
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
          })
        )}
      </main>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDrawerOpen(false)}>
          <div className="flex h-full w-full max-w-sm flex-col bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">Your order</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                ✕
              </button>
            </div>

            <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
              {count === 0 ? (
                <p className="text-sm text-neutral-500">Your cart is empty.</p>
              ) : (
                Object.entries(cart).map(([id, qty]) => {
                  const item = itemsById.get(id);
                  if (!item) return null;
                  return (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span>
                        {qty} × {item.name}
                      </span>
                      <span>{money(item.price_cents * qty, restaurant.currency)}</span>
                    </div>
                  );
                })
              )}
            </div>

            {count > 0 && (
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
                  className="mt-4 block rounded-full py-3 text-center text-sm font-medium text-white"
                  style={{ backgroundColor: restaurant.brand_color }}
                >
                  Proceed to checkout
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
