/**
 * React bindings for the daily log.
 *
 * Thin on purpose. Each hook closes over the database, hands [[useAsyncData]] a
 * loader, and maps the row shape. There is no cache, no global state and no
 * duplicated copy of the log: SQLite is the only source of truth, and a screen
 * re-reads it whenever its inputs change or it regains focus.
 *
 * See [[InternTrack Architecture]] for the repository → hook → component rule,
 * and R-7 for why the SQL lives in the repository rather than here.
 */

import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import {
  type Entry,
  type EntryInput,
  type Totals,
  deleteByDate,
  getByDate,
  historyPage,
  listRange,
  overallTotals,
  totalsFor,
  upsert,
} from '@/db/repositories/entries.repo';
import type { ValidEntry } from '@/lib/validation';

import { type AsyncData, useAsyncData } from './useAsyncData';

/** How much History shows per page. */
export const HISTORY_PAGE_SIZE = 30;

/**
 * The entry logged for one day, or `null` for an unlogged day.
 *
 * `data` being `undefined` means "not read yet" — which is different from
 * `data === null`, which means "read, and that day has nothing logged". The
 * screen must not treat the first as a reason to prompt for input, or a day
 * already logged would look empty for a frame on every open.
 */
export function useEntryForDate(entryDate: string): AsyncData<Entry | null> {
  const db = useSQLiteContext();

  const load = useCallback(() => getByDate(db, entryDate), [db, entryDate]);

  return useAsyncData(load, `entry:${entryDate}`, { refetchOnFocus: true });
}

export type LogEntryResult =
  | { ok: true; entry: Entry }
  | { ok: false; error: Error };

/**
 * Saving and deleting days.
 *
 * A hand-rolled mutation rather than a library's, because the work is a single
 * `await`. What it does own is the failure path: a rejected write comes back as
 * a result rather than an exception, so a screen can show the reason and keep
 * the intern's typing instead of losing it to an unhandled rejection.
 *
 * It does **not** refetch anything. The caller reloads the queries it cares
 * about, which keeps the direction of the dependency obvious — a save does not
 * silently reach across the app and pull data the screen never asked for.
 */
export function useLogEntryMutation() {
  const db = useSQLiteContext();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const save = useCallback(
    async (value: ValidEntry): Promise<LogEntryResult> => {
      setIsPending(true);
      setError(undefined);
      try {
        // `EntryInput` is an alias of `ValidEntry`, so the type system already
        // guarantees this only accepts validated input.
        const entry = await upsert(db, value as EntryInput);
        return { ok: true, entry };
      } catch (reason) {
        const failure = reason instanceof Error ? reason : new Error(String(reason));
        setError(failure);
        return { ok: false, error: failure };
      } finally {
        setIsPending(false);
      }
    },
    [db],
  );

  const remove = useCallback(
    async (entryDate: string): Promise<{ ok: true; removed: boolean } | { ok: false; error: Error }> => {
      setIsPending(true);
      setError(undefined);
      try {
        const removed = await deleteByDate(db, entryDate);
        return { ok: true, removed };
      } catch (reason) {
        const failure = reason instanceof Error ? reason : new Error(String(reason));
        setError(failure);
        return { ok: false, error: failure };
      } finally {
        setIsPending(false);
      }
    },
    [db],
  );

  // One object so the hook's return identity is stable while the callbacks are,
  // which matters because screens pass these into memoised children.
  return useMemo(
    () => ({ save, remove, isPending, error }),
    [save, remove, isPending, error],
  );
}

/**
 * All-time totals, for the headline figure on Today.
 *
 * Refetches on focus because logging a day changes it, and the user lands back
 * here from the log editor expecting the number to have moved.
 */
export function useOverallTotals(): AsyncData<Totals> {
  const db = useSQLiteContext();

  const load = useCallback(() => overallTotals(db), [db]);

  return useAsyncData(load, 'totals:overall', { refetchOnFocus: true });
}

/** Totals for an inclusive range, for the Reports screen. */
export function useRangeTotals(from: string, to: string): AsyncData<Totals> {
  const db = useSQLiteContext();

  const load = useCallback(() => totalsFor(db, from, to), [db, from, to]);

  return useAsyncData(load, `totals:range:${from}:${to}`, { refetchOnFocus: true });
}

/** Every entry in an inclusive range, oldest first — a chart's worth of data. */
export function useEntriesInRange(from: string, to: string): AsyncData<Entry[]> {
  const db = useSQLiteContext();

  const load = useCallback(() => listRange(db, from, to), [db, from, to]);

  return useAsyncData(load, `entries:range:${from}:${to}`, { refetchOnFocus: true });
}

/**
 * One page of History, newest first.
 *
 * `page` is 1-based, because that is what the UI counts in; the repository's
 * offset is 0-based, and converting here means the conversion is written down
 * once instead of at every call site.
 *
 * `hasMore` comes back as a separate boolean because "this page was full" is
 * not quite "there is another page" — the last page can be exactly full and
 * still be the last. A `limit + 1` probe would be the usual fix; here the
 * caller refetches on focus, so a momentary `true` on a full last page costs one
 * harmless empty fetch.
 */
export function useHistoryPage(page: number): AsyncData<Entry[]> & { hasMore: boolean } {
  const db = useSQLiteContext();
  const safePage = Math.max(1, Math.floor(page));
  const limit = HISTORY_PAGE_SIZE;

  const load = useCallback(
    () => historyPage(db, { limit, offset: (safePage - 1) * limit }),
    [db, safePage, limit],
  );

  const result = useAsyncData(load, `history:${safePage}`, { refetchOnFocus: true });

  return { ...result, hasMore: (result.data?.length ?? 0) === limit };
}