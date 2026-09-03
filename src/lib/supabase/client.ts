import { createBrowserClient } from "@supabase/ssr";

// For use in Client Components. Runs with the anon key + the visitor's
// session cookie, so it's bound by Row Level Security like any other user.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
