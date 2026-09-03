-- OrderNest platform schema
-- Multi-tenant: every ordering/menu/order table is scoped by restaurant_id.

create extension if not exists "pgcrypto";

-- ---------- Core tables ----------

-- You / your team — full cross-restaurant access.
create table platform_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- A tenant. One row per restaurant customer.
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  logo_url text,
  brand_color text not null default '#b3435c',
  address jsonb,
  phone text,
  currency text not null default 'cad',
  tax_rate numeric not null default 0.13,
  delivery_fee_cents integer not null default 0,
  free_delivery_threshold_cents integer,
  stripe_account_id text,
  stripe_onboarding_complete boolean not null default false,
  -- Platform-billing Customer (cus_...) on OrderNest's own Stripe account —
  -- unrelated to stripe_account_id above (the restaurant's connected Account
  -- for their own order payments). Subscriptions are created/managed by hand
  -- in the Stripe Dashboard (no in-app Checkout/webhook integration by
  -- design); this id is pasted in once so the platform-admin dashboard can
  -- look up live subscription status instead of tracking it manually.
  stripe_customer_id text,
  is_live boolean not null default false,
  delivery_radius_km numeric,
  timezone text not null default 'America/Toronto',
  -- Manual pause switch, independent of hours-of-operation: hours describe a
  -- recurring weekly schedule and still allow scheduling ahead for a later
  -- open slot even while currently closed; this is a blunter "not taking any
  -- orders right now" toggle (ASAP or scheduled) for things hours can't
  -- express — short-staffed, temporarily overwhelmed, closed for the day
  -- outside the normal schedule. Defaults true so every existing tenant is
  -- unaffected until an admin explicitly pauses.
  accepting_orders boolean not null default true,
  created_at timestamptz not null default now()
);

-- Per-day operating hours. No rows at all = always open (backward-compatible
-- default for every existing tenant); once an admin saves hours, all 7 days
-- get a row (even if marked closed) so there's no ambiguous partial state.
create table restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0=Sunday .. 6=Saturday
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  unique (restaurant_id, day_of_week)
);

-- A physical location of a restaurant. Menu/pricing (tax_rate, delivery_fee_cents,
-- free_delivery_threshold_cents, delivery_radius_km) stay per-restaurant, shared
-- across all of a restaurant's locations — this table only adds geography and
-- per-location delivery/pickup availability, not per-location menus or pricing.
create table restaurant_locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  province text not null,
  postal_code text not null,
  country text not null default 'CA',
  lat double precision not null,
  lng double precision not null,
  supports_delivery boolean not null default true,
  supports_pickup boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Which Supabase auth users can administer which restaurant.
create table restaurant_admins (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner', -- owner | staff
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  title text not null,
  icon text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  price_cents integer not null,
  emoji text,
  image_url text,
  unit text,
  tags text[] not null default '{}',
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete restrict,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  fulfillment_mode text not null check (fulfillment_mode in ('delivery', 'pickup')),
  delivery_address jsonb,
  pickup_time text, -- human display label, now used for both fulfillment modes
  scheduled_for timestamptz, -- null = ASAP
  location_id uuid references restaurant_locations(id) on delete set null,
  subtotal_cents integer not null,
  delivery_fee_cents integer not null default 0,
  tax_cents integer not null default 0,
  promo_code text, -- plain snapshot, not an FK — survives the promo row being edited/deleted later
  discount_cents integer not null default 0,
  total_cents integer not null,
  currency text not null default 'cad',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'preparing', 'ready', 'completed', 'cancelled')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  -- Set together when cancelAndRefundOrderAction (src/app/admin/[slug]/actions.ts)
  -- issues a refund. stripe_refund_id is the audit trail back to the actual
  -- Stripe Refund object, and the join key the stripe webhook uses to find
  -- this row again when the refund's status changes asynchronously.
  -- refunded_at is when the refund was *requested*, not necessarily when it
  -- finished — Stripe refunds aren't always instant (see refund_status).
  stripe_refund_id text,
  refunded_at timestamptz,
  -- Stripe's own Refund.status ('pending' | 'requires_action' | 'succeeded' |
  -- 'failed' | 'canceled'), not assumed from "the create call didn't throw" —
  -- a refund can come back pending and later fail asynchronously (Stripe's
  -- refund.updated / refund.failed webhook events, handled in
  -- src/app/api/webhooks/stripe/route.ts, keep this in sync). This is the
  -- actual source of truth for "did the money move," independent of `status`
  -- above, which stays 'cancelled' regardless of how the refund resolves.
  refund_status text,
  created_at timestamptz not null default now()
);

-- Restaurant-scoped promo/coupon codes. Deliberately NO public select policy —
-- the one table in this app that must not be scrapeable; customer-facing
-- validation goes through a service-role route (src/lib/promo.ts) instead.
create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value integer not null check (discount_value > 0), -- percent: 1-100; fixed: cents
  max_uses integer,
  uses_count integer not null default 0,
  expires_at timestamptz,
  min_subtotal_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, code)
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  name_snapshot text not null,
  price_cents_snapshot integer not null,
  quantity integer not null
);

-- ---------- Indexes ----------

create index restaurant_admins_user_id_idx on restaurant_admins (user_id);
create index restaurant_locations_restaurant_id_idx on restaurant_locations (restaurant_id);
create index restaurant_hours_restaurant_id_idx on restaurant_hours (restaurant_id);
create index promo_codes_restaurant_id_idx on promo_codes (restaurant_id);
create index menu_categories_restaurant_id_idx on menu_categories (restaurant_id);
create index menu_items_restaurant_id_idx on menu_items (restaurant_id);
create index orders_restaurant_id_created_at_idx on orders (restaurant_id, created_at desc);
create index orders_location_id_idx on orders (location_id);
-- Enforces webhook idempotency: checkout.session.completed retries must not create duplicate orders.
create unique index orders_stripe_checkout_session_id_key on orders (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index order_items_order_id_idx on order_items (order_id);

-- ---------- Row Level Security ----------

alter table platform_admins enable row level security;
alter table restaurants enable row level security;
alter table restaurant_locations enable row level security;
alter table restaurant_hours enable row level security;
alter table promo_codes enable row level security;
alter table restaurant_admins enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create or replace function is_platform_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from platform_admins where id = auth.uid());
$$;

create or replace function is_restaurant_admin(target_restaurant_id uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from restaurant_admins
    where restaurant_id = target_restaurant_id and user_id = auth.uid()
  ) or is_platform_admin();
$$;

create policy "platform admins see platform_admins" on platform_admins
  for select using (is_platform_admin());

create policy "restaurants are publicly readable" on restaurants
  for select using (true);
create policy "platform admins manage restaurants" on restaurants
  for all using (is_platform_admin()) with check (is_platform_admin());
create policy "restaurant admins update their own restaurant" on restaurants
  for update using (is_restaurant_admin(id)) with check (is_restaurant_admin(id));

create policy "restaurant locations are publicly readable" on restaurant_locations
  for select using (true);
create policy "restaurant admins manage their locations" on restaurant_locations
  for all using (is_restaurant_admin(restaurant_id)) with check (is_restaurant_admin(restaurant_id));

create policy "restaurant hours are publicly readable" on restaurant_hours
  for select using (true);
create policy "restaurant admins manage their hours" on restaurant_hours
  for all using (is_restaurant_admin(restaurant_id)) with check (is_restaurant_admin(restaurant_id));

-- No public select policy on purpose — promo codes must not be scrapeable by
-- anonymous customers. Validation at checkout goes through a service-role
-- route (src/lib/promo.ts), same sanctioned bypass /api/onboard already uses.
create policy "restaurant admins manage their promo codes" on promo_codes
  for all using (is_restaurant_admin(restaurant_id)) with check (is_restaurant_admin(restaurant_id));

create policy "admins see their own restaurant_admins rows" on restaurant_admins
  for select using (user_id = auth.uid() or is_platform_admin());
create policy "platform admins manage restaurant_admins" on restaurant_admins
  for all using (is_platform_admin()) with check (is_platform_admin());

create policy "menu categories are publicly readable" on menu_categories
  for select using (true);
create policy "restaurant admins manage their categories" on menu_categories
  for all using (is_restaurant_admin(restaurant_id)) with check (is_restaurant_admin(restaurant_id));

create policy "menu items are publicly readable" on menu_items
  for select using (true);
create policy "restaurant admins manage their menu items" on menu_items
  for all using (is_restaurant_admin(restaurant_id)) with check (is_restaurant_admin(restaurant_id));

-- Orders are written only by the server (service role key bypasses RLS entirely,
-- e.g. from the Stripe webhook handler) — no public insert policy on purpose.
create policy "restaurant admins read their orders" on orders
  for select using (is_restaurant_admin(restaurant_id));
create policy "restaurant admins update their orders" on orders
  for update using (is_restaurant_admin(restaurant_id)) with check (is_restaurant_admin(restaurant_id));

create policy "restaurant admins read their order items" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_id and is_restaurant_admin(o.restaurant_id))
  );

-- ---------- Storage: menu item images ----------
-- Path convention: {restaurant_id}/{uuid}.{ext} — storage.foldername(name)[1]
-- is the restaurant_id folder; reuses is_restaurant_admin(uuid) directly,
-- same authorization primitive as every other table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-item-images', 'menu-item-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "menu item images are publicly readable"
on storage.objects for select using (bucket_id = 'menu-item-images');

create policy "restaurant admins upload their own menu item images"
on storage.objects for insert to authenticated
with check (bucket_id = 'menu-item-images' and is_restaurant_admin((storage.foldername(name))[1]::uuid));

create policy "restaurant admins update their own menu item images"
on storage.objects for update to authenticated
using (bucket_id = 'menu-item-images' and is_restaurant_admin((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'menu-item-images' and is_restaurant_admin((storage.foldername(name))[1]::uuid));

create policy "restaurant admins delete their own menu item images"
on storage.objects for delete to authenticated
using (bucket_id = 'menu-item-images' and is_restaurant_admin((storage.foldername(name))[1]::uuid));

-- ---------- Storage: restaurant logos ----------
-- Same shape as menu-item-images (path {restaurant_id}/{uuid}.{ext}, public
-- read, is_restaurant_admin-gated write). In practice the only writer today
-- is /api/onboard uploading the new restaurant's logo via the service-role
-- client (bypasses RLS — the uploading platform admin isn't yet a
-- restaurant_admin of the restaurant being created, so these policies
-- couldn't authorize that upload even if they tried); the restaurant-admin
-- policies below exist for a future self-service "edit my logo" page.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-logos', 'restaurant-logos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "restaurant logos are publicly readable"
on storage.objects for select using (bucket_id = 'restaurant-logos');

create policy "restaurant admins upload their own logo"
on storage.objects for insert to authenticated
with check (bucket_id = 'restaurant-logos' and is_restaurant_admin((storage.foldername(name))[1]::uuid));

create policy "restaurant admins update their own logo"
on storage.objects for update to authenticated
using (bucket_id = 'restaurant-logos' and is_restaurant_admin((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'restaurant-logos' and is_restaurant_admin((storage.foldername(name))[1]::uuid));

create policy "restaurant admins delete their own logo"
on storage.objects for delete to authenticated
using (bucket_id = 'restaurant-logos' and is_restaurant_admin((storage.foldername(name))[1]::uuid));
