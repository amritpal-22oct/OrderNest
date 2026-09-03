"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

// Saves all 7 days at once (upsert on the restaurant_id+day_of_week unique
// constraint) so hours are never left in a partial/ambiguous state — a
// restaurant either has no rows at all (always open, see src/lib/hours.ts)
// or a complete week. RLS (is_restaurant_admin) is the real authorization
// boundary, same as every other admin action in this app.
export async function saveHoursAction(formData: FormData) {
  const slug = formData.get("slug") as string;
  const restaurantId = formData.get("restaurantId") as string;
  const timezone = (formData.get("timezone") as string)?.trim() || "America/Toronto";

  const rows = DAYS.map((day) => {
    const isClosed = formData.get(`closed_${day}`) === "on";
    const openTime = (formData.get(`open_${day}`) as string) || null;
    const closeTime = (formData.get(`close_${day}`) as string) || null;
    return {
      restaurant_id: restaurantId,
      day_of_week: day,
      is_closed: isClosed,
      open_time: isClosed ? null : openTime,
      close_time: isClosed ? null : closeTime,
    };
  });

  const supabase = await createClient();
  await supabase.from("restaurants").update({ timezone }).eq("id", restaurantId);
  await supabase.from("restaurant_hours").upsert(rows, { onConflict: "restaurant_id,day_of_week" });
  revalidatePath(`/admin/${slug}/hours`);
}
