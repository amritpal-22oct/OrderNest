import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePromoCode } from "@/lib/promo";

// Public — used only for the checkout UI's "Apply" button feedback. Never
// trusted by /api/checkout itself, which re-validates independently. Uses the
// admin client because promo_codes has no public select policy (see schema.sql).
export async function POST(request: Request) {
  const body = await request.json();
  const slug = (body?.slug as string)?.trim();
  const code = (body?.code as string)?.trim();
  const subtotalCents = Number(body?.subtotalCents);

  if (!slug || !code || !Number.isFinite(subtotalCents) || subtotalCents < 0) {
    return NextResponse.json({ ok: false, error: "Missing or invalid request" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: restaurant } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
  if (!restaurant) {
    return NextResponse.json({ ok: false, error: "Restaurant not found" }, { status: 404 });
  }

  const result = await validatePromoCode(supabase, restaurant.id, code, subtotalCents);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error });
  }
  return NextResponse.json({ ok: true, discountCents: result.discountCents });
}
