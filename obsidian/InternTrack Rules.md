---
title: InternTrack Rules
tags: [interntrack, rules, conventions]
created: 2026-09-27
updated: 2026-09-27
status: planning
---

# InternTrack — Rules

Index: [[InternTrack Index]] · Scope: [[InternTrack Overview]] · Stack: [[InternTrack Tech Stack]] · Design: [[InternTrack Architecture]] · Work: [[InternTrack Agent Tasks]]

> [!danger] These are not suggestions.
> If code and this note disagree, one of them is a bug. Update the note in the same change that changes the behaviour.

## R-1 · Hours are integer minutes, forever

- Store `minutes INTEGER`. Never a float column, never a decimal string in the DB.
- Convert only at the edges: text in → `toMinutes()`, minutes out → `formatHours()`.
- All totals are `SUM(minutes)` in SQL.
- Reason: `0.1 + 0.2 !== 0.3` in IEEE 754. A timesheet that is off by a hundredth of an hour is not defensible to a supervisor.

```
7.5 h  -> 450      450      -> "7.5 h"
7.25 h -> 435      480      -> "8 h"
```

## R-2 · One entry per calendar day

- `entries.entry_date` is `UNIQUE`. This is enforced by the schema, not by the UI.
- "Save" on a date that already has a row = `INSERT ... ON CONFLICT(entry_date) DO UPDATE`.
- Never `DELETE` then `INSERT` — it changes `id` and `created_at` and breaks edit history.
- To relax this later (multiple activities per day): drop the `UNIQUE` index in a **new migration** and move multi-row sums to a sum query. Do not pre-build for it.

## R-3 · Valid input ranges

| Field | Rule | Error message intent |
| --- | --- | --- |
| `entry_date` | `YYYY-MM-DD`, a real calendar date, **not in the future** | "You can't log a day that hasn't happened" |
| `minutes` | `1 .. 1440` (0 < hours ≤ 24) | "Hours must be between 0 and 24" |
| `activity` | non-empty after `.trim()`, max 2000 chars | "Describe what you did" |
| `requiredMinutes` | `0` (unset) or `1 .. 100000` | — |
| `reminderTime` | `HH:mm`, 24-hour | — |

A day with **0 hours** is not an entry. If the intern didn't work, there is no row — absence of a row *is* the record. (A future "holiday / non-working day" feature would need a separate `day_type`, not a zero.)

## R-4 · `entry_date` is a date, not a timestamp

- Text `YYYY-MM-DD`, device-local calendar day.
- Never store the day's date as epoch ms, and never derive it from a UTC timestamp — that shifts the day for anyone east or west of UTC.
- `created_at` / `updated_at` **are** epoch ms. Date and timestamp are different types here on purpose.

## R-5 · Weeks run Monday → Sunday

- `weekRange(date)` returns Monday 00:00:00 local through Sunday 23:59:59 local, as inclusive `YYYY-MM-DD` bounds.
- ISO weeks. A week containing Jan 1 is the week containing its Monday, not a partial week.
- Queries use `BETWEEN ? AND ?` on the text date with inclusive bounds.

## R-6 · Progress toward required hours

```
progress = SUM(minutes) / requiredMinutes     // requiredMinutes > 0
```

- If `requiredMinutes` is `0` (unset), hide the progress bar. Do not divide by zero, do not show `Infinity%`, do not guess a target.
- Clamp the *displayed* bar to 100%. Report the true number (`412 / 300 h`) underneath — overachieving must be visible, not silently capped.
- Logged **after** the programme start only. Entries dated before `programStartDate` are excluded from progress but still listed in history. (Prevents a backdated entry from inflating the total.)

## R-7 · All SQL lives in repositories

- No SQL strings in `app/` screens, in components, or in hooks.
- Always bind parameters. Never build SQL with string concatenation — `activity` is user text.
- Every multi-statement change runs in `withTransactionAsync`.
- `COALESCE(SUM(minutes), 0)` on every aggregate. An empty range totals `0`, never `null`.

## R-8 · Pure logic in `src/lib`

- Files in `src/lib/` import **nothing** from `expo-*`, `react`, or `react-native`. They take values in and return values out.
- This is what makes hours/date logic testable without a renderer or a device. If a function needs a device API, it is not in `src/lib/`.
- Hours and date maths appear in exactly one place each. A second implementation is a bug.

## R-9 · TypeScript strictness

- `strict: true`. No `any`, no non-null `!` to silence an error, no `@ts-ignore`.
- `unknown` + narrowing at boundaries (repository results, JSON from an imported file).
- Exported functions and components get explicit return types.
- Discriminated results instead of exceptions for expected failures: `{ ok: true, value } | { ok: false, errors }`.

## R-10 · Zustand is not a database

- Zustand holds **draft form state and UI filters only**.
- Entries, settings and totals are never copied into the store.
- A mutation re-queries SQLite; it does not patch the store optimistically. With a local DB there is no latency to hide, and optimism is where drift comes from.
- Store slices are named by what they hold (`useLogDraftStore`), never a generic `useStore`.

## R-11 · Dependency versions come from `npx expo install`

- `npx expo install <pkg>` — always. It resolves the version the SDK expects, not the version npm considers newest.
- **Never** `npm install <pkg>` to "get latest", and never hand-write a version into `package.json`. Real examples, all hit on 2026-09-27 against SDK 57:

  | Package | npm `latest` | SDK 57 actually wants | Consequence of using `latest` |
  | --- | --- | --- | --- |
  | `react-native` | 0.87.1 | 0.86.3 | Wrong RN for the SDK |
  | `typescript` | 7.0.2 | ~6.0.3 | Stricter compiler, unrelated errors |
  | `@react-native-community/datetimepicker` | 9.2.1 | **9.1.0** | `expo install --check` fails |
  | `react-native-reanimated` | 4.7.0 | 4.5.1 | Untested against the SDK |
  | `react-native-safe-area-context` | 5.10.0 | 5.7.0 | Same |

- **The template's pin is the source of truth**, even when it is *older* than npm `latest`. The Expo team ships the combination they test.
- After any dependency change, run `npx expo install --check` and fix what it reports (`--fix` applies it). Do not hand-correct its output.
- Don't add a dependency that isn't listed in [[InternTrack Tech Stack]]. Adding one means updating that note first.
- Every new dependency must justify its native surface. Each one is a potential build failure — and under decision 9 ([[InternTrack Index]]) native problems cannot be debugged locally.

> [!warning] R-11 is not theoretical
> During T-01 a version was hand-written into `package.json` (`datetimepicker@9.2.1`, taken from npm `latest`). `npx expo install --check` rejected it and `--fix` corrected it to 9.1.0. This is the rule working exactly as intended.

## R-12 · Build discipline

- Local dev via `npx expo start --dev-client`. A cloud build is not a dev loop.
- Before any `eas build`, ask: *does this change require native code?* If no, it's a local reload.
- Never edit generated `android/` or `ios/` directories. If a native change seems required, it needs a config plugin or a prebuild — and a note in [[InternTrack Tech Stack]].
- Never commit secrets, `.env` values, or signing material. EAS holds the credentials.
- `version` / `buildNumber` are owned by `autoIncrement`, not by hand.

## R-13 · UX rules

- **The daily log must be completable in under 30 seconds** (G1 in [[InternTrack Overview]]). Anything added to that flow has to earn its place.
- Save is **explicit** (a button), not save-on-blur. Blur-saves lose data when a screen unmounts mid-edit.
- Deleting a day asks for confirmation, and the confirmation names the date and the hours.
- Field errors are inline, next to the field, and the first error takes focus. Never a toast for a validation failure.
- Every list has an empty state that says what to do next ("No entries yet — log your first day").
- On launch, land on Today. Never on a settings or onboarding wall.
- Localised date and number formatting via the platform (`Intl` / device locale), not hand-built strings.

## R-14 · Data is never destroyed implicitly

- No `DROP`, no "reset" without a confirmation that names what is lost.
- Deleting is always explicit, per-row, confirmed.
- Anything that rewrites many rows is a **migration**, versioned forward (see [[InternTrack Architecture]]).
- The `entries` table is the user's only copy of their OJT record. Treat it accordingly — this is the app's core risk.

## R-15 · Definition of Done

A task is done when all of these hold:

- [ ] Feature works offline, on a physical device or simulator, from a dev build.
- [ ] Validation lives in `src/lib` and is unit tested (edge cases: 0, negative, 24, 24.01, blank, whitespace, month end, leap day).
- [ ] All SQL is in a repository, parameterised, inside a transaction if multi-statement.
- [ ] Types are strict; no `any`, no `@ts-ignore`.
- [ ] Loading, empty, and error states exist — not just the happy path.
- [ ] `npx tsc --noEmit` and `npx expo lint` are clean.
- [ ] Tests pass (`npx jest`).
- [ ] Any new dependency is added to [[InternTrack Tech Stack]] with a reason.
- [ ] Any rule this change touches is updated **in the same commit**.
- [ ] The task's checkbox in [[InternTrack Agent Tasks]] is ticked and the status table updated.

## Related

- [[InternTrack Index]] · [[InternTrack Overview]] · [[InternTrack Tech Stack]] · [[InternTrack Architecture]] · [[InternTrack Agent Tasks]]
