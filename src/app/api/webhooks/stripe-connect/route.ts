import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Separate from /api/webhooks/stripe: Accounts v2 delivers "thin" events
// through a distinct Event Destination/signing-secret mechanism from classic
// v1 webhook events (checkout.session.completed etc.), verified with
// stripe.parseEventNotificationAsync rather than stripe.webhooks.constructEvent.
// See CLAUDE.md's "Stripe Connect" section for why this exists: the
// return-route's synchronous capability check can read a stale status right
// after onboarding, since activation lags the redirect by a couple seconds.
// This event is the durable fix — it fires whenever it actually changes.
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let notification;
  try {
    notification = await stripe.parseEventNotificationAsync(
      rawBody,
      signature!,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Connect webhook signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (notification.type === "v2.core.account[configuration.recipient].capability_status_updated") {
    const accountId = notification.related_object?.id;
    if (accountId) await syncOnboardingStatus(accountId);
  }

  return NextResponse.json({ received: true });
}

async function syncOnboardingStatus(accountId: string) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient"],
  });
  const onboardingComplete =
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("restaurants")
    .update({ stripe_onboarding_complete: onboardingComplete })
    .eq("stripe_account_id", accountId);

  if (error) console.error("Connect webhook: failed to update restaurant", accountId, error);
}
