import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { requireRestaurantAdmin } from "@/lib/restaurant";

// OrderNest is a marketplace, not a SaaS platform: the platform (not the
// restaurant) runs checkout and is merchant of record, taking a cut via
// application_fee_amount on destination charges. That means connected
// accounts get the "recipient" configuration (they receive transfers, not
// process charges directly) — see Stripe's Connect v2 guidance. Restaurants
// get the cobranded Express dashboard rather than the full Stripe Dashboard.

// Creates (if needed) a Stripe Connect v2 account for this restaurant and
// returns a fresh hosted-onboarding Account Link URL. Shared by the
// "Connect Stripe" button and the refresh route (Stripe redirects there when
// a previously-issued link has expired).
export async function createAccountLinkForRestaurant(slug: string, origin: string) {
  const { restaurant, user } = await requireRestaurantAdmin(slug);

  let accountId = restaurant.stripe_account_id;

  if (!accountId) {
    const account = await stripe.v2.core.accounts.create({
      display_name: restaurant.name,
      contact_email: user.email,
      dashboard: "express",
      identity: { country: "CA" },
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
      },
    });
    accountId = account.id;

    const supabase = await createClient();
    await supabase.from("restaurants").update({ stripe_account_id: accountId }).eq("id", restaurant.id);
  }

  const accountLink = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: `${origin}/admin/${slug}/connect/refresh`,
        return_url: `${origin}/admin/${slug}/connect/return`,
      },
    },
  });

  return accountLink.url;
}
