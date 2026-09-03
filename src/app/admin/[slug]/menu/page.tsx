import Link from "next/link";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import { money } from "@/lib/format";
import type { MenuCategory, MenuItem } from "@/lib/types";
import {
  addCategoryAction,
  addItemAction,
  deleteCategoryAction,
  deleteItemAction,
  toggleItemAvailabilityAction,
  updateItemAction,
} from "./actions";

export default async function MenuManagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, restaurant } = await requireRestaurantAdmin(slug);

  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from("menu_categories").select("*").eq("restaurant_id", restaurant.id).order("sort_order").returns<MenuCategory[]>(),
    supabase.from("menu_items").select("*").eq("restaurant_id", restaurant.id).order("sort_order").returns<MenuItem[]>(),
  ]);

  const itemsByCategory = new Map<string, MenuItem[]>();
  const uncategorized: MenuItem[] = [];
  for (const item of items ?? []) {
    if (!item.category_id) {
      uncategorized.push(item);
      continue;
    }
    if (!itemsByCategory.has(item.category_id)) itemsByCategory.set(item.category_id, []);
    itemsByCategory.get(item.category_id)!.push(item);
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Menu</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/admin/${slug}/locations`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Locations
            </Link>
            <Link href={`/admin/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-900">
              ← Orders
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {(categories ?? []).map((category) => (
          <section key={category.id} className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                {category.icon && <span>{category.icon}</span>}
                {category.title}
              </h2>
              <form action={deleteCategoryAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="categoryId" value={category.id} />
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  Delete category
                </button>
              </form>
            </div>

            <ul className="mt-4 space-y-2">
              {(itemsByCategory.get(category.id) ?? []).map((item) => (
                <ItemRow key={item.id} item={item} slug={slug} currency={restaurant.currency} categories={categories ?? []} />
              ))}
            </ul>

            <details className="mt-4 rounded-md border border-dashed border-neutral-300 p-3">
              <summary className="cursor-pointer text-sm font-medium text-neutral-700">+ Add item</summary>
              <form action={addItemAction} className="mt-3 space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="restaurantId" value={restaurant.id} />
                <input type="hidden" name="categoryId" value={category.id} />
                <ItemFields />
                <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
                  Add item
                </button>
              </form>
            </details>
          </section>
        ))}

        {uncategorized.length > 0 && (
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-base font-semibold text-neutral-900">Uncategorized</h2>
            <ul className="mt-4 space-y-2">
              {uncategorized.map((item) => (
                <ItemRow key={item.id} item={item} slug={slug} currency={restaurant.currency} categories={categories ?? []} />
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-dashed border-neutral-300 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">Add a category</h2>
          <form action={addCategoryAction} className="mt-3 flex gap-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="restaurantId" value={restaurant.id} />
            <input
              name="icon"
              placeholder="🍰"
              maxLength={4}
              className="w-16 rounded-md border border-neutral-300 px-2 py-2 text-center text-sm"
            />
            <input
              name="title"
              required
              placeholder="Category name"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800">
              Add
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function ItemFields({ item }: { item?: MenuItem }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <input name="name" required defaultValue={item?.name} placeholder="Name" className="col-span-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
      <input name="description" defaultValue={item?.description ?? ""} placeholder="Description (optional)" className="col-span-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
      <input name="price" required type="number" step="0.01" min="0" defaultValue={item ? (item.price_cents / 100).toFixed(2) : ""} placeholder="Price" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
      <input name="emoji" defaultValue={item?.emoji ?? ""} placeholder="Emoji" maxLength={4} className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
      <input name="unit" defaultValue={item?.unit ?? ""} placeholder="Unit (e.g. 1 kg, 1 pc)" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
      <input name="tags" defaultValue={item?.tags?.join(", ") ?? ""} placeholder="Tags (comma separated)" className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
    </div>
  );
}

function ItemRow({
  item,
  slug,
  currency,
  categories,
}: {
  item: MenuItem;
  slug: string;
  currency: string;
  categories: MenuCategory[];
}) {
  return (
    <li className="rounded-md border border-neutral-100 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {item.emoji && <span>{item.emoji}</span>}
          <span className={item.is_available ? "text-neutral-900" : "text-neutral-400 line-through"}>{item.name}</span>
          <span className="text-neutral-500">{money(item.price_cents, currency)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <form action={toggleItemAvailabilityAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="isAvailable" value={String(item.is_available)} />
            <button type="submit" className="text-neutral-500 hover:underline">
              {item.is_available ? "Mark unavailable" : "Mark available"}
            </button>
          </form>
          <form action={deleteItemAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit" className="text-red-600 hover:underline">
              Delete
            </button>
          </form>
        </div>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-neutral-500">Edit</summary>
        <form action={updateItemAction} className="mt-2 space-y-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="itemId" value={item.id} />
          <ItemFields item={item} />
          <select name="categoryId" defaultValue={item.category_id ?? ""} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm">
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
            Save
          </button>
        </form>
      </details>
    </li>
  );
}
