import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses Row Level Security entirely. Server-only:
// never import this into a Client Component or expose the key to the browser.
// Reserved for trusted server code, e.g. the Stripe webhook writing a paid
// order on the customer's behalf (customers never have a Supabase session).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
