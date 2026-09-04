import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/lib/types";

export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("restaurants").select("*").eq("slug", slug).maybeSingle();
  if (error) {
    // A real query failure (auth/session hiccup, network blip, etc.) looks
    // identical to "no such restaurant" if we only check `data` — surface it
    // instead of silently treating every failure as a 404.
    console.error(`getRestaurantBySlug(${slug}) failed:`, error);
  }
  return data;
}

// Server Component guard for /admin/[slug] pages: redirects to login if
// there's no session, and to the login page (with an error) if the logged-in
// user isn't an admin for this restaurant. RLS enforces the same boundary on
// every query underneath this, so this is a UX shortcut, not the security
// boundary itself.
export async function requireRestaurantAdmin(slug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/admin/${slug}/login`);
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    redirect(`/admin/${slug}/login?error=not-found`);
  }

  const { data: membership } = await supabase
    .from("restaurant_admins")
    .select("id, role")
    .eq("restaurant_id", restaurant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!membership && !platformAdmin) {
    redirect(`/admin/${slug}/login?error=not-authorized`);
  }

  // Platform admins aren't a restaurant_admins row at all (RLS's
  // is_platform_admin() is what actually grants them access), so they have
  // no `role` to read — treat them as owner-equivalent rather than gating
  // owner-only actions (like opening the connected account's Stripe
  // Dashboard) away from the one login that can already see every
  // restaurant's data anyway.
  const role = membership?.role ?? "owner";

  return { supabase, user, restaurant, role };
}
