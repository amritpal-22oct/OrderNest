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
  is_live: boolean;
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
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  status: OrderStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  order_items?: OrderItem[];
};
