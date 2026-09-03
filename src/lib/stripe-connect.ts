import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { requireRestaurantAdmin } from "@/lib/restaurant";

// OrderNest must never sit in the flow of funds — restaurants receive
// payment directly. That means checkout uses direct charges (created on the
// connected account itself, via the stripeAccount request option — see
// src/app/api/checkout/route.ts), so the restaurant is merchant of record,
// not the platform. Direct charges require the "merchant" configuration
// (with card_payments requested) rather than "recipient" — a recipient
// account can only receive transfers, it can't process charges itself. See
// Stripe's Connect v2 guidance. Restaurants still get the cobranded Express
// dashboard rather than the full Stripe Dashboard — dashboard: "express"
// with fees_collector/losses_collector: "application" is compatible with
// every charge type, including direct, so no dashboard change was needed.

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
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
      },
    });
    accountId = account.id;

    const supabase = await createClient();
    await supabase.from("restaurants").update({ stripe_account_id: accountId }).eq("id", restaurant.id);
  } else {
    // Existing accounts created before the switch to direct charges (e.g.
    // mithaas-cafe) only have "recipient" applied — request "merchant"
    // explicitly if it isn't already, or the onboarding flow below has
    // nothing to collect for.
    const existing = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.merchant"],
    });
    if (!existing.configuration?.merchant?.applied) {
      await stripe.v2.core.accounts.update(accountId, {
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
            },
          },
        },
      });
    }
  }

  // Stripe requires an onboarding Account Link's `configurations` to list
  // every configuration currently applied on the account, not just the one
  // being onboarded — confirmed by testing against mithaas-cafe's account,
  // which still has "recipient" applied from before this account's switch to
  // direct charges (a stale but harmless leftover; account_links.create
  // rejects the request outright otherwise: "The configurations in the
  // request must match the applied configurations on the account").
  const account = await stripe.v2.core.accounts.retrieve(accountId);
  const accountLink = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: account.applied_configurations,
        refresh_url: `${origin}/admin/${slug}/connect/refresh`,
        return_url: `${origin}/admin/${slug}/connect/return`,
      },
    },
  });

  return accountLink.url;
}
