---
title: InternTrack Index
tags: [interntrack, moc]
created: 2026-09-27
updated: 2026-09-27
status: planning
---

# InternTrack — Index

> [!info] Map of content
> This is the single entry point. Open any note below; they are all wikilinked together.

## The app in one line

A React Native (Expo) mobile app where an intern records, reviews and totals their On-the-Job Training hours and daily activities — **entirely offline, on one device, with no account and no server**.

## Notes

| Note | What it answers |
| --- | --- |
| [[InternTrack Overview]] | What are we building, for whom, and what is explicitly *not* in scope? |
| [[InternTrack Tech Stack]] | Which exact libraries and versions, and why these? |
| [[InternTrack Architecture]] | How is the code and the data laid out? |
| [[InternTrack Rules]] | What are the non-negotiable domain and code rules? |
| [[InternTrack Agent Tasks]] | What is the backlog, in what order, with what acceptance criteria? |

## Decisions locked

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **Local-only.** No backend, no auth, no network calls. | Simplest thing that works for a single-user tracker. Nothing to host, nothing to pay for, works with no signal. |
| 2 | **Single user: the intern.** No login, no roles. | No data to protect beyond a phone PIN. |
| 3 | **Manual daily log** (date + hours + what happened) — no live timer. | Matches how OJT is reported: hours are entered after the fact, not clocked in real time. |
| 4 | **No approval workflow.** Entries are final as logged. | Supervisor only ever sees an exported report. |
| 5 | **Hours stored as integer minutes.** | `7.5 + 7.5 ≠ 15` in floating point. Integer minutes make totals exact forever. See [[InternTrack Rules]]. |
| 6 | **One entry per calendar day**, `UNIQUE(entry_date)`. | Matches "input hours, input what happened that day". Editing a day edits the row. |
| 7 | **Expo SDK 57**, not 58 (beta). | SDK 58 was still in beta as of 2026-09-27. Betting a v1 app on a beta is not worth it. |
| 8 | **Builds via EAS Build**, Android first, iOS when a Mac/Apple account situation allows. | User requirement. Android APK covers testing for free via internal distribution. |
| 9 | **Option B — EAS-only builds. No local Android toolchain.** No Android Studio, no JDK, no Android SDK on the dev machine. | Limited free disk. EAS compiles in the cloud, so the local toolchain is unnecessary. Consequence: no `npx expo run:android`, no hot-reload dev loop — every visual check costs one EAS build from the monthly allowance. See [[InternTrack Tech Stack]]. |
| 10 | **Required-hours target only** — no programme end date in v1. | Simpler. `app_settings` is a key/value table, so an end date can be added later with **no migration**. |
| 11 | **Capture the intern's name** (`internName` in Settings). | Makes exported reports self-labelling. Already in the schema. |
| 12 | **Export / backup is IN the MVP**, not deferred to Phase 7. `T-51`–`T-54` are now required work. | Reverses the earlier "not MVP" call. Local-only means the log exists on one phone and nowhere else; a phone lost or wiped takes every logged hour with it. The app is not fit for real OJT reporting without a way out. See the risk note below. |
| 13 | **First EAS build is batched to the end of Phase 3**, not run as soon as the DB layer exists. | Under Option B each build costs one of ~15 free Android builds/month, and no screen exists to look at yet. Databases are verified by executing the real migration SQL in Node (`T-14b`), so the build is spent on UI instead. |
| 14 | **Migration 1 may still be amended; nothing has shipped.** Once `T-61` produces an APK, that closes. | `T-16` found that `key TEXT PRIMARY KEY` accepts `NULL` in SQLite — only `INTEGER PRIMARY KEY` implies `NOT NULL`, being a rowid alias. A NULL-keyed row would never match `ON CONFLICT(key)`, so every read would see a phantom setting. Cheaper to amend v1 now than to ship a v2 migration that rebuilds a table before anyone has data. After `T-61` the forward-only rule applies without exception. |

## Current phase

**Phase 3 in progress. `T-01`–`T-05`, `T-11`–`T-16`, `T-14b` done (11/35).** The app lives in `interntrack/` (a subfolder of this repo, so `obsidian/` stays a sibling).

Gates green: `tsc --noEmit` · `expo lint` · `expo install --check` · `expo-doctor` 21/21 · **112 Jest tests**.

> [!warning] R-1 was amended in `T-11`
> Decimal hours are now an **input-only** format. A `minutes → "7.5 h"` formatter was written, caught by its own tests, and deleted: minutes are not always expressible in 2-decimal hours, so it lied for 2 of every 3 valid values. Output is always `formatDuration()` (`"7h 20m"`). See [[InternTrack Rules]].

> [!tip] Testing cheaply caught what a build would not have
> - `T-11`/`T-13`: the impossible decimal formatter, and a **key mismatch** in `validation.ts` that `tsc` caught and the tests missed (they asserted the bug). Both regression-tested.
> - `T-14b`: `jest-expo` **cannot** run SQLite — it polyfills `expo-modules-core`, so `openDatabaseAsync` throws, and the `@expo/mocks` package it looks for is not published. The architecture note had claimed otherwise. A `node:sqlite`-backed test double now executes the real migration SQL, so every `CHECK`/`UNIQUE` constraint is verified before any build. See [[InternTrack Architecture]].
>
> Three assumptions in these notes were wrong and all three were caught by running something rather than reasoning about it. That is the whole argument for R-8 and for testing the cheap layers first.

Next action: `T-16` (`repositories/settings.repo.ts`), then `T-17`, then `T-18` — after which Phase 3 is done and the batched EAS build (`T-61`) becomes worth its credit. See [[InternTrack Agent Tasks]].

## Open questions

- ✅ Resolved 2026-09-27: **export scope → IN the MVP** (decision 12). `T-51`–`T-54` are no longer optional.
- ✅ Resolved 2026-09-27: intern name → yes (decision 11).
- ✅ Resolved 2026-09-27: end date → no, target only (decision 10).
- ✅ Resolved 2026-09-27: build strategy → Option B, EAS-only (decision 9).
- ✅ Resolved 2026-09-27: first build timing → batched to end of Phase 3 (decision 13).
- Nothing outstanding.

> [!danger] The one risk worth restating
> This app is local-only, which means **the log lives on exactly one phone and nowhere else.** If the phone is lost, wiped, or replaced, every logged hour is gone with no way to recover it. This is why export is now in the MVP (decision 12) rather than deferred: JSON backup/restore (`T-53`) is the actual mitigation, with CSV export (`T-51`) serving the supervisor hand-in.

## Related

- Vault entry point: [[Welcome]]
