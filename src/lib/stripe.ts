import Stripe from "stripe";

// Platform-level Stripe client. Server-only. OrderNest is a marketplace
// (destination charges), so Checkout Sessions and PaymentIntents are created
// directly on this platform account — never with a per-request `stripeAccount`
// override, which is a SaaS/direct-charge pattern that doesn't apply here.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// The platform's cut of each order, taken via application_fee_amount on the
// destination charge. Flat rate for now; move to a per-restaurant column
// (e.g. restaurants.platform_fee_rate) if/when pricing needs to vary.
export const PLATFORM_FEE_RATE = 0.1;
