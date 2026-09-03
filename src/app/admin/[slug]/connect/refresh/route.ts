import { NextRequest, NextResponse } from "next/server";
import { createAccountLinkForRestaurant } from "@/lib/stripe-connect";

// Stripe redirects here if a previously-issued Account Link expired before
// the admin finished onboarding — issue a fresh one and send them back.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const origin = new URL(request.url).origin;
  const url = await createAccountLinkForRestaurant(slug, origin);
  return NextResponse.redirect(url);
}
