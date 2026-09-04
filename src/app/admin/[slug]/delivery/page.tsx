import { requireRestaurantAdmin } from "@/lib/restaurant";
import { siteOrigin } from "../actions";
import type { RestaurantDeliveryAccount, RestaurantLocation } from "@/lib/types";
import { AdminHeader } from "../AdminHeader";
import { saveDeliveryAccountAction, deactivateDeliveryAccountAction } from "./actions";

export default async function DeliveryManagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, restaurant, user, role } = await requireRestaurantAdmin(slug);

  const [{ data: account }, { data: firstLocation }] = await Promise.all([
    supabase
      .from("restaurant_delivery_accounts")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("provider", "doordash")
      .maybeSingle<RestaurantDeliveryAccount>(),
    supabase
      .from("restaurant_locations")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at")
      .limit(1)
      .maybeSingle<RestaurantLocation>(),
  ]);

  const origin = await siteOrigin();
  const webhookUrl = `${origin}/api/webhooks/doordash`;

  return (
    <div className="min-h-screen bg-neutral-50">
      <AdminHeader slug={slug} restaurant={restaurant} userEmail={user.email ?? ""} role={role} active="delivery" />

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-medium text-neutral-700">DoorDash Drive</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Lets you offer delivery through DoorDash&apos;s courier network even if you don&apos;t have your own
            drivers. You bring your own DoorDash Drive developer account — DoorDash bills your account directly for
            each delivery, the same way Stripe pays your restaurant directly for orders. OrderNest never touches
            delivery money.
          </p>

          {role !== "owner" ? (
            <p className="mt-4 text-sm text-neutral-500">
              {account
                ? "DoorDash Drive is connected for this restaurant."
                : "Ask the owner to connect a DoorDash Drive account."}
            </p>
          ) : (
            <>
              {account && (
                <div className="mt-4 flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                  <span className={account.is_active ? "text-green-700" : "text-neutral-500"}>
                    {account.is_active ? "Connected and active" : "Connected but deactivated"}
                  </span>
                  {account.is_active && (
                    <form action={deactivateDeliveryAccountAction}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="accountId" value={account.id} />
                      <button type="submit" className="text-red-600 hover:underline">
                        Deactivate
                      </button>
                    </form>
                  )}
                </div>
              )}

              <form action={saveDeliveryAccountAction} className="mt-4 space-y-4">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="restaurantId" value={restaurant.id} />

                <div className="space-y-2">
                  <p className="text-xs font-medium text-neutral-500">
                    From your DoorDash Developer Portal → Credentials
                  </p>
                  <input
                    name="developerId"
                    required
                    defaultValue={account?.developer_id}
                    placeholder="Developer ID"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    name="keyId"
                    required
                    defaultValue={account?.key_id}
                    placeholder="Key ID"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    name="signingSecret"
                    type="password"
                    required={!account}
                    placeholder={account ? "Signing secret (leave blank to keep current)" : "Signing secret"}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-neutral-500">
                    Pickup address — where DoorDash sends a Dasher to collect orders
                    {firstLocation && !account && " (prefilled from your first location)"}
                  </p>
                  <input
                    name="pickupBusinessName"
                    required
                    defaultValue={account?.pickup_business_name ?? firstLocation?.name ?? restaurant.name}
                    placeholder="Business name"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    name="pickupPhone"
                    required
                    defaultValue={account?.pickup_phone ?? restaurant.phone ?? ""}
                    placeholder="Pickup phone number"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    name="pickupAddressLine1"
                    required
                    defaultValue={account?.pickup_address_line1 ?? firstLocation?.address_line1}
                    placeholder="Address line 1"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    name="pickupAddressLine2"
                    defaultValue={account?.pickup_address_line2 ?? firstLocation?.address_line2 ?? ""}
                    placeholder="Address line 2 (optional)"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="pickupCity"
                      required
                      defaultValue={account?.pickup_city ?? firstLocation?.city}
                      placeholder="City"
                      className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      name="pickupProvince"
                      required
                      defaultValue={account?.pickup_province ?? firstLocation?.province}
                      placeholder="Province"
                      className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      name="pickupPostalCode"
                      required
                      defaultValue={account?.pickup_postal_code ?? firstLocation?.postal_code}
                      placeholder="Postal code"
                      className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      name="pickupCountry"
                      defaultValue={account?.pickup_country ?? firstLocation?.country ?? "CA"}
                      placeholder="Country"
                      className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>

                <button type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800">
                  {account ? "Save changes" : "Connect DoorDash Drive"}
                </button>
              </form>
            </>
          )}
        </section>

        {role === "owner" && (
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-medium text-neutral-700">Webhook setup (one-time, in DoorDash&apos;s dashboard)</h2>
            <p className="mt-1 text-xs text-neutral-500">
              So delivery status updates (picked up, dropped off, etc.) show up on your orders page. In your DoorDash
              Developer Portal, under Webhooks, add an endpoint with these values:
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-neutral-500">Endpoint URL</dt>
                <dd className="font-mono text-neutral-900">{webhookUrl}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Authorization header value</dt>
                <dd className="font-mono text-neutral-900">{process.env.DOORDASH_WEBHOOK_AUTH_TOKEN ?? "(not configured on the server yet)"}</dd>
              </div>
            </dl>
          </section>
        )}
      </main>
    </div>
  );
}
