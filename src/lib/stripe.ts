import Stripe from "stripe";

// Platform-level Stripe client. Server-only. OrderNest must never sit in the
// flow of funds, so checkout uses direct charges: Checkout Sessions,
// coupons, session retrieval, and refunds that touch a restaurant's charge
// are all created with a per-request `stripeAccount` option (the connected
// account's id), not on this platform account. This client is still used
// bare for platform-level calls that aren't tied to a specific restaurant's
// charge (e.g. Connect account/account-link management in
// src/lib/stripe-connect.ts).
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
