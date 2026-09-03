@AGENTS.md

# OrderNest

## What this is

A multi-tenant restaurant ordering platform (ChowNow/Toast-style): one codebase
serves many restaurants, each with their own branded ordering page, menu, and
order dashboard. In Stripe's own terminology this **is a Marketplace** (not a
"SaaS platform" — see Stripe Connect section below): OrderNest runs checkout
and is merchant of record, restaurants receive payouts as connected accounts,
and the platform earns a cut via `application_fee_amount`. No cross-restaurant
discovery/browsing though — each restaurant's ordering page is reached
directly by its own slug, not surfaced in a marketplace-style directory.

**Origin:** built after a single-restaurant project (`../mithaas-cafe` — a
static HTML/CSS/JS site with a working Stripe Checkout integration for
"Mithaas Cake & Café") was scoped up into a reusable platform. Mithaas Cafe is
tenant #1 here, not a separate product — its ordering UX is the reference for
what `/r/[slug]` should become, and its `netlify/functions/create-checkout-session.js`
is the reference for the Stripe Checkout flow (server creates the session,
client never touches card data or secret keys).

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind), `src/` layout, deployed to Vercel (planned)
- **Supabase**: Postgres + Auth + Row Level Security — project `bccjapzfqkwkxiqxlelv` (see `.env.local`, gitignored)
- **Stripe Connect** (Accounts v2, `recipient` configuration, `dashboard: "express"`) — each
  restaurant onboards its own connected account via hosted onboarding; platform takes a cut
  via `application_fee_amount` — see "Stripe Connect" section below before touching this code
- MCP servers available in this session: `supabase` (schema/migrations/queries) and
  Stripe's official plugin MCP (`plugin:stripe:stripe`) — note its `stripe_api_search`/
  `stripe_api_details` tools don't have the v2 Core endpoints indexed yet; for those, either
  read the type defs directly (`node_modules/stripe/cjs/resources/V2/Core/*.d.ts` — reliable,
  matches the installed SDK exactly) or use `search_stripe_documentation`

## Multi-tenancy model

Every table that isn't platform-global is scoped by `restaurant_id`, enforced by
Postgres Row Level Security (not just app-level checks). Two helper SQL functions,
`is_platform_admin()` and `is_restaurant_admin(restaurant_id)`, back every policy.
Full schema: `supabase/schema.sql` (source of truth — already applied to the live
Supabase project via `apply_migration`, so edit-then-reapply, don't hand-edit the
dashboard). Tables: `restaurants`, `restaurant_admins`, `menu_categories`,
`menu_items`, `orders`, `order_items`, `platform_admins`.

Orders have **no public insert policy** — they're only ever written by trusted
server code (the service-role client in `src/lib/supabase/admin.ts`), e.g. from a
Stripe webhook after payment is confirmed. Customers never insert orders directly.

## Stripe Connect (read before touching `src/lib/stripe-connect.ts` or checkout code)

**Use Accounts v2 (`stripe.v2.core.accounts.*`), never v1's `stripe.accounts.create({ type: 'express' })`.**
The platform Stripe account was set up via the Connect onboarding at
dashboard.stripe.com/connect, which defaults new platforms onto v2 — v1 account
creation fails outright with a "no longer recommends Accounts v1" error. This is a real
gap between training data and current Stripe practice; don't assume v1 shapes are current.

**OrderNest is a Marketplace, not a SaaS platform** (per Stripe's own platform taxonomy —
see the `stripe-best-practices` skill's `references/connect.md`). That determines
everything downstream:
- Connected accounts get the **`recipient`** configuration (not `merchant`) — they receive
  transfers, they don't process charges directly.
- `defaults.responsibilities.fees_collector` / `losses_collector` = `"application"` (the
  platform, not Stripe, owns fees and negative-balance risk).
- `dashboard: "express"` (cobranded Express Dashboard, not the full Stripe Dashboard).
- Checkout Sessions must use **destination charges** (`payment_intent_data.transfer_data.destination`
  + `application_fee_amount`) — **not `on_behalf_of`**, which is for SaaS/direct-charge platforms
  and is explicitly wrong for a standard marketplace flow. **Built** — see `src/app/api/checkout/route.ts`.

**Capability check uses the v2 path, not deprecated v1 fields:**
`account.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === "active"`
— never `charges_enabled`/`payouts_enabled`. Requires `include: ["configuration.recipient"]` on
retrieve, since v2 nested config isn't returned by default. This lives in
`src/app/admin/[slug]/connect/return/route.ts`.

**Capability activation lags the onboarding redirect by a couple seconds** — a same-request
check right after `return_url` can read a stale non-active status even though the account is
genuinely fine seconds later. The return route retries a few times with a short delay to paper
over this, but the real fix (not yet built) is a Connect webhook listening for
`v2.core.account[requirements].updated` and updating `restaurants.stripe_onboarding_complete`
from that event instead of trusting a single synchronous check.

**Test-mode onboarding is fast**: the hosted onboarding flow has one-click shortcuts —
"Use test phone number" / "Use test code" for phone verification, and "Use test account" on
the bank details step (auto-fills Stripe Test Bank). Individual/sole-proprietor + those
shortcuts + a plausible name/DOB/address is enough to get `stripe_transfers` to `active` in a
sandbox. Mithaas Cafe's connected account was onboarded exactly this way — see seeded dev data
below.

**Watch for the "Personal details: Incomplete" trap in review**: after filling the personal
details form's real fields, the review page can still show a section as `Incomplete` with an
unhelpful generic "Please complete all sections above" error on submit. Re-opening that
section's Edit and just re-touching the (already-filled) field — even something as trivial as
re-typing the phone number — clears it. Seemed to be a UI state sync issue with the hosted flow,
not a real missing field. If "Agree and submit" won't go through, check each section's badge
individually rather than trusting the top-level warning to point at the right one.

## Checkout & webhook (read before touching `src/app/api/checkout` or `src/app/api/webhooks/stripe`)

**`ui_mode: "embedded"` is dead — use `"embedded_page"`.** Another v1-vs-current-API gap: passing
the old value throws `The ui_mode value 'embedded' is no longer supported` at session-create time.
Confirmed against the installed SDK's own types (`resources/Checkout/Sessions.d.ts`), which is the
reliable source here — same lesson as the Accounts v1/v2 gap above, don't trust remembered param
values without checking.

**Mounting Stripe's embedded Checkout after an async `initEmbeddedCheckout()` needs a real
`useEffect`, not `setTimeout(fn, 0)`.** The container div only exists once React commits the state
update that reveals it; a same-tick `setTimeout` can still fire before that commit and throws
`IntegrationError: The selector you specified (#checkout-container) applies to 0 DOM elements`.
Fix (already applied in `CheckoutForm.tsx`): store the `EmbeddedCheckout` instance in state, mount
it from a `useEffect` keyed on that state — effects run after commit, so the div is guaranteed to
exist. Applies to any future embedded-Checkout mount point, not just this one.

**Pricing is always recomputed server-side** (`src/lib/cart-pricing.ts`) from `menu_items` —
the client-submitted cart is just `{item_id: quantity}`; prices, delivery fee, and tax are looked
up/derived from the restaurant's own DB row and settings, never trusted from the request body.

**Platform fee** is a flat `PLATFORM_FEE_RATE = 0.1` (10%) constant in `src/lib/stripe.ts`, applied
as `application_fee_amount` on the destination charge. Move to a per-restaurant
`restaurants.platform_fee_rate` column if pricing ever needs to vary.

**Webhook idempotency**: `orders.stripe_checkout_session_id` has a unique index (partial, only
where not null); `fulfillOrder()` in the webhook checks for an existing row with that session id
before inserting, so Stripe retries — or receiving both `checkout.session.completed` and
`checkout.session.async_payment_succeeded` for one session — can't create duplicate orders.
Order line items are read back from `session.line_items` (expanded on retrieve), not from any
cart data stashed in metadata — Stripe's own record of what was charged is the source of truth,
metadata only carries the fulfillment/contact fields Stripe doesn't already have
(`restaurant_id`, `fulfillment_mode`, `customer_name`, `customer_phone`, `pickup_time`,
`delivery_address`).

**Local webhook testing needs the Stripe CLI forwarding events**, since Stripe can't reach
`localhost` directly:
```
stripe listen --api-key <STRIPE_SECRET_KEY> --forward-to localhost:3000/api/webhooks/stripe \
  --events checkout.session.completed,checkout.session.async_payment_succeeded
```
Installed via `brew install stripe/stripe-cli/stripe` this session. `stripe listen` prints a
`whsec_...` signing secret on startup — put it in `.env.local` as `STRIPE_WEBHOOK_SECRET` and
restart `next dev` (env vars aren't hot-reloaded). The signing secret is regenerated every time
`stripe listen` restarts, so it needs updating again if the listener is ever stopped/restarted.

## Planned routes

- `/r/[slug]` — public ordering page per restaurant (**built**: menu browsing by
  category, qty steppers, cart drawer with live subtotal/delivery/tax/total computed
  from that restaurant's `tax_rate`/`delivery_fee_cents`/`free_delivery_threshold_cents`.
  Cart persists client-side in `localStorage` under `ordernest_cart_<slug>`, scoped per
  tenant. `src/app/r/[slug]/page.tsx` fetches restaurant+menu server-side and hands it
  to the client component `RestaurantMenu.tsx`, which owns all cart state.)
- `/r/[slug]/checkout` — **built**: contact/delivery form (`CheckoutForm.tsx`) → `POST
  /api/checkout` prices the cart server-side and creates a destination-charge embedded
  Checkout Session → mounts inline via Stripe.js. Falls back to a "coming soon" notice if
  the restaurant hasn't completed Stripe Connect onboarding yet. See Checkout & webhook
  section above.
- `/r/[slug]/success` — **built**: verifies the session server-side against Stripe (never
  trusts the browser/URL), shows the confirmed order, clears the local cart.
- `/api/checkout` and `/api/webhooks/stripe` — **built**, see Checkout & webhook section above.
- `/admin/[slug]` and `/admin/[slug]/login` — restaurant admin orders dashboard (**built**:
  email/password login via Supabase Auth, orders list with status updates, RLS-gated).
  Also shows a "Connect Stripe" banner/button when `stripe_onboarding_complete` is false.
- `/admin/[slug]/connect/return` and `/admin/[slug]/connect/refresh` — Stripe's hosted-onboarding
  redirect targets (**built**, see Stripe Connect section above)
- `/onboard` — new restaurant signup flow (creating the `restaurants` row + first admin user)
  for acquiring new tenants — distinct from Stripe Connect onboarding, which is per-restaurant
  and already built for existing restaurants (**not built**)
- `/platform-admin` — cross-restaurant super-admin view (**not built**)

## Local dev

- Env vars in `.env.local` (gitignored): Supabase and Stripe keys are all filled in, including
  `STRIPE_WEBHOOK_SECRET` — but that value is tied to a running `stripe listen` process (see
  Checkout & webhook section above) and needs regenerating if the listener restarts.
- `npm run dev` — note: Next 16 made route `params` an async `Promise` even in
  Server *and* Client Component pages (unwrap with `await params` server-side, or
  `use(params)` client-side). Got bitten by this once already (silently resolved to
  `params.slug === undefined`, causing a bad redirect) — watch for it in new routes.
- To test a real payment locally, `stripe listen` (see Checkout & webhook section above) must be
  running alongside `next dev` — without it, payments succeed on Stripe's side but no webhook
  ever reaches `/api/webhooks/stripe`, so no order gets persisted.
- Seeded dev data: restaurant `mithaas-cafe` (slug, id `cfc1da68-13d3-491d-a826-6c21259515c7`),
  one test admin user — `admin@mithaascafe.test` / `TestAdmin123!` (local Supabase dev
  project only, not a real secret) — full menu (4 categories, 17 items, ported from the
  static site's `MENU_DATA`). Has a real (test-mode) Stripe Connect account,
  `acct_1UBRDfC5FfrDmREo`, onboarded via the hosted flow with `stripe_transfers` active, and at
  least one real paid order from an end-to-end test checkout (on top of the two hand-seeded
  sample orders used to exercise the dashboard before checkout existed).

## Not built yet (in rough priority order)

1. Connect account-requirements webhook (`v2.core.account[requirements].updated`) so
   `stripe_onboarding_complete` stays accurate without relying on the return-route's
   synchronous retry-check
2. Restaurant onboarding flow (`/onboard`) — new tenant signup, distinct from Stripe
   Connect onboarding (already built, per-restaurant)
3. Menu management UI for restaurant admins
4. Platform-admin cross-restaurant view

