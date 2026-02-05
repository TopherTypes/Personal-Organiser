# Decisions (ADR-lite)

This log records significant decisions for **The Second Brain** so future changes are consistent and deliberate.

**Format:** ADR-lite (one entry per decision)  
**Order:** newest first  
**Voice:** “I decided …”

---

## How to add a decision

Create a new entry at the top using the template below:

- **ID:** D-###
- **Date:** YYYY-MM-DD
- **Decision:** I decided ...
- **Context:** What problem or pressure existed?
- **Options considered:** What were the realistic alternatives?
- **Why:** Why this option (trade-offs)?
- **Consequences / follow-ups:** What this unlocks, constrains, or requires next.

---

## D-008 — 2026-02-05 — Baseline app shell structure and single in-app version constant

- **Decision:** I decided to establish a static GitHub Pages-ready baseline with `index.html` at repo root, UI modules under `src/`, and a single SemVer constant in `src/version.js` displayed in the UI footer.
- **Context:** Development needs a safe, consistent starting point that works on GitHub Pages and keeps version communication clear.
- **Options considered:** (1) defer app shell until sync implementation, (2) spread version strings across docs/UI files, (3) create a thin shell now with a single version source.
- **Why:** A minimal shell enables incremental delivery and manual validation, while a single version constant prevents drift between runtime and release notes.
- **Consequences / follow-ups:** Future behavior changes should update `APP_VERSION` and `CHANGELOG.md` together; paths must remain relative (`./...`) for GitHub Pages portability.

---

## D-007 — 2026-02-05 — Non-goals for v1

- **Decision:** I decided v1 will explicitly exclude: multi-user/collaboration, attachments, calendar integration, email integration, full-text global search, encryption beyond Google, and complex roles/permissions.
- **Context:** Without clear non-goals, scope creep will dilute the MVP and increase risk.
- **Options considered:** (1) Leave non-goals implicit, (2) define a strict v1 boundary.
- **Why:** A written boundary keeps tasks focused and protects build momentum.
- **Consequences / follow-ups:** Future features must be added intentionally with new decision entries.

---

## D-006 — 2026-02-05 — Google Drive as source of truth (GitHub Pages static hosting)

- **Decision:** I decided the app will be hosted on GitHub Pages with **no backend**, and **Google Drive** will be the source of truth for data.
- **Context:** The app must work on locked-down machines without installs or server hosting.
- **Options considered:** (1) localStorage only, (2) custom backend, (3) Drive-backed storage.
- **Why:** Drive provides portability across devices while keeping infrastructure minimal.
- **Consequences / follow-ups:** Requires OAuth, Drive folder/file setup, robust sync and conflict handling.

---

## D-005 — 2026-02-05 — Two hard-separated datasets (Work vs Personal)

- **Decision:** I decided Work and Personal will be hard-separated datasets and experiences.
- **Context:** Work and Personal behave differently and must not accidentally mix data.
- **Options considered:** (1) single blended dataset with tags, (2) separate UI only, (3) separate files/datasets.
- **Why:** Hard separation reduces risk, simplifies mental model, and supports different defaults.
- **Consequences / follow-ups:** No shared entities in MVP; cross-mode linking is out of scope.

---

## D-004 — 2026-02-05 — File strategy: one JSON file per mode + metadata + backups

- **Decision:** I decided to store data as `work.json` and `personal.json` plus `meta.json`, with rolling backups in a `backups/` folder.
- **Context:** Sync complexity and conflict risk increase with many small files.
- **Options considered:** (1) one file per entity type, (2) one file per mode, (3) append-only event log.
- **Why:** One file per mode is a good balance of simplicity and stability.
- **Consequences / follow-ups:** Requires careful merge logic at field level to avoid losing concurrent edits.

---

## D-003 — 2026-02-05 — Conflict resolution: field-level timestamps, newest wins

- **Decision:** I decided conflict resolution will be **field-level** using per-field `lastUpdated` timestamps, with **newest value wins**.
- **Context:** I will use multiple devices; stale local caches must not overwrite newer Drive data.
- **Options considered:** (1) record-level newest wins, (2) manual merge always, (3) field-level merge with timestamps.
- **Why:** Field-level merge reduces avoidable conflicts while remaining deterministic.
- **Consequences / follow-ups:** Data model must support per-field timestamps; UI should surface sync state and conflicts.

---

## D-002 — 2026-02-05 — Backups and revert: keep last 5 versions

- **Decision:** I decided to keep the **last 5 versions** of each dataset on Drive and provide a UI to revert.
- **Context:** Conflict handling must be recoverable; “no silent loss” requires rollback options.
- **Options considered:** (1) no backups, (2) last-known-good only, (3) rolling versions, (4) append-only snapshots.
- **Why:** Rolling 5 versions provides safety without excessive Drive clutter.
- **Consequences / follow-ups:** Implement backup rotation and a safe restore flow.

---

## D-001 — 2026-02-05 — Navigation model: dashboard + modular sidebar apps

- **Decision:** I decided the app will start with a cross-life dashboard and then enter Work/Personal via a landing choice; within a mode, navigation will be a modular sidebar of “apps” with icons and labels.
- **Context:** The app must cover many functions without becoming confusing.
- **Options considered:** (1) single long page, (2) top tabs, (3) sidebar modules.
- **Why:** Sidebar modules scale well and support cross-linking between areas (e.g., Meetings → People).
- **Consequences / follow-ups:** Requires consistent module patterns and predictable cross-link behaviour.
