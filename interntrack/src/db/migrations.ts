/**
 * Schema migrations for the local SQLite database.
 *
 * Forward-only, versioned by `PRAGMA user_version` — see [[InternTrack
 * Architecture]] and the Migrations section of [[InternTrack Rules]].
 *
 *   - Never edit a shipped migration. Append a new one.
 *   - Never `DROP TABLE`. The user's log is the entire point of the app.
 *
 * This module is **pure** — it holds SQL text and a validator, no imports from
 * `expo-sqlite`. That keeps it type-checkable and unit-testable without a
 * native module (R-8).
 */

export type Migration = {
  /** Sequential integer starting at 1. Recorded in `PRAGMA user_version`. */
  readonly version: number;
  /** Human label, used in error messages and debugging. Never shown in the UI. */
  readonly name: string;
  /** One or more statements, applied together in a single transaction. */
  readonly up: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: /* sql */ `
      -- One row per calendar day. R-2: the uniqueness is enforced by the
      -- database, not by UI code, so a race can never produce two rows.
      CREATE TABLE IF NOT EXISTS entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date  TEXT    NOT NULL UNIQUE,
        minutes     INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
        activity    TEXT    NOT NULL CHECK (length(trim(activity)) > 0),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        -- R-4: reject anything that is not a bare YYYY-MM-DD string. SQLite's
        -- GLOB is case-sensitive, so this cannot be bypassed with 'x'.
        CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
      );

      -- ISO date strings sort lexicographically, so this index serves both
      -- ORDER BY entry_date DESC and the BETWEEN range queries used by reports.
      CREATE INDEX IF NOT EXISTS idx_entries_date ON entries (entry_date DESC);

      -- Key/value programme configuration. Defaults are applied at *read* time
      -- by the settings repository rather than inserted by the migration,
      -- because programStartDate defaults to the device's today and a
      -- migration cannot know it.
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

/** The schema version this build expects. */
export const LATEST_VERSION: number = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

/**
 * Fail loudly if the migration list itself is malformed.
 *
 * A gap or a duplicate in this array would silently skip or re-run a schema
 * change on a user's real data, so it is checked at startup rather than
 * discovered later. Cheap, and the failure is a clear message instead of a
 * corrupt log.
 */
export function assertMigrationsValid(migrations: readonly Migration[]): void {
  if (migrations.length === 0) {
    throw new Error('Migration list is empty — a fresh install would have no schema.');
  }

  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(
        `Migration version must be a positive integer, got ${migration.version} (${migration.name}).`,
      );
    }
    if (migration.version <= previousVersion) {
      throw new Error(
        `Migration versions must strictly ascend: ${migration.version} (${migration.name}) ` +
          `follows ${previousVersion}.`,
      );
    }
    if (migration.version !== previousVersion + 1) {
      throw new Error(
        `Migration versions must be contiguous from 1: expected ${previousVersion + 1}, ` +
          `got ${migration.version} (${migration.name}).`,
      );
    }
    if (migration.name.trim().length === 0) {
      throw new Error(`Migration ${migration.version} has no name.`);
    }
    if (migration.up.trim().length === 0) {
      throw new Error(`Migration ${migration.version} (${migration.name}) has an empty body.`);
    }
    previousVersion = migration.version;
  }
}

/**
 * Migrations that still need to run against a database at `currentVersion`,
 * in ascending order.
 *
 * A `currentVersion` ahead of the list means the user is on a *newer* build
 * than this one (an EAS OTA rollback, say). Nothing is pending, and the caller
 * is expected to leave the data alone rather than try to downgrade it.
 */
export function pendingMigrations(
  currentVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return migrations.filter((migration) => migration.version > currentVersion);
}
