/**
 * Tests for the Today screen.
 *
 * ## What is real and what is mocked
 *
 * Everything below the router is real: the real `expo-sqlite`-shaped test double
 * running the real migration SQL, the real repositories, the real hooks, the real
 * `validateEntry`, and the real input components. So the ACs are checked against
 * the actual data path, not a stubbed one — "edits rather than duplicates" is
 * proved by counting rows in SQLite.
 *
 * Only two modules are mocked:
 *
 *   - `expo-router`, for `useFocusEffect` (which calls `useNavigation()` before
 *     its effect and so throws without a navigation container) and `useRouter`.
 *   - `expo-sqlite`, for `useSQLiteContext`, which returns the test database.
 *
 * ## The clock
 *
 * `todayISODate()` reads the device clock, and R-4 makes it the only function
 * allowed to. Rather than mock the module - which would hide the real date
 * formatting - the system time is pinned with fake timers, so the screen
 * genuinely computes today's date from a known clock.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrateDatabase } from '@/db/client';
import { createTestDatabase, type TestDatabase } from '@/db/testing/nodeSqliteTestDouble';
import { upsert } from '@/db/repositories/entries.repo';
import { writeSettings } from '@/db/repositories/settings.repo';
import { todayISODate, weekRange } from '@/lib/dates';

import TodayScreen from './index';

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useRouter: () => ({ push: mockPush, replace: mockPush, back: () => undefined }),
}));

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDb,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `mock`-prefixed: Jest's babel plugin rejects out-of-scope names in a factory.
let mockDb: TestDatabase;
let mockPush: jest.Mock;

/** 2026-09-28T14:30 local. A Monday afternoon, mid-programme. */
const PINNED = new Date(2026, 8, 28, 14, 30, 0);
const TODAY = '2026-09-28';

async function freshDb(): Promise<TestDatabase> {
  const db = createTestDatabase();
  await migrateDatabase(db);
  return db;
}

function mount(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<TodayScreen />);
  });
  return renderer;
}

/** Let every queued promise continuation run, then re-render. */
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * The **host** element carrying this `testID`, not a wrapper.
 *
 * `findAllByProps` also matches composite elements: passing `testID` to
 * `ThemedText` puts it on both `ThemedText` and the `Text` it renders. Taking
 * the first match lands on the wrapper, whose subtree includes neighbouring
 * text — reading `week-total` returned "This week0h". Filtering to string types
 * picks the real element.
 */
const byTestId = (r: ReactTestRenderer, id: string): ReactTestInstance => {
  const m = r.root
    .findAllByProps({ testID: id })
    .filter((n) => typeof n.type === 'string');
  if (m.length === 0) throw new Error(`No host node with testID "${id}".`);
  return m[0];
};

const hasTestId = (r: ReactTestRenderer, id: string): boolean =>
  r.root.findAllByProps({ testID: id }).length > 0;

/**
 * The element with this `testID` that actually handles the press.
 *
 * `Pressable` keeps `onPress` on the composite and forwards it to a host `View`,
 * so the press handler has to be read from whichever match carries it rather
 * than from the host node that `byTestId` returns.
 */
const pressable = (r: ReactTestRenderer, id: string): ReactTestInstance => {
  const withHandler = r.root
    .findAllByProps({ testID: id })
    .filter((n) => typeof n.props.onPress === 'function');
  if (withHandler.length === 0) throw new Error(`No press handler for testID "${id}".`);
  return withHandler[0];
};

/**
 * The rendered text under a node with this `testID`.
 *
 * Not `props.children`. That reads `undefined` on a `ThemedText` wrapper and
 * `"[object Object]"` on a `Pressable` that contains one, because the children
 * are elements rather than strings at that level. This walks to the leaves
 * instead, so a test can assert against a label the way a person reads it.
 */
function textOf(r: ReactTestRenderer, id: string): string {
  const parts: string[] = [];
  const walk = (node: ReactTestInstance): void => {
    for (const child of node.children) {
      if (typeof child === 'string') {
        parts.push(child);
      } else {
        walk(child as ReactTestInstance);
      }
    }
  };
  walk(byTestId(r, id));
  return parts.join('');
}

const press = async (r: ReactTestRenderer, id: string): Promise<void> => {
  await act(async () => {
    pressable(r, id).props.onPress();
    await Promise.resolve();
  });
};

const typeInto = async (r: ReactTestRenderer, id: string, text: string): Promise<void> => {
  await act(async () => {
    byTestId(r, id).props.onChangeText(text);
  });
};

const rows = async (): Promise<{ count: number }[]> => mockDb.getAllAsync('SELECT COUNT(*) AS count FROM entries');

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
  jest.setSystemTime(PINNED);
  mockPush = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  mockDb?.close();
});

describe('Today screen', () => {
  describe('the empty state (the AC)', () => {
    beforeEach(async () => {
      mockDb = await freshDb();
    });

    it('says the day is not logged', async () => {
      const r = mount();
      await settle();
      expect(textOf(r, 'today-status')).toBe('Not logged yet');
    });

    it('offers to save rather than to update', async () => {
      // There is nothing to update yet, and saying "Update" on an empty form
      // would misdescribe the state.
      const r = mount();
      await settle();
      expect(textOf(r, 'today-save')).toBe('Save day');
    });

    it('shows both inputs, ready to type into', async () => {
      const r = mount();
      await settle();
      expect(byTestId(r, 'hour-input').props.value).toBe('');
      expect(byTestId(r, 'activity-input').props.value).toBe('');
    });

    it('starts at zero across the week and overall totals', async () => {
      const r = mount();
      await settle();
      expect(textOf(r, 'week-total')).toBe('0h');
      expect(textOf(r, 'overall-total')).toBe('0h');
    });

    it('offers no delete, because there is nothing to delete', async () => {
      const r = mount();
      await settle();
      expect(hasTestId(r, 'today-delete')).toBe(false);
    });
  });

  describe('logging a day (the AC)', () => {
    beforeEach(async () => {
      mockDb = await freshDb();
    });

    it('saves hours and activity, and the day becomes logged', async () => {
      const r = mount();
      await settle();

      await typeInto(r, 'hour-input', '7.5');
      await typeInto(r, 'activity-input', 'Shadowed the support team');
      await press(r, 'today-save');
      await settle();

      const stored = await mockDb.getAllAsync<{ entry_date: string; minutes: number; activity: string }>(
        'SELECT entry_date, minutes, activity FROM entries',
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual({
        entry_date: TODAY,
        minutes: 450,
        activity: 'Shadowed the support team',
      });
      expect(textOf(r, 'today-status')).toBe('Logged');
    });

    it('shows the saved hours and moves both totals', async () => {
      const r = mount();
      await settle();

      await typeInto(r, 'hour-input', '7.5');
      await typeInto(r, 'activity-input', 'Did the thing');
      await press(r, 'today-save');
      await settle();

      expect(textOf(r, 'week-total')).toBe('7h 30m');
      expect(textOf(r, 'overall-total')).toBe('7h 30m');
    });

    it('reloads the totals rather than guessing them', async () => {
      // The mutation deliberately does not refetch. If the screen did not
      // reload, the totals would still read zero after a successful save - which
      // is the bug this asserts against.
      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '8');
      await typeInto(r, 'activity-input', 'Did the thing');
      await press(r, 'today-save');
      await settle();

      expect(textOf(r, 'overall-total')).toBe('8h');
    });

    it("keeps the intern's typing when the save fails", async () => {
      // Losing a paragraph to a failed write is the worst thing this screen
      // could do, so the draft is asserted to survive.
      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '7.5');
      await typeInto(r, 'activity-input', 'A paragraph worth keeping');

      const realRun = mockDb.runAsync.bind(mockDb);
      mockDb.runAsync = (async (sql: string, ...params: unknown[]) => {
        if (String(sql).includes('INSERT') || String(sql).includes('UPDATE')) {
          throw new Error('disk is full');
        }
        return realRun(sql, ...params);
      }) as typeof mockDb.runAsync;

      await press(r, 'today-save');
      await settle();

      expect(hasTestId(r, 'save-error')).toBe(true);
      expect(byTestId(r, 'activity-input').props.value).toBe('A paragraph worth keeping');
      expect(byTestId(r, 'hour-input').props.value).toBe('7.5');
    });
  });

  describe('editing a day rather than duplicating it (the AC)', () => {
    beforeEach(async () => {
      mockDb = await freshDb();
      await upsert(mockDb, { entryDate: TODAY, minutes: 450, activity: 'First attempt' });
    });

    it('pre-fills the form from the stored entry', async () => {
      const r = mount();
      await settle();
      expect(byTestId(r, 'hour-input').props.value).toBe('7.5');
      expect(byTestId(r, 'activity-input').props.value).toBe('First attempt');
    });

    it('labels the action as an update', async () => {
      const r = mount();
      await settle();
      expect(textOf(r, 'today-save')).toBe('Update');
      expect(textOf(r, 'today-status')).toBe('Logged');
    });

    it('edits the row in place rather than adding a second one', async () => {
      // The heart of the AC. `entry_date` is UNIQUE and the repository upserts, so
      // a second save must UPDATE. Counting rows proves it: an insert would
      // leave two.
      const r = mount();
      await settle();

      await typeInto(r, 'hour-input', '8');
      await typeInto(r, 'activity-input', 'Corrected description');
      await press(r, 'today-save');
      await settle();

      const all = await rows();
      expect(all[0].count).toBe(1);

      const stored = await mockDb.getAllAsync<{ minutes: number; activity: string }>(
        'SELECT minutes, activity FROM entries WHERE entry_date = ?',
        [TODAY],
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual({ minutes: 480, activity: 'Corrected description' });
    });

    it('keeps the original createdAt, so the first log time is not lost', async () => {
      const before = await mockDb.getFirstAsync<{ created_at: number }>(
        'SELECT created_at FROM entries WHERE entry_date = ?',
        [TODAY],
      );
      jest.setSystemTime(new Date(2026, 8, 28, 18, 0, 0));

      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '9');
      await press(r, 'today-save');
      await settle();

      const after = await mockDb.getFirstAsync<{ created_at: number; updated_at: number }>(
        'SELECT created_at, updated_at FROM entries WHERE entry_date = ?',
        [TODAY],
      );
      expect(after?.created_at).toBe(before?.created_at);
      expect(after?.updated_at).toBeGreaterThan(after?.created_at ?? 0);
    });

    it('round-trips an awkward minute count through the hour field', async () => {
      // 440 minutes is 7h 20m, which has no exact 2-decimal hour form - "7.33" is
      // the closest. I expected that to lose a minute. It does not: 2dp is 0.3
      // min of resolution, inside the rounding `toMinutes` already applies. The
      // screen therefore pre-fills "7.33", states the real duration so the number
      // is not a puzzle, and re-saving an untouched form stores 440 again.
      mockDb = await freshDb();
      await upsert(mockDb, { entryDate: TODAY, minutes: 440, activity: 'Seven twenty' });

      const r = mount();
      await settle();

      expect(byTestId(r, 'hour-input').props.value).toBe('7.33');
      expect(textOf(r, 'today-status')).toBe('Logged');
      expect(textOf(r, 'stored-hours')).toContain('7h 20m');

      // The real assertion: press Update without touching the field.
      await press(r, 'today-save');
      await settle();

      const stored = await mockDb.getAllAsync<{ minutes: number }>('SELECT minutes FROM entries');
      expect(stored).toHaveLength(1);
      expect(stored[0].minutes).toBe(440);
    });
  });

  describe('validation', () => {
    beforeEach(async () => {
      mockDb = await freshDb();
    });

    it('refuses an empty activity and says why', async () => {
      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '7.5');
      await press(r, 'today-save');
      await settle();

      expect(textOf(r, 'activity-error')).toBe('Describe what you did.');
      expect((await rows())[0].count).toBe(0);
    });

    it('refuses whitespace-only activity (R-3)', async () => {
      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '7.5');
      await typeInto(r, 'activity-input', '    ');
      await press(r, 'today-save');
      await settle();

      expect((await rows())[0].count).toBe(0);
    });

    it('shows every problem at once, not one per attempt', async () => {
      // Both fields are on screen together, so showing only the first would make
      // the intern fix and resubmit twice for no reason.
      const r = mount();
      await settle();
      await press(r, 'today-save');
      await settle();

      expect(hasTestId(r, 'hour-error')).toBe(true);
      expect(hasTestId(r, 'activity-error')).toBe(true);
    });

    it('reveals the errors without waiting for a blur', async () => {
      // A submit does not blur anything, so a blur-gated form would be silent.
      const r = mount();
      await settle();
      expect(hasTestId(r, 'activity-error')).toBe(false);
      await press(r, 'today-save');
      await settle();
      expect(hasTestId(r, 'activity-error')).toBe(true);
    });

    it('clears a message as soon as the field is corrected', async () => {
      const r = mount();
      await settle();
      await press(r, 'today-save');
      await settle();
      expect(hasTestId(r, 'activity-error')).toBe(true);

      await typeInto(r, 'activity-input', 'Now it is described');
      expect(hasTestId(r, 'activity-error')).toBe(false);
    });

    it('refuses hours outside 0 to 24', async () => {
      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '25');
      await typeInto(r, 'activity-input', 'Long day');
      await press(r, 'today-save');
      await settle();

      expect((await rows())[0].count).toBe(0);
    });
  });

  describe('the progress bar follows R-6', () => {
    it('is hidden when no target is set', async () => {
      mockDb = await freshDb();
      const r = mount();
      await settle();
      expect(hasTestId(r, 'progress-caption')).toBe(false);
    });

    it('appears once a target is set, and counts the logged time', async () => {
      mockDb = await freshDb();
      await writeSettings(mockDb, { requiredMinutes: 10 * 60, dailyTargetMinutes: 8 * 60 });

      const r = mount();
      await settle();
      await typeInto(r, 'hour-input', '5');
      await typeInto(r, 'activity-input', 'Half a day');
      await press(r, 'today-save');
      await settle();

      expect(textOf(r, 'progress-caption')).toBe('5h of 10h');
    });
  });

  describe('the week total respects the Monday-to-Sunday week (R-5)', () => {
    beforeEach(async () => {
      mockDb = await freshDb();
      // 2026-09-28 is a Monday, so this week runs 28 Sep .. 4 Oct. The 24th is
      // the previous week and the 5th is the next one; both sit either side of
      // the boundary, which is the part worth testing.
      await upsert(mockDb, { entryDate: '2026-09-24', minutes: 480, activity: 'Previous week' });
      await upsert(mockDb, { entryDate: '2026-10-01', minutes: 60, activity: 'This week' });
      await upsert(mockDb, { entryDate: '2026-10-05', minutes: 120, activity: 'Next week' });
    });

    it('includes this week only, starting on the Monday', () => {
      expect(weekRange(TODAY)).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    });

    it('excludes the day before the week starts', async () => {
      const r = mount();
      await settle();
      // 8h is the 24th, which is last week. It must not appear here.
      expect(textOf(r, 'week-total')).toBe('1h');
    });

    it('includes the Sunday at the far end of the week', async () => {
      // 2026-10-04 is the Sunday, and it is the last day of the range. A strict
      // `<` comparison would drop it.
      await upsert(mockDb, { entryDate: '2026-10-04', minutes: 30, activity: 'Sunday' });
      const r = mount();
      await settle();
      expect(textOf(r, 'week-total')).toBe('1h 30m');
    });

    it('excludes the Monday that starts the next week', async () => {
      const r = mount();
      await settle();
      // 2h on the 5th is next week. Counting it would give 3h.
      expect(textOf(r, 'week-total')).not.toContain('3h');
    });

    it('counts every day towards the overall total, whatever the week', async () => {
      const r = mount();
      await settle();
      // 8h + 1h + 2h = 11h, all of it.
      expect(textOf(r, 'overall-total')).toBe('11h');
    });
  });

  describe('navigation', () => {
    beforeEach(async () => {
      mockDb = await freshDb();
    });

    it('links to History for backdated days', async () => {
      // There is no date picker here on purpose: today logs today, and T-25
      // handles a past day.
      const r = mount();
      await settle();
      await press(r, 'today-history-link');
      expect(mockPush).toHaveBeenCalledWith('/history');
    });
  });

  it('shows the real calendar date for the pinned clock', async () => {
    mockDb = await freshDb();
    const r = mount();
    await settle();
    // Guards the fake-timer setup: if the clock were not pinned, this screen
    // would be asserting against a different date on every run.
    expect(todayISODate()).toBe(TODAY);
    expect(textOf(r, 'today-date').length).toBeGreaterThan(0);
  });
});
