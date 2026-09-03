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
  is_live boolean not null default false,
  delivery_radius_km numeric,
  created_at timestamptz not null default now()
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
  pickup_time text,
  location_id uuid references restaurant_locations(id) on delete set null,
  subtotal_cents integer not null,
  delivery_fee_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null,
  currency text not null default 'cad',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'preparing', 'ready', 'completed', 'cancelled')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
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
