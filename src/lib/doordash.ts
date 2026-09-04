import jwt from "jsonwebtoken";
import type { JwtHeader } from "jsonwebtoken";
import type { RestaurantDeliveryAccount } from "@/lib/types";

// DoorDash Drive API client — bring-your-own-account (see CLAUDE.md
// "DoorDash Drive" section). Every call below authenticates with the
// *restaurant's own* DoorDash Drive credentials (RestaurantDeliveryAccount),
// never a platform-wide one — DoorDash bills whoever's credentials placed the
// request, so this keeps OrderNest out of the flow of funds for delivery,
// the same way direct-charge Stripe Checkout keeps it out for food.
//
// Confirmed against developer.doordash.com this session (not assumed from
// training data, same discipline this codebase already applies to Stripe):
// - JWT format: header {alg: "HS256", typ: "JWT", "dd-ver": "DD-JWT-V1"},
//   payload {aud: "doordash", iss: developer_id, kid: key_id, iat, exp}, HS256
//   over a base64url-decoded signing_secret (NOT the raw secret string —
//   confirmed via DoorDash's own Node.js sample code). Sent as
//   `Authorization: Bearer <jwt>`. Max token lifetime is 1800s; a fresh token
//   is generated per request here, so a short 300s expiry is plenty.
// - Base URL: https://openapi.doordash.com
// - POST /drive/v2/quotes — pricing-only, no commitment; response includes
//   `fee` (cents) and `currency`.
// - POST /drive/v2/deliveries — creates and dispatches a real delivery;
//   requires `external_delivery_id`, pickup/dropoff address fields.
// - GET /drive/v2/deliveries/{external_delivery_id} — delivery status lookup.
// What was NOT independently verified against a live sandbox call this
// session: the exact optional field names beyond what's listed above (e.g.
// dropoff_instructions, order_value) — these are the commonly-documented
// names but worth a real test call before relying on them for anything
// beyond what this module already sends.

const DOORDASH_API_BASE = "https://openapi.doordash.com";

type Credentials = Pick<RestaurantDeliveryAccount, "developer_id" | "key_id" | "signing_secret">;

type PickupInfo = Pick<
  RestaurantDeliveryAccount,
  | "pickup_business_name"
  | "pickup_phone"
  | "pickup_address_line1"
  | "pickup_address_line2"
  | "pickup_city"
  | "pickup_province"
  | "pickup_postal_code"
  | "pickup_country"
>;

export type DeliveryAccount = Credentials & PickupInfo;

function createDoorDashJWT(account: Credentials): string {
  const secretKey = Buffer.from(account.signing_secret, "base64url");
  return jwt.sign(
    {
      aud: "doordash",
      iss: account.developer_id,
      kid: account.key_id,
    },
    secretKey,
    {
      algorithm: "HS256",
      header: { alg: "HS256", typ: "JWT", "dd-ver": "DD-JWT-V1" } as JwtHeader,
      expiresIn: 300,
    }
  );
}

function pickupAddressLine(account: PickupInfo): string {
  return [
    account.pickup_address_line1,
    account.pickup_address_line2,
    account.pickup_city,
    account.pickup_province,
    account.pickup_postal_code,
    account.pickup_country,
  ]
    .filter(Boolean)
    .join(", ");
}

function dropoffAddressLine(dropoff: { address1: string; city: string; province: string; postal: string }): string {
  return [dropoff.address1, dropoff.city, dropoff.province, dropoff.postal].filter(Boolean).join(", ");
}

async function doordashRequest(account: Credentials, path: string, body: Record<string, unknown>) {
  const token = createDoorDashJWT(account);
  const res = await fetch(`${DOORDASH_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DoorDash Drive API error (${res.status}): ${text}`);
  }
  return res.json();
}

export type DeliveryQuote = { feeCents: number; currency: string };

// Pricing-only — never Accepted, no commitment made to DoorDash. Used at
// checkout-price-computation time (see src/lib/cart-pricing.ts). Any failure
// (network error, address outside DoorDash's coverage) is expected to be
// caught by the caller and treated as "no live quote available," not a hard
// checkout error.
export async function getDeliveryQuote(
  account: DeliveryAccount,
  dropoffAddress: { address1: string; city: string; province: string; postal: string }
): Promise<DeliveryQuote> {
  const data = await doordashRequest(account, "/drive/v2/quotes", {
    pickup_address: pickupAddressLine(account),
    pickup_business_name: account.pickup_business_name,
    pickup_phone_number: account.pickup_phone,
    dropoff_address: dropoffAddressLine(dropoffAddress),
  });
  return { feeCents: data.fee, currency: data.currency };
}

export type CreatedDelivery = {
  externalDeliveryId: string;
  status: string;
  trackingUrl: string | null;
  feeCents: number | null;
};

// Called manually (see DispatchDeliveryButton / dispatchDeliveryAction), well
// after checkout/payment — always gets a fresh price rather than trying to
// reuse or track an earlier quote's ~5-minute validity window; the gap
// between what the customer was quoted at checkout and what DoorDash
// actually charges here is the restaurant's own risk (see CLAUDE.md).
export async function createDelivery(
  account: DeliveryAccount,
  externalDeliveryId: string,
  dropoff: { address1: string; city: string; province: string; postal: string; instructions?: string | null },
  dropoffName: string,
  dropoffPhone: string,
  orderValueCents: number
): Promise<CreatedDelivery> {
  const data = await doordashRequest(account, "/drive/v2/deliveries", {
    external_delivery_id: externalDeliveryId,
    pickup_address: pickupAddressLine(account),
    pickup_business_name: account.pickup_business_name,
    pickup_phone_number: account.pickup_phone,
    dropoff_address: dropoffAddressLine(dropoff),
    dropoff_business_name: dropoffName,
    dropoff_phone_number: dropoffPhone,
    dropoff_instructions: dropoff.instructions || undefined,
    order_value: orderValueCents,
  });
  return {
    externalDeliveryId: data.external_delivery_id ?? externalDeliveryId,
    status: data.delivery_status ?? "created",
    trackingUrl: data.tracking_url ?? null,
    feeCents: typeof data.fee === "number" ? data.fee : null,
  };
}

// Optional manual-refresh helper — not on the critical path of any flow
// wired up yet, kept for a future "refresh status" admin action.
export async function getDelivery(account: Credentials, externalDeliveryId: string): Promise<CreatedDelivery> {
  const token = createDoorDashJWT(account);
  const res = await fetch(`${DOORDASH_API_BASE}/drive/v2/deliveries/${encodeURIComponent(externalDeliveryId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DoorDash Drive API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  return {
    externalDeliveryId: data.external_delivery_id ?? externalDeliveryId,
    status: data.delivery_status ?? "unknown",
    trackingUrl: data.tracking_url ?? null,
    feeCents: typeof data.fee === "number" ? data.fee : null,
  };
}
