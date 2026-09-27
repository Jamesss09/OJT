---
title: InternTrack Overview
tags: [interntrack, product]
created: 2026-09-27
updated: 2026-09-27
status: planning
---

# InternTrack — Overview

Index: [[InternTrack Index]] · Stack: [[InternTrack Tech Stack]] · Design: [[InternTrack Architecture]] · Rules: [[InternTrack Rules]] · Work: [[InternTrack Agent Tasks]]

## Problem

An intern doing On-the-Job Training tracks their hours in whatever they have to hand — a paper timesheet, a notes-app file, a spreadsheet. Three costs:

1. **Reconstruction tax.** At the end of a week, nobody remembers what happened on Tuesday. The timesheet gets filled in from vague memory, or guessed.
2. **No running total.** Nobody knows "am I at 180 of 300 required hours yet?" until someone reconciles a spreadsheet.
3. **Paperwork friction.** Producing a report for a supervisor or a school submission is manual and error-prone.

## User

A single **intern** on an OJT programme.

- Not technical, on a phone, using it in short bursts (once a day, at end of shift).
- Needs the log to take under 30 seconds per day.
- Needs a defensible record at the end of each week / at the end of the programme.

There is **no supervisor account**. A supervisor is an *offline consumer* of the data — they receive an exported file. Building a reviewer role is explicitly out of scope.

## Goals

- **G1.** Log a day (hours + activity) in under 30 seconds.
- **G2.** Always show the running picture: hours this week, this month, and total vs the programme's required hours.
- **G3.** Make the record trustworthy — exact arithmetic, no silent data loss, recoverable from backups.
- **G4.** Produce a hand-in report (CSV / PDF) without touching a computer by hand.
- **G5.** Work with no internet, ever. No account, no login, no network permission needed for core use.

## Non-goals

Explicitly **out of scope** for v1. Anything touching these is scope creep.

- Multi-user, accounts, login, roles, sharing, collaboration.
- A server, sync, cloud backup, or any network API.
- Supervisor approval / sign-off workflow.
- A live start/stop timer (hours are entered after the fact).
- Payroll, invoicing, billing, timesheet-to-money conversion.
- Multiple entries per day (see [[InternTrack Rules]] — one day, one row).
- Photos, attachments, or evidence capture.
- Multiple interns / programmes in one install.

## Core user stories

| ID | As an intern, I want to… | So that… | Covered by |
| --- | --- | --- | --- |
| US-1 | log today's hours and what I did | my record is accurate | `T-11`, `T-12` |
| US-2 | go back and fix yesterday | mistakes are correctable | `T-13` |
| US-3 | see this week's and this month's hours | I know where I stand | `T-21`, `T-22` |
| US-4 | see total hours vs the required hours | I know how much is left | `T-23` |
| US-5 | get a daily nudge if I forget | I never lose a day of logging | `T-41`, `T-42` |
| US-6 | export my log to hand in | my supervisor is happy | `T-51` (Phase 7) |

## Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Today | `app/index.tsx` | The home screen. Big hour input, activity field, today's total, week total + progress bar, and a "logged?" state. Fast path for US-1. |
| History | `app/history.tsx` | Reverse-chronological list of logged days, grouped by month. Tap to edit, swipe/menu to delete. Search by text. |
| Reports | `app/reports.tsx` | Week / month / all-time totals, per-day bar chart, progress vs required hours. |
| Settings | `app/settings.tsx` | Programme start date, required total hours, daily target, reminder time + toggle, install intern name, data management (export, backup, reset). |
| Log editor | `app/log/[date].tsx` | Add or edit a specific day, reached from History or a deep date link. |

Navigation is file-based via **expo-router** — see [[InternTrack Architecture]] for the route map.

## The one primary flow

```
Open app
  → Today screen shows "not logged yet" + today's date
  → type hours (e.g. 7.5) and what I did
  → Save
  → Today flips to "logged · 7.5 h", week total and progress bar update instantly
```

Everything else in the app is a view onto data this flow produces.

## Success criteria

The MVP is done when:

- [ ] A day can be logged, edited and deleted, offline, in under 30 seconds (SC-1).
- [ ] Totals for day / week / month / all-time are exact and match hand arithmetic (SC-2).
- [ ] Progress toward required hours is visible on the Today screen (SC-3).
- [ ] The daily reminder fires at the configured time and can be turned off (SC-4).
- [ ] The app survives a force-quit and a device restart with no data loss (SC-5).
- [ ] A build installs from an EAS Build artifact on a physical Android device (SC-6).
- [ ] Data can be exported and restored from a file (SC-7 — **Phase 7, see risk below**).

## Known risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Data loss** — local-only storage, one device, no backup | High | `T-51`–`T-54` export + JSON backup. Do not use for real reporting before this ships. |
| **EAS build quota** — free plan is limited (~15 Android + 15 iOS builds/mo, verify at [expo.dev/pricing](https://expo.dev/pricing)) | Medium | Build via `expo start --dev-client` locally. Cloud builds only for real install/share. See [[InternTrack Tech Stack]]. |
| **Version drift** — `npm i react-native` pulls 0.87; `typescript@latest` is 7.x; Expo 57 targets RN 0.86 | Medium | Hard rule: only `npx expo install`. See [[InternTrack Rules]]. |
| **Scope creep into a timesheet/HR product** | Medium | Non-goals list above. Add to it, don't negotiate with it. |
| Intern abandons logging because it's annoying | Medium | 30-second flow, reminder, edit-not-retype. |

## Glossary

| Term | Meaning |
| --- | --- |
| **OJT** | On-the-Job Training — a structured work-training programme with a required number of hours. |
| **Entry / log** | One row: a date, hours worked, and a description of what was done. |
| **Required hours** | Total hours the intern must complete on the programme. Set in Settings. |
| **Programme start** | First date of the OJT period. Set in Settings; anchors reports. |
| **Day** | A calendar day in the device's local timezone. One entry per day. |
| **Minutes** | The stored form of hours. `7.5 h` → `450` minutes. See [[InternTrack Rules]]. |

## Related

- [[InternTrack Index]] · [[InternTrack Tech Stack]] · [[InternTrack Architecture]] · [[InternTrack Rules]] · [[InternTrack Agent Tasks]]
