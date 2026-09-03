@AGENTS.md

# OrderNest

## What this is

A multi-tenant restaurant ordering platform (ChowNow/Toast-style): one codebase
serves many restaurants, each with their own branded ordering page, menu, and
order dashboard. OrderNest must never sit in the flow of funds: checkout uses
**direct charges** (see Stripe Connect section below), so each restaurant —
not OrderNest — is merchant of record and receives payment straight into its
own connected account. OrderNest takes **no cut** — purely a payment
facilitator, never touching the money itself. No cross-restaurant
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
- **Stripe Connect** (Accounts v2, `merchant` configuration, `dashboard: "express"`, direct
  charges) — each restaurant onboards its own connected account via hosted onboarding and is
  merchant of record on its own charges; platform takes no cut and never touches the funds
  (see "Stripe Connect" section below before touching this code)
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

**OrderNest must never be in the flow of funds** — the explicit product requirement that
drives this whole section (confirmed against Stripe's own Connect guidance via the
`connect-recommend` skill's charge-pattern/compatibility references and the installed SDK's
v2 type defs, not assumed). That means **direct charges**, not destination charges:
- Connected accounts get the **`merchant`** configuration (not `recipient`) with `card_payments`
  requested — `recipient` accounts can only *receive transfers*, they can't process a charge
  directly, which direct charges require. See `Accounts.d.ts`'s `Configuration.Merchant`
  interface for the exact shape.
- `dashboard: "express"` stays, with `defaults.responsibilities.fees_collector` /
  `losses_collector` = `"application"` — the one Express-dashboard combination Stripe allows
  for every charge type including direct.
- Checkout Sessions are created **directly on the connected account** via the `stripeAccount`
  request option (`stripe.checkout.sessions.create(params, { stripeAccount: acctId })`), not
  on the platform account. The restaurant is merchant of record; the charge — and Stripe's own
  processing fee — lands on and is deducted from *their* balance, never the platform's. No
  `application_fee_amount`/`transfer_data` needed, since OrderNest takes no cut. **Built** — see
  `src/app/api/checkout/route.ts`. Every other call that touches a restaurant's charge (session
  retrieve on the success page and in the webhook, refunds) needs the same `{ stripeAccount }`
  option — grep for `stripeAccount` if adding a new one.

**Capability check uses the v2 path, not deprecated v1 fields:**
`account.configuration.merchant.capabilities.card_payments.status === "active"`
— never `charges_enabled`/`payouts_enabled`. Requires `include: ["configuration.merchant"]` on
retrieve, since v2 nested config isn't returned by default. This lives in
`src/app/admin/[slug]/connect/return/route.ts`.

**Capability activation lags the onboarding redirect by a couple seconds** — a same-request
check right after `return_url` can read a stale non-active status even though the account is
genuinely fine seconds later. The return route retries a few times with a short delay to paper
over this (confirmed for real in testing: the return route's redirect took ~6s, i.e. it needed
multiple retries before the status actually flipped). The durable fix, **built**, is a separate
Connect thin-events webhook — see its own section below.

### Connect thin-events webhook (`src/app/api/webhooks/stripe-connect/route.ts`)

Accounts v2 delivers account-change notifications through an entirely different mechanism from
classic v1 webhooks: **Event Destinations** + **thin events**, not the `checkout.session.completed`-style
snapshot events. Don't assume the same webhook pattern applies — verified this the hard way via
`search_stripe_documentation` before writing any code, since guessing here would've meant a third
Connect-related rewrite.

- Event type: `v2.core.account[configuration.merchant].capability_status_updated` (fires
  specifically when a merchant capability like `card_payments` changes status — more precise
  than the broader `[requirements].updated`; confirmed exact string in the installed SDK's
  `resources/V2/Core/Events.d.ts`).
- Verified with `stripe.parseEventNotificationAsync(rawBody, signature, secret)`, **not**
  `stripe.webhooks.constructEvent()` — a distinct method for thin events.
- The notification payload is tiny (`related_object.id` = the account id, plus the event type) —
  full account details (needed for the capability status) are fetched separately via
  `stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant"] })`, same
  call as the return route uses.
- **Separate signing secret** from the v1 checkout webhook: `STRIPE_CONNECT_WEBHOOK_SECRET` in
  `.env.local`, distinct from `STRIPE_WEBHOOK_SECRET`. In production these come from two separate
  Event Destinations (different `event_payload`: `snapshot` vs `thin`); locally, a single
  `stripe listen` session signs both with the same value — see Local dev section for the actual
  command.
- **Verified working end-to-end** (not just type-checked): created a throwaway restaurant,
  onboarded a fresh Connect account for it through the real hosted flow, and watched both the
  thin event fire (`stripe-listen` log showed 3 deliveries, all `200`) and
  `restaurants.stripe_onboarding_complete` flip to `true` from the webhook path independently of
  the return-route retry. Cleaned up the throwaway restaurant after — don't be surprised it's gone
  from the DB, that's expected, not a sign the feature is untested.

**Test-mode onboarding is fast**: the hosted onboarding flow has one-click shortcuts —
"Use test phone number" / "Use test code" for phone verification, and "Use test account" on
the bank details step (auto-fills Stripe Test Bank). Individual/sole-proprietor + those
shortcuts + a plausible name/DOB/address is enough to get a capability to `active` in a
sandbox. Mithaas Cafe's connected account was originally onboarded this way for `recipient`/
`stripe_transfers` — see seeded dev data below for what happened when it later requested
`merchant`/`card_payments` too (activated instantly from existing identity info, no full
re-onboarding actually required in this case).

**Watch for the "Personal details: Incomplete" trap in review (`recipient`/`stripe_transfers`
era)**: after filling the personal details form's real fields, the review page can still show a
section as `Incomplete` with an unhelpful generic "Please complete all sections above" error on
submit. Re-opening that section's Edit and just re-touching the (already-filled) field — even
something as trivial as re-typing the phone number — clears it. Seemed to be a UI state sync
issue with the hosted flow, not a real missing field. If "Agree and submit" won't go through,
check each section's badge individually rather than trusting the top-level warning to point at
the right one.

**A different, heavier "Personal details: Incomplete" gate exists for `merchant`/`card_payments`
— the phone re-touch trick above does NOT clear it.** Requesting `card_payments` on an account
triggers real government-ID document verification ("Verify your identity" / "Liveness
verification" / "Verify your ID and home address") — a materially higher KYC bar than
`recipient`'s `stripe_transfers`. Confirmed by testing: re-touching fields left the section
`Incomplete`; only completing (or explicitly skipping, via "Skip for now") the ID-verification
step moved past it. Don't assume this is the same UI glitch as the recipient-era trap — it isn't,
and no fake documents should ever be uploaded to clear it. Note this gate blocks the hosted
*onboarding UI*'s "Review and confirm" completion, not necessarily the capability itself — Mithaas
Cafe's `card_payments` reached `status: "active"` without ever completing this step, since Stripe
evaluates capability activation from whatever identity info the account already has on file.

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

**No platform fee, and no flow of funds — explicit product decisions** (confirmed directly, not
assumed): OrderNest "should not [be] involve[d] in any fee... it should purely be between
restaurant and stripe... we are just facilitating payments," and should never sit in the flow of
funds at all. Direct charges (see Stripe Connect section above) satisfy both at once: the charge
is created on the restaurant's own connected account via `{ stripeAccount }`, so the money never
touches the platform's balance, and Stripe deducts its own processing fee straight from the
restaurant's balance automatically — no `application_fee_amount`/`transfer_data`, and no need for
the fee-approximation math a destination charge would have required. If a real platform revenue
model is ever wanted, `application_fee_amount` on the direct charge is the mechanism to reach for
— but don't reintroduce it without being asked; the zero-fee decision was deliberate, not a
placeholder.

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
`localhost` directly. One `stripe listen` invocation forwards both the v1 checkout webhook and
the v2 thin Connect webhook:
```
stripe listen --api-key <STRIPE_SECRET_KEY> \
  --events checkout.session.completed,checkout.session.async_payment_succeeded \
  --forward-to localhost:3000/api/webhooks/stripe \
  --thin-events "v2.core.account[configuration.merchant].capability_status_updated" \
  --forward-thin-to localhost:3000/api/webhooks/stripe-connect
```
Installed via `brew install stripe/stripe-cli/stripe` this session. `stripe listen` prints one
`whsec_...` signing secret on startup, shared by both destinations in this local-forwarding mode —
put the same value in `.env.local` as both `STRIPE_WEBHOOK_SECRET` and
`STRIPE_CONNECT_WEBHOOK_SECRET`, then restart `next dev` (env vars aren't hot-reloaded). The
secret is regenerated every time `stripe listen` restarts, so both vars need updating again if the
listener is ever stopped/restarted — they'll drift out of sync if you only update one.

**Direct charges mean `checkout.session.completed` (and `refund.updated`) now fire on the
connected account, not the platform** — confirmed via a real end-to-end test order + refund
against `mithaas-cafe`'s connected account: `stripe listen`'s `--forward-to` delivers these with
**no extra flag needed** — the CLI logs them prefixed `connect` (e.g. `connect
checkout.session.completed`) and forwards them to the same `--forward-to` endpoint as platform
events. (A real Stripe Dashboard-registered webhook endpoint in production still needs "Listen to
events on Connected accounts" explicitly enabled — only the local CLI behavior is confirmed
automatic.) Any handler reading `event.data.object` for a Connect-forwarded event also needs
`event.account` if it re-fetches the object from Stripe (see `fulfillOrder` in
`src/app/api/webhooks/stripe/route.ts`, which passes it through as `{ stripeAccount }`).

## Multi-location delivery

A `restaurants` row can have multiple `restaurant_locations` (name, structured address, `lat`/`lng`,
`supports_delivery`/`supports_pickup`, `is_active`). Menu and pricing (`tax_rate`,
`delivery_fee_cents`, `free_delivery_threshold_cents`) stay per-restaurant, shared across all of a
restaurant's locations — this feature only adds geography and delivery feasibility, not per-location
menus or pricing. The delivery radius is **one value per restaurant**
(`restaurants.delivery_radius_km`, nullable = unlimited), not per-location, applying no matter which
location ends up nearest. All locations share the restaurant's single existing
`stripe_account_id` — no Connect changes.

**Zero or one location = skip entirely.** This is the load-bearing backward-compatibility rule: a
restaurant with fewer than 2 rows in `restaurant_locations` (every existing tenant today, e.g.
`mithaas-cafe`) gets no picker UI, no radius check, both fulfillment modes always available — exactly
the pre-this-feature behavior. With exactly one location, its `id` is still captured on the order for
attribution, but its `supports_delivery`/`supports_pickup` flags and the restaurant's radius are
**not** enforced — a deliberate scope line, not an oversight, if it ever needs tightening.

**Nearest-location flow** (`src/app/r/[slug]/checkout/LocationPicker.tsx`, only rendered when
`locations.length > 1`): tries `navigator.geolocation.getCurrentPosition()` first; on denial/error, an
always-visible typed-address field falls back to `POST /api/geocode` (server-side Mapbox proxy —
`MAPBOX_TOKEN` never reaches the browser). Either path yields `{lat, lng}`; nearest location is
`haversineDistanceKm()` (`src/lib/geo.ts`) client-side. Result persists to
`localStorage["ordernest_location_" + slug]` (same convention as `ordernest_cart_<slug>`).

**Or choose a location directly** (same component, below the geolocation/address UI) — a plain list
with a "Select" button per location, no coordinates involved (`ResolvedLocation.lat/lng/distanceKm`
all `null` for this path — the type is `number | null`, not `number`, specifically to represent this).
Safe by construction: `deliveryAllowed`'s existing `(resolvedLocation?.distanceKm ?? Infinity) <=
radius` check already treats "unknown distance" as "outside any configured radius", so direct-select
only enables delivery when `delivery_radius_km` is `null` (unlimited) — otherwise it's pickup-only,
with an inline prompt to share location instead if the customer wants delivery. `/api/checkout`
mirrors this: coordinates are required **only inside the `delivery_radius_km != null` branch**, not
unconditionally, so a direct-selected unlimited-radius delivery order needs no coordinates at all
server-side either. Verified via curl: direct-select + delivery succeeds with unlimited radius and no
coordinates, 400s with a radius configured and no coordinates, and pickup always succeeds regardless.

**Server-side re-validation is mandatory, like pricing.** `/api/checkout` re-fetches active locations
and re-runs the same distance check server-side before creating the Stripe session — a tampered
request can't force a delivery order outside the radius just because the client-side picker allowed
it. Out-of-radius/unsupported-mode requests get a **400 rejection**, not a silent downgrade to
pickup — changing what the customer is charged/fulfilled without their explicit re-confirmation would
be worse than a clear error. `orders.location_id` (nullable FK) records which location fulfilled the
order, shown on the admin orders dashboard.

**Geocoding is a single plain `fetch` against Mapbox's REST API** (`src/lib/geocode.ts`,
`geocodeAddress()`) — no SDK, since this is the only geo call in the app. All Mapbox specifics are
isolated to that one function; swapping providers later (e.g. Google Maps) means rewriting its
internals only, since every caller (`/api/geocode`, the admin locations actions) just consumes its
`{lat, lng, formattedAddress} | null` return shape.

**Live address autocomplete** (`/api/geocode/suggest`, `suggestAddresses()` in `src/lib/geocode.ts`):
`LocationPicker.tsx`'s typed-address field debounces input (300ms, 3+ chars) and shows a dropdown of
up to 5 Mapbox suggestions (`autocomplete=true&limit=5`), each already carrying `lat`/`lng` — picking
one resolves immediately, no second lookup. This is separate from the one-shot `/api/geocode` (POST)
used by "Use this address", which stays as the fallback for when a user types a full address and
doesn't pick a suggestion. Verified the debounced fetch fires correctly end-to-end (network log
showed the request), but the actual suggestion *results* are unverified against real Mapbox data — no
`MAPBOX_TOKEN` has been available in this dev environment yet, so `suggestAddresses()`'s only
exercised path so far is its own graceful-empty-results fallback, not real API responses.

**Known gap, not fixed:** `/api/geocode` and `/api/geocode/suggest` are necessarily public (anonymous
customers call them) with no rate limiting — same class of issue as the pre-fix `/onboard` below,
lower stakes (Mapbox quota cost, not account creation) but worse for `/suggest` specifically since it
fires per keystroke rather than once per checkout.

**Known gotcha (same trap as `menu_categories`):** `restaurant_locations.sort_order` defaults to `0`,
so newly-added locations render **first** in the admin list, not last — the admin query orders by
`sort_order, created_at` to keep this predictable rather than surprising.

## Hours of operation

Per-restaurant, per-day-of-week schedule (`restaurant_hours`: `day_of_week` 0=Sunday..6=Saturday,
`is_closed`, `open_time`/`close_time` as Postgres `time`), plus `restaurants.timezone` (IANA name,
default `America/Toronto`). Enforced, not just informational: `/r/[slug]/checkout` blocks with a
"currently closed" screen server-side, `/api/checkout` independently re-checks and rejects with 400
(same "never trust the client alone" pattern as the delivery-radius check — a checkout page loaded
before closing time could still submit after), and the menu page (`/r/[slug]/order`) shows a
non-blocking amber banner so browsing still works while closed.

**No rows at all = always open** — the load-bearing backward-compatibility rule, identical in spirit
to "zero locations = skip entirely": every existing tenant (e.g. `mithaas-cafe`) has no
`restaurant_hours` rows and is completely unaffected until an admin explicitly saves hours.
`/admin/[slug]/hours` always saves **all 7 days at once** (a single upsert on the
`restaurant_id, day_of_week` unique constraint) specifically to avoid a half-configured week ever
existing — partial state was a real risk here since each day's checkbox+time inputs are independent.

**`isRestaurantOpen()` / `getTodayHours()`** (`src/lib/hours.ts`) read the restaurant's local
day-of-week and time via `Intl.DateTimeFormat` with the `timeZone` option — no date library
dependency, same "plain platform API, no SDK" choice as `geocode.ts`. Handles overnight-wrap hours
(e.g. Friday 18:00–02:00) by also checking *yesterday's* row for a carry-over into early this
morning — verified with 8 scripted test cases via `npx tsx` (normal range, closed day, and all three
overnight-wrap edges: still-open late stretch, carried-over early morning, and past-close) before
wiring it into the two checkout gates. Not covered by an actual test file yet — the verification was
a one-off script, not a committed test (see "Not built yet": no automated tests exist in this repo).

## Scheduled ordering

`src/lib/scheduling.ts` (`getSchedulingAvailability`, `isValidScheduledTime`, both used client- and
server-side) has two modes: **`"unrestricted"`** when a restaurant has zero `restaurant_hours` rows
(same "no rows = always open" default as above — nothing to enumerate against), and **`"slots"`**
once hours are configured, which pre-computes real open time slots per day (30-minute increments,
`SLOT_MINUTES`) rather than just a yes/no per day.

**Capped to the next 7 days** (`DAYS_AHEAD`, exported from `scheduling.ts` so the client doesn't
hand-copy the number) — enforced on both ends: the client's date `<input>` gets `min`/`max`
attributes, and `isValidScheduledTime` independently rejects anything past `now + DAYS_AHEAD` with a
dedicated `"too_far"` reason (surfaced as its own error message in `/api/checkout`), not just a
client-side convenience.

**No raw `datetime-local`/`<select>` — matches the rest of the form's pill-button style.**
`CheckoutForm.tsx`'s "When" section used to render a bare `<input type="datetime-local">` for
unrestricted restaurants (browsers render this with an unstyled, truncated placeholder —
`yyyy-mm-dd, --:-- --` — that reads as broken) and two plain `<select>` dropdowns for slots-mode
restaurants. Replaced with: separate labeled `Date`/`Time` inputs for unrestricted mode, and a
horizontal row of day pills + a wrapped row of time-slot pills for slots mode — same rounded-pill
look as the existing Delivery/Pickup and ASAP/Schedule toggles, not a new pattern.

**Closed right now no longer blocks ordering ahead.** This was a real bug, not just polish: both the
checkout page and `/api/checkout` used to hard-block with "currently closed" whenever
`isRestaurantOpen()` was false *at request time* — even for a **scheduled** future order that would
land squarely inside store hours, which defeats the entire point of scheduling ahead. Fixed on both
ends:
- `/api/checkout`'s `isRestaurantOpen` gate now only applies when `!scheduledFor` (ASAP orders); a
  scheduled order is validated against *its own* scheduled time via `isValidScheduledTime` instead,
  which already checks the target time falls inside hours.
- `checkout/page.tsx` only shows the hard-block screen when there's truly no way to order at all:
  closed now **and** (slots-mode with zero upcoming open days in the 7-day window). Unrestricted-mode
  restaurants can never hit this, since `isRestaurantOpen` with no hours rows is always `true`.
- `CheckoutForm.tsx` computes `openNow` client-side (same `isRestaurantOpen`, safe to call from a
  Client Component — no server-only dependencies) and defaults `scheduleMode` to `"schedule"` with
  the "As soon as possible" toggle disabled when closed, plus an inline note explaining why — rather
  than silently defaulting to a mode the customer can't actually use.

**Fixed a real "stuck on Loading payment" bug while touching this form**, unrelated to hours but
found and reported during testing here: `CheckoutForm.tsx`'s `<Script src=".../stripe.js">` used
`onLoad={() => setStripeLoaded(true)}`. Next.js's `next/script` (`node_modules/next/dist/client/script.js`)
only invokes `onLoad` on a script's *first* load globally (`loadScript()` bails out early if the
script is already in its module-level `LoadCache`); if `CheckoutForm` unmounts and remounts — e.g.
the customer hits the browser back button, then forward again — `onLoad` never fires a second time,
and `stripeLoaded` (freshly `false` on the new mount) stays `false` forever, permanently disabling
the payment button. Next.js has a dedicated `onReady` prop built exactly for this remount case (see
the state-machine comment in `script.js` itself); switched to it. If this component ever needs
another third-party `<Script>` with client state gated on load, use `onReady`, not `onLoad`.

## Planned routes

- `/r/[slug]` — **built**: public landing page per restaurant (`src/app/r/[slug]/page.tsx`, server
  component, no client JS). Brand-color gradient hero (`restaurant.brand_color` → dark, no photo
  pipeline exists yet — see "Not built yet"), name/description, today's open/closed status
  (`isRestaurantOpen`/`getTodayHours`, only shown if hours are configured), a location-count or
  single-address summary (only shown if any `restaurant_locations` exist), and an "Order Now" CTA
  into `/r/[slug]/order`. Every section degrades to nothing (not a placeholder) when the restaurant
  hasn't configured that data — verified against `mithaas-cafe` (zero hours, zero locations) still
  rendering a clean, complete-looking page.
- `/r/[slug]/order` — **built**: the actual menu/cart page (moved here from `/r/[slug]` when the
  landing page was added — same `RestaurantMenu.tsx` client component, unchanged cart/pricing logic,
  `localStorage` key still `ordernest_cart_<slug>`). Header now also shows today's hours/open-status
  and a location summary when configured (passed down from `order/page.tsx`, reusing the same
  `isRestaurantOpen`/`getTodayHours` helpers as the landing page and the checkout hours-gate). A
  client-side search box filters items by name/description before grouping into categories — cheap
  (`Array.prototype.filter`, no new dependency), not a replacement for a real search index, fine at
  a single-restaurant menu's scale. Every other page's "back to menu"/"order again" link now points
  here instead of `/r/[slug]` (checkout's two blocking screens, success page, CheckoutForm's
  empty-cart screen) — grep for `` `/r/${slug}` `` (or `restaurant.slug`) if you add a new one and
  aren't sure which of the two it should point to: the landing page for "start over", `/order` for
  "back to ordering". Layout benchmarked live against sardarji.ca (a real multi-location Indian
  restaurant site with a polished ordering UI): the category sidebar is `sticky`, menu item cards get
  a hover lift/shadow, and — the bigger change — the cart is a **persistent right-hand column at
  `lg:` and up** (`aside.sticky`, always visible, no click-to-open) rather than a click-to-open
  drawer; the drawer still exists but only as the `lg:hidden` mobile fallback, sharing the same
  item-list/totals JSX so the two can't drift out of sync. Active promo codes render as a bigger
  icon-badge banner (`bg-green-50` card, not a thin one-line strip) for the same reason.
- `/r/[slug]/checkout` — **built**: contact/delivery form (`CheckoutForm.tsx`) → `POST
  /api/checkout` prices the cart server-side and creates a direct-charge embedded
  Checkout Session on the restaurant's connected account → mounts inline via Stripe.js.
  Falls back to a "coming soon" notice if the restaurant hasn't completed Stripe Connect
  onboarding yet. See Checkout & webhook section above.
- `/r/[slug]/success` — **built**: verifies the session server-side against Stripe (never
  trusts the browser/URL), shows the confirmed order, clears the local cart.
- `/api/checkout`, `/api/webhooks/stripe`, and `/api/webhooks/stripe-connect` — **built**, see
  Checkout & webhook and Stripe Connect sections above.
- `/admin/[slug]` and `/admin/[slug]/login` — restaurant admin orders dashboard (**built**:
  email/password login via Supabase Auth, orders list with status updates, RLS-gated).
  Also shows a "Connect Stripe" banner/button when `stripe_onboarding_complete` is false.
  Search/filter (customer name via `ilike`, date range, status, fulfillment mode, and location when
  the restaurant has any) plus pagination (20/page, `range()` + `{count:"exact"}`) all live in plain
  `?query` params via a GET `<form>` — no client JS, no Server Action, just navigation, so it's
  bookmarkable/shareable and works identically to every other filtered listing in the app. Date
  filtering treats the `from`/`to` boundaries as UTC rather than the restaurant's own `timezone` —
  an acknowledged simplification (a restaurant far from UTC can see a day's orders spill a few hours
  into the adjacent calendar day); this is a search convenience, not an enforcement path like
  hours-of-operation, so the extra precision wasn't worth the complexity. Verified end-to-end via
  browser against real `mithaas-cafe` orders (each filter individually and combined) and against a
  throwaway 25-order seed for pagination (page 1 of 2 → page 2, correct "Showing X–Y of Z" counts).
  The submit button reads "Search" (not "Filter") and the `From`/`To` date inputs have their own
  labels stacked above them — a first attempt put the label inline (`flex items-center gap-2`) next
  to the input, which overlapped the *next* field's label because a flex child's default
  `min-width: auto` doesn't let `w-full` shrink it below the native date input's own content width;
  labels stacked above the input side-step that instead of fighting it with `min-w-0`.
- `/admin/[slug]/connect/return` and `/admin/[slug]/connect/refresh` — Stripe's hosted-onboarding
  redirect targets (**built**, see Stripe Connect section above)
- `/onboard` — **built, platform-admin-gated** (not public self-serve — see "Not built yet" for why):
  new restaurant signup flow. `src/app/onboard/page.tsx` is now a server component calling
  `requirePlatformAdmin()`, wrapping the actual form (moved to `OnboardForm.tsx`, unchanged
  otherwise). `POST /api/onboard` independently checks the caller is a signed-in platform admin at
  the top of the handler (can't reuse `requirePlatformAdmin()` there — it calls `redirect()`, which
  inside a `fetch()`-hit Route Handler would make the client's `res.json()` choke on a followed
  redirect instead of a clean error), then proceeds exactly as before via the service-role client:
  validates inputs, creates the Supabase Auth user, `restaurants` row, and `restaurant_admins` link
  (role `owner`) — best-effort cleanup on partial failure since it's not a real DB transaction. Signs
  the new user in client-side and redirects to `/admin/[slug]`. Linked from `/platform-admin`'s
  "+ Add restaurant". Verified end-to-end via browser (signup → auto sign-in → redirect → empty
  dashboard with "Stripe isn't connected yet"), predating the platform-admin gate added later.
- `/admin/[slug]/locations` — **built**: multi-location CRUD for restaurant admins (add/edit/
  deactivate/delete a location, set the restaurant's delivery radius) — see "Multi-location delivery"
  above. Same Server Action pattern as `/admin/[slug]/menu`.
- `/api/geocode` and `/api/geocode/suggest` — **built**: public Mapbox proxies (one-shot resolve, and
  debounced autocomplete respectively) used by the customer-facing location picker — see
  "Multi-location delivery" above.
- `/admin/[slug]/hours` — **built**: per-day operating-hours editor (all 7 days saved as one batch
  upsert) — see "Hours of operation" above.
- `/admin/[slug]/menu` — **built**: menu management for restaurant admins. Server Actions
  (`src/app/admin/[slug]/menu/actions.ts`) for add/edit/delete category, add/edit/delete item,
  toggle availability — all authorized via existing RLS policies (session-scoped client, no
  service-role bypass needed). New categories default to a low/null `sort_order` so they render
  **first**, not last — not a bug, just worth knowing before assuming an add failed silently.
  Verified end-to-end via browser + DB checks. Menu items can have a photo (`ImageUploadField.tsx`,
  `menu_items.image_url`) — read by `RestaurantMenu.tsx` and falls back to the item's `emoji` when
  unset, so existing items with no photo are unaffected. There's still no equivalent upload for the
  *restaurant's* own logo (`restaurants.logo_url`) — see "Not built yet".
- `/admin/[slug]/promo` — **built**: promo/coupon code management (percent or fixed-amount discount,
  optional minimum subtotal, active/inactive toggle). `src/lib/promo.ts`'s `validatePromoCode` backs
  both `POST /api/promo/validate` (called live from `CheckoutForm.tsx` as the customer types a code,
  for an instant preview) and the authoritative re-check inside `/api/checkout` itself before the
  Stripe session is created — same "client preview, server re-validates" pattern as pricing and the
  delivery-radius/hours checks elsewhere in checkout.
- `/platform-admin` and `/platform-admin/login` — **built**: cross-restaurant super-admin view.
  `requirePlatformAdmin()` (`src/lib/platform-admin.ts`) gates the page; RLS's
  `is_platform_admin()` (used inside `is_restaurant_admin()`) is what actually grants the
  session cross-tenant read access, the page guard is just the UX layer on top. Lists every
  restaurant with Stripe connection status, order count, and revenue (aggregated client-side
  from a single cross-tenant `orders` query), plus a Dashboard link into each restaurant's
  `/admin/[slug]`. Verified end-to-end via browser + DB checks.

## Local dev

- Env vars in `.env.local` (gitignored): Supabase and Stripe keys are all filled in, including
  `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` — both tied to a running
  `stripe listen` process (see Checkout & webhook section above) and both need regenerating
  together if the listener restarts.
- `npm run dev` — note: Next 16 made route `params` an async `Promise` even in
  Server *and* Client Component pages (unwrap with `await params` server-side, or
  `use(params)` client-side). Got bitten by this once already (silently resolved to
  `params.slug === undefined`, causing a bad redirect) — watch for it in new routes.
- To test a real payment (or Connect onboarding) locally, `stripe listen` (see Checkout & webhook
  section above, needs both `--forward-to` and `--forward-thin-to`) must be running alongside
  `next dev` — without it, the Stripe-side action succeeds but no webhook ever reaches the app, so
  nothing gets persisted/updated.
- `getRestaurantBySlug` (`src/lib/restaurant.ts`) logs (rather than silently swallows) query
  errors now — originally it destructured only `{ data }` from the Supabase response, so any
  transient failure (auth hiccup, network blip) looked identical to "restaurant doesn't exist" and
  produced a confusing false-negative 404 during testing. If a restaurant that definitely exists
  ever fails to load again, check the server console for the logged error before assuming it's
  actually missing.
- Seeded dev data: restaurant `mithaas-cafe` (slug, id `cfc1da68-13d3-491d-a826-6c21259515c7`),
  one test admin user — `admin@mithaascafe.test` / `TestAdmin123!` (local Supabase dev
  project only, not a real secret) — full menu (4 categories, 17 items, ported from the
  static site's `MENU_DATA`). Has a real (test-mode) Stripe Connect account,
  `acct_1UBRDfC5FfrDmREo`, with both `recipient`/`stripe_transfers` (destination-charge era) and
  `merchant`/`card_payments` (current, direct-charge) applied and active — the account already
  had enough identity info on file from the original onboarding that requesting `merchant`
  activated `card_payments` instantly, no new hosted-onboarding fields needed (confirmed via the
  Stripe API directly: `card_payments.status === "active"` right after the capability request).
  Has at least one real paid-and-refunded order from an end-to-end direct-charge test (on top of
  the two hand-seeded sample orders used to exercise the dashboard before checkout existed) —
  verified the charge exists *only* on the connected account (a platform-account lookup of the
  same `payment_intent` id 404s) and that OrderNest's balance was never touched.

## Not built yet (in rough priority order)

> Kept in sync with actual code state, not just intent — before trusting an item here as still
> missing, it's worth a quick grep, since this list has drifted from reality before (promo codes,
> menu item images, the sticky sidebar, and scheduled ordering were all built in earlier sessions
> but stayed listed here as "not built" for a while afterward).

1. **Deployment** — still local-only (`npm run dev`); Vercel deploy, production env vars, and
   real Stripe Event Destinations (v1 + v2 thin) pointed at the deployed URL instead of
   `stripe listen` are all outstanding. Nothing about the app itself blocks this — it's purely
   unstarted infra work.
2. **Restaurant settings UI** — `tax_rate`, `delivery_fee_cents`, `free_delivery_threshold_cents`,
   currency, etc. exist as DB columns (read by checkout/menu pages) but have no admin UI; only
   editable by hand via SQL/seed today. (`delivery_radius_km` and `timezone` are the exceptions —
   editable from `/admin/[slug]/locations` and `/admin/[slug]/hours` respectively.)
3. **Auth completeness** — no password reset flow, no way to invite a second admin to an existing
   restaurant (`restaurant_admins` supports multiple rows, but only onboarding's initial owner
   insert exists). `/onboard` itself is no longer public (platform-admin-gated), but
   `/api/geocode` and `/api/geocode/suggest` are still public with **no rate limiting** — lower
   stakes than the pre-fix `/onboard` gap (Mapbox quota cost, not account creation) but worse for
   `/suggest` specifically since it fires per keystroke, not once per checkout.
4. **Order lifecycle beyond "paid"** — an admin can set an order's status to `cancelled`, but that's
   just a label on the row; there's no actual Stripe refund/void wired to it, and no customer-facing
   notification (email/SMS) of any status change.
5. **Restaurant-level branding** — menu items *do* support a photo now (`ImageUploadField.tsx`,
   read by `RestaurantMenu.tsx`), but there's still no equivalent for the restaurant's own identity:
   no logo upload (`restaurants.logo_url` unused), no custom domain support. This is also why the
   `/r/[slug]` landing hero is brand-color/typography rather than a photo.
6. **No automated tests** — all verification so far has been manual/live browser + DB checks, plus
   one one-off `npx tsx` script for `isRestaurantOpen()`'s edge cases (not a committed test file).
7. **Smaller ordering-flow gaps**, remaining from an earlier live benchmark against sardarji.ca (a
   real multi-location Indian restaurant site — see the git log around the landing-page commit, and
   the "Scheduled ordering" section above for what that benchmark led to on the scheduling side
   specifically):
   - No per-item special instructions — only one restaurant-wide delivery-instructions field exists
     (`CheckoutForm.tsx`); nothing for pickup orders, nothing per line item.
   - No prep-time estimate shown alongside the scheduling picker (scheduled ordering itself — date
     picker, store-hours enforcement, the 7-day cap — is built; see "Scheduled ordering" above).

