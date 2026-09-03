import Stripe from "stripe";

// Platform-level Stripe client. Server-only. OrderNest is a marketplace
// (destination charges), so Checkout Sessions and PaymentIntents are created
// directly on this platform account — never with a per-request `stripeAccount`
// override, which is a SaaS/direct-charge pattern that doesn't apply here.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// OrderNest takes NO cut — the platform is purely a payment facilitator.
// A destination charge still lands on the *platform's* Stripe balance before
// the transfer to the restaurant, so Stripe's own processing fee would
// otherwise be deducted from the platform (not the restaurant) by default.
// application_fee_amount is used here only as a pass-through to offset that:
// set to Stripe's own fee, so it nets to $0 for the platform and the
// restaurant ends up paying Stripe's standard rate directly — the same as if
// they'd connected to Stripe themselves, not a markup we keep.
//
// Standard Stripe Canada card rate (domestic cards): 2.9% + $0.30 CAD. This
// is an approximation — actual per-charge fees vary by card brand (e.g. Amex),
// international cards, and currency conversion — so the platform's net won't
// be exactly $0 on every single charge, but it's not a deliberate revenue
// mechanism either way.
export const STRIPE_FEE_PERCENT = 0.029;
export const STRIPE_FEE_FIXED_CENTS = 30;
