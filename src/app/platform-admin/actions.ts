"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/platform-admin/login");
}

// Saves the platform-billing Stripe Customer id (cus_...) a platform admin
// created by hand in the Stripe Dashboard, so the dashboard below can look up
// live subscription status instead of tracking it manually in the app.
// Unrelated to stripe_account_id (the restaurant's own connected Account) —
// RLS's "platform admins manage restaurants" policy is what actually
// authorizes this write; this page is only reachable by a platform admin
// anyway (requirePlatformAdmin), same trust pattern as the rest of this file.
export async function updateStripeCustomerIdAction(formData: FormData) {
  const restaurantId = formData.get("restaurantId") as string;
  const stripeCustomerId = (formData.get("stripeCustomerId") as string | null)?.trim() || null;

  const supabase = await createClient();
  await supabase.from("restaurants").update({ stripe_customer_id: stripeCustomerId }).eq("id", restaurantId);

  revalidatePath("/platform-admin");
}

// Creates the platform-billing Stripe Customer (cus_...) on OrderNest's own
// account for a restaurant that doesn't have one yet — a convenience over
// doing the equivalent by hand in the Stripe Dashboard, still just a plain
// Customer with no subscription attached. Actual subscription creation stays
// a manual Dashboard step by design (see stripe_customer_id's comment in
// schema.sql) — this only removes the copy/paste step.
export async function setUpPlatformBillingAction(formData: FormData) {
  const restaurantId = formData.get("restaurantId") as string;

  const supabase = await createClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name, slug, stripe_customer_id")
    .eq("id", restaurantId)
    .maybeSingle();
  // Already has one, or the row vanished — nothing to do. Guards against a
  // double-click creating two Customers for the same restaurant.
  if (!restaurant || restaurant.stripe_customer_id) {
    revalidatePath("/platform-admin");
    return;
  }

  // The owner's email makes for a more useful Stripe Customer record than
  // just a name. restaurants has no email column of its own, so this looks
  // up the owner via restaurant_admins (RLS already allows a platform admin
  // to read any restaurant's rows there) and reads auth.users through the
  // service-role client — the session client has no access to auth.users.
  const { data: ownerLink } = await supabase
    .from("restaurant_admins")
    .select("user_id")
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner")
    .maybeSingle();

  let email: string | undefined;
  if (ownerLink) {
    const adminClient = createAdminClient();
    const { data: userResult } = await adminClient.auth.admin.getUserById(ownerLink.user_id);
    email = userResult.user?.email ?? undefined;
  }

  const customer = await stripe.customers.create({
    name: restaurant.name,
    email,
    metadata: { restaurant_id: restaurant.id, slug: restaurant.slug },
  });

  await supabase.from("restaurants").update({ stripe_customer_id: customer.id }).eq("id", restaurantId);

  revalidatePath("/platform-admin");
}
