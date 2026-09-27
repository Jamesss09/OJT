/**
 * Hours <-> minutes conversion. See R-1 in [[InternTrack Rules]].
 *
 * The single most important rule in this codebase: hours are NEVER stored or
 * summed as decimals. `0.1 + 0.2 !== 0.3` in IEEE 754, and a timesheet that is
 * off by a hundredth of an hour is not defensible to a supervisor. Everything
 * in this module goes through integer minutes, and floats appear only inside
 * `toMinutes`, where the result is immediately rounded and bounded.
 *
 * Pure module: no React, no react-native, no expo imports (R-8).
 */

export const MINUTES_PER_HOUR = 60;

/** A single calendar day can hold at most 24h = 1440 minutes (R-3). */
export const MAX_MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * Accepted user input: 1-2 digits, optional 1-2 decimal places.
 * A decimal separator may be `.` or `,` so `7,5` works on locales that use it.
 *
 * Deliberately capped at 2 decimal places (= 1 minute of resolution). Accepting
 * `7.333` would round to 440 minutes, and reformatting that as "7.33 h" would
 * no longer round-trip back to 440 — the displayed hours would silently
 * disagree with the stored minutes. Rejecting is honest; rounding is not.
 */
const HOURS_INPUT = /^\d{1,2}(?:[.,]\d{1,2})?$/;

/**
 * Parse user-typed hours into integer minutes.
 *
 * @returns the minute count, or `null` if the input is not a valid duration.
 *   `null` (rather than 0 or NaN) keeps "empty" distinguishable from "zero".
 */
export function toMinutes(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!HOURS_INPUT.test(normalized)) {
    return null;
  }

  const minutes = Math.round(Number(normalized) * MINUTES_PER_HOUR);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES_PER_DAY) {
    return null;
  }

  return minutes;
}

/** A minute count decomposed into whole hours and leftover minutes. */
export type HourParts = {
  hours: number;
  minutes: number;
};

/**
 * Split a minute count into whole hours and leftover minutes.
 *
 * Lossless for every integer input: `hours * 60 + minutes === total` always.
 */
export function splitMinutes(total: number): HourParts {
  assertWholeMinutes(total);
  return {
    hours: Math.floor(total / MINUTES_PER_HOUR),
    minutes: total % MINUTES_PER_HOUR,
  };
}

/**
 * Render stored minutes back into the *input* format, for pre-filling an edit
 * form: `450 -> "7.5"`, `480 -> "8"`, `440 -> "7.33"`.
 *
 * ## Why 2 decimal places are enough, checked rather than assumed
 *
 * I expected this to be lossy. One minute is 0.0166…h, so it seemed obvious that
 * most stored values would have no 2-decimal form and this would need to report
 * failure. I ran all 1440 legal minute counts through the round trip and **every
 * one of them survives**: 2dp is 0.005h = 0.3 min of resolution, well inside the
 * ±0.5 min that `toMinutes` rounds away.
 *
 * So there is no failure case to handle here, and inventing one would have added
 * a branch no entry could ever reach. `hours.test.ts` keeps the exhaustive check
 * so this stays a measured property rather than a comment.
 *
 * Note `440 -> "7.33"`: that reads as a lie to someone comparing it against
 * "7h 20m", but it is the only 2-decimal form that exists, and it round-trips to
 * the same stored 440. That is the property that matters for an edit form — the
 * value survives a save unchanged. For text a person reads, use
 * `formatDuration`, which is exact.
 *
 * `0` returns `"0"`, which R-3 rejects as an entry. No stored entry can be 0, so
 * this only matters to a caller passing a value the database would not hold.
 */
export function toHoursText(minutes: number): string {
  assertWholeMinutes(minutes);
  return (minutes / MINUTES_PER_HOUR).toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Format a minute count for display, e.g. `450 -> "7h 30m"`, `480 -> "8h"`.
 *
 * ### Why there is no decimal-hours output function
 * Minutes cannot always be expressed as a decimal number of hours: 1 minute is
 * 0.0166…h, and only minute counts divisible by 3 land on a 2-decimal boundary
 * (1/60 = 0.0(16)). A `minutes -> "7.33 h"` formatter would therefore be
 * *lying* for 2 of every 3 valid minute values — printing 7.33 h for a stored
 * 440 minutes that is really 7h 20m. That is precisely the class of bug R-1
 * exists to prevent, so this module offers only lossless forms:
 *
 * - `splitMinutes()` for maths, and
 * - `formatDuration()` for text.
 *
 * When the UI needs to echo what the intern just typed, it shows their own raw
 * input text rather than re-deriving a value from minutes.
 */
export function formatDuration(total: number): string {
  const { hours, minutes } = splitMinutes(total);

  if (minutes === 0) {
    return `${hours}h`;
  }
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Clamp a minute count into the legal range for a single day.
 *
 * Not used for validation — `validateEntry` rejects out-of-range input outright
 * (R-3). This exists for UI affordances such as a "+30m" stepper, where
 * clamping is the friendlier behaviour.
 */
export function clampToDay(minutes: number): number {
  if (minutes < 0) {
    return 0;
  }
  return Math.min(minutes, MAX_MINUTES_PER_DAY);
}

function assertWholeMinutes(total: number): void {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`expected a non-negative whole number of minutes, got ${total}`);
  }
}

// NOTE: there is deliberately no `sumMinutes()` helper here.
// Totals are computed by `SUM(minutes)` in SQL (R-7). A JS reducer over a list
// of entries would invite exactly the client-side aggregation R-7 forbids, and
// would reintroduce the float drift R-1 exists to prevent.
