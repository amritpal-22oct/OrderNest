import { NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

// Public — anonymous customers on /r/[slug]/checkout call this to turn a typed
// address into coordinates when they don't share browser geolocation. No rate
// limiting yet (same class of gap as the pre-fix /onboard, lower stakes here).
export async function POST(request: Request) {
  const body = await request.json();
  const address = (body?.address as string)?.trim();

  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  let result;
  try {
    result = await geocodeAddress(address);
  } catch {
    return NextResponse.json({ error: "Unable to look up address right now" }, { status: 502 });
  }

  if (!result) {
    return NextResponse.json({ error: "No matching address found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
