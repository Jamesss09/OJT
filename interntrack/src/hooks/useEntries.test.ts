/**
 * Tests for the entry hooks' wiring to the repositories.
 *
 * The repository behaviour itself is covered by `entries.repo.test.ts` against a
 * real SQLite engine. What is new here is the seam these tests own: that each
 * hook reads the right column, passes the right date, keys its query correctly,
 * and turns a write failure into a result a screen can render instead of an
 * unhandled rejection.
 *
 * `useSQLiteContext` is stubbed to hand out the `node:sqlite` stand-in, so these
 * run real SQL. The focus-refetch path is mocked away, as in
 * `useAsyncData.test.ts` — it needs a navigation container.
 */

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { initDatabase } from '@/db/client';
import { type Entry, upsert } from '@/db/repositories/entries.repo';
import { type TestDatabase, createTestDatabase } from '@/db/testing/nodeSqliteTestDouble';
import type { ValidEntry } from '@/lib/validation';

import {
  HISTORY_PAGE_SIZE,
  type LogEntryResult,
  useEntryForDate,
  useHistoryPage,
  useLogEntryMutation,
  useOverallTotals,
  useRangeTotals,
} from './useEntries';

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
}));

// Reassigned per test; only read at render time, never while this factory runs.
// The `mock` prefix is required: Jest's babel plugin rejects any out-of-scope
// variable referenced inside a `jest.mock` factory that is not so named.
let mockDb: TestDatabase;

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDb,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handle<T> = {
  /** Latest render's value. Never destructure this — see `useAsyncData.test.ts`. */
  readonly current: T;
  rerender: () => void;
  unmount: () => void;
};

function renderHook<T>(useHook: () => T): Handle<T> {
  const box: { current: T | undefined } = { current: undefined };
  let renderer: ReactTestRenderer | undefined;

  function Harness() {
    box.current = useHook();
    return null;
  }

  const draw = () => {
    act(() => {
      renderer = create(createElement(Harness));
    });
  };
  draw();

  return {
    get current() {
      if (box.current === undefined) {
        throw new Error('Hook was never rendered.');
      }
      return box.current;
    },
    rerender: () => {
      act(() => {
        renderer?.update(createElement(Harness));
      });
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

/** Let the queued promise continuations run, then let React re-render. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const valid = (entryDate: string, minutes: number, activity = 'Something'): ValidEntry => ({
  entryDate,
  minutes,
  activity,
});

/**
 * Whether `mockDb` is still open.
 *
 * Some tests close it deliberately to force a write failure, and `DatabaseSync`
 * throws on a second close. `closeAfter` is set to false instead of the test
 * reaching into the double's internals to check.
 */
let dbIsOpen = false;

beforeEach(async () => {
  mockDb = createTestDatabase();
  await initDatabase(mockDb);
  dbIsOpen = true;
});

afterEach(() => {
  if (dbIsOpen) {
    mockDb.close();
  }
});

describe('useEntryForDate', () => {
  it('resolves to null for an unlogged day, not undefined', async () => {
    // The distinction matters: `undefined` means "not read yet" and would make a
    // screen prompt for input on a day that is already logged.
    const hook = renderHook(() => useEntryForDate('2026-09-28'));
    expect(hook.current.isLoading).toBe(true);

    await settle();

    expect(hook.current.isLoading).toBe(false);
    expect(hook.current.data).toBeNull();
    hook.unmount();
  });

  it('resolves to the entry once one exists', async () => {
    await upsert(mockDb, valid('2026-09-28', 450, 'Wrote the migration'));

    const hook = renderHook(() => useEntryForDate('2026-09-28'));
    await settle();

    expect(hook.current.data).toMatchObject({
      entryDate: '2026-09-28',
      minutes: 450,
      activity: 'Wrote the migration',
    });
    hook.unmount();
  });

  it('reads only the day it was asked for', async () => {
    await upsert(mockDb, valid('2026-09-27', 300));
    await upsert(mockDb, valid('2026-09-28', 450));

    const hook = renderHook(() => useEntryForDate('2026-09-28'));
    await settle();

    expect((hook.current.data as Entry).minutes).toBe(450);
    hook.unmount();
  });
});

describe('useLogEntryMutation', () => {
  it('saves a validated entry and hands back the stored row', async () => {
    const hook = renderHook(() => useLogEntryMutation());

    let result: LogEntryResult | undefined;
    await act(async () => {
      result = await hook.current.save(valid('2026-09-28', 450, 'Reviewed PRs'));
    });

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.entry).toMatchObject({
        entryDate: '2026-09-28',
        minutes: 450,
        activity: 'Reviewed PRs',
      });
    }
    expect(hook.current.error).toBeUndefined();
    expect(hook.current.isPending).toBe(false);

    const row = await mockDb.getFirstAsync<{ minutes: number }>(
      'SELECT minutes FROM entries WHERE entry_date = ?',
      ['2026-09-28'],
    );
    expect(row?.minutes).toBe(450);
    hook.unmount();
  });

  it('returns a failure result instead of throwing when the write fails', async () => {
    // A screen must be able to show the reason and keep what the intern typed.
    // Closing the database is a faithful stand-in for a real write failure.
    mockDb.close();
    dbIsOpen = false;

    const hook = renderHook(() => useLogEntryMutation());

    let result: LogEntryResult | undefined;
    await act(async () => {
      result = await hook.current.save(valid('2026-09-28', 450));
    });

    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).not.toBe('');
    }
    expect(hook.current.error).toBeInstanceOf(Error);
    // Pending must be cleared, or the save button would stay disabled forever.
    expect(hook.current.isPending).toBe(false);
    hook.unmount();
  });

  it('clears a stale error once a later save succeeds', async () => {
    const hook = renderHook(() => useLogEntryMutation());

    mockDb.close();
    dbIsOpen = false;
    await act(async () => {
      await hook.current.save(valid('2026-09-28', 450));
    });
    expect(hook.current.error).toBeInstanceOf(Error);

    // A fresh connection, as if the user retried after fixing the problem. The
    // re-render is required: the hook holds the database in a `useCallback`
    // dependency, so without it the callbacks would still point at the closed one.
    mockDb = createTestDatabase();
    await initDatabase(mockDb);
    dbIsOpen = true;
    hook.rerender();

    let result: LogEntryResult | undefined;
    await act(async () => {
      result = await hook.current.save(valid('2026-09-28', 450));
    });

    expect(result?.ok).toBe(true);
    expect(hook.current.error).toBeUndefined();
    hook.unmount();
  });

  it('reports whether a delete actually removed anything', async () => {
    const hook = renderHook(() => useLogEntryMutation());

    await upsert(mockDb, valid('2026-09-28', 450));

    let first: { ok: boolean; removed?: boolean } | undefined;
    let second: { ok: boolean; removed?: boolean } | undefined;
    await act(async () => {
      first = await hook.current.remove('2026-09-28');
      second = await hook.current.remove('2026-09-28');
    });

    expect(first).toEqual({ ok: true, removed: true });
    // Deleting an unlogged day is a no-op, not a failure.
    expect(second).toEqual({ ok: true, removed: false });
    hook.unmount();
  });

  it('keeps its callbacks stable while the database is unchanged', async () => {
    const hook = renderHook(() => useLogEntryMutation());
    const first = hook.current.save;
    await settle();
    hook.rerender();
    expect(hook.current.save).toBe(first);
    hook.unmount();
  });
});

describe('useOverallTotals', () => {
  it('sums every entry', async () => {
    await upsert(mockDb, valid('2026-09-26', 450));
    await upsert(mockDb, valid('2026-09-27', 300));

    const hook = renderHook(() => useOverallTotals());
    await settle();

    expect(hook.current.data).toMatchObject({ totalMinutes: 750, loggedDays: 2 });
    hook.unmount();
  });
});

describe('useRangeTotals', () => {
  it('counts only the days inside the range, inclusive at both ends', async () => {
    await upsert(mockDb, valid('2026-09-26', 450));
    await upsert(mockDb, valid('2026-09-27', 300));
    await upsert(mockDb, valid('2026-09-28', 120));

    const hook = renderHook(() => useRangeTotals('2026-09-27', '2026-09-28'));
    await settle();

    expect(hook.current.data).toMatchObject({ totalMinutes: 420, loggedDays: 2 });
    hook.unmount();
  });
});

describe('useHistoryPage', () => {
  it('reads a page at a time, newest first', async () => {
    // 33 days, oldest first. Two pages at 30 per page.
    for (let day = 1; day <= 33; day += 1) {
      await upsert(mockDb, valid(`2026-09-${String(day).padStart(2, '0')}`, 60));
    }

    const first = renderHook(() => useHistoryPage(1));
    await settle();
    expect(first.current.data).toHaveLength(HISTORY_PAGE_SIZE);
    expect(first.current.hasMore).toBe(true);
    expect(first.current.data?.[0].entryDate).toBe('2026-09-33');
    first.unmount();

    const last = renderHook(() => useHistoryPage(2));
    await settle();
    expect(last.current.data).toHaveLength(3);
    // A short final page is the reliable "no more" signal.
    expect(last.current.hasMore).toBe(false);
    expect(last.current.data?.[0].entryDate).toBe('2026-09-03');
    last.unmount();
  });

  it('treats page 1 as the first page regardless of what is passed in', async () => {
    await upsert(mockDb, valid('2026-09-28', 60));

    // A zero or negative page from a stale route param must not read from a
    // negative offset, which SQLite would treat as "from the end".
    const hook = renderHook(() => useHistoryPage(0));
    await settle();

    expect(hook.current.data?.[0].entryDate).toBe('2026-09-28');
    hook.unmount();
  });
});
