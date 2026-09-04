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

// Adds (or re-roles) an admin login for an existing restaurant — the missing
// piece noted in CLAUDE.md's "Auth completeness" gap: /api/onboard only ever
// creates the initial `owner` row for a brand-new restaurant, and nothing
// anywhere could add a second admin to one that already exists.
//
// Also doubles as the password-reset mechanism: OrderNest has no self-serve
// forgot-password flow by explicit product decision — every account change
// (new logins, role changes, forgotten passwords alike) goes through a
// platform admin here instead. So a non-empty password field on an existing
// login means "reset it", not just "re-link/re-role them" — see the
// `password && userId` branch below.
//
// No invite-email flow exists either (no accept-invite/set-password page to
// land an emailed link on), so a brand-new login's password is set directly
// by the platform admin (shared with the new admin out of band) rather than
// Supabase emailing a half-working invite link with nowhere to land.
export async function addRestaurantAdminAction(formData: FormData) {
  const restaurantId = formData.get("restaurantId") as string;
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const password = (formData.get("password") as string | null) ?? "";
  const role = formData.get("role") === "staff" ? "staff" : "owner";

  if (!email) {
    redirect(`/platform-admin?adminError=${encodeURIComponent("Email is required.")}`);
  }

  const adminClient = createAdminClient();

  // The installed supabase-js version's listUsers() has no email filter, so
  // an existing-login check means paging through and matching client-side.
  // Fine at this app's platform-wide user count; would need a real filter
  // (or a users-by-email lookup table) if that stops being true.
  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || data.users.length === 0) break;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 1000) break;
  }

  if (!userId) {
    if (password.length < 8) {
      redirect(
        `/platform-admin?adminError=${encodeURIComponent("That email has no existing OrderNest login — set an initial password (8+ characters) to create one.")}`,
      );
    }
    const { data, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      redirect(`/platform-admin?adminError=${encodeURIComponent(error?.message ?? "Couldn't create that login.")}`);
    } else {
      userId = data.user.id;
    }
  } else if (password) {
    if (password.length < 8) {
      redirect(`/platform-admin?adminError=${encodeURIComponent("Password must be 8+ characters.")}`);
    }
    const { error } = await adminClient.auth.admin.updateUserById(userId, { password });
    if (error) {
      redirect(`/platform-admin?adminError=${encodeURIComponent(error.message)}`);
    }
  }

  const supabase = await createClient();
  const { error: linkError } = await supabase
    .from("restaurant_admins")
    .upsert({ restaurant_id: restaurantId, user_id: userId, role }, { onConflict: "restaurant_id,user_id" });
  if (linkError) {
    redirect(`/platform-admin?adminError=${encodeURIComponent(linkError.message)}`);
  }

  revalidatePath("/platform-admin");
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
