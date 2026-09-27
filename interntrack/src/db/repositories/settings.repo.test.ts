import { initDatabase } from '../client';
import { type TestDatabase, createTestDatabase } from '../testing/nodeSqliteTestDouble';
import {
  DEFAULT_DAILY_TARGET_MINUTES,
  DEFAULT_REMINDER_TIME,
  MAX_NAME_LENGTH,
  MAX_TOTAL_MINUTES,
  REMINDER_ID_KEY,
  asBoolean,
  asISODate,
  asMinutes,
  asName,
  asReminderTime,
  defaultSettings,
  readReminderId,
  readSettings,
  serialiseSettings,
  writeReminderId,
  writeSettings,
} from './settings.repo';

// Mon 28 Sep 2026, local.
const NOW = new Date(2026, 8, 28, 12, 0, 0);

async function seeded(): Promise<TestDatabase> {
  const db = createTestDatabase();
  await initDatabase(db);
  return db;
}

describe('defaultSettings', () => {
  it('matches the documented defaults', () => {
    expect(defaultSettings(NOW)).toEqual({
      programStartDate: '2026-09-28',
      requiredMinutes: 0,
      dailyTargetMinutes: DEFAULT_DAILY_TARGET_MINUTES,
      reminderEnabled: false,
      reminderTime: DEFAULT_REMINDER_TIME,
      internName: '',
    });
  });

  it('defaults the programme start to today, not to a build-time constant', () => {
    expect(defaultSettings(new Date(2026, 0, 1)).programStartDate).toBe('2026-01-01');
    expect(defaultSettings(new Date(2026, 11, 31)).programStartDate).toBe('2026-12-31');
  });
});

describe('sanitisers', () => {
  it('asISODate accepts only a real calendar date', () => {
    expect(asISODate('2026-09-28', 'fallback')).toBe('2026-09-28');
    expect(asISODate('2026-02-31', 'fallback')).toBe('fallback');
    expect(asISODate('28-09-2026', 'fallback')).toBe('fallback');
    expect(asISODate(undefined, 'fallback')).toBe('fallback');
  });

  it('asMinutes accepts whole minutes in range and rejects the rest', () => {
    expect(asMinutes('480', 0, MAX_TOTAL_MINUTES)).toBe(480);
    expect(asMinutes('0', 99, MAX_TOTAL_MINUTES)).toBe(0);

    // parseInt would have turned each of these into a plausible wrong number.
    for (const bad of ['7.5', '12abc', '', '   ', 'NaN', '-1', 'Infinity']) {
      expect(asMinutes(bad, 99, MAX_TOTAL_MINUTES)).toBe(99);
    }
    expect(asMinutes(String(MAX_TOTAL_MINUTES + 1), 99, MAX_TOTAL_MINUTES)).toBe(99);
    expect(asMinutes(undefined, 99, MAX_TOTAL_MINUTES)).toBe(99);
  });

  it('asBoolean accepts only the exact strings', () => {
    expect(asBoolean('true', false)).toBe(true);
    expect(asBoolean('false', true)).toBe(false);
    // Anything else falls through to the caller's default, either way round.
    for (const bad of ['TRUE', '1', 'yes', '', '0']) {
      expect(asBoolean(bad, false)).toBe(false);
      expect(asBoolean(bad, true)).toBe(true);
    }
  });

  it('asReminderTime accepts only a real 24-hour time', () => {
    expect(asReminderTime('18:00', 'fallback')).toBe('18:00');
    expect(asReminderTime('00:00', 'fallback')).toBe('00:00');
    expect(asReminderTime('23:59', 'fallback')).toBe('23:59');

    for (const bad of ['24:00', '18:60', '8:00', '18:0', '18:00:00', '1800', 'abc', '']) {
      expect(asReminderTime(bad, 'fallback')).toBe('fallback');
    }
  });

  it('asName trims and caps, and allows empty', () => {
    expect(asName('  James Quig  ', 'fallback')).toBe('James Quig');
    expect(asName('', 'fallback')).toBe('');
    expect(asName(undefined, 'fallback')).toBe('fallback');
    expect(asName('x'.repeat(500), '')).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('serialiseSettings', () => {
  it('stringifies every value, since the column is TEXT', () => {
    const serialised = serialiseSettings(defaultSettings(NOW));
    expect(serialised).toEqual({
      programStartDate: '2026-09-28',
      requiredMinutes: '0',
      dailyTargetMinutes: '480',
      reminderEnabled: 'false',
      reminderTime: '18:00',
      internName: '',
    });
  });
});

describe('readSettings', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('returns the documented defaults when nothing has ever been written', async () => {
    // The T-16 acceptance criterion.
    expect(await readSettings(db, NOW)).toEqual(defaultSettings(NOW));
  });

  it('reads back what was written', async () => {
    await writeSettings(
      db,
      {
        programStartDate: '2026-09-01',
        requiredMinutes: 12_000,
        dailyTargetMinutes: 450,
        reminderEnabled: true,
        reminderTime: '07:30',
        internName: 'James Quig',
      },
      NOW,
    );

    expect(await readSettings(db, NOW)).toEqual({
      programStartDate: '2026-09-01',
      requiredMinutes: 12_000,
      dailyTargetMinutes: 450,
      reminderEnabled: true,
      reminderTime: '07:30',
      internName: 'James Quig',
    });
  });

  it('falls back to defaults for corrupt rows rather than trusting the text', async () => {
    const write = (key: string, value: string) =>
      db.runAsync('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, 0)', [
        key,
        value,
      ]);

    await write('programStartDate', 'last Tuesday');
    await write('requiredMinutes', '12abc');
    await write('dailyTargetMinutes', '-480');
    await write('reminderEnabled', 'yes');
    await write('reminderTime', '25:00');
    await write('internName', '   ');

    expect(await readSettings(db, NOW)).toEqual(defaultSettings(NOW));
  });

  it('keeps good rows and repairs only the bad one', async () => {
    await writeSettings(db, { internName: 'James Quig', requiredMinutes: 12_000 }, NOW);
    await db.runAsync(
      "UPDATE app_settings SET value = 'broken' WHERE key = 'reminderTime'",
    );

    const settings = await readSettings(db, NOW);
    expect(settings.internName).toBe('James Quig');
    expect(settings.requiredMinutes).toBe(12_000);
    expect(settings.reminderTime).toBe(DEFAULT_REMINDER_TIME);
  });

  it('ignores unknown keys, so a newer build cannot break this one', async () => {
    await db.runAsync('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, 0)', [
      'somethingFromTheFuture',
      '???',
    ]);
    expect(await readSettings(db, NOW)).toEqual(defaultSettings(NOW));
  });
});

describe('writeSettings', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('merges a partial change and leaves other keys alone', async () => {
    await writeSettings(db, { internName: 'James Quig', reminderTime: '07:30' }, NOW);
    await writeSettings(db, { requiredMinutes: 12_000 }, NOW);

    expect(await readSettings(db, NOW)).toEqual({
      ...defaultSettings(NOW),
      internName: 'James Quig',
      reminderTime: '07:30',
      requiredMinutes: 12_000,
    });
  });

  it('sanitises on the way in, not only on the way out', async () => {
    await writeSettings(
      db,
      { reminderTime: '99:99', requiredMinutes: -1, internName: '  padded  ' },
      NOW,
    );

    // The stored rows themselves are already corrected, so a future reader that
    // does not sanitise still gets usable data.
    const stored = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings ORDER BY key',
    );
    const byKey = Object.fromEntries(stored.map((row) => [row.key, row.value]));

    expect(byKey.reminderTime).toBe(DEFAULT_REMINDER_TIME);
    expect(byKey.requiredMinutes).toBe('0');
    expect(byKey.internName).toBe('padded');
  });

  it('returns the sanitised result so the caller can render it immediately', async () => {
    const result = await writeSettings(db, { reminderTime: 'nonsense' }, NOW);
    expect(result.reminderTime).toBe(DEFAULT_REMINDER_TIME);
  });

  it('records when each row changed', async () => {
    const when = new Date(2026, 8, 28, 9, 30, 0);
    await writeSettings(db, { internName: 'James Quig' }, when);
    const row = await db.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM app_settings WHERE key = ?',
      ['internName'],
    );
    expect(row?.updated_at).toBe(when.getTime());
  });

  it('upserts rather than duplicating, so writing twice is safe', async () => {
    await writeSettings(db, { internName: 'First' }, NOW);
    await writeSettings(db, { internName: 'Second' }, NOW);

    const count = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM app_settings WHERE key = ?',
      ['internName'],
    );
    expect(count?.c).toBe(1);
    expect((await readSettings(db, NOW)).internName).toBe('Second');
  });

  it('rolls back entirely if any row fails', async () => {
    await writeSettings(db, { internName: 'Before' }, NOW);

    // A trigger is needed because every value writeSettings produces is valid by
    // construction — the sanitisers have already run. Both INSERT and UPDATE
    // need a trigger, because the upsert takes the DO UPDATE path for a key
    // that already exists.
    //
    // RAISE(ABORT) rolls back only the offending *statement*, leaving the
    // transaction open. So this test is specifically checking that the
    // surrounding withTransactionAsync issues the ROLLBACK for us.
    await db.execAsync(`
      CREATE TRIGGER fail_on_insert BEFORE INSERT ON app_settings
      WHEN NEW.key = 'internName' BEGIN SELECT RAISE(ABORT, 'boom'); END;
      CREATE TRIGGER fail_on_update BEFORE UPDATE ON app_settings
      WHEN NEW.key = 'internName' BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);

    await expect(writeSettings(db, { internName: 'After' }, NOW)).rejects.toThrow(/boom/);

    // The five upserts that ran before internName must not have survived.
    // internName is last in SETTINGS_KEYS, so it is the last to be attempted.
    expect((await readSettings(db, NOW)).internName).toBe('Before');
  });

  it('is not left in a broken transaction state after rolling back', async () => {
    await writeSettings(db, { internName: 'Before' }, NOW);
    await db.execAsync(`
      CREATE TRIGGER fail_on_insert BEFORE INSERT ON app_settings
      WHEN NEW.key = 'internName' BEGIN SELECT RAISE(ABORT, 'boom'); END;
      CREATE TRIGGER fail_on_update BEFORE UPDATE ON app_settings
      WHEN NEW.key = 'internName' BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    await expect(writeSettings(db, { internName: 'After' }, NOW)).rejects.toThrow();

    // If the ROLLBACK had been missing, this INSERT would fail with
    // "cannot start a transaction within a transaction".
    await db.execAsync('DROP TRIGGER fail_on_insert; DROP TRIGGER fail_on_update;');
    await expect(writeSettings(db, { internName: 'After' }, NOW)).resolves.toBeDefined();
    expect((await readSettings(db, NOW)).internName).toBe('After');
  });
});

describe('reminder id', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await seeded();
  });

  afterEach(() => {
    db.close();
  });

  it('is absent until a reminder is scheduled', async () => {
    expect(await readReminderId(db)).toBeNull();
  });

  it('round-trips, and is not confused with a user-facing setting', async () => {
    await writeReminderId(db, 'notification-42', NOW);
    expect(await readReminderId(db)).toBe('notification-42');

    // Reading settings must not surface it as configuration.
    const settings = await readSettings(db, NOW);
    expect(settings).toEqual(defaultSettings(NOW));
    expect(Object.keys(settings)).not.toContain(REMINDER_ID_KEY);
  });

  it('replaces a stale id rather than accumulating rows', async () => {
    await writeReminderId(db, 'first', NOW);
    await writeReminderId(db, 'second', NOW);
    expect(await readReminderId(db)).toBe('second');

    const count = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM app_settings WHERE key = ?',
      [REMINDER_ID_KEY],
    );
    expect(count?.c).toBe(1);
  });

  it('is removed when the reminder is cancelled', async () => {
    await writeReminderId(db, 'notification-42', NOW);
    await writeReminderId(db, null, NOW);
    expect(await readReminderId(db)).toBeNull();
  });
});
