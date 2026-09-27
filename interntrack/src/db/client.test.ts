import { readUserVersion, initDatabase, migrateDatabase } from './client';
import { LATEST_VERSION, MIGRATIONS, assertMigrationsValid, pendingMigrations } from './migrations';
import { type TestDatabase, createTestDatabase } from './testing/nodeSqliteTestDouble';

function tableNames(db: TestDatabase): string[] {
  return db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe('migration list invariants', () => {
  it('is valid, contiguous and starts at 1', () => {
    expect(() => assertMigrationsValid(MIGRATIONS)).not.toThrow();
    expect(MIGRATIONS[0].version).toBe(1);
    expect(LATEST_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  it('rejects a gap in versions', () => {
    expect(() =>
      assertMigrationsValid([
        { version: 1, name: 'a', up: 'SELECT 1;' },
        { version: 3, name: 'c', up: 'SELECT 1;' },
      ]),
    ).toThrow(/contiguous/);
  });

  it('rejects a list that does not start at 1', () => {
    expect(() =>
      assertMigrationsValid([{ version: 2, name: 'a', up: 'SELECT 1;' }]),
    ).toThrow(/contiguous/);
  });

  it('rejects out-of-order and duplicate versions', () => {
    // Reachable only past the contiguity check, e.g. a migration pasted in out
    // of order — exactly the edit that would re-run a schema change.
    expect(() =>
      assertMigrationsValid([
        { version: 1, name: 'a', up: 'SELECT 1;' },
        { version: 2, name: 'b', up: 'SELECT 1;' },
        { version: 1, name: 'c', up: 'SELECT 1;' },
      ]),
    ).toThrow(/strictly ascend/);
  });

  it('rejects a malformed version, blank name and empty body', () => {
    expect(() => assertMigrationsValid([{ version: 0, name: 'a', up: 'SELECT 1;' }])).toThrow(
      /positive integer/,
    );
    expect(() => assertMigrationsValid([{ version: 1.5, name: 'a', up: 'SELECT 1;' }])).toThrow(
      /positive integer/,
    );
    expect(() => assertMigrationsValid([{ version: 1, name: '  ', up: 'SELECT 1;' }])).toThrow(/no name/);
    expect(() => assertMigrationsValid([{ version: 1, name: 'a', up: '   ' }])).toThrow(/empty body/);
    expect(() => assertMigrationsValid([])).toThrow(/empty/);
  });

  it('computes pending migrations in ascending order', () => {
    const list = [
      { version: 1, name: 'a', up: 'SELECT 1;' },
      { version: 2, name: 'b', up: 'SELECT 1;' },
      { version: 3, name: 'c', up: 'SELECT 1;' },
    ];
    expect(pendingMigrations(0, list).map((m) => m.version)).toEqual([1, 2, 3]);
    expect(pendingMigrations(2, list).map((m) => m.version)).toEqual([3]);
    expect(pendingMigrations(3, list)).toEqual([]);
    // Database from a newer build: leave it alone, do not attempt a downgrade.
    expect(pendingMigrations(99, list)).toEqual([]);
  });
});

describe('migrateDatabase', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('reads version 0 from a fresh database', async () => {
    expect(await readUserVersion(db)).toBe(0);
  });

  it('applies the initial schema to an empty database', async () => {
    expect(await migrateDatabase(db)).toEqual([1]);
    expect(await readUserVersion(db)).toBe(1);
    expect(tableNames(db)).toEqual(['app_settings', 'entries']);
  });

  it('is idempotent — a second run changes nothing', async () => {
    await migrateDatabase(db);
    expect(await migrateDatabase(db)).toEqual([]);
    expect(await readUserVersion(db)).toBe(1);
  });

  it('creates the date index used by history and report queries', async () => {
    await migrateDatabase(db);
    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'entries'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toContain('idx_entries_date');
  });

  it('rolls back and leaves the version untouched when a migration fails', async () => {
    const broken = [
      { version: 1, name: 'creates-a-table', up: 'CREATE TABLE partial (id INTEGER);' },
      { version: 2, name: 'fails', up: 'THIS IS NOT SQL;' },
    ];

    await expect(migrateDatabase(db, broken)).rejects.toThrow();
    // The first migration was committed on its own transaction...
    expect(await readUserVersion(db)).toBe(1);
    expect(tableNames(db)).toEqual(['partial']);
  });

  it('runs later migrations on an already-versioned database', async () => {
    const first = [{ version: 1, name: 'one', up: 'CREATE TABLE one (id INTEGER);' }];
    const second = [
      ...first,
      { version: 2, name: 'two', up: 'CREATE TABLE two (id INTEGER);' },
    ];

    expect(await migrateDatabase(db, first)).toEqual([1]);
    expect(await migrateDatabase(db, second)).toEqual([2]);
    expect(await readUserVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(['one', 'two']);
  });
});

describe('initDatabase (the boot path)', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('applies connection PRAGMAs and migrates in one call', async () => {
    await initDatabase(db);

    expect(await readUserVersion(db)).toBe(LATEST_VERSION);
    expect(tableNames(db)).toEqual(['app_settings', 'entries']);
    // SQLite reports `foreign_keys` per connection; 1 means ON.
    const foreignKeys = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(foreignKeys?.foreign_keys).toBe(1);
  });

  it('is safe to run on every launch', async () => {
    await initDatabase(db);
    await expect(initDatabase(db)).resolves.toBeUndefined();
    expect(await readUserVersion(db)).toBe(LATEST_VERSION);
    expect(tableNames(db)).toEqual(['app_settings', 'entries']);
  });

  it('does not destroy existing rows when re-run', async () => {
    await initDatabase(db);
    await db.runAsync(
      'INSERT INTO entries (entry_date, minutes, activity, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
      ['2026-09-27', 450, 'Shadowed support'],
    );

    await initDatabase(db);

    const count = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM entries');
    expect(count?.c).toBe(1);
  });
});

describe('entries schema constraints (R-2, R-3, R-4)', () => {
  let db: TestDatabase;

  const insert = (entryDate: string, minutes: number, activity: string) =>
    db.runAsync(
      'INSERT INTO entries (entry_date, minutes, activity, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
      [entryDate, minutes, activity],
    );

  beforeEach(async () => {
    db = createTestDatabase();
    await migrateDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  it('accepts a well-formed row', async () => {
    await expect(insert('2026-09-27', 450, 'Shadowed support')).resolves.toBeDefined();
    const row = await db.getFirstAsync<{ minutes: number }>('SELECT minutes FROM entries');
    expect(row?.minutes).toBe(450);
  });

  it('refuses a second row for the same day (R-2)', async () => {
    await insert('2026-09-27', 450, 'Shadowed support');
    await expect(insert('2026-09-27', 480, 'Duplicate day')).rejects.toThrow(/UNIQUE/);
    const count = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM entries');
    expect(count?.c).toBe(1);
  });

  it.each([
    ['zero minutes', 0],
    ['negative minutes', -1],
    ['over 24 hours', 1441],
  ])('rejects %s', async (_label, minutes) => {
    await expect(insert('2026-09-27', minutes, 'activity')).rejects.toThrow(/CHECK/);
  });

  it('accepts the boundary minute values', async () => {
    await expect(insert('2026-09-27', 1, 'a')).resolves.toBeDefined();
    await expect(insert('2026-09-28', 1440, 'b')).resolves.toBeDefined();
  });

  it('rejects an empty or whitespace-only activity', async () => {
    await expect(insert('2026-09-27', 450, '')).rejects.toThrow(/CHECK/);
    await expect(insert('2026-09-27', 450, '   ')).rejects.toThrow(/CHECK/);
  });

  it.each([
    ['a timestamp instead of a date', '2026-09-27T00:00:00Z'],
    ['a slashed date', '2026/09/27'],
    ['a short year', '26-09-27'],
    ['prose', 'next tuesday'],
  ])('rejects %s (R-4)', async (_label, entryDate) => {
    await expect(insert(entryDate, 450, 'activity')).rejects.toThrow(/CHECK/);
  });

  it('rejects a NULL activity or minutes', async () => {
    await expect(
      db.runAsync(
        'INSERT INTO entries (entry_date, minutes, activity, created_at, updated_at) VALUES (?, 450, NULL, 0, 0)',
        ['2026-09-27'],
      ),
    ).rejects.toThrow(/NOT NULL/);
  });

  it('sorts by date lexicographically, so ISO strings order correctly', async () => {
    await insert('2026-09-30', 450, 'c');
    await insert('2026-10-01', 450, 'a');
    await insert('2026-09-27', 450, 'b');

    const dates = (await db.getAllAsync<{ entry_date: string }>(
      'SELECT entry_date FROM entries ORDER BY entry_date DESC',
    )).map((row) => row.entry_date);

    expect(dates).toEqual(['2026-10-01', '2026-09-30', '2026-09-27']);
  });

  it('totals exactly with SUM, never float drift (R-1)', async () => {
    // 7h 20m five times = 36h 40m. As a float this is 36.666...h.
    for (let day = 27; day <= 31; day += 1) {
      await insert(`2026-09-${day}`, 440, 'worked');
    }
    const total = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(minutes), 0) AS total FROM entries',
    );
    expect(total?.total).toBe(2200);
  });

  it('totals 0, not null, for an empty range', async () => {
    const total = await db.getFirstAsync<{ total: number }>(
      "SELECT COALESCE(SUM(minutes), 0) AS total FROM entries WHERE entry_date BETWEEN '2030-01-01' AND '2030-01-31'",
    );
    expect(total?.total).toBe(0);
  });
});

describe('app_settings schema', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = createTestDatabase();
    await migrateDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  it('is a key/value store with one row per key', async () => {
    await db.runAsync('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, 0)', [
      'requiredMinutes',
      '480',
    ]);
    await expect(
      db.runAsync('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, 0)', [
        'requiredMinutes',
        '960',
      ]),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('starts empty — defaults are applied at read time, not by the migration', async () => {
    // programStartDate defaults to the device's today, which a migration
    // cannot know, so defaults must not be baked into schema v1.
    expect(await db.getFirstAsync('SELECT * FROM app_settings')).toBeNull();
  });
});
