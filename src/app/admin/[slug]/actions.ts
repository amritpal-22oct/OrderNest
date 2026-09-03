"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAccountLinkForRestaurant } from "@/lib/stripe-connect";
import type { OrderStatus } from "@/lib/types";

export async function siteOrigin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host")}`;
}

// Sends the admin to Stripe's hosted onboarding for this restaurant's
// connected account (creating the account first if it doesn't exist yet).
export async function connectStripeAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const url = await createAccountLinkForRestaurant(slug, await siteOrigin());
  redirect(url);
}

export async function signOutAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/admin/${slug}/login`);
}

const VALID_STATUSES: OrderStatus[] = ["pending", "paid", "preparing", "ready", "completed", "cancelled"];

export async function updateOrderStatusAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const orderId = formData.get("orderId") as string;
  const status = formData.get("status") as OrderStatus;

  if (!VALID_STATUSES.includes(status)) return;

  // RLS (is_restaurant_admin) enforces that only this restaurant's admins
  // can update this row — this update is a no-op for anyone else's session.
  const supabase = await createClient();
  await supabase.from("orders").update({ status }).eq("id", orderId);

  revalidatePath(`/admin/${slug}`);
}
