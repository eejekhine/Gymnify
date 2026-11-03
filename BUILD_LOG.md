# Gymnify build log

Newest first. Each entry: what changed, why, and what is next.

## Plan
Done:
- **M1** Offline support, first-run welcome
- **M2** Optional accounts and sync (shared Supabase project, row-level security)
- **M3** Setup wizard, routine builder, themes, tap-to-view routines, blank start
- **M4** kg/lb units, CSV export, privacy page
- **M5** Merge-based sync, automated tests (CI workflow file waiting in tests/)
- **M6** Athlete goal with sport choice, screenshot import, welcome-screen import shortcut
- **M7** Supersets, deload weeks, week-boundary fix for clock changes

Now: **Tester round** (share the link, collect feedback directly, fix the top issues). Not done yet: real-phone checks of sign-up, sync, screenshot import, offline.

Next (suggested order): light theme, exercise how-to text, delete-my-account button, then friends (design is on the roadmap page; opt-in, built on Klander friendships).

Each milestone is also copied into the Training Hub's Gym page with tools/build-gym.py in the hub repo.

## 2026-11-03
- M7: supersets. In a routine, tap Superset on an exercise to link it with the next one (tap Unlink to undo); in a workout use the exercise menu. Linked exercises show a SUPERSET A1/A2 badge and alternate set by set: no rest timer between them, rest starts after the last exercise of each round.
- M7: deload weeks. After 5 weeks in a row with at least 2 workouts (setting: Settings > Training, 0 turns it off), Today suggests a lighter week. Accepting it cuts sets by about 40% and suggests weights about 10% lower for that week only; it ends on its own at the next Monday, or early from the Today card. Not now hides it for 3 days.
- M7: fix: weekly streaks and the weekly volume chart miscounted weeks that cross a clock change (UK clocks went back on 25 Oct). Weeks are now stepped by calendar days. The test suite runs in the Europe/London time zone to catch this.
- M7: fix: workout column headings said KG even in lb mode.
- Welcome screen now has "Import from another app", which skips the setup questions and opens Import (screenshot, pasted text, CSV or backup).
- M6: new goal "Perform in my sport" in setup and the builder, with a sport choice (basketball/volleyball, football/rugby/hockey, combat, running, other). Lower-body days get jump and power work (beginners get the easier jumps only; basketball gets two), other sports get a conditioning finisher, and lifts use strength-style reps and rests.
- M6: import from screenshots. Workouts > Import > Read a screenshot reads the text on the device (Tesseract.js, downloaded once from a CDN; the image is never uploaded), fills the box and parses it. The result is checked before saving, and OCR mistakes can be edited in the text box. Needs internet the first time. Tested with a generated screenshot (4 of 4 exercises matched).
- M5: sync now merges instead of overwriting. Workouts, routines, body weight, measurements and custom exercises from two devices are combined by id/date; deletions travel as tombstones (kept 120 days) so a deleted routine does not come back; Delete all data also clears the other device. A device with nothing on it takes the account copy. Where the same routine differs, the more recently saved copy wins. The pre-merge local copy is still kept under `gym.v1.backup`.
- M5: automated tests (`npm test`, 18 checks: first run, merge rules, kg/lb, CSV, setup wizard) and a GitHub Actions workflow that runs them on every push.
- Decision: example programmes stay optional; email confirmation to be switched off in the shared Supabase project so testers sign up in one step.
- M4: kg/lb switch (Settings > Training). Data is always stored in kg and converted for display and entry, so switching is lossless. Covers set inputs, progression hints (5 lb steps in lb), plate calculator (45 lb bar and lb plates), charts, PRs, body weight and goal weight.
- M4: Export CSV (Settings > Data): every completed set with date, workout, exercise, type (warm-up or working), weight, reps, RPE and PR flag.
- M4: Privacy and data page (Settings > About) saying what is stored on the device, what is synced with an account, and what is never done.
- Correction: plate calculator, progression hints, estimated 1RM, warm-up sets and weekly muscle sets already existed; the roadmap page listed them as ideas by mistake.
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
