/**
 * Database client: open, configure, migrate.
 *
 * The only place in the app that is allowed to call `openDatabaseAsync` or
 * configure SQLite. Repositories receive an already-migrated `SQLiteDatabase`
 * and never open or version anything themselves — see [[InternTrack
 * Architecture]].
 *
 * Nothing here imports React, so the migration logic can be exercised in Node
 * against a real SQLite engine (`T-14`).
 */

import { type SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

import { type Migration, MIGRATIONS, assertMigrationsValid, pendingMigrations } from './migrations';

/**
 * File name of the database inside the app's documents directory.
 *
 * Lives in the documents directory, not the caches directory, so the OS may
 * offer it to the user in a file manager and iOS backs it up to iCloud. That
 * matters because the log is the user's only record of their OJT hours.
 */
export const DATABASE_NAME = 'interntrack.db';

/**
 * The slice of `SQLiteDatabase` that migration needs.
 *
 * Declared structurally rather than as `SQLiteDatabase` so tests can pass a
 * plain Node-backed stand-in without casting the real native type away.
 */
export type MigratableDatabase = {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string): Promise<T | null>;
  withExclusiveTransactionAsync(task: (txn: MigratableDatabase) => Promise<void>): Promise<void>;
};

/** Read the schema version out of the database header. `0` when never migrated. */
export async function readUserVersion(db: MigratableDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number | null }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Bring a database up to the latest schema version.
 *
 * Each migration runs in its own transaction together with the `user_version`
 * bump, so an interrupted upgrade leaves the database at its previous version
 * rather than half-migrated.
 *
 * Uses `withExclusiveTransactionAsync` rather than `withTransactionAsync`
 * because the plain variant is not exclusive: any other async query issued
 * while it is open gets pulled into the transaction. Migrations should never
 * admit a bystander. (Trade-off: it is unsupported on web, which is not a
 * target platform for this app.)
 *
 * @returns the versions that were applied — empty when already up to date.
 */
export async function migrateDatabase(
  db: MigratableDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<number[]> {
  assertMigrationsValid(migrations);

  const currentVersion = await readUserVersion(db);
  const pending = pendingMigrations(currentVersion, migrations);
  const applied: number[] = [];

  for (const migration of pending) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migration.up);
      // `PRAGMA user_version` does not accept a bound parameter in SQLite, so
      // the value is interpolated. That is safe here because it comes from our
      // own validated integer list above, never from user input.
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    applied.push(migration.version);
  }

  return applied;
}

/**
 * `SQLiteProvider` initialiser: apply connection-level PRAGMAs, then migrate.
 *
 * PRAGMAs run outside any transaction because `journal_mode` cannot be changed
 * inside one.
 *
 * Typed as `MigratableDatabase` rather than the full `SQLiteDatabase` so the
 * boot path can be tested in Node. `SQLiteProvider.onInit` still accepts it,
 * since a `SQLiteDatabase` satisfies the narrower type.
 */
export async function initDatabase(db: MigratableDatabase): Promise<void> {
  // WAL: readers do not block the writer, so reading the log can never stall a
  // save. `foreign_keys` is off by default in SQLite and must be re-asserted
  // on every connection.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrateDatabase(db);
}

/**
 * Open the database directly, without React.
 *
 * `SQLiteProvider` is the normal entry point; this exists for one-off work such
 * as the export in `T-54`.
 *
 * This is the one function in the client that cannot be unit tested — it calls
 * the native `openDatabaseAsync`, which `jest-expo` replaces with a web
 * polyfill. It is covered by the first EAS build (`T-61`).
 */
export async function openInternTrackDatabase(
  name: string = DATABASE_NAME,
): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrateDatabase(db);
  return db;
}
