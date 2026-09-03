@AGENTS.md

# OrderNest

## What this is

A multi-tenant restaurant ordering platform (ChowNow/Toast-style): one codebase
serves many restaurants, each with their own branded ordering page, menu, and
order dashboard. In Stripe's own terminology this **is a Marketplace** (not a
"SaaS platform" — see Stripe Connect section below): OrderNest runs checkout
and is merchant of record, restaurants receive payouts as connected accounts,
and OrderNest takes **no cut** — purely a payment facilitator, not a revenue
share (see Checkout & webhook section for how `application_fee_amount` is
still used, as a Stripe-fee pass-through, not platform revenue). No cross-restaurant
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
  restaurant onboards its own connected account via hosted onboarding; platform takes no cut
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
  `application_fee_amount` here is a **Stripe-fee pass-through, not platform revenue** — OrderNest
  takes no cut (explicit product decision); see the Checkout & webhook section for why
  `application_fee_amount` still has to be set to something even at 0% platform take.

**Capability check uses the v2 path, not deprecated v1 fields:**
`account.configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === "active"`
— never `charges_enabled`/`payouts_enabled`. Requires `include: ["configuration.recipient"]` on
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

- Event type: `v2.core.account[configuration.recipient].capability_status_updated` (fires
  specifically when a recipient capability like `stripe_transfers` changes status — more precise
  than the broader `[requirements].updated`).
- Verified with `stripe.parseEventNotificationAsync(rawBody, signature, secret)`, **not**
  `stripe.webhooks.constructEvent()` — a distinct method for thin events.
- The notification payload is tiny (`related_object.id` = the account id, plus the event type) —
  full account details (needed for the capability status) are fetched separately via
  `stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] })`, same
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

**No platform fee — explicit product decision** (confirmed directly, not assumed): OrderNest
"should not [be] involve[d] in any fee... it should purely be between restaurant and stripe...
we are just facilitating payments." A destination charge still lands on the *platform's* Stripe
balance before transferring to the restaurant, so Stripe's own processing fee would otherwise be
deducted from the platform, not the restaurant, by default. `application_fee_amount` is still set
on every session — not as a cut, but as a **pass-through** equal to Stripe's own estimated fee
(`STRIPE_FEE_PERCENT` + `STRIPE_FEE_FIXED_CENTS` in `src/lib/stripe.ts`, currently the standard
Stripe Canada domestic-card rate, 2.9% + $0.30 — an approximation, not exact for every card
type/currency). Net effect: platform nets ~$0 per transaction, restaurant's payout absorbs
Stripe's fee, same as if they'd connected to Stripe directly themselves. If a real platform
revenue model is ever wanted, this is the constant to repurpose — but don't reintroduce it without
being asked; the zero-fee decision was deliberate, not a placeholder.

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
  --thin-events "v2.core.account[configuration.recipient].capability_status_updated" \
  --forward-thin-to localhost:3000/api/webhooks/stripe-connect
```
Installed via `brew install stripe/stripe-cli/stripe` this session. `stripe listen` prints one
`whsec_...` signing secret on startup, shared by both destinations in this local-forwarding mode —
put the same value in `.env.local` as both `STRIPE_WEBHOOK_SECRET` and
`STRIPE_CONNECT_WEBHOOK_SECRET`, then restart `next dev` (env vars aren't hot-reloaded). The
secret is regenerated every time `stripe listen` restarts, so both vars need updating again if the
listener is ever stopped/restarted — they'll drift out of sync if you only update one.

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
  "back to ordering".
- `/r/[slug]/checkout` — **built**: contact/delivery form (`CheckoutForm.tsx`) → `POST
  /api/checkout` prices the cart server-side and creates a destination-charge embedded
  Checkout Session → mounts inline via Stripe.js. Falls back to a "coming soon" notice if
  the restaurant hasn't completed Stripe Connect onboarding yet. See Checkout & webhook
  section above.
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
  Verified end-to-end via browser + DB checks.
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
  `acct_1UBRDfC5FfrDmREo`, onboarded via the hosted flow with `stripe_transfers` active, and at
  least one real paid order from an end-to-end test checkout (on top of the two hand-seeded
  sample orders used to exercise the dashboard before checkout existed).

## Not built yet (in rough priority order)

1. **Deployment** — still local-only (`npm run dev`); Vercel deploy, production env vars, and
   real Stripe Event Destinations (v1 + v2 thin) pointed at the deployed URL instead of
   `stripe listen` are all outstanding.
2. **Restaurant settings UI** — `tax_rate`, `delivery_fee_cents`, `free_delivery_threshold_cents`,
   currency, etc. exist as DB columns (read by checkout/menu pages) but have no admin UI; only
   editable by hand via SQL/seed today. (`delivery_radius_km` and `timezone` are the exceptions —
   editable from `/admin/[slug]/locations` and `/admin/[slug]/hours` respectively.)
3. **Auth completeness** — no password reset flow, no way to invite a second admin to an existing
   restaurant (`restaurant_admins` supports multiple rows, but only onboarding's initial owner
   insert exists). `/onboard` itself is no longer public (platform-admin-gated), but
   `/api/geocode` and `/api/geocode/suggest` still are, with no rate limiting — see "Multi-location
   delivery" above.
4. **Order lifecycle beyond "paid"** — no refund/cancellation handling, no customer-facing order
   status notifications (email/SMS) when status changes.
5. **Branding/customization per tenant** — no logo/image upload for restaurants or menu items
   (emoji only today), no custom domain support.
6. Automated tests — none yet (all verification so far has been manual/live browser + DB checks, plus
   one one-off `npx tsx` script for `isRestaurantOpen()`'s edge cases — not a committed test file).
7. **Ordering-flow gaps found by benchmarking against sardarji.ca** (a real multi-location Indian
   restaurant site, researched live this session — see the git log around the landing-page commit for
   the full comparison). Implemented from that research: the `/r/[slug]` landing page, hours/location
   shown on the order page, menu search, and the direct-location-select list. Still open, roughly in
   the order a customer would notice them:
   - No real scheduled ordering — pickup time is a fixed 4-option dropdown (`CheckoutForm.tsx`), no
     date picker, and delivery has no timing selection at all. No prep-time estimate either.
   - No per-item special instructions — only one restaurant-wide delivery-instructions field exists;
     nothing for pickup orders, nothing per line item.
   - No promo/coupon code system.
   - Menu is flat scrolling sections; no sticky category sidebar nav (sardarji.ca has one with
     per-category item counts) — search (built) covers some of the same need but doesn't replace it
     for a large menu.
   - `menu_items.image_url` exists in the schema but is never read by any page, and there's no admin
     upload for it (or for `restaurants.logo_url`) — menu items only ever show `emoji`. This is also
     why the landing hero is brand-color/typography rather than photography.

