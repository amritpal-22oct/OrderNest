import { NextRequest, NextResponse } from "next/server";
import { suggestAddresses } from "@/lib/geocode";

// Public — powers live address-suggestion-as-you-type in the customer-facing
// location picker. Same no-rate-limiting gap as /api/geocode (see CLAUDE.md),
// worse here since it fires per keystroke rather than once per checkout.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await suggestAddresses(query);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
