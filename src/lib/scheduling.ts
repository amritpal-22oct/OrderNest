import type { RestaurantHours } from "./types";
import { isRestaurantOpen } from "./hours";

const SLOT_MINUTES = 30;
// Also the cap for "unrestricted" mode's date picker (no hours configured) —
// exported so the client can mirror it in the date input's max attribute
// rather than hand-copying the number.
export const DAYS_AHEAD = 7;

export type SlotOption = { value: string; label: string }; // value = ISO UTC instant

export type DayOption = { date: string; label: string; slots: SlotOption[] }; // date = "YYYY-MM-DD" in the restaurant's own timezone

export type SchedulingAvailability = { mode: "unrestricted" } | { mode: "slots"; days: DayOption[] };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Turns a restaurant-local wall-clock date+time into a real UTC instant.
// Offset-probe technique (same "plain platform API, no date library" style as
// hours.ts): format the naive-UTC guess as if it were in the target timezone,
// read back the wall-clock components Intl produces, and the delta from the
// guess is the zone's offset at that instant.
export function zonedTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(naiveUtcMs));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtcMs = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);

  const offsetMs = asUtcMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs);
}

function todayPartsInTimezone(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: +map.year, month: +map.month, day: +map.day };
}

// Calendar-date arithmetic (Y-M-D + N days, and the resulting day-of-week) is
// timezone-independent — a Y-M-D triple maps to a fixed weekday no matter
// what zone you consider it from — so plain UTC Date math is safe here even
// though the dates themselves represent the restaurant's local calendar.
function addCalendarDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dayOfWeek: d.getUTCDay() };
}

function dayLabel(year: number, month: number, day: number, dayOffset: number): string {
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${period}`;
}

function slotsForRange(dateStr: string, openTime: string, closeTimeExclusive: string, timezone: string, now: Date): SlotOption[] {
  const slots: SlotOption[] = [];
  let [h, m] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTimeExclusive.split(":").map(Number);
  while (h < closeH || (h === closeH && m < closeM)) {
    const hhmm = `${pad(h)}:${pad(m)}`;
    const instant = zonedTimeToUtc(dateStr, hhmm, timezone);
    if (instant.getTime() >= now.getTime()) {
      slots.push({ value: instant.toISOString(), label: timeLabel(hhmm) });
    }
    m += SLOT_MINUTES;
    if (m >= 60) {
      m -= 60;
      h += 1;
    }
  }
  return slots;
}

// No hours configured = "always open" (same backward-compatible default as
// isRestaurantOpen) — nothing to enumerate against, so the UI falls back to a
// plain datetime-local input instead of day/slot pickers.
export function getSchedulingAvailability(hours: RestaurantHours[], timezone: string, now: Date = new Date()): SchedulingAvailability {
  if (hours.length === 0) return { mode: "unrestricted" };

  const hoursByDay = new Map(hours.map((h) => [h.day_of_week, h]));
  const today = todayPartsInTimezone(timezone, now);

  const days: DayOption[] = [];
  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    const { year, month, day, dayOfWeek } = addCalendarDays(today.year, today.month, today.day, offset);
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const row = hoursByDay.get(dayOfWeek);

    let slots: SlotOption[] = [];
    if (row && !row.is_closed && row.open_time && row.close_time) {
      if (row.close_time > row.open_time) {
        slots = slotsForRange(dateStr, row.open_time.slice(0, 5), row.close_time.slice(0, 5), timezone, now);
      } else {
        // Overnight wrap: this calendar day's own stretch runs open_time..23:59.
        slots = slotsForRange(dateStr, row.open_time.slice(0, 5), "24:00", timezone, now);
      }
    }

    // Carry-over from an overnight-wrap the *previous* day, mirroring
    // isRestaurantOpen's yesterday check: early-morning slots on this
    // calendar day that actually belong to yesterday's late stretch.
    const prevDayOfWeek = (dayOfWeek + 6) % 7;
    const prevRow = hoursByDay.get(prevDayOfWeek);
    if (prevRow && !prevRow.is_closed && prevRow.open_time && prevRow.close_time && prevRow.close_time < prevRow.open_time) {
      slots = [...slotsForRange(dateStr, "00:00", prevRow.close_time.slice(0, 5), timezone, now), ...slots];
    }

    if (slots.length > 0) {
      days.push({ date: dateStr, label: dayLabel(year, month, day, offset), slots });
    }
  }

  return { mode: "slots", days };
}

export function isValidScheduledTime(
  hours: RestaurantHours[],
  timezone: string,
  scheduledFor: Date,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: "past" | "too_far" | "closed" } {
  if (scheduledFor.getTime() < now.getTime()) return { ok: false, reason: "past" };
  // Same window "slots" mode already enumerates (DAYS_AHEAD) — the
  // "unrestricted" (no hours configured) case had no upper bound at all
  // before this, letting the client's datetime-local input accept any
  // future date.
  if (scheduledFor.getTime() > now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000) return { ok: false, reason: "too_far" };
  if (hours.length > 0 && !isRestaurantOpen(hours, timezone, scheduledFor)) return { ok: false, reason: "closed" };
  return { ok: true };
}
