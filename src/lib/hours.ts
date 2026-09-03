import type { RestaurantHours } from "./types";

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Reads the restaurant's local day-of-week and time-of-day via Intl, no extra
// dependency needed (same "no SDK, plain platform API" choice as geocode.ts).
function localParts(timezone: string, date: Date): { dayOfWeek: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = map.hour === "24" ? "00" : map.hour.padStart(2, "0");
  return { dayOfWeek: WEEKDAY_INDEX[map.weekday], time: `${hour}:${map.minute}:${map.second}` };
}

// No rows at all = always open — the backward-compatible default for every
// restaurant that hasn't configured hours yet (mirrors the "zero locations =
// skip entirely" rule for the locations feature).
export function isRestaurantOpen(hours: RestaurantHours[], timezone: string, now: Date = new Date()): boolean {
  if (hours.length === 0) return true;

  const { dayOfWeek, time } = localParts(timezone, now);
  const yesterday = (dayOfWeek + 6) % 7;

  const today = hours.find((h) => h.day_of_week === dayOfWeek);
  const openViaToday =
    !!today && !today.is_closed && !!today.open_time && !!today.close_time && isWithinTodayRange(today, time);

  const prev = hours.find((h) => h.day_of_week === yesterday);
  const openViaOvernightCarry =
    !!prev &&
    !prev.is_closed &&
    !!prev.open_time &&
    !!prev.close_time &&
    prev.close_time < prev.open_time && // overnight wrap
    time < prev.close_time;

  return openViaToday || openViaOvernightCarry;
}

function isWithinTodayRange(row: RestaurantHours, time: string): boolean {
  const open = row.open_time!;
  const close = row.close_time!;
  if (close > open) return time >= open && time < close; // normal same-day range
  return time >= open; // overnight wrap — "open" today means the late stretch has started
}

export function getTodayHours(hours: RestaurantHours[], timezone: string, now: Date = new Date()): RestaurantHours | null {
  const { dayOfWeek } = localParts(timezone, now);
  return hours.find((h) => h.day_of_week === dayOfWeek) ?? null;
}
