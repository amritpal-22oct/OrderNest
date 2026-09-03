import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isPlatformAdmin(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase.from("platform_admins").select("id").eq("id", userId).maybeSingle();
  return !!data;
}

// Server Component guard for /platform-admin pages. Mirrors
// requireRestaurantAdmin's shape but checks platform_admins instead — RLS
// (is_platform_admin(), used inside is_restaurant_admin()) is what actually
// grants a platform admin's session cross-restaurant access to every table;
// this is just the page-level UX gate on top of that.
export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/platform-admin/login");
  }

  if (!(await isPlatformAdmin(supabase, user.id))) {
    redirect("/platform-admin/login?error=not-authorized");
  }

  return { supabase, user };
}
