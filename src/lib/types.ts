export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  brand_color: string;
  address: Record<string, string> | null;
  phone: string | null;
  currency: string;
  tax_rate: number;
  delivery_fee_cents: number;
  free_delivery_threshold_cents: number | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  // Platform-billing Customer (cus_...) on OrderNest's own account — separate
  // from stripe_account_id (the restaurant's own connected Account).
  stripe_customer_id: string | null;
  is_live: boolean;
  accepting_orders: boolean;
  delivery_radius_km: number | null;
  timezone: string;
  created_at: string;
};

export type RestaurantHours = {
  id: string;
  restaurant_id: string;
  day_of_week: number; // 0=Sunday .. 6=Saturday
  is_closed: boolean;
  open_time: string | null; // "HH:MM:SS"
  close_time: string | null;
};

export type RestaurantLocation = {
  id: string;
  restaurant_id: string;
  name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  lat: number;
  lng: number;
  supports_delivery: boolean;
  supports_pickup: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type MenuCategory = {
  id: string;
  restaurant_id: string;
  title: string;
  icon: string | null;
  sort_order: number;
};

export type MenuItem = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  emoji: string | null;
  image_url: string | null;
  unit: string | null;
  tags: string[];
  is_available: boolean;
  sort_order: number;
};

export type PromoCode = {
  id: string;
  restaurant_id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number; // percent: 1-100; fixed: cents
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  min_subtotal_cents: number;
  is_active: boolean;
  created_at: string;
};

// Per-restaurant DoorDash Drive credentials — see CLAUDE.md "DoorDash Drive".
// signing_secret is a real secret: never pass a value of this type into a
// Client Component prop.
export type RestaurantDeliveryAccount = {
  id: string;
  restaurant_id: string;
  provider: "doordash";
  developer_id: string;
  key_id: string;
  signing_secret: string;
  pickup_business_name: string;
  pickup_phone: string;
  pickup_address_line1: string;
  pickup_address_line2: string | null;
  pickup_city: string;
  pickup_province: string;
  pickup_postal_code: string;
  pickup_country: string;
  is_active: boolean;
  created_at: string;
};

export type OrderStatus = "pending" | "paid" | "preparing" | "ready" | "completed" | "cancelled";

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  price_cents_snapshot: number;
  quantity: number;
};

export type Order = {
  id: string;
  restaurant_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  fulfillment_mode: "delivery" | "pickup";
  delivery_address: Record<string, string> | null;
  pickup_time: string | null;
  scheduled_for: string | null;
  location_id: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  promo_code: string | null;
  discount_cents: number;
  total_cents: number;
  currency: string;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  refunded_at: string | null;
  // Stripe's own Refund.status — the source of truth for whether the money
  // actually moved, kept in sync by the refund.updated/refund.failed webhook.
  refund_status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
  // DoorDash Drive dispatch state — set by dispatchDeliveryAction, kept in
  // sync afterward by src/app/api/webhooks/doordash/route.ts. dispatch_status
  // is DoorDash's own event_name value, independent of `status` above.
  dispatch_provider: "doordash" | null;
  dispatch_external_delivery_id: string | null;
  dispatch_status: string | null;
  dispatch_tracking_url: string | null;
  dispatch_fee_cents: number | null;
  dispatched_at: string | null;
  created_at: string;
  order_items?: OrderItem[];
};
