---
title: InternTrack Architecture
tags: [interntrack, architecture]
created: 2026-09-27
updated: 2026-09-27
status: planning
---

# InternTrack — Architecture

Index: [[InternTrack Index]] · Scope: [[InternTrack Overview]] · Stack: [[InternTrack Tech Stack]] · Rules: [[InternTrack Rules]] · Work: [[InternTrack Agent Tasks]]

## Design principles

1. **SQLite is the single source of truth.** Not the store, not a cache — the truth. UI reads from it, writes to it, re-reads. No in-memory copy that can drift.
2. **No network layer.** There is no API client, no fetch wrapper, no retry logic, no offline queue. If code needs it, the design is wrong. (Revisit trigger: a second device, or a supervisor account.)
3. **Exact arithmetic.** Hours live as integer minutes. Totals are `SUM(minutes)` — never JS float addition.
4. **Pure domain logic.** Hours/date maths are dependency-free functions in `src/lib`. They are testable without a renderer or a database.
5. **Thin screens.** Route files compose UI and call hooks. They contain no SQL and no business rules.
6. **Migrations, never destructive changes.** Schema changes are forward-only, versioned by `PRAGMA user_version`.

## Layer diagram

```mermaid
flowchart TD
    UI["Screens (app/*) + Components<br/>presentation only"]
    Hooks["Hooks (useTodayLog, useReport, useReminder)<br/>orchestration, loading/error state"]
    Repo["Repositories (src/db/repositories)<br/>all SQL lives here"]
    DB[("SQLite (interntrack.db)<br/>entries + app_settings")]
    Pure["Pure lib (src/lib)<br/>hours, dates, validation"]
    Store["Zustand (src/store)<br/>drafts + filters ONLY"]

    UI --> Hooks
    UI --> Store
    Hooks --> Repo
    Hooks --> Pure
    Repo --> DB
    Repo --> Pure
    Store --> Pure
    Remind["expo-notifications<br/>schedules from settings"] -.-> DB
```

**Rule of thumb:** SQL stops at the repository boundary. Validation stops at `src/lib`. If a screen contains either, that's a bug.

## Folder structure

```
interntrack/
├─ app/                          # expo-router — file-based routes
│  ├─ _layout.tsx                # providers: SQLiteProvider, SafeArea, theme
│  ├─ index.tsx                  # Today
│  ├─ history.tsx                # History
│  ├─ reports.tsx                # Reports
│  ├─ settings.tsx               # Settings
│  └─ log/
│     └─ [date].tsx              # add/edit one day  (e.g. /log/2026-09-27)
│
├─ src/
│  ├─ components/                # presentational, reusable
│  │  ├─ HourInput.tsx           #   numeric entry, decimal hours
│  │  ├─ ActivityInput.tsx       #   multiline text
│  │  ├─ ProgressBar.tsx
│  │  ├─ DayRow.tsx
│  │  ├─ TotalTile.tsx
│  │  └─ EmptyState.tsx
│  ├─ db/
│  │  ├─ client.ts               # openDatabaseAsync + PRAGMAs
│  │  ├─ migrations.ts           # versioned, ordered migration list
│  │  ├─ schema.sql              # canonical DDL (documentation)
│  │  └─ repositories/
│  │     ├─ entries.repo.ts
│  │     └─ settings.repo.ts
│  ├─ hooks/
│  │  ├─ useEntryForDate.ts
│  │  ├─ useLogEntryMutation.ts  # save / delete, invalidates
│  │  ├─ useReportTotals.ts
│  │  ├─ useSettings.ts
│  │  └─ useDailyReminder.ts
│  ├─ lib/                       # PURE — no React, no expo imports
│  │  ├─ hours.ts                #   toMinutes, fromMinutes, format, validate
│  │  ├─ dates.ts                #   today, weekRange, monthRange, formatting
│  │  └─ validation.ts           #   validateEntry -> Result<Entry, Errors>
│  ├─ store/
│  │  └─ uiStore.ts              # draft form state, history filters
│  ├─ notifications/
│  │  └─ scheduler.ts            # schedule / cancel the daily reminder
│  └─ theme/
│     ├─ tokens.ts
│     └─ ThemeProvider.tsx
│
├─ assets/                       # icons, splash
├─ app.json  eas.json  package.json  tsconfig.json
└─ __tests__/                    # co-located *.test.ts next to the file
```

## Data model

### `entries` — one row per calendar day

```sql
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date  TEXT    NOT NULL UNIQUE,        -- 'YYYY-MM-DD', device-local
  minutes     INTEGER NOT NULL,               -- 1..1440  (never a float)
  activity    TEXT    NOT NULL,               -- what was done
  created_at  INTEGER NOT NULL,               -- epoch ms
  updated_at  INTEGER NOT NULL                -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries (entry_date DESC);
```

Design notes:

- **`UNIQUE(entry_date)`** enforces the one-row-per-day rule at the database level, not in UI code. Saving an existing day = `UPDATE ... WHERE entry_date = ?`. See [[InternTrack Rules]].
- **`minutes INTEGER`** is the whole reason totals are exact. `SUM(minutes)` in SQL, then format to `7.5 h` at the edge. Rule R-1.
- **`entry_date` as `TEXT 'YYYY-MM-DD'`** sorts correctly with a plain `ORDER BY`, is timezone-free, and is trivially readable when debugging. Do not store epoch ms for the day.
- **`created_at`/`updated_at` as epoch ms** — machine-sortable, timezone-correct. Format only for display.

### `app_settings` — programme configuration

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `programStartDate` | `YYYY-MM-DD` | today | First day of the OJT period |
| `requiredMinutes` | integer | `0` | Total hours required (`0` = not set) |
| `dailyTargetMinutes` | integer | `480` | Expected hours per day (8 h) |
| `reminderEnabled` | `'true'\|'false'` | `'false'` | Daily reminder on/off |
| `reminderTime` | `HH:mm` | `18:00` | When the reminder fires |
| `internName` | text | `''` | Printed on reports (Phase 7) |

Settings live in SQLite rather than AsyncStorage so reports can read them in the same query as entries and the app has exactly one persistence mechanism.

## Data flow — saving a day

```mermaid
sequenceDiagram
    participant U as User
    participant S as Log screen
    participant H as useLogEntryMutation
    participant V as lib/validation
    participant R as entries.repo
    participant D as SQLite

    U->>S: types hours "7.5" + activity, taps Save
    S->>H: save({ date, hoursText, activity })
    H->>V: validateEntry(input)
    V-->>H: Ok | Err(fields)
    alt invalid
        H-->>S: field errors, focus first bad field
    else valid
        H->>R: upsert({ entry_date, minutes, activity })
        R->>D: INSERT ... ON CONFLICT(entry_date) DO UPDATE
        D-->>R: ok
        R-->>H: saved entry
        H-->>S: reset draft, refresh totals
    end
```

`INSERT ... ON CONFLICT(entry_date) DO UPDATE` is the whole "add or edit" story. One statement, no read-modify-write race, no branching in the UI.

## Reporting queries

All aggregation lives in SQL. Never fetch rows and reduce in JS.

```sql
-- day
SELECT * FROM entries WHERE entry_date = ?;

-- week / month / all-time (pass ISO bounds, inclusive)
SELECT COALESCE(SUM(minutes), 0) AS total FROM entries
 WHERE entry_date BETWEEN ? AND ?;

-- progress vs required
SELECT COALESCE(SUM(minutes), 0) AS done,
       (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'requiredMinutes') AS required
  FROM entries;

-- history, newest first
SELECT * FROM entries ORDER BY entry_date DESC LIMIT ? OFFSET ?;
```

`COALESCE(..., 0)` matters: an empty range must total `0`, not `null`.

## State management

| State | Home | Rule |
| --- | --- | --- |
| Entries, settings, totals | SQLite | Truth. Read via repository → hook → component. |
| In-progress form draft | Zustand | Survives tab switches and accidental backgrounding mid-entry. Cleared on successful save. |
| History filters / selected report range | Zustand | Pure UI. |
| Anything derived from entries | A `useMemo` over the query result, or SQL | Never duplicated into a store. |

**No `useEffect`-fetched copy of the database in global state.** That is the classic local-first bug: two sources of truth, silent drift after a write. A mutation invalidates its hook; the hook re-queries SQLite.

## Migrations

Versioning lives in `PRAGMA user_version` (0, 1, 2, …). One ordered array in `src/db/migrations.ts`:

```ts
export const MIGRATIONS: Migration[] = [
  { version: 1, up: `CREATE TABLE entries (...); CREATE TABLE app_settings (...);` },
  // { version: 2, up: `ALTER TABLE entries ADD COLUMN ...` },
];
```

On boot: read `user_version`, run every migration with a higher version, each in a transaction, then set the version.

- **Forward-only.** Never edit a shipped migration — add a new one.
- **Never `DROP TABLE`.** The user's log is the entire point of the app.
- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` on open.

## Reminder flow

1. `useDailyReminder` reads `reminderEnabled` + `reminderTime` from settings.
2. On change (or first run), cancel any existing scheduled notification, then schedule a new daily one at `reminderTime` (local trigger).
3. Store the returned notification id in `app_settings` (`reminderId`) so it can be cancelled deterministically.
4. Create the Android notification channel once at startup — a daily trigger silently no-ops without it.
5. The reminder is a nudge only. It must never gate, block, or modify data.

## Navigation

expo-router, file-based. No separate navigation config.

| File | Path | Notes |
| --- | --- | --- |
| `app/_layout.tsx` | — | `SQLiteProvider` (runs migrations) → `SafeAreaProvider` → `Stack` |
| `app/index.tsx` | `/` | Today. The 30-second flow. |
| `app/log/[date].tsx` | `/log/2026-09-27` | Add/edit one day. `date` is a validated param. |
| `app/history.tsx` | `/history` | Grouped list. |
| `app/reports.tsx` | `/reports` | Totals + progress. |
| `app/settings.tsx` | `/settings` | Configuration + data management. |

Tabs (`(tabs)` group) are an option for later if the screen count grows; a plain stack is simpler for 5 screens.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Validation failure | Inline field errors. Never a blocking alert. |
| DB write fails | Alert with the reason; keep the draft in the store so nothing typed is lost. |
| DB fails to open / migrate | Full-screen error with a "reset app data" escape hatch. Never a white screen. |
| Corrupt `entry_date` in DB | Repository sorts it last and is skipped by range queries; never crashes the list. |
| Notification permission denied | Reminder silently disabled, surfaced once in Settings. Core logging is unaffected. |

## Testing strategy

| Layer | What to test | How |
| --- | --- | --- |
| `src/lib/*` | Hours conversion/rounding, week & month boundaries, month-end, leap years, validation cases | Jest, pure functions, no mocks. **Highest value.** |
| Repositories | Upsert-by-date, totals, range queries, migration from v0→v1 | `jest-expo` against an in-memory SQLite |
| Hooks | Mutation → refetch, error propagation | `@testing-library/react-native` |
| Screens | Happy path for log/save, delete confirmation | Light. Manual QA on a device does the rest. |

Do not test `lib/` through the UI. If a test needs a renderer to check date maths, the function is in the wrong place.

## Related

- [[InternTrack Index]] · [[InternTrack Overview]] · [[InternTrack Tech Stack]] · [[InternTrack Rules]] · [[InternTrack Agent Tasks]]
