# Gymnify build log

Newest first. Each entry: what changed, why, and what is next.

## Plan
- **M1 Offline + first run** (service worker, welcome card, honest README)
- **M2 Accounts + sync (built, needs a tester round)** (optional sign-in; per-user tables with row-level security, shared with Klander's Supabase project; the app stays fully usable without an account)
- **M3 Tester round** (share with testers, collect feedback directly, fix the top issues)
- **Later:** exercise demos, unit toggle (kg/lb), charts polish, import from other apps

## 2026-11-03
- M3: first-run setup wizard (goal, experience, days and time, where you train, theme, optional account, then build a plan or start blank). Existing users with data skip it. Settings > Setup runs it again.
- M3: guided routine builder (Workouts > Build for me). Builds a split from goal, experience, days, time and your equipment, shows a preview, can shuffle exercises, and sets the weekly plan. Replaces only routines it made earlier.
- M3: themes ported from the Training Hub (Gymnify, Midnight, Nebula, Deep Ocean, Ember, Classic Gold, Mono) plus eight accent colours, in Settings > Appearance and in setup.
- M3: tap a routine's name to read it (exercises, sets, reps) before deciding to Start or Edit.
- New users now start with a blank app (no routines). Today shows an empty-state card with Empty workout, New routine, Import and Add example programmes. The example programmes (basketball/jump, mobility) are optional and live under Settings as well.
- M2: optional accounts and sync. Settings has an Account card (sign in, create account, sign out). Signed-in users sync their workouts between devices; photos stay on the device. Without an account the app works exactly as before.
- Backend: new table `gymnify_state` (one JSON state per user) in the shared Klander Supabase project, with Row Level Security so a user only reaches their own row. Tested: another user sees 0 rows, cannot write as someone else, and the public key sees nothing.
- When a newer account copy replaces data on a device, the old local data is kept under `gym.v1.backup`.
- Known limits: sync is whole-state, last write wins (no merging of two devices edited offline); sign-up emails come from the Klander project, so the confirmation link may open Klander.
- Renamed the app to Gymnify (repo, title, manifest, README).
- Published on GitHub Pages as a public showcase. Local-only by default: no account, data stays on the device.
- M1: added `sw.js` so the app opens offline (network-first, so updates arrive when online), and a first-run welcome card on Today.
- Decided to share one Supabase project with Klander so a single login works across both apps. Gymnify tables will be namespaced `gymnify_*` and every row will carry `user_id`.
