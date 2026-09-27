/**
 * Calendar-date arithmetic for entry dates. See R-4 and R-5 in [[InternTrack Rules]].
 *
 * Design note — why this module avoids `Date` almost entirely:
 *
 * An entry date is a *calendar day*, not an instant. Storing or doing maths on
 * a timestamp is a bug source: `toISOString()` converts to UTC, which silently
 * moves the day for anyone not on UTC, and adding a day across a DST boundary
 * can land on 23:00 the previous day in some zones. So dates are carried as
 * ISO `YYYY-MM-DD` strings and parsed into plain `{ year, month, day }` numbers.
 * `Date.UTC` is used only as a day-number calculator; all reads go through UTC
 * getters, so no local-timezone rule can ever apply. The one place the device's
 * local calendar is genuinely needed — "what is today" — is `todayISODate()`.
 *
 * ISO strings sort lexicographically, so `<` and `>` on two date strings are
 * valid comparisons. That is why range queries are `BETWEEN` on TEXT (R-7).
 *
 * Pure module: no React, no react-native, no expo imports (R-8).
 */

/** A calendar day, with no time and no timezone. `month` is 1-12. */
export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

/** Inclusive range of ISO dates, as used by report queries. */
export type DateRange = {
  start: string;
  end: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * Parse a `YYYY-MM-DD` string into a calendar date.
 *
 * @returns `null` if the string is malformed or names a day that does not
 *   exist. Round-tripping through `Date.UTC` is what catches `2026-02-31`,
 *   which would otherwise silently become 2 March.
 */
export function parseISODate(iso: string): CalendarDate | null {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    return null;
  }

  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const asUTC = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    asUTC.getUTCFullYear() === year &&
    asUTC.getUTCMonth() === month - 1 &&
    asUTC.getUTCDate() === day;

  if (!roundTrips) {
    return null;
  }

  return { year, month, day };
}

/** True if the string is a real, existing calendar date. */
export function isValidISODate(iso: string): boolean {
  return parseISODate(iso) !== null;
}

/** Format a calendar date (or a `Date.UTC` day number) as `YYYY-MM-DD`. */
export function toISODate(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/**
 * Today's date in the **device's local timezone**.
 *
 * This is the only function in the module that reads the local clock, and it
 * must: the intern's "today" is their own wall-clock day.
 */
export function todayISODate(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True if the ISO date is a real date strictly after today (R-3). */
export function isFutureISODate(iso: string, now: Date = new Date()): boolean {
  if (!isValidISODate(iso)) {
    return false;
  }
  return iso > todayISODate(now);
}

/** Shift an ISO date by whole days. Rolls over months and years correctly. */
export function addDays(iso: string, days: number): string {
  const parsed = parseISODate(iso);
  if (!parsed) {
    throw new RangeError(`addDays received an invalid ISO date: ${iso}`);
  }

  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return toISODate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Day of week for an ISO date, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  const parsed = parseISODate(iso);
  if (!parsed) {
    throw new RangeError(`dayOfWeek received an invalid ISO date: ${iso}`);
  }
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/** Number of days in a month, e.g. 29 for February 2028 (a leap year). */
export function daysInMonth(iso: string): number {
  const parsed = parseISODate(iso);
  if (!parsed) {
    throw new RangeError(`daysInMonth received an invalid ISO date: ${iso}`);
  }
  return new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
}

/**
 * The Monday-to-Sunday week containing `iso`, inclusive (R-5).
 *
 * ISO weeks: the week belongs to the month containing its Monday, so a week
 * spanning a month boundary is never a partial week.
 */
export function weekRange(iso: string): DateRange {
  // getUTCDay is 0=Sun..6=Sat; shift so Monday is 0.
  const offsetFromMonday = (dayOfWeek(iso) + 6) % 7;
  const start = addDays(iso, -offsetFromMonday);
  return { start, end: addDays(start, 6) };
}

/** The calendar month containing `iso`, inclusive. */
export function monthRange(iso: string): DateRange {
  const parsed = parseISODate(iso);
  if (!parsed) {
    throw new RangeError(`monthRange received an invalid ISO date: ${iso}`);
  }

  const last = daysInMonth(iso);
  return {
    start: `${pad(parsed.year, 4)}-${pad(parsed.month)}-01`,
    end: `${pad(parsed.year, 4)}-${pad(parsed.month)}-${pad(last)}`,
  };
}

/** Compare two ISO dates: negative if `a` is earlier, 0 if equal, positive if later. */
export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The first and last ISO dates, i.e. the report range for "all time". */
export function allTimeRange(): DateRange {
  return { start: '0000-01-01', end: '9999-12-31' };
}

/**
 * Human-readable date for display, e.g. "Mon 27 Sep 2026".
 *
 * Uses `Intl` so the format follows the device locale rather than being
 * hand-built (R-13). Pass `locale` explicitly in tests to keep them
 * deterministic; Hermes ships with full ICU on Android and iOS.
 */
export function formatDisplayDate(iso: string, locale?: string): string {
  const parsed = parseISODate(iso);
  if (!parsed) {
    throw new RangeError(`formatDisplayDate received an invalid ISO date: ${iso}`);
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // Noon avoids any chance of a UTC-midnight render landing on the previous
    // day in a negative-offset locale.
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)));
}

/** Month heading for grouped history, e.g. "September 2026". */
export function formatMonthLabel(iso: string, locale?: string): string {
  const parsed = parseISODate(iso);
  if (!parsed) {
    throw new RangeError(`formatMonthLabel received an invalid ISO date: ${iso}`);
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1, 12)));
}
