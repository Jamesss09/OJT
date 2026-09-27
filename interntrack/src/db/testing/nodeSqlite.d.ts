/**
 * Minimal ambient types for the slice of Node's built-in `node:sqlite` module
 * used by [[InternTrack Tech Stack]]'s test double.
 *
 * Deliberately **not** `@types/node`. Pulling in the full Node type surface
 * would put `setTimeout: () => NodeJS.Timeout` and friends into the type
 * environment of React Native application code, which is a real source of
 * confusion, in exchange for a test helper.
 *
 * Runtime is genuinely Node's SQLite, so a method that does not exist will fail
 * the test loudly. Only the *static* description could drift, and it is
 * confined to this one file.
 *
 * Requires Node 22.5+ (22.13+ / 23.4+ for `node:sqlite` to be usable without a
 * flag). The project runs Node 24.
 */
declare module 'node:sqlite' {
  export type SupportedValueType = null | number | bigint | string | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowId: number | bigint;
  }

  export interface StatementSync {
    setAllowBareNamedParameters(enabled: boolean): void;
    run(...anonymousParameters: SupportedValueType[]): StatementResultingChanges;
    get(...anonymousParameters: SupportedValueType[]): unknown;
    all(...anonymousParameters: SupportedValueType[]): unknown[];
  }

  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    /** Runs one or more statements. Parameters are not supported here. */
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
