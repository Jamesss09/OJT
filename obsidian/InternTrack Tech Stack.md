---
title: InternTrack Tech Stack
tags: [interntrack, tech-stack]
created: 2026-09-27
updated: 2026-09-27
status: planning
versions_verified: 2026-09-27
---

# InternTrack — Tech Stack

Index: [[InternTrack Index]] · Scope: [[InternTrack Overview]] · Design: [[InternTrack Architecture]] · Rules: [[InternTrack Rules]] · Work: [[InternTrack Agent Tasks]]

> [!info] Versions verified 2026-09-27 against npm and the Expo docs.
> Re-verify before scaffolding. Expo releases 3 SDKs/year; SDK 58 was in **beta** on this date and is deliberately not used.

## Platform baseline

Pinned by **Expo SDK 57** — do not install these by hand, let `npx expo install` resolve them.

| Component | Version | Note |
| --- | --- | --- |
| Expo SDK | **57.0.25** | Latest stable. SDK 58 = beta, avoided. |
| React Native | **0.86.x** | SDK 57 targets 0.86. npm `latest` is 0.87.1 — *do not use it.* |
| React | **19.2.3** | |
| Node.js | **≥ 22.13.x** | SDK 57 minimum. |
| TypeScript | **~6.0.3** (template-pinned) | npm `latest` is **7.0.2** — do not install. TS 6 is stricter and needs `src/types/global.d.ts` to type `*.css` imports. See rules. |
| Android | min **7.0**, `compileSdk`/`targetSdk` **36** | |
| iOS | min **16.4**, Xcode **26.4+** | |
| Hermes | on (default) | |
| `newArchEnabled` | on (SDK 57 default) | |

## Runtime dependencies

Install with `npx expo install <pkg>` so versions match the SDK.

| Package | Version | Why this one |
| --- | --- | --- |
| `expo-router` | 57.0.23 | File-based routing, typed routes, deep links into a specific date. Removes the need for a separate nav library. |
| `expo-sqlite` | 57.0.3 | **The database.** Real SQL, exact integer arithmetic, survives restarts, no native config. `AsyncStorage` can't aggregate and can't do transactions properly. |
| `expo-notifications` | 57.0.21 | Local scheduled daily reminder (`T-41`/`T-42`). Local only — no push, no server. |
| `zustand` | 5.0.15 | Tiny UI-state store. Holds form drafts + filter state, never a second copy of the DB. |
| `@react-native-community/datetimepicker` | **9.1.0** | Native date picker. ⚠️ npm `latest` is 9.2.1 but SDK 57 wants 9.1.0 — see R-11. |
| `react-native-safe-area-context` | 5.7.0 | Notches / gesture bars. Required by expo-router. |
| `expo-haptics` | 57.0.3 | Save/delete confirmation tick. Small delight, one line. |
| `react-native-reanimated` | 4.5.1 | Progress bar + chart animation. Pairs with `react-native-worklets` 0.10.1. |
| `expo-dev-client` | 57.0.19 | Dev builds so native modules (SQLite, notifications) work during development. |

## Build / delivery

| Tool | Choice | Note |
| --- | --- | --- |
| **EAS Build** | Required | Cloud builds for Android/iOS with managed signing. |
| `eas-cli` | `npx eas-cli` | Don't global-install; the CLI moves fast. |
| Signing | EAS-managed credentials | Let EAS generate the keystore/certs. Document the recovery path. |
| EAS Update | optional, later | Ship JS-only fixes without a rebuild. Only after v1 is stable. |
| Store target | Google Play (internal track) first, then App Store | Internal track avoids review friction during testing. |

### `eas.json` profiles (sketch)

```jsonc
{
  "cli": { "version": ">= 16.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",   // installable APK for manual testing
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true          // handles versionCode/buildNumber
    }
  },
  "submit": { "production": {} }
}
```

### Build cost discipline

> [!danger] Decision 9 — this machine has **no Android toolchain** (no Android Studio, no JDK, no Android SDK, no `adb`). Chosen deliberately: limited free disk.
> **EAS Build runs in the cloud, so this does not block building the app at all.** It changes *how you verify*, not *whether you can build*.

Consequences to design around:

| Normally you'd… | Here you… | Cost |
| --- | --- | --- |
| `npx expo run:android` for a local dev loop | **Cannot.** No JDK/Android SDK. | — |
| Reload JS and see the change instantly | Rebuild and reinstall the APK | 1 EAS build |
| `npx expo start` in Expo Go | Works for pure-JS screens only; **SQLite and notifications are native** and need a real build | free, but limited |

Working rules under Option B:

- **Verify logic in Node, not on the device.** Jest covers `src/lib` and the repositories. Most bugs (hours maths, date ranges, SQL) never need a phone — see the testing strategy in [[InternTrack Architecture]].
- `npx tsc --noEmit` and `npx expo lint` are the fast inner loop. Both are free and catch most mistakes.
- Spend cloud builds only on **UI/visual verification** — the first `T-61` build, then after a batch of screen work.
- Batch changes: finish a whole phase, then build once. Do not build per task.
- The Free plan is a limited allowance (≈15 Android + 15 iOS builds/month per [expo.dev/pricing](https://expo.dev/pricing) — verify, pricing changes). Treat it as scarce.
- `eas build --profile preview --platform android` produces the installable APK. Use `--auto-submit` only for the store track.
- Requires an Expo account (`npx eas login`, free). iOS **device** builds additionally require a paid Apple Developer account; simulator builds do not.

## Deferred but chosen (Phase 7 — export & backup)

Not installed at MVP. Do not add them early — each adds native surface and build risk.

| Package | Version | Used for |
| --- | --- | --- |
| `expo-file-system` | 57.0.7 | Write CSV/JSON files, read a backup back in |
| `expo-sharing` | 57.0.22 | Share/send the exported file to email or Drive |
| `expo-print` | 57.0.2 | Render the PDF report |
| `expo-document-picker` | (SDK 57) | Import a JSON backup |
| `expo-crypto` | 57.0.3 | Stable UUIDs for entry ids if `AUTOINCREMENT` proves insufficient |

## Considered and rejected

| Option | Why not |
| --- | --- |
| **AsyncStorage as the store** | Key-value only. No `SUM`, no ranges, no transactions, no indexes. Reports would mean loading every record into JS on every render. |
| **Supabase / Firebase / any backend** | Kills the "no account, works offline" property for a single-user app. Adds auth, network states, cost, and failure modes for zero benefit here. |
| **WatermelonDB / RxDB / Prisma** | Designed for *sync*. There is no second device to sync with. Massive complexity for no payoff. |
| **Realm / MMKV** | Realm needs a license discussion for some uses; MMKV is a KV store (same aggregation problem as AsyncStorage). `expo-sqlite` is the boring, correct choice. |
| **`react-hook-form` + `zod`** | 7.89.0 / 4.6.5 are excellent, but v1 has one form. The validation rules are simple and better expressed once as pure functions — see [[InternTrack Rules]]. Revisit if forms multiply. |
| **`@shopify/flash-list`** | 2.3.2. A personal OJT log is hundreds of rows, not tens of thousands. `FlatList` is fine. |
| **Native tabs / Expo UI component kit** | Nice, but adds churn. Standard `StyleSheet` + a small design-token file keeps v1 readable. |
| **A charting library** | Reports need a bar chart of hours per day. ~40 lines of `react-native-svg` (15.15.5) is enough; a full chart lib is not. |

## Tooling & quality

| Tool | Version | Purpose |
| --- | --- | --- |
| `typescript` | 5.x | `strict: true`, no `any` (see [[InternTrack Rules]]) |
| `eslint` + `eslint-config-expo` | via template | Lint |
| `jest-expo` | via template | Unit tests for hours/date/validation pure functions |
| `@testing-library/react-native` | latest | Component tests for the log form |
| Prettier | latest | Formatting consistency |

> [!tip] Test budget
> The pure logic in `src/lib` (hour conversion, date ranges, totals) is where bugs actually cost the user trust. Cover that thoroughly. Screens can stay lightly tested.

## Upgrade policy

- Review Expo's changelog quarterly; SDK releases land ~3×/year.
- Upgrade to a new SDK only on a dedicated branch, after v1 is working.
- Never mix an SDK upgrade with feature work in the same change.

## Related

- [[InternTrack Index]] · [[InternTrack Overview]] · [[InternTrack Architecture]] · [[InternTrack Rules]] · [[InternTrack Agent Tasks]]
