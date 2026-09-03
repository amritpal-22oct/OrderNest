import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { requireRestaurantAdmin } from "@/lib/restaurant";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Stripe sends the admin back here after hosted onboarding — whether or not
// they actually finished. Re-check the account's real capability status with
// Stripe (v2 capability path, not the deprecated v1 charges_enabled field)
// rather than trusting that landing here means success.
//
// Capability activation can lag a moment behind the redirect (observed:
// immediately-after-submit reads still show a non-active status that flips
// to "active" within a couple seconds), so retry briefly before giving up.
// This is a best-effort UX check, not the source of truth — an
// account-requirements webhook (not yet built, see CLAUDE.md) is what should
// keep this in sync going forward regardless of when the admin visits.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { restaurant } = await requireRestaurantAdmin(slug);

  if (restaurant.stripe_account_id) {
    let onboardingComplete = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1500);

      const account = await stripe.v2.core.accounts.retrieve(restaurant.stripe_account_id, {
        include: ["configuration.recipient"],
      });
      onboardingComplete =
        account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";

      if (onboardingComplete) break;
    }

    const supabase = await createClient();
    await supabase
      .from("restaurants")
      .update({ stripe_onboarding_complete: onboardingComplete })
      .eq("id", restaurant.id);
  }

  return NextResponse.redirect(new URL(`/admin/${slug}`, request.url));
}
