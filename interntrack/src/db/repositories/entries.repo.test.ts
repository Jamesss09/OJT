import { initDatabase } from '../client';
import { type TestDatabase, createTestDatabase } from '../testing/nodeSqliteTestDouble';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type Entry,
  type EntryInput,
  clampPageSize,
  deleteByDate,
  getByDate,
  historyPage,
  listRange,
  overallTotals,
  totalsFor,
  upsert,
} from './entries.repo';

// Fixed clock, local. Epoch ms are the source of truth in these assertions.
const FIRST = new Date(2026, 8, 28, 9, 0, 0);
const SECOND = new Date(2026, 8, 28, 17, 30, 0);

const draft = (
  entryDate: string,
  minutes: number,
  activity = 'Worked on the build',
): EntryInput => ({ entryDate, minutes, activity });

async function seeded(): Promise<TestDatabase> {
  const db = createTestDatabase();
  await initDatabase(db);
  return db;
}

describe('getByDate', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for a day that has not been logged', async () => {
    // An unlogged day is the normal case, not an error.
    expect(await getByDate(db, '2026-09-28')).toBeNull();
  });

  it('returns the entry, mapped into the camelCase domain shape', async () => {
    await upsert(db, draft('2026-09-28', 450, 'Fixed the migration'), FIRST);

    const entry = await getByDate(db, '2026-09-28');
    expect(entry).toEqual({
      id: expect.any(Number),
      entryDate: '2026-09-28',
      minutes: 450,
      activity: 'Fixed the migration',
      createdAt: FIRST.getTime(),
      updatedAt: FIRST.getTime(),
    });
  });

  it('treats a date as a literal, proving the query is parameterised (R-7)', async () => {
    const injection = "2026-09-28'; DROP TABLE entries; --";
    expect(await getByDate(db, injection)).toBeNull();

    // The table is still there and still holds its row.
    const entry = await upsert(db, draft('2026-09-28', 60), FIRST);
    expect((await getByDate(db, entry.entryDate))?.minutes).toBe(60);
  });
});

describe('upsert', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('creates a day that is not yet logged', async () => {
    const entry = await upsert(db, draft('2026-09-28', 450), FIRST);
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.minutes).toBe(450);
  });

  it('updates the existing day rather than adding a second row (R-2)', async () => {
    // The T-18 acceptance criterion.
    const first = await upsert(db, draft('2026-09-28', 450, 'First attempt'), FIRST);
    const second = await upsert(db, draft('2026-09-28', 480, 'Corrected'), SECOND);

    expect(second.id).toBe(first.id);
    expect(second.minutes).toBe(480);
    expect(second.activity).toBe('Corrected');

    const count = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM entries');
    expect(count?.c).toBe(1);
  });

  it('keeps created_at across an edit but bumps updated_at', async () => {
    // An edit is not a re-creation: the day the record came into existence is
    // not the day it was last corrected.
    await upsert(db, draft('2026-09-28', 450), FIRST);
    const second = await upsert(db, draft('2026-09-28', 480), SECOND);

    expect(second.createdAt).toBe(FIRST.getTime());
    expect(second.updatedAt).toBe(SECOND.getTime());
    expect(second.updatedAt).toBeGreaterThan(second.createdAt);
  });

  it('logs distinct days independently', async () => {
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2026-09-29', 480), FIRST);

    const all = await listRange(db, '2026-09-01', '2026-09-30');
    expect(all.map((entry) => entry.entryDate)).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('preserves multi-line activity exactly as written', async () => {
    const activity = 'Line one\n\nLine two with  spaces\ttabbed';
    const entry = await upsert(db, draft('2026-09-28', 60, activity), FIRST);
    expect((await getByDate(db, '2026-09-28'))?.activity).toBe(activity);
    expect(entry.activity).toBe(activity);
  });
});

describe('upsert rejects what the schema forbids', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  // The repository deliberately does not re-validate: validateEntry owns that,
  // and two copies of a rule drift. These are the backstop that a caller which
  // skipped validation still cannot get past.
  it('rejects zero minutes', async () => {
    await expect(upsert(db, draft('2026-09-28', 0), FIRST)).rejects.toThrow(/CHECK/);
  });

  it('rejects more than 24 hours in a day', async () => {
    await expect(upsert(db, draft('2026-09-28', 1441), FIRST)).rejects.toThrow(/CHECK/);
  });

  it('rejects an empty or whitespace-only activity', async () => {
    await expect(upsert(db, draft('2026-09-28', 60, ''), FIRST)).rejects.toThrow(/CHECK/);
    await expect(upsert(db, draft('2026-09-28', 60, '   '), FIRST)).rejects.toThrow(/CHECK/);
  });

  it('rejects a date that is not a bare YYYY-MM-DD string (R-4)', async () => {
    for (const bad of ['28-09-2026', '2026/09/28', '2026-9-28', 'x', '']) {
      await expect(upsert(db, draft(bad, 60), FIRST)).rejects.toThrow();
    }
  });

  it('leaves nothing behind when a write is refused', async () => {
    await expect(upsert(db, draft('2026-09-28', 0), FIRST)).rejects.toThrow(/CHECK/);

    const count = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM entries');
    expect(count?.c).toBe(0);
  });

  it('leaves the database usable after a refused write', async () => {
    // If the transaction had not been rolled back, the next write would fail
    // with "cannot start a transaction within a transaction".
    await expect(upsert(db, draft('2026-09-28', 0), FIRST)).rejects.toThrow(/CHECK/);
    const entry = await upsert(db, draft('2026-09-28', 450), FIRST);
    expect(entry.minutes).toBe(450);
  });

  it('does not disturb an existing day when a later edit is refused', async () => {
    await upsert(db, draft('2026-09-28', 450, 'Good entry'), FIRST);
    await expect(upsert(db, draft('2026-09-28', 60, '   '), SECOND)).rejects.toThrow(/CHECK/);

    const entry = await getByDate(db, '2026-09-28');
    expect(entry?.activity).toBe('Good entry');
    expect(entry?.updatedAt).toBe(FIRST.getTime());
  });
});

describe('deleteByDate', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('removes the day and reports that it did', async () => {
    await upsert(db, draft('2026-09-28', 450), FIRST);
    expect(await deleteByDate(db, '2026-09-28')).toBe(true);
    expect(await getByDate(db, '2026-09-28')).toBeNull();
  });

  it('reports false for a day that was never logged', async () => {
    // So a screen can tell "removed" from "was never there".
    expect(await deleteByDate(db, '2026-09-28')).toBe(false);
  });

  it('does not touch other days', async () => {
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2026-09-29', 480), FIRST);
    await deleteByDate(db, '2026-09-28');

    const remaining = await listRange(db, '2026-09-01', '2026-09-30');
    expect(remaining.map((entry) => entry.entryDate)).toEqual(['2026-09-29']);
  });

  it('lets a deleted day be logged again, with a fresh created_at', async () => {
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await deleteByDate(db, '2026-09-28');
    const again = await upsert(db, draft('2026-09-28', 450), SECOND);

    expect(again.createdAt).toBe(SECOND.getTime());
  });
});

describe('listRange', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
    // Deliberately inserted out of order, to prove ordering comes from SQL.
    await upsert(db, draft('2026-09-29', 480), FIRST);
    await upsert(db, draft('2026-09-27', 420), FIRST);
    await upsert(db, draft('2026-09-28', 450), FIRST);
  });

  afterEach(() => {
    db.close();
  });

  it('returns the range oldest first', async () => {
    const entries = await listRange(db, '2026-09-27', '2026-09-29');
    expect(entries.map((entry) => entry.entryDate)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
    ]);
  });

  it('includes both bounds', async () => {
    const entries = await listRange(db, '2026-09-28', '2026-09-29');
    expect(entries.map((entry) => entry.entryDate)).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('returns an empty list when the range contains nothing', async () => {
    expect(await listRange(db, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('returns an empty list when the bounds are the wrong way round', async () => {
    // The honest answer for a BETWEEN that matches nothing. Swapping the bounds
    // silently instead would hide a caller bug.
    expect(await listRange(db, '2026-09-29', '2026-09-27')).toEqual([]);
  });

  it('spans a month and a year boundary', async () => {
    await upsert(db, draft('2026-10-01', 60), FIRST);
    await upsert(db, draft('2027-01-01', 60), FIRST);

    const entries = await listRange(db, '2026-09-30', '2027-01-01');
    expect(entries.map((entry) => entry.entryDate)).toEqual(['2026-10-01', '2027-01-01']);
  });
});

describe('totalsFor', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('totals 0, not null, for an empty range (R-7)', async () => {
    // The T-18 acceptance criterion.
    expect(await totalsFor(db, '2026-01-01', '2026-01-31')).toEqual({
      totalMinutes: 0,
      loggedDays: 0,
    });
  });

  it('sums an inclusive range and counts the days with entries', async () => {
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2026-09-29', 480), FIRST);
    await upsert(db, draft('2026-09-30', 60), FIRST);

    expect(await totalsFor(db, '2026-09-28', '2026-09-29')).toEqual({
      totalMinutes: 930,
      loggedDays: 2,
    });
  });

  it('excludes days outside the range', async () => {
    await upsert(db, draft('2026-09-27', 999), FIRST);
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2026-10-01', 999), FIRST);

    expect((await totalsFor(db, '2026-09-28', '2026-09-28')).totalMinutes).toBe(450);
  });

  it('sums whole minutes exactly, with no floating-point drift (R-1)', async () => {
    // 7.5 hours three times is the case that breaks a float implementation:
    // 7.5 + 7.5 + 7.5 is 22.499999999999996 in binary floating point.
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2026-09-29', 450), FIRST);
    await upsert(db, draft('2026-09-30', 450), FIRST);

    const total = (await totalsFor(db, '2026-09-01', '2026-09-30')).totalMinutes;
    expect(total).toBe(1350);
    expect(Number.isInteger(total)).toBe(true);
  });

  it('is unaffected by a day being edited between two reads', async () => {
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2026-09-28', 480), SECOND);

    expect((await totalsFor(db, '2026-09-01', '2026-09-30')).totalMinutes).toBe(480);
  });
});

describe('overallTotals', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('is 0 on an empty log', async () => {
    expect(await overallTotals(db)).toEqual({ totalMinutes: 0, loggedDays: 0 });
  });

  it('covers the whole log regardless of range', async () => {
    await upsert(db, draft('2026-01-15', 300), FIRST);
    await upsert(db, draft('2026-09-28', 450), FIRST);
    await upsert(db, draft('2027-03-02', 120), FIRST);

    expect(await overallTotals(db)).toEqual({ totalMinutes: 870, loggedDays: 3 });
  });

  it('agrees with totalsFor over a range that spans the whole log', async () => {
    await upsert(db, draft('2026-01-15', 300), FIRST);
    await upsert(db, draft('2026-09-28', 450), FIRST);

    const all = await overallTotals(db);
    const ranged = await totalsFor(db, '2000-01-01', '2999-12-31');
    expect(ranged).toEqual(all);
  });
});

describe('clampPageSize', () => {
  it('defaults when nothing is asked for', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('passes a sane request through', () => {
    expect(clampPageSize(7)).toBe(7);
    expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('clamps nonsense into a usable range', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
    expect(clampPageSize(10_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('truncates a fractional page size', () => {
    // LIMIT 7.5 would be an error in SQLite; a floor keeps it a whole number.
    expect(clampPageSize(7.9)).toBe(7);
  });
});

describe('historyPage', () => {
  let db: TestDatabase;
  const days = [
    '2026-09-20',
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
  ];

  beforeEach(async () => {
    db = await seeded();
    for (const day of days) {
      await upsert(db, draft(day, 60), FIRST);
    }
  });

  afterEach(() => {
    db.close();
  });

  const datesOf = (entries: Entry[]) => entries.map((entry) => entry.entryDate);

  it('returns the newest day first', async () => {
    const page = await historyPage(db, { limit: 3 });
    expect(datesOf(page)).toEqual(['2026-09-27', '2026-09-26', '2026-09-25']);
  });

  it('walks the whole log across pages without repeating or skipping', async () => {
    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const page = await historyPage(db, { limit: 3, offset });
      if (page.length === 0) {
        break;
      }
      seen.push(...datesOf(page));
      offset += 3;
    }

    expect(seen).toEqual([...days].reverse());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('returns an empty page past the end', async () => {
    expect(await historyPage(db, { limit: 3, offset: 999 })).toEqual([]);
  });

  it('honours a limit larger than the log', async () => {
    expect(await historyPage(db, { limit: 1_000 })).toHaveLength(days.length);
  });

  it('clamps a hostile limit instead of trusting it', async () => {
    // Without the clamp this is the whole log in one query; with a negative
    // limit SQLite would treat it as no limit at all.
    expect(await historyPage(db, { limit: -3 })).toHaveLength(1);
    expect(await historyPage(db, { limit: MAX_PAGE_SIZE + 1 })).toHaveLength(days.length);
  });

  it('floors a negative offset rather than reading from the end', async () => {
    const page = await historyPage(db, { limit: 1, offset: -4 });
    expect(datesOf(page)).toEqual(['2026-09-27']);
  });

  it('uses the default page size when no options are given', async () => {
    const page = await historyPage(db);
    expect(page).toHaveLength(Math.min(DEFAULT_PAGE_SIZE, days.length));
  });
});
