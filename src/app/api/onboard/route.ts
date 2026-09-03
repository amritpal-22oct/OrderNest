import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform-admin";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Creates a brand-new tenant: the restaurants row, a Supabase Auth user, and
// the restaurant_admins link making that user its owner. All three only via
// the service-role client — self-serve restaurant_admins inserts are
// deliberately blocked by RLS (only platform admins can normally do this),
// so this trusted server route is the one sanctioned bypass, and it does its
// own validation up front rather than relying on RLS to catch mistakes.
//
// Gated to platform admins only — onboarding used to be public self-serve
// signup, but with no CAPTCHA/rate-limiting and zero platform fee (no billing
// gate to throttle abuse), that's not safe to leave open pre-launch. Can't
// reuse requirePlatformAdmin() here: it calls redirect(), which inside a
// Route Handler hit via fetch() would make the client's res.json() choke on
// a followed redirect instead of getting a clean JSON error.
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await isPlatformAdmin(authClient, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { restaurantName?: string; slug?: string; ownerName?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const restaurantName = body.restaurantName?.trim();
  const slug = body.slug?.trim().toLowerCase();
  const ownerName = body.ownerName?.trim();
  const email = body.email?.trim();
  const password = body.password;

  if (!restaurantName || restaurantName.length < 2) {
    return NextResponse.json({ error: "Restaurant name is too short" }, { status: 400 });
  }
  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Slug must be lowercase letters, numbers, and hyphens only" }, { status: 400 });
  }
  if (!ownerName || ownerName.length < 2) {
    return NextResponse.json({ error: "Your name is too short" }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: existing } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "That slug is already taken" }, { status: 409 });
  }

  const { data: userResult, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: ownerName },
  });
  if (userError || !userResult.user) {
    return NextResponse.json({ error: userError?.message ?? "Unable to create account" }, { status: 400 });
  }
  const userId = userResult.user.id;

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .insert({ slug, name: restaurantName })
    .select("id, slug")
    .single();

  if (restaurantError || !restaurant) {
    await supabase.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: restaurantError?.message ?? "Unable to create restaurant" }, { status: 500 });
  }

  const { error: adminLinkError } = await supabase
    .from("restaurant_admins")
    .insert({ restaurant_id: restaurant.id, user_id: userId, role: "owner" });

  if (adminLinkError) {
    // Best-effort cleanup — this isn't wrapped in a DB transaction, so undo
    // what we can rather than leave an orphaned restaurant with no admin.
    await supabase.from("restaurants").delete().eq("id", restaurant.id);
    await supabase.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: adminLinkError.message }, { status: 500 });
  }

  return NextResponse.json({ slug: restaurant.slug });
}
