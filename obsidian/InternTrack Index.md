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

## Current phase

**Phase 1 — Scaffold.** Code lives in `interntrack/` inside this repo; the Obsidian vault is a sibling.

Next action: work [[InternTrack Agent Tasks]] top-down, starting at `T-01`.

## Open questions

- [!warning] **Export / backup is not in the MVP.** See below. Still unresolved by choice — revisit before real use.
- ✅ Resolved 2026-09-27: intern name → yes (decision 11).
- ✅ Resolved 2026-09-27: end date → no, target only (decision 10).
- ✅ Resolved 2026-09-27: build strategy → Option B, EAS-only (decision 9).

> [!danger] The one risk worth restating
> This app is local-only, which means **the log lives on exactly one phone and nowhere else.** If the phone is lost, wiped, or replaced, every logged hour is gone with no way to recover it. The fix is export (CSV for hand-in, JSON as a backup) — it is currently scoped to Phase 7 as `T-51`–`T-54` in [[InternTrack Agent Tasks]] and is **strongly recommended before the app is used for real OJT reporting.**

## Related

- Vault entry point: [[Welcome]]
