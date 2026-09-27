/**
 * A minimal `SQLiteDatabase` stand-in backed by Node's built-in `node:sqlite`.
 *
 * ## Why this exists
 *
 * `jest-expo` replaces `expo-modules-core` with a web polyfill, so under Jest
 * `openDatabaseAsync` throws `NativeDatabase is not a constructor`. There is no
 * official SQLite mock for Jest — `@expo/mocks`, which `jest-expo` probes for, is
 * not published. An earlier version of [[InternTrack Architecture]] assumed
 * "jest-expo against an in-memory SQLite" was available; it is not.
 *
 * Without *some* stand-in the migration SQL would never be executed until the
 * first EAS build, and a typo in a `CHECK` constraint would be discovered on a
 * user's phone. This runs the real SQL through a real SQLite engine, so schema
 * constraints, transactions and `PRAGMA user_version` are genuinely tested.
 *
 * ## What it does not prove
 *
 * It is not `expo-sqlite`, so it cannot catch a difference in how expo-sqlite
 * binds parameters or drives transactions. `execAsync`, `getFirstAsync` and
 * `withExclusiveTransactionAsync` are the complete set `migrateDatabase` uses
 * and all three are verified present in the SDK 57 `SQLiteDatabase` API.
 *
 * Named (`:name`) bind parameters are not supported — positional `?` only. A
 * repository that needs them will get a clear error rather than a silent
 * mismatch.
 */

import { DatabaseSync, type SupportedValueType } from 'node:sqlite';

import type { MigratableDatabase } from '../client';

export type RunResult = { lastInsertRowId: number; changes: number };

/**
 * Accepts both expo-sqlite call styles — `runAsync(sql, [a, b])` and
 * `runAsync(sql, a, b)` — and returns the positional argument list.
 */
function positionalArgs(rest: readonly unknown[]): SupportedValueType[] {
  if (rest.length === 0) {
    return [];
  }
  if (rest.length === 1 && Array.isArray(rest[0])) {
    return rest[0] as SupportedValueType[];
  }
  if (rest.some((value) => typeof value === 'object' && value !== null && !Array.isArray(value))) {
    throw new TypeError(
      'The test double does not support named bind parameters. Use positional `?` placeholders.',
    );
  }
  return rest as SupportedValueType[];
}

/**
 * The surface this stand-in exposes.
 *
 * Declared standalone rather than as `MigratableDatabase & {...}`. An
 * intersection gives the two `getFirstAsync` declarations the status of an
 * overload list, and the 1-arg one from `MigratableDatabase` comes first — so
 * `getFirstAsync(sql, [key])` was a type error, and would have been a silent
 * wrong answer if it had compiled. A rest parameter is assignable to the
 * narrower 1-arg signature, so this still satisfies `MigratableDatabase` and can
 * be handed to `initDatabase`.
 */
export type TestDatabase = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: unknown[]): Promise<RunResult>;
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (txn: MigratableDatabase) => Promise<void>): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  /** Escape hatch for assertions that need the raw engine. */
  readonly raw: DatabaseSync;
  close(): void;
};

export function createTestDatabase(name = ':memory:'): TestDatabase {
  const raw = new DatabaseSync(name);

  const db: TestDatabase = {
    raw,

    async execAsync(source) {
      raw.exec(source);
    },

    async runAsync(source, ...params) {
      const result = raw
        .prepare(source)
        .run(...positionalArgs(params));
      return { lastInsertRowId: Number(result.lastInsertRowId), changes: Number(result.changes) };
    },

    // Parameter types are annotated rather than inferred: `TestDatabase`
    // intersects `MigratableDatabase` with a self-referential transaction
    // signature, and TypeScript gives up on contextual typing through that.
    //
    // The rest parameter is not decoration — an earlier version of this double
    // took only `source` and silently ignored bind parameters, so every
    // `getFirstAsync(sql, [key])` lookup in a repository returned nothing.
    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      const row = raw.prepare(source).get(...positionalArgs(params));
      return (row as T | undefined) ?? null;
    },

    async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
      return raw.prepare(source).all(...positionalArgs(params)) as T[];
    },

    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task(db);
        raw.exec('COMMIT');
      } catch (error) {
        // Mirrors expo-sqlite: a throwing task rolls the whole thing back.
        raw.exec('ROLLBACK');
        throw error;
      }
    },

    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },

    close() {
      raw.close();
    },
  };

  return db;
}
