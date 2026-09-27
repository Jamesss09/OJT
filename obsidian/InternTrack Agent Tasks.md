---
title: InternTrack Agent Tasks
tags: [interntrack, tasks, backlog]
created: 2026-09-27
updated: 2026-09-27
status: planning
---

# InternTrack — Agent Tasks

Index: [[InternTrack Index]] · Scope: [[InternTrack Overview]] · Stack: [[InternTrack Tech Stack]] · Design: [[InternTrack Architecture]] · Rules: [[InternTrack Rules]]

## How to work this backlog

1. **Work top to bottom.** Phases are ordered by dependency, not by priority.
2. **One task at a time.** Don't start `T-21` while `T-11` is open.
3. **Before starting:** re-read the relevant rules in [[InternTrack Rules]]. Most of them exist because of a bug someone already made.
4. **Definition of Done** is R-15. Not optional, not "later".
5. **When done:** tick the checkbox, update the status table, and update any note whose rules changed.
6. **Don't upgrade dependencies** as a side effect of a feature. That is its own task (`T-52`).

**Estimates:** S ≈ under an hour · M ≈ half a day · L ≈ 1–2 days.

**Status legend:** `todo` · `doing` · `blocked` · `done` · `cut`

---

## Phase 0 — Planning ✅

- [x] `T-00` Write overview, tech stack, architecture, rules, and backlog notes.
  - **Done:** all six notes exist in this vault.

> [!info] Next up
> `T-01`. Do not start Phase 1 until the Phase 0 open questions in [[InternTrack Index]] are answered.

---

## Phase 1 — Scaffold (M)

- [ ] `T-01` Scaffold the Expo app. **M** · deps: none
  - `npx create-expo-app@latest interntrack` into the repo root; default TypeScript template; enable `newArchEnabled`.
  - Verify `npx tsc --noEmit` and `npx expo start` are clean on arrival.
  - AC: app launches in a simulator, no errors.
- [ ] `T-02` Install runtime dependencies via `npx expo install`. **S** · deps: `T-01`
  - `expo-router expo-sqlite expo-notifications zustand @react-native-community/datetimepicker react-native-safe-area-context expo-haptics react-native-reanimated expo-dev-client`
  - AC: `npx expo-doctor` passes; every version matches [[InternTrack Tech Stack]].
- [ ] `T-03` Configure `app.json`, `tsconfig.json` (strict, path alias `@/*`), `eas.json`. **S** · deps: `T-02`
  - AC: strict TS with no implicit `any`; `eas.json` has `development` / `preview` / `production` per the stack note.
- [ ] `T-04` Set up the theme tokens and `ThemeProvider`. **S** · deps: `T-01`
  - AC: spacing / colour / radius / type tokens; light and dark resolved from device scheme.
- [ ] `T-05` Root `_layout.tsx`: providers wired. **S** · deps: `T-02`, `T-04`
  - `SQLiteProvider` → `SafeAreaProvider` → `Stack`; routes per [[InternTrack Architecture]] navigation map.
  - AC: all 5 routes reachable, no red screen.

---

## Phase 2 — Pure domain logic (M)

> No UI, no database. This phase is where correctness is won — R-8.

- [ ] `T-11` `src/lib/hours.ts` + tests. **M** · deps: `T-01`
  - `toMinutes('7.5') → 450`, `formatHours(450) → '7.5 h'`, `isValidHours`, rounding at `.5`/`.25`, reject `0`, `-1`, `24.01`, `''`, `'abc'`.
  - AC: 100% branch coverage on the file; jest green.
- [ ] `T-12` `src/lib/dates.ts` + tests. **M** · deps: `T-11`
  - `today()`, `toISODate`, `parseISODate`, `weekRange` (Mon–Sun, R-5), `monthRange`, `formatDisplayDate`, `isFuture`.
  - AC: month-end, year boundary, leap-day and month-start cases tested.
- [ ] `T-13` `src/lib/validation.ts` + tests. **M** · deps: `T-11`, `T-12`
  - `validateEntry` → discriminated union; enforces R-3.
  - AC: every row of the R-3 table has a passing test.

---

## Phase 3 — Persistence (M)

- [ ] `T-14` `db/client.ts` + `db/schema.sql`. **S** · deps: `T-05`
  - `openDatabaseAsync('interntrack.db')`; `journal_mode = WAL`; `foreign_keys = ON`.
  - AC: DB opens, pragmas applied.
- [ ] `T-15` `db/migrations.ts` with v1. **M** · deps: `T-14`
  - `PRAGMA user_version` loop, transactional, forward-only.
  - AC: fresh install and re-open both reach v1 with no error; a bad version fails loudly.
- [ ] `T-16` `repositories/settings.repo.ts`. **S** · deps: `T-15`
  - Typed get/set for the keys in [[InternTrack Architecture]]; defaults applied on first read.
  - AC: reads before any write return the documented defaults.
- [ ] `T-17` `repositories/entries.repo.ts`. **M** · deps: `T-15`
  - `getByDate`, `upsert` (R-2), `delete`, `listRange`, `totalsFor`, `overallTotals`, `historyPage`.
  - AC: all queries parameterised; aggregates `COALESCE`d (R-7).
- [ ] `T-18` Repository tests against in-memory SQLite. **M** · deps: `T-17`
  - AC: upsert-by-date updates rather than duplicating; empty range totals `0`; a transaction rolls back on throw.

---

## Phase 4 — Today screen, the core loop (L)

> G1: a day logged in under 30 seconds. This is the make-or-break flow — see R-13.

- [ ] `T-21` `useEntryForDate` + `useLogEntryMutation`. **S** · deps: `T-18`
  - AC: save → SQLite → refetch; failure keeps the draft and surfaces the reason.
- [ ] `T-22` `components/HourInput.tsx`. **M** · deps: `T-11`
  - Numeric keypad, decimal entry, live "7.5 h" echo, inline error.
  - AC: rejects > 24 h inline before submit.
- [ ] `T-23` `components/ActivityInput.tsx`. **S** · deps: `T-12`
  - Multiline, 2000-char cap with counter, trims on save.
  - AC: whitespace-only input is blocked by R-3.
- [ ] `T-24` `app/index.tsx` (Today). **L** · deps: `T-21`, `T-22`, `T-23`
  - Hour + activity input, today's total, week total, progress bar, logged/not-logged state, "edit" path.
  - AC: full log-and-save in < 30 s; edits an existing day instead of duplicating it; empty state present.
- [ ] `T-25` `app/log/[date].tsx` (editor for a past day). **M** · deps: `T-24`
  - AC: `2026-09-31` or a malformed param is rejected with a friendly error, not a crash; past dates only.
- [ ] `T-26` `components/ProgressBar.tsx`. **S** · deps: `T-24`
  - R-6: hidden when `requiredMinutes = 0`; bar clamped to 100% with true numbers shown.
  - AC: `0 h` required → bar hidden, no divide-by-zero warning.

---

## Phase 5 — History & reports (L)

- [ ] `T-31` `app/history.tsx`. **L** · deps: `T-24`
  - Reverse-chronological, grouped by month, paginated; tap to edit; delete with a confirming dialog naming date + hours.
  - AC: delete is confirmed and permanent; empty state offers the first-log action; text search.
- [ ] `T-32` `useReportTotals` + `app/reports.tsx`. **L** · deps: `T-24`, `T-31`
  - Week / month / all-time tiles, per-day bar chart, progress vs required (R-6).
  - AC: totals match hand arithmetic across a month boundary; all SQL-backed, no JS reduction (R-7).
- [ ] `T-33` Bar chart in `react-native-svg`. **S** · deps: `T-32`
  - AC: renders a week, a month, and an empty range without a layout jump.

---

## Phase 6 — Settings (M)

- [ ] `T-41` `app/settings.tsx` + `useSettings`. **L** · deps: `T-16`
  - Programme start, required hours, daily target, intern name; all persisted via `settings.repo`.
  - AC: survives restart; required-hours change immediately moves the progress bar.
- [ ] `T-42` `useDailyReminder` + `notifications/scheduler.ts`. **M** · deps: `T-41`, `T-05`
  - Daily local trigger at `reminderTime`; channel created once; id stored for cancellation; permission denied → reminder off with a Settings note.
  - AC: changing the time reschedules (never double-fires); disabling cancels; permission denial never blocks logging.
- [ ] `T-43` Data management section (placeholder). **S** · deps: `T-41`
  - Disabled "Export" / "Backup" entries that state they land in Phase 7. Keeps the UI honest without building early.

---

## Phase 7 — Export, backup & restore (L) — **strongly recommended before real use**

> [!danger] Read this first
> The app is local-only. Until this phase ships, the intern's entire OJT record exists on one phone with no way out. See the risk in [[InternTrack Index]]. This phase converts the app from a toy into something you can actually report from.

- [ ] `T-51` CSV export. **M** · deps: `T-32`, `T-41`
  - `expo-file-system` + `expo-sharing`; columns: date, hours, activity; respects the current report range; opens with a self-labelling header (intern name, programme range, generated date).
  - AC: the file opens correctly in a spreadsheet; decimals are unambiguous.
- [ ] `T-52` PDF report. **M** · deps: `T-51`
  - `expo-print`; table of entries + totals + progress, per [[InternTrack Overview]] G4.
  - AC: fits one page per month, no truncated activity text.
- [ ] `T-53` JSON backup + restore. **M** · deps: `T-51`
  - Full dump of `entries` + `app_settings` with a schema version; `expo-document-picker` on import.
  - AC: restore on a wiped install reproduces totals exactly; import is validated before any write; a mismatched version is refused with an explanation.
- [ ] `T-54` "Remind me to export" nag. **S** · deps: `T-53`
  - Prompt if the last backup is older than 7 days. Small, and it is the control that makes the risk survivable.

---

## Phase 8 — Ship it (M)

- [ ] `T-61` First EAS build. **M** · deps: Phase 4 minimum
  - `eas build --profile preview --platform android`; confirm the APK installs on a physical device.
  - AC: installs, launches, logs a day, and the data survives force-quit.
- [ ] `T-62` Polish pass. **M** · deps: `T-61`
  - Empty/loading/error states, dark mode, accessibility labels, 44pt touch targets.
  - AC: R-13 and R-15 walked screen by screen.
- [ ] `T-63` Internal distribution. **S** · deps: `T-62`
  - Google Play internal track (and TestFlight if iOS credentials are available). `autoIncrement` on.
- [ ] `T-64` Store listing + privacy. **S** · deps: `T-63`
  - Screenshots, description, and a privacy declaration that states: no account, no network, all data on device.
- [ ] `T-65` Post-v1 backlog. **S** · deps: `T-64`
  - Candidates: multiple entries per day (relax R-2), categories/tags per entry, read-only share link, EAS Update for JS-only fixes, Android widget for the running total, iOS build.
  - AC: written up here with a rough size; **not** started.

---

## Status table

| ID | Task | Phase | Size | Status | Blocked by |
| --- | --- | --- | --- | --- | --- |
| `T-00` | Planning notes | 0 | M | **done** | — |
| `T-01` | Scaffold Expo app | 1 | M | todo | — |
| `T-02` | Install dependencies | 1 | S | todo | `T-01` |
| `T-03` | Config files | 1 | S | todo | `T-02` |
| `T-04` | Theme tokens | 1 | S | todo | `T-01` |
| `T-05` | Root layout + routes | 1 | S | todo | `T-02` |
| `T-11` | `lib/hours.ts` | 2 | M | todo | `T-01` |
| `T-12` | `lib/dates.ts` | 2 | M | todo | `T-11` |
| `T-13` | `lib/validation.ts` | 2 | M | todo | `T-12` |
| `T-14` | `db/client.ts` | 3 | S | todo | `T-05` |
| `T-15` | Migrations v1 | 3 | M | todo | `T-14` |
| `T-16` | settings repo | 3 | S | todo | `T-15` |
| `T-17` | entries repo | 3 | M | todo | `T-15` |
| `T-18` | Repository tests | 3 | M | todo | `T-17` |
| `T-21` | Entry hooks | 4 | S | todo | `T-18` |
| `T-22` | `HourInput` | 4 | M | todo | `T-11` |
| `T-23` | `ActivityInput` | 4 | S | todo | `T-12` |
| `T-24` | Today screen | 4 | L | todo | `T-21` |
| `T-25` | Log editor | 4 | M | todo | `T-24` |
| `T-26` | `ProgressBar` | 4 | S | todo | `T-24` |
| `T-31` | History screen | 5 | L | todo | `T-24` |
| `T-32` | Reports screen | 5 | L | todo | `T-31` |
| `T-33` | SVG bar chart | 5 | S | todo | `T-32` |
| `T-41` | Settings screen | 6 | L | todo | `T-16` |
| `T-42` | Daily reminder | 6 | M | todo | `T-41` |
| `T-43` | Data management stub | 6 | S | todo | `T-41` |
| `T-51` | CSV export | 7 | M | todo | `T-41` |
| `T-52` | PDF report | 7 | M | todo | `T-51` |
| `T-53` | JSON backup/restore | 7 | M | todo | `T-51` |
| `T-54` | Backup nag | 7 | S | todo | `T-53` |
| `T-61` | First EAS build | 8 | M | todo | `T-24` |
| `T-62` | Polish pass | 8 | M | todo | `T-61` |
| `T-63` | Internal distribution | 8 | S | todo | `T-62` |
| `T-64` | Store listing | 8 | S | todo | `T-63` |
| `T-65` | Post-v1 backlog | 8 | S | todo | `T-64` |

## Progress

| | |
| --- | --- |
| Tasks done | 1 / 35 |
| In progress | 0 |
| Current | `T-01` — Scaffold the Expo app |
| Blocking decision | Export scope (Phase 7) — answered "not MVP", see [[InternTrack Index]] |

## Related

- [[InternTrack Index]] · [[InternTrack Overview]] · [[InternTrack Tech Stack]] · [[InternTrack Architecture]] · [[InternTrack Rules]]
