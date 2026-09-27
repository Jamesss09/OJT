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

- [x] `T-01` Scaffold the Expo app. **M** · deps: none
  - `npx create-expo-app@latest interntrack` → got `expo-template-default@sdk-57`: expo 57.0.25, RN 0.86.3, React 19.2.3. ✅ matches decision 7
  - Demo stripped (tabs, animated splash, badges, collapsible, 8 demo images). Kept `themed-text`, `themed-view`, `constants/theme.ts`, `use-theme`, `use-color-scheme`.
  - Placeholder `src/app/index.tsx` so the router is valid; real screen in `T-24`.
  - AC met: `tsc --noEmit` clean, `expo lint` clean, `expo-doctor` 21/21 passed.
- [x] `T-02` Install runtime dependencies. **S** · deps: `T-01`
  - Added `expo-sqlite`, `expo-notifications`, `expo-haptics`, `expo-dev-client`, `datetimepicker`, `zustand`.
  - Removed as unused demo surface: `@expo/ui`, `expo-device`, `expo-glass-effect`, `expo-image`, `expo-symbols`, `expo-web-browser`.
  - AC met: `npx expo install --check` → "Dependencies are up to date".
  - ⚠️ `datetimepicker` was hand-pinned to 9.2.1 straight from npm `latest`; `--check` rejected it and `--fix` corrected it to 9.1.0. R-11 caught a real mistake — see [[InternTrack Rules]].
- [x] `T-03` Config files. **S** · deps: `T-02`
  - `app.json`: display name **InternTrack**, ids `com.jamesss09.interntrack`, `expo-notifications` plugin.
  - `tsconfig.json`: template already shipped `strict: true` + `@/*` → `./src/*`. No change needed.
  - `eas.json`: `development` / `preview` (internal APK) / `production` (AAB + `autoIncrement`).
  - `eslint.config.js`: scoped `react-hooks/set-state-in-effect` opt-out for `*.web.ts(x)` — the template's `hasHydrated` guard is intentional, not a mistake.
  - `src/types/global.d.ts`: declares `*.css`; TS 6 rejects the template's `global.css` side-effect import (TS2882).
  - AC met.
- [x] `T-04` Theme tokens. **S** · deps: `T-01`
  - Extended the template's `src/constants/theme.ts` rather than forking it: added `accent`, `accentMuted`, `danger`, `border` to both schemes, plus a `Radius` scale (`none`/`sm`/`md`/`lg`/`full`) which the template lacked entirely.
  - `ThemeColor` stays valid automatically — it is derived from `Colors`.
  - AC met. ⚠️ Contrast of `accent` still needs an accessibility pass in `T-62`.
- [x] `T-05` Root `_layout.tsx` + all 5 routes. **S** · deps: `T-02`, `T-04`
  - `Stack` with `index`, `history`, `reports`, `settings`, `log/[date]` (modal presentation).
  - Routes are placeholders via one shared `ScreenPlaceholder` component, each naming the task that replaces it.
  - `log/[date]` renders its raw `date` param to prove the dynamic segment resolves; real param validation is `T-25` (R-3).
  - AC: all 5 routes resolve, `tsc` + lint clean.
  - ⏭️ `SQLiteProvider` is deliberately **not** wired yet — there is no `db/client.ts` or migration to initialise. It lands with `T-14`/`T-15`.

---

## Phase 2 — Pure domain logic (M)

> [!info] No build required
> This whole phase is pure functions. It runs in Node via Jest — no emulator, no device, no EAS credit. That is the point of R-8.

- [x] `T-11` `src/lib/hours.ts` + tests. **M** · deps: `T-01`
  - `toMinutes` (caps input at 2 dp, accepts `,` separator, rounds IEEE drift), `splitMinutes`, `formatDuration`, `clampToDay`.
  - 🔴 **Design bug caught by the tests:** the first draft had `fromMinutes(450) -> "7.30"` (padded the minute remainder) and a `minutes -> "7.5 h"` formatter. Both were wrong: minutes are not always expressible as 2-decimal hours (1 min = 0.0166…h; only multiples of 3 land on a boundary), so a decimal formatter **lies for 2 of every 3 valid values**. Deleted it; R-1 now forbids decimal output. The original round-trip assertion was mathematically unsatisfiable and was replaced with a losslessness property.
  - AC: 100% branch coverage on the file; 77 tests green across the phase.
- [x] `T-12` `src/lib/dates.ts` + tests. **M** · deps: `T-11`
  - Calendar dates are `YYYY-MM-DD` strings and `{year, month, day}` numbers. `Date.UTC` is used only as a day-number calculator and all reads go through UTC getters, so **no local-timezone rule can ever shift a day** (R-4). `todayISODate()` is the single function that reads the device clock.
  - `parseISODate` round-trips to reject `2026-02-31`; `weekRange` (Mon–Sun), `monthRange`, `addDays`, `daysInMonth`, `isFutureISODate`, `compareISO`, `allTimeRange`, `Intl`-based formatters.
  - AC: leap day both directions, month/year rollover, week spanning month + year boundary, DST-proof local-time assertions.
- [x] `T-13` `src/lib/validation.ts` + tests. **M** · deps: `T-11`, `T-12`
  - `validateEntry` → discriminated union, **collects all field errors in one pass** so the form can show everything wrong at once (R-13). `firstInvalidField` for focus order.
  - Enforces the whole R-3 table, including the 2000-char activity cap reported with its actual length.
  - 🐛 **Real bug caught by `tsc`, not by the tests:** the hours error was keyed `errors.hours` while the form field is `hoursText`, so the message was unreachable and `firstInvalidField` returned `null` — R-13's "focus the first field with an error" silently failed for bad hours. The tests *passed* because they asserted `errors.hours`, matching the bug. Two lessons recorded in [[InternTrack Rules]] (R-15).
  - AC: every R-3 row tested, plus an "all three fields invalid" case, plus a **regression test verified to have teeth** (reintroducing the key mismatch produces 12 failures).

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
| `T-01` | Scaffold Expo app | 1 | M | **done** | — |
| `T-02` | Install dependencies | 1 | S | **done** | `T-01` |
| `T-03` | Config files | 1 | S | **done** | `T-02` |
| `T-04` | Theme tokens | 1 | S | **done** | `T-01` |
| `T-05` | Root layout + 5 routes | 1 | S | **done** | `T-02` |
| `T-11` | `lib/hours.ts` | 2 | M | **done** | `T-01` |
| `T-12` | `lib/dates.ts` | 2 | M | **done** | `T-11` |
| `T-13` | `lib/validation.ts` | 2 | M | **done** | `T-12` |
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
| Tasks done | 9 / 35 |
| In progress | 0 |
| Current | `T-14` — `db/client.ts` (first task needing native code) |
| Tests | 80 passing across `src/lib` · `hours.ts` 100% branch, `validation.ts` 100% stmt, `dates.ts` 94% |
| Gates | `tsc` ✅ · `lint` ✅ · `expo install --check` ✅ · `expo-doctor` 21/21 ✅ |
| First build needed | `T-61` — nothing before that needs a device |
| Blocking decision | Export scope (Phase 7) — answered "not MVP", see [[InternTrack Index]] |

## Related

- [[InternTrack Index]] · [[InternTrack Overview]] · [[InternTrack Tech Stack]] · [[InternTrack Architecture]] · [[InternTrack Rules]]
