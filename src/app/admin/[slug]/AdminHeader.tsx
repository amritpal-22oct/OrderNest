import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import { openStripeDashboardAction, signOutAction } from "./actions";
import { AcceptingOrdersToggle } from "./AcceptingOrdersToggle";
import { BagIcon, CardIcon, ClockIcon, HomeIcon, LogoutIcon, PinIcon, TagIcon, TruckIcon } from "./icons";

type NavKey = "orders" | "menu" | "locations" | "hours" | "promo" | "delivery";

const NAV_ITEMS: { key: NavKey; label: string; path: string; Icon: typeof HomeIcon }[] = [
  { key: "orders", label: "Orders", path: "", Icon: HomeIcon },
  { key: "menu", label: "Menu", path: "/menu", Icon: BagIcon },
  { key: "locations", label: "Locations", path: "/locations", Icon: PinIcon },
  { key: "hours", label: "Hours", path: "/hours", Icon: ClockIcon },
  { key: "promo", label: "Promo codes", path: "/promo", Icon: TagIcon },
  { key: "delivery", label: "Delivery", path: "/delivery", Icon: TruckIcon },
];

// Shared shell for every /admin/[slug]/* page — was previously duplicated
// (and drifting: each sub-page had its own plain-text nav with a different
// link set and no icons/status pill/action buttons) across page.tsx, menu,
// locations, hours, promo, and delivery. One component now, so the header
// stays identical everywhere instead of only existing on the Orders page.
export function AdminHeader({
  slug,
  restaurant,
  userEmail,
  role,
  active,
}: {
  slug: string;
  restaurant: Pick<Restaurant, "name" | "logo_url" | "brand_color" | "accepting_orders" | "stripe_onboarding_complete">;
  userEmail: string;
  role: string;
  active: NavKey;
}) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {restaurant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={restaurant.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-full border border-neutral-200 object-cover" />
            ) : (
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
                style={{ backgroundColor: restaurant.brand_color || "#171717" }}
              >
                {restaurant.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
              <p className="text-sm text-neutral-500">Orders · signed in as {userEmail}</p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              restaurant.accepting_orders ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-500"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${restaurant.accepting_orders ? "bg-green-500" : "bg-neutral-400"}`} />
            {restaurant.accepting_orders ? "Ordering is active" : "Ordering paused"}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap items-center gap-1 rounded-lg bg-neutral-100 p-1 text-sm">
            {NAV_ITEMS.map(({ key, label, path, Icon }) => (
              <Link
                key={key}
                href={`/admin/${slug}${path}`}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  key === active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            {role === "owner" && restaurant.stripe_onboarding_complete && (
              <form action={openStripeDashboardAction}>
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900">
                  <CardIcon className="h-4 w-4" />
                  Stripe Dashboard
                </button>
              </form>
            )}
            <AcceptingOrdersToggle slug={slug} acceptingOrders={restaurant.accepting_orders} />
            <form action={signOutAction}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                <LogoutIcon className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
