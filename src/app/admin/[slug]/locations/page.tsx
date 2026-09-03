import Link from "next/link";
import { requireRestaurantAdmin } from "@/lib/restaurant";
import type { RestaurantLocation } from "@/lib/types";
import {
  addLocationAction,
  deleteLocationAction,
  toggleLocationActiveAction,
  updateDeliveryRadiusAction,
  updateLocationAction,
} from "./actions";

export default async function LocationsManagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, restaurant } = await requireRestaurantAdmin(slug);

  const { data: locations } = await supabase
    .from("restaurant_locations")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .order("sort_order")
    .order("created_at")
    .returns<RestaurantLocation[]>();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
            <p className="text-sm text-neutral-500">Locations</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/admin/${slug}/menu`} className="text-sm text-neutral-500 hover:text-neutral-900">
              Menu
            </Link>
            <Link href={`/admin/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-900">
              ← Orders
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">Delivery radius</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Applies to every location below. Leave blank for unlimited delivery range.
          </p>
          <form action={updateDeliveryRadiusAction} className="mt-3 flex items-center gap-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="restaurantId" value={restaurant.id} />
            <input
              name="deliveryRadiusKm"
              type="number"
              step="0.1"
              min="0"
              defaultValue={restaurant.delivery_radius_km ?? ""}
              placeholder="km"
              className="w-24 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
              Save
            </button>
          </form>
        </section>

        {(locations ?? []).map((location) => (
          <LocationRow key={location.id} location={location} slug={slug} />
        ))}

        <section className="rounded-xl border border-dashed border-neutral-300 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">Add a location</h2>
          <form action={addLocationAction} className="mt-3 space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="restaurantId" value={restaurant.id} />
            <LocationFields />
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
              Add location
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function LocationFields({ location }: { location?: RestaurantLocation }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <input
        name="name"
        required
        defaultValue={location?.name}
        placeholder="Location name (e.g. Downtown)"
        className="col-span-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        name="addressLine1"
        required
        defaultValue={location?.address_line1}
        placeholder="Address line 1"
        className="col-span-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        name="addressLine2"
        defaultValue={location?.address_line2 ?? ""}
        placeholder="Address line 2 (optional)"
        className="col-span-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        name="city"
        required
        defaultValue={location?.city}
        placeholder="City"
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        name="province"
        required
        defaultValue={location?.province}
        placeholder="Province"
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        name="postalCode"
        required
        defaultValue={location?.postal_code}
        placeholder="Postal code"
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        name="country"
        defaultValue={location?.country ?? "CA"}
        placeholder="Country"
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <label className="col-span-2 flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="supportsDelivery" defaultChecked={location?.supports_delivery ?? true} />
        Supports delivery
      </label>
      <label className="col-span-2 flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="supportsPickup" defaultChecked={location?.supports_pickup ?? true} />
        Supports pickup
      </label>
      <details className="col-span-2">
        <summary className="cursor-pointer text-xs text-neutral-500">
          Manual coordinates (optional — leave blank to geocode the address automatically)
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            name="lat"
            type="number"
            step="any"
            defaultValue={location?.lat}
            placeholder="Latitude"
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            name="lng"
            type="number"
            step="any"
            defaultValue={location?.lng}
            placeholder="Longitude"
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
      </details>
    </div>
  );
}

function LocationRow({ location, slug }: { location: RestaurantLocation; slug: string }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={location.is_active ? "font-semibold text-neutral-900" : "font-semibold text-neutral-400 line-through"}>
            {location.name}
          </p>
          <p className="text-sm text-neutral-500">
            {location.address_line1}, {location.city}, {location.province} {location.postal_code}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <form action={toggleLocationActiveAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <input type="hidden" name="isActive" value={String(location.is_active)} />
            <button type="submit" className="text-neutral-500 hover:underline">
              {location.is_active ? "Deactivate" : "Activate"}
            </button>
          </form>
          <form action={deleteLocationAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <button type="submit" className="text-red-600 hover:underline">
              Delete
            </button>
          </form>
        </div>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-neutral-500">Edit</summary>
        <form action={updateLocationAction} className="mt-2 space-y-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="locationId" value={location.id} />
          <LocationFields location={location} />
          <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
            Save
          </button>
        </form>
      </details>
    </section>
  );
}
