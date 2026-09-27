/**
 * The daily log: one row per calendar day.
 *
 * ## The whole add-or-edit story is one statement
 *
 * R-2 makes `UNIQUE(entry_date)` a database guarantee rather than a UI
 * convention, so saving a day is a single
 * `INSERT ... ON CONFLICT(entry_date) DO UPDATE`. There is no
 * "does this day exist?" branch to get wrong, and no read-modify-write
 * window in which a second write could interleave.
 *
 * `created_at` is deliberately absent from the `DO UPDATE SET` list. An edit
 * is not a re-creation: the day the intern first logged the hours is the day
 * the record came into existence, and overwriting it would make "how long did
 * this take to write up" unanswerable.
 *
 * ## This module trusts its caller, and the schema catches mistakes
 *
 * There is no re-validation here. `validateEntry` in [[InternTrack
 * validation]] owns that, the hook calls it before calling in here, and
 * duplicating the rules in a second place is how two copies drift apart.
 *
 * What still holds the line is the `entries` schema: `CHECK` constraints on
 * `minutes`, `activity` and `entry_date` mean a caller that skips validation
 * gets a rejected write rather than a corrupt log. See [[InternTrack
 * Architecture]].
 *
 * All aggregation happens in SQL â€” never fetch rows and reduce in JS. Totals
 * are `COALESCE`d to `0` so an empty range is `0` and not `null` (R-7).
 * Minutes are summed as integers, so they are exact (R-1).
 *
 * This module imports no React (R-8).
 */

import type { ValidEntry } from '@/lib/validation';

import type { QueryableDatabase, TransactableDatabase } from '../client';

/** Ceiling on a single history page, so a bad limit cannot pull the whole log. */
export const MAX_PAGE_SIZE = 100;

/** Page size the History screen uses when the caller has no opinion. */
export const DEFAULT_PAGE_SIZE = 30;

export type Entry = {
  id: number;
  /** `YYYY-MM-DD`, device-local. */
  entryDate: string;
  minutes: number;
  activity: string;
  /** Epoch ms. Never changes once the day is first logged. */
  createdAt: number;
  /** Epoch ms. Bumped on every edit. */
  updatedAt: number;
};

/**
 * What a caller supplies to log or edit a day.
 *
 * Exactly `ValidEntry` from [[InternTrack validation]] — the output of
 * `validateEntry`, and nothing else. Aliasing rather than restating it makes
 * the "validate before you write" rule a compile-time guarantee instead of a
 * comment: if the validated shape ever changes, this changes with it and the
 * call site that has drifted fails to typecheck.
 *
 * Not to be confused with `EntryDraft` in `src/lib/validation.ts`, which is the
 * raw *form* input — `dateISO`, `hoursText`, `activity`, all strings, none of it
 * trusted yet.
 */
export type EntryInput = ValidEntry;

/** Aggregate for a set of days. Minutes are exact integers, never floats. */
export type Totals = {
  totalMinutes: number;
  /** How many days in the range have an entry. Not the number of days spanned. */
  loggedDays: number;
};

const SELECT_COLUMNS =
  'SELECT id, entry_date, minutes, activity, created_at, updated_at FROM entries';

/** The row shape SQLite hands back, before it becomes a domain object. */
type EntryRow = {
  id: number;
  entry_date: string;
  minutes: number;
  activity: string;
  created_at: number;
  updated_at: number;
};

/**
 * Map a row to the camelCase domain shape.
 *
 * Explicit rather than trusting a column alias, so a column added or renamed
 * later cannot silently start producing `undefined` fields downstream.
 */
function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    minutes: row.minutes,
    activity: row.activity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `null` for an unlogged day. Absence is normal, not an error. */
export async function getByDate(db: QueryableDatabase, entryDate: string): Promise<Entry | null> {
  const row = await db.getFirstAsync<EntryRow>(
    `${SELECT_COLUMNS} WHERE entry_date = ?`,
    [entryDate],
  );
  return row === null ? null : toEntry(row);
}

/**
 * Log a day, or overwrite it if that day is already logged.
 *
 * Returns the stored row, read back inside the same transaction, so the caller
 * gets the real `id` and a `created_at` that reflects an edit rather than a
 * fresh creation.
 *
 * @throws if the schema rejects the row â€” see the module note on validation.
 */
export async function upsert(
  db: TransactableDatabase,
  draft: EntryInput,
  now: Date = new Date(),
): Promise<Entry> {
  const timestamp = now.getTime();

  // Deliberately left uninitialised. TypeScript does not track assignments made
  // inside a callback, so `let saved: Entry | null = null` narrows to exactly
  // `null` here and the return would need a cast to shut the compiler up. With
  // no initialiser the union survives, the check below is honest, and an
  // unassigned value becomes a real error rather than a suppressed one.
  let saved: Entry | undefined;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO entries (entry_date, minutes, activity, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(entry_date) DO UPDATE SET ' +
        'minutes = excluded.minutes, ' +
        'activity = excluded.activity, ' +
        'updated_at = excluded.updated_at',
      [draft.entryDate, draft.minutes, draft.activity, timestamp, timestamp],
    );

    const row = await db.getFirstAsync<EntryRow>(
      `${SELECT_COLUMNS} WHERE entry_date = ?`,
      [draft.entryDate],
    );
    // Unreachable while the `entries` CHECKs hold: the row we just wrote is in
    // this transaction. Throwing rather than returning null keeps a genuine bug
    // from reaching a screen as "saved nothing".
    if (row === null) {
      throw new Error(`Entry for ${draft.entryDate} vanished immediately after being written.`);
    }
    saved = toEntry(row);
  });

  if (saved === undefined) {
    throw new Error(`upsert finished without reading back the entry for ${draft.entryDate}.`);
  }

  return saved;
}

/**
 * Remove a day's entry.
 *
 * @returns whether anything was actually deleted, so a screen can tell the
 * difference between "removed" and "was never there".
 */
export async function deleteByDate(
  db: QueryableDatabase,
  entryDate: string,
): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM entries WHERE entry_date = ?', [entryDate]);
  return result.changes > 0;
}

/**
 * Every entry between two dates, inclusive, oldest first.
 *
 * Ascending because the callers are a report range and a chart, which read
 * left to right. `from > to` yields an empty list rather than an error, which
 * is the honest answer for a `BETWEEN` that matches nothing.
 */
export async function listRange(
  db: QueryableDatabase,
  from: string,
  to: string,
): Promise<Entry[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `${SELECT_COLUMNS} WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date ASC`,
    [from, to],
  );
  return rows.map(toEntry);
}

/** Totals for an inclusive date range. `0` for a range with nothing logged. */
export async function totalsFor(
  db: QueryableDatabase,
  from: string,
  to: string,
): Promise<Totals> {
  const row = await db.getFirstAsync<{ totalMinutes: number | null; loggedDays: number }>(
    'SELECT COALESCE(SUM(minutes), 0) AS totalMinutes, COUNT(*) AS loggedDays ' +
      'FROM entries WHERE entry_date BETWEEN ? AND ?',
    [from, to],
  );
  // The `?? 0` is a second layer behind the SQL COALESCE, not a replacement for
  // it. R-7 asks for the COALESCE so the *query* answers on its own; the
  // fallback covers a driver handing back undefined. Worth knowing: deleting the
  // COALESCE fails no test, because this line hides it. The observable
  // behaviour is guaranteed either way, which is what the tests assert.
  return { totalMinutes: row?.totalMinutes ?? 0, loggedDays: row?.loggedDays ?? 0 };
}

/** All-time totals. Same COALESCE treatment as [[totalsFor]]. */
export async function overallTotals(db: QueryableDatabase): Promise<Totals> {
  const row = await db.getFirstAsync<{ totalMinutes: number | null; loggedDays: number }>(
    'SELECT COALESCE(SUM(minutes), 0) AS totalMinutes, COUNT(*) AS loggedDays FROM entries',
  );
  return { totalMinutes: row?.totalMinutes ?? 0, loggedDays: row?.loggedDays ?? 0 };
}

/**
 * One page of the History screen, newest first.
 *
 * `limit` is clamped to `1..MAX_PAGE_SIZE` and `offset` floored at zero, because
 * both are interpolated into a query that SQLite will happily accept as
 * anything. `COUNT(*)` needs no `COALESCE` â€” it is already `0` on no rows â€” but
 * `SUM` does, and the two are written side by side on purpose.
 *
 * Offset paging rather than keyset: inserting a day mid-scroll would shift the
 * window and repeat a row. That needs the user to log a day and scroll History
 * at the same moment, which is two different screens, so the simpler query wins.
 */
export async function historyPage(
  db: QueryableDatabase,
  options: { limit?: number; offset?: number } = {},
): Promise<Entry[]> {
  const limit = clampPageSize(options.limit);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const rows = await db.getAllAsync<EntryRow>(
    `${SELECT_COLUMNS} ORDER BY entry_date DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map(toEntry);
}

/** Coerce anything to a usable page size. Exported so the clamp itself is tested. */
export function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}
