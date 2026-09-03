import Link from "next/link";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import type { RestaurantHours } from "@/lib/types";
import { saveHoursAction } from "./actions";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function HoursManagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, restaurant } = await requireRestaurantAdmin(slug);

  const { data: hours } = await supabase
    .from("restaurant_hours")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .returns<RestaurantHours[]>();

  const hoursByDay = new Map((hours ?? []).map((h) => [h.day_of_week, h]));
  const hasAnyHours = (hours ?? []).length > 0;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Hours</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/admin/${slug}/menu`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Menu
            </Link>
            <Link href={`/admin/${slug}/locations`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Locations
            </Link>
            <Link href={`/admin/${slug}/promo`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Promo codes
            </Link>
            <Link href={`/admin/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-900">
              ← Orders
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
        {!hasAnyHours && (
          <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
            No hours configured yet — orders are accepted at any time. Set hours below and save to start
            enforcing them.
          </p>
        )}

        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <form action={saveHoursAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="restaurantId" value={restaurant.id} />

            <div>
              <label className="block text-sm font-medium text-neutral-700">Timezone</label>
              <input
                name="timezone"
                defaultValue={restaurant.timezone}
                placeholder="America/Toronto"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-neutral-400">An IANA timezone name, e.g. America/Toronto.</p>
            </div>

            <div className="space-y-2">
              {DAY_LABELS.map((label, day) => {
                const row = hoursByDay.get(day);
                return (
                  <div key={day} className="grid grid-cols-[100px_auto_1fr_1fr] items-center gap-2 text-sm">
                    <span className="text-neutral-700">{label}</span>
                    <label className="flex items-center gap-1.5 text-neutral-600">
                      <input type="checkbox" name={`closed_${day}`} defaultChecked={row?.is_closed ?? false} />
                      Closed
                    </label>
                    <input
                      type="time"
                      name={`open_${day}`}
                      defaultValue={row?.open_time?.slice(0, 5) ?? ""}
                      className="rounded-md border border-neutral-300 px-2 py-1.5"
                    />
                    <input
                      type="time"
                      name={`close_${day}`}
                      defaultValue={row?.close_time?.slice(0, 5) ?? ""}
                      className="rounded-md border border-neutral-300 px-2 py-1.5"
                    />
                  </div>
                );
              })}
            </div>

            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800">
              Save hours
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
