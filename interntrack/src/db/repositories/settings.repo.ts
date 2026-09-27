/**
 * Programme configuration, stored as key/value rows in `app_settings`.
 *
 * ## Why every read re-validates
 *
 * `app_settings.value` is `TEXT`, and nothing at the database layer constrains
 * what is in it. A hand-edited row, a bad restore from `T-53`, or a future
 * migration that writes the wrong shape would otherwise surface as `NaN` in a
 * progress bar or a reminder that never fires. So each value is parsed through a
 * sanitiser that falls back to the documented default, and a corrupt row is
 * indistinguishable from an absent one — which is the safe reading, because
 * defaults are always coherent.
 *
 * ## Defaults are not written by the migration
 *
 * `programStartDate` defaults to the device's *today*. A migration runs against
 * the database, not the device's calendar, so it cannot supply that value. The
 * table therefore ships empty and defaults are applied here, on read. See
 * [[InternTrack Architecture]].
 *
 * All SQL is here, parameterised (R-7). This module imports no React (R-8).
 */

import { isValidISODate, todayISODate } from '@/lib/dates';

import type { TransactableDatabase } from '../client';

/** Keys the Settings screen owns. `reminderId` is deliberately not one of them. */
export const SETTINGS_KEYS = [
  'programStartDate',
  'requiredMinutes',
  'dailyTargetMinutes',
  'reminderEnabled',
  'reminderTime',
  'internName',
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/**
 * Internal bookkeeping key: the id of the currently scheduled OS notification,
 * so it can be cancelled deterministically when the reminder changes.
 * Not user-facing, so not in the [[Settings]] shape.
 */
export const REMINDER_ID_KEY = 'reminderId';

/** Eight hours. The default daily expectation for a full OJT day. */
export const DEFAULT_DAILY_TARGET_MINUTES = 8 * 60;

/** 366 days in minutes — a generous ceiling on a total programme target. */
export const MAX_TOTAL_MINUTES = 366 * 24 * 60;

/** Printed on exported reports, so it needs a bound. */
export const MAX_NAME_LENGTH = 120;

export const DEFAULT_REMINDER_TIME = '18:00';

export type Settings = {
  /** `YYYY-MM-DD` first day of the OJT period. */
  programStartDate: string;
  /** Total hours required for the programme. `0` means "not set". */
  requiredMinutes: number;
  /** Hours expected per day. */
  dailyTargetMinutes: number;
  reminderEnabled: boolean;
  /** `HH:mm`, 24-hour, local time. */
  reminderTime: string;
  /** Shown on exported reports so they are self-labelling. */
  internName: string;
};

/**
 * The documented defaults.
 *
 * A function rather than a constant because `programStartDate` depends on the
 * device's current day. Pass `now` in tests.
 */
export function defaultSettings(now: Date = new Date()): Settings {
  return {
    programStartDate: todayISODate(now),
    requiredMinutes: 0,
    dailyTargetMinutes: DEFAULT_DAILY_TARGET_MINUTES,
    reminderEnabled: false,
    reminderTime: DEFAULT_REMINDER_TIME,
    internName: '',
  };
}

const REMINDER_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Accepts only a real calendar date. */
export function asISODate(raw: string | undefined, fallback: string): string {
  return raw !== undefined && isValidISODate(raw) ? raw : fallback;
}

/**
 * Accepts a whole number of minutes in `0..max`.
 *
 * `Number()` is used deliberately rather than `parseInt`, so `"7.5"`, `"12abc"`
 * and `""` are all rejected instead of silently becoming `7`, `12` and `NaN`.
 */
export function asMinutes(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    return fallback;
  }
  return parsed;
}

/** Only the exact string `'true'` enables the reminder. */
export function asBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return fallback;
}

/** Accepts only a 24-hour `HH:mm`, so the reminder can never be unschedulable. */
export function asReminderTime(raw: string | undefined, fallback: string): string {
  return raw !== undefined && REMINDER_TIME.test(raw) ? raw : fallback;
}

/** Trims and caps. An empty name is legitimate — it just means "not set". */
export function asName(raw: string | undefined, fallback: string): string {
  if (raw === undefined) {
    return fallback;
  }
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

type SettingRow = { key: string; value: string };

/**
 * Read every setting, applying defaults for absent *and* unusable rows.
 *
 * Unknown keys are ignored, so adding one to the table never breaks the
 * Settings screen of an older build.
 */
export async function readSettings(
  db: TransactableDatabase,
  now: Date = new Date(),
): Promise<Settings> {
  const defaults = defaultSettings(now);
  const rows = await db.getAllAsync<SettingRow>('SELECT key, value FROM app_settings');

  const stored = new Map<string, string>();
  for (const row of rows) {
    stored.set(row.key, row.value);
  }

  return {
    programStartDate: asISODate(stored.get('programStartDate'), defaults.programStartDate),
    requiredMinutes: asMinutes(
      stored.get('requiredMinutes'),
      defaults.requiredMinutes,
      MAX_TOTAL_MINUTES,
    ),
    dailyTargetMinutes: asMinutes(
      stored.get('dailyTargetMinutes'),
      defaults.dailyTargetMinutes,
      MAX_TOTAL_MINUTES,
    ),
    reminderEnabled: asBoolean(stored.get('reminderEnabled'), defaults.reminderEnabled),
    reminderTime: asReminderTime(stored.get('reminderTime'), defaults.reminderTime),
    internName: asName(stored.get('internName'), defaults.internName),
  };
}

/** How a [[Settings]] object is stored: every value becomes a string. */
export function serialiseSettings(settings: Settings): Record<SettingsKey, string> {
  return {
    programStartDate: settings.programStartDate,
    requiredMinutes: String(settings.requiredMinutes),
    dailyTargetMinutes: String(settings.dailyTargetMinutes),
    reminderEnabled: String(settings.reminderEnabled),
    reminderTime: settings.reminderTime,
    internName: settings.internName,
  };
}

/**
 * Merge and persist a partial change.
 *
 * Read-then-write inside one transaction so a concurrent Settings screen cannot
 * clobber a key this call was not touching. `ON CONFLICT DO UPDATE` means this
 * is an upsert either way — there is no separate "create settings" step.
 */
export async function writeSettings(
  db: TransactableDatabase,
  changes: Partial<Settings>,
  now: Date = new Date(),
): Promise<Settings> {
  const current = await readSettings(db, now);
  const merged: Settings = { ...current, ...changes };

  // Run the merged value through the same sanitisers, so a bad write is
  // corrected on the way in rather than on the next read.
  const sanitised = readSettingsFromValues(merged, now);

  const rows = serialiseSettings(sanitised);
  const timestamp = now.getTime();
  const query =
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';

  await db.withTransactionAsync(async () => {
    for (const key of SETTINGS_KEYS) {
      await db.runAsync(query, [key, rows[key], timestamp]);
    }
  });

  return sanitised;
}

/** Apply the sanitiser pipeline to an in-memory [[Settings]], without touching the DB. */
export function readSettingsFromValues(candidate: Settings, now: Date = new Date()): Settings {
  const defaults = defaultSettings(now);
  const stored = serialiseSettings(candidate);

  return {
    programStartDate: asISODate(stored.programStartDate, defaults.programStartDate),
    requiredMinutes: asMinutes(
      stored.requiredMinutes,
      defaults.requiredMinutes,
      MAX_TOTAL_MINUTES,
    ),
    dailyTargetMinutes: asMinutes(
      stored.dailyTargetMinutes,
      defaults.dailyTargetMinutes,
      MAX_TOTAL_MINUTES,
    ),
    reminderEnabled: asBoolean(stored.reminderEnabled, defaults.reminderEnabled),
    reminderTime: asReminderTime(stored.reminderTime, defaults.reminderTime),
    internName: asName(stored.internName, defaults.internName),
  };
}

/** The scheduled notification id, or `null` when no reminder is scheduled. */
export async function readReminderId(db: TransactableDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [REMINDER_ID_KEY],
  );
  return row?.value ?? null;
}

/**
 * Remember which OS notification is currently scheduled.
 *
 * Pass `null` once it has been cancelled, so a stale id can never be cancelled
 * twice or cancel someone else's notification.
 */
export async function writeReminderId(
  db: TransactableDatabase,
  id: string | null,
  now: Date = new Date(),
): Promise<void> {
  if (id === null) {
    await db.runAsync('DELETE FROM app_settings WHERE key = ?', [REMINDER_ID_KEY]);
    return;
  }
  await db.runAsync(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [REMINDER_ID_KEY, id, now.getTime()],
  );
}
