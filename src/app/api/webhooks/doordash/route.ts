import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// DoorDash Drive webhooks — confirmed via developer.doordash.com this
// session (see CLAUDE.md "DoorDash Drive"): unlike Stripe, there's no
// HMAC/signature scheme here. DoorDash supports Basic Auth or OAuth for
// webhook endpoints, configured per-developer-account in the DoorDash portal
// (the caller chooses the value DoorDash will send back verbatim in the
// Authorization header — see /admin/[slug]/delivery's webhook setup
// instructions). This app uses one platform-wide value
// (DOORDASH_WEBHOOK_AUTH_TOKEN) that every restaurant's own DoorDash portal
// is configured to send, rather than a per-restaurant secret — simpler, and
// this value only proves "this request really came from DoorDash," it
// doesn't gate access to anything restaurant-specific (that's RLS's job
// everywhere else in this app; this route uses the service-role client since
// a webhook has no Supabase session, same as every other webhook here).
//
// Event → order mapping uses external_delivery_id, which OrderNest itself
// set to the order's own id at dispatch time (see dispatchDeliveryAction in
// src/app/admin/[slug]/actions.ts) — unlike the Stripe Connect webhook (which
// has to look up by external account id because it has no OrderNest id at
// all), this route can match directly.
//
// Event types confirmed: DASHER_CONFIRMED, DASHER_CONFIRMED_PICKUP_ARRIVAL,
// DASHER_PICKED_UP, DASHER_CONFIRMED_DROPOFF_ARRIVAL, DASHER_DROPPED_OFF,
// DELIVERY_CANCELLED, DELIVERY_RETURN_INITIALIZED,
// DASHER_CONFIRMED_RETURN_ARRIVAL, DELIVERY_RETURNED, DELIVERY_BATCHED (plus
// optional dasher_enroute_to_* events). Stored as-received in
// orders.dispatch_status, same "separate field, webhook-synced" pattern as
// refund_status — never mapped into orders.status.

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.DOORDASH_WEBHOOK_AUTH_TOKEN;
  if (!expected) return false;
  const received = request.headers.get("authorization") ?? "";
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { external_delivery_id?: string; event_name?: string; tracking_url?: string; cancellation_reason?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { external_delivery_id: externalDeliveryId, event_name: eventName, tracking_url: trackingUrl } = payload;
  if (!externalDeliveryId || !eventName) {
    return NextResponse.json({ received: true });
  }

  const supabase = createAdminClient();
  const update: Record<string, unknown> = { dispatch_status: eventName };
  if (trackingUrl) update.dispatch_tracking_url = trackingUrl;

  const { error } = await supabase
    .from("orders")
    .update(update)
    .eq("dispatch_external_delivery_id", externalDeliveryId);

  if (error) console.error("DoorDash webhook: failed to update order", externalDeliveryId, error);

  return NextResponse.json({ received: true });
}
