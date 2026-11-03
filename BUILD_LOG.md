# Gymnify build log

Newest first. Each entry: what changed, why, and what is next.

## Plan
- **M1 Offline + first run** (service worker, welcome card, honest README)
- **M2 Accounts + sync** (optional sign-in; per-user tables with row-level security, shared with Klander's Supabase project; the app stays fully usable without an account)
- **M3 Tester round** (share with testers, collect feedback directly, fix the top issues)
- **Later:** exercise demos, unit toggle (kg/lb), charts polish, import from other apps

## 2026-11-03
- Renamed the app to Gymnify (repo, title, manifest, README).
- Published on GitHub Pages as a public showcase. Local-only by default: no account, data stays on the device.
- M1: added `sw.js` so the app opens offline (network-first, so updates arrive when online), and a first-run welcome card on Today.
- Decided to share one Supabase project with Klander so a single login works across both apps. Gymnify tables will be namespaced `gymnify_*` and every row will carry `user_id`.
