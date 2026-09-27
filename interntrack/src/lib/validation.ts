/**
 * Entry validation. Enforces the R-3 table in [[InternTrack Rules]].
 *
 * Returns a discriminated result rather than throwing, so the UI can render
 * per-field errors inline (R-13) and pick the first field to focus. Nothing
 * here touches the database — a draft is validated before it is ever saved.
 *
 * Pure module: no React, no react-native, no expo imports (R-8).
 */

import { MAX_MINUTES_PER_DAY, toMinutes } from './hours';
import { isFutureISODate, isValidISODate } from './dates';

/** R-3: activity descriptions are capped so a row can never bloat a report. */
export const ACTIVITY_MAX_LENGTH = 2000;

/** Raw, unvalidated form input as it comes off the screen. */
export type EntryDraft = {
  /** `YYYY-MM-DD` from the date picker. */
  dateISO: string;
  /** Free text from the hour field — not yet known to be a number. */
  hoursText: string;
  /** Free text from the activity field. */
  activity: string;
};

/** Normalised, storable entry. `minutes` is guaranteed 1..1440. */
export type ValidEntry = {
  entryDate: string;
  minutes: number;
  activity: string;
};

/** Keyed by field so the form can attach each message to its input. */
export type FieldErrors = Partial<Record<keyof EntryDraft, string>>;

export type ValidationResult =
  | { ok: true; value: ValidEntry }
  | { ok: false; errors: FieldErrors };

/**
 * Validate a draft entry.
 *
 * Collects *all* field errors rather than stopping at the first, so the form
 * can show everything that is wrong in one pass.
 */
export function validateEntry(draft: EntryDraft, now: Date = new Date()): ValidationResult {
  const errors: FieldErrors = {};

  if (!isValidISODate(draft.dateISO)) {
    errors.dateISO = 'That date does not exist.';
  } else if (isFutureISODate(draft.dateISO, now)) {
    // R-3: a day that has not happened yet cannot be logged.
    errors.dateISO = "You can't log a day that hasn't happened yet.";
  }

  const minutes = toMinutes(draft.hoursText);
  if (minutes === null) {
    errors.hoursText = 'Enter hours between 0 and 24, e.g. 7.5.';
  }

  const activity = draft.activity.trim();
  if (activity.length === 0) {
    errors.activity = 'Describe what you did.';
  } else if (activity.length > ACTIVITY_MAX_LENGTH) {
    errors.activity = `Keep this under ${ACTIVITY_MAX_LENGTH} characters (currently ${activity.length}).`;
  }

  if (errors.dateISO || errors.hoursText || errors.activity) {
    return { ok: false, errors };
  }

  // Safe: every branch above returned early on null, and `activity` is a
  // non-empty string once we reach here.
  return {
    ok: true,
    value: {
      entryDate: draft.dateISO,
      minutes: minutes as number,
      activity,
    },
  };
}

/**
 * Field order for "focus the first thing that is wrong" (R-13).
 *
 * Keys must match `keyof EntryDraft` exactly — the form looks errors up by
 * field name, so a mismatch here silently breaks focusing.
 */
export const FIELD_ORDER: readonly (keyof EntryDraft)[] = ['dateISO', 'hoursText', 'activity'];

/** The first field with an error, for focusing. `null` when the draft is valid. */
export function firstInvalidField(errors: FieldErrors): keyof EntryDraft | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

/** Re-exported so callers can bound-check without importing `hours` directly. */
export { MAX_MINUTES_PER_DAY };
