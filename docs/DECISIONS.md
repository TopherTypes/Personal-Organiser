# Decisions (ADR-lite)

This log records significant decisions for **The Second Brain** so future changes are consistent and deliberate.

**Format:** ADR-lite (one entry per decision)  
**Order:** newest first  
**Voice:** “I decided …”

---

## D-014 — 2026-02-07 — Compact pseudo-table layout for Work Tasks list

- **Decision:** I decided to replace the Work Tasks card-list presentation with a compact pseudo-table row layout while keeping all existing task actions and persisted data unchanged.
- **Context:** The prior task cards consumed too much vertical space, making sprint and workload planning harder because fewer tasks were visible at once.
- **Options considered:** (1) Keep large cards and only tighten spacing, (2) switch to a semantic `<table>`, (3) implement a responsive pseudo-table built from grid rows.
- **Why:** Option (3) improves scan-ability and density, keeps existing component patterns, and is safer for responsive behaviour in the current SPA module rendering approach.
- **Consequences / follow-ups:** Task data schema and storage keys remain unchanged (no migration risk); future enhancements can add sortable columns if needed.

---

## D-013 — 2026-02-07 — User settings module for appearance and workflow preferences

- **Decision:** I decided to implement a dedicated Settings module (Work + Personal) backed by localStorage for theme, layout density, startup mode, and unsaved-change confirmation preferences.
- **Context:** The app needed user-level customisation without adding backend assumptions, while staying safe for static GitHub Pages hosting.
- **Options considered:** (1) keep Settings as placeholder, (2) add ad-hoc toggles in top bar, (3) create a single settings module with explanatory controls and validated persistence.
- **Why:** Option (3) keeps preferences discoverable, provides context for each setting, and allows behaviour changes without touching data schemas for other modules.
- **Consequences / follow-ups:** Adds storage key `second-brain.ui.settings.v1`; app boot now can auto-enter preferred mode; navigation warning becomes user-configurable while default remains safety-first (enabled).

---

## D-012 — 2026-02-07 — Work Sprints module with pace tracking and archive-first safety

- **Decision:** I decided to implement Work → Sprints as a localStorage-backed module with slide-over create/edit, full-screen sprint details, task-to-sprint linking, and pace tracking from completion percentage versus sprint elapsed percentage.
- **Context:** Work mode required a practical way to chunk tasks into manageable sprint windows without backend dependencies and without risking silent data loss.
- **Options considered:** (1) keep Sprints as placeholder navigation only, (2) model sprints as a tag on tasks only, (3) implement dedicated sprint entities with local schema, validation, and archive/restore safety controls.
- **Why:** Option (3) satisfies the acceptance criteria (CRUD, task linking, and progress/pace visibility) while preserving recoverability in a static GitHub Pages deployment.
- **Consequences / follow-ups:** Adds storage key `second-brain.work.sprints.work` with `{ schemaVersion, sprints[] }`, includes legacy-array migration backup (`.backup` key), enforces one active sprint at a time, and validates active sprints to today's date window to keep sprint state consistent.

---

## D-009 — 2026-02-06 — Work Tasks module with local-first safety and computed priority

- **Decision:** I decided to implement a dedicated Work Tasks module with localStorage-backed CRUD, People/Project assignment links, archive-by-default safety controls, recurrence rule storage, and deterministic priority-score ordering.
- **Context:** Work mode needed actionable task tracking similar to Meetings and Projects while remaining static-host compatible (GitHub Pages, no backend).
- **Options considered:** (1) placeholder-only tasks, (2) basic list with manual ordering, (3) full local module with required filters and automated score ordering.
- **Why:** Option (3) satisfies acceptance criteria while preserving data safety via non-destructive archive/restore and versioned storage envelope.
- **Consequences / follow-ups:** Adds storage key `second-brain.work.tasks.work.v1` with `{ schemaVersion, tasks[] }`. Recurrence is stored as rules only (instance generation deferred). Priority ties use a stable ID hash to avoid volatile list reorder on refresh.

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


## D-011 — 2026-02-06 — Work Projects module with link-centric data model and safe unlink-on-delete

- **Decision:** I decided to implement Work → Projects as a localStorage-first module with explicit links to people and meetings, including project-level role tagging for people and confirmation-based delete that unlinks related entities rather than removing them.
- **Context:** The product needs a single work container to connect meetings and stakeholders while preserving data safety in a static GitHub Pages deployment.
- **Options considered:** (1) keep Projects as a placeholder, (2) create project records without cross-entity links, (3) implement link-aware CRUD with project, meeting, and person entry points.
- **Why:** Option (3) satisfies acceptance criteria and no-silent-loss requirements by making links editable from relevant screens and by protecting existing person/meeting records during project deletion.
- **Consequences / follow-ups:** Adds project storage key `second-brain.work.projects.work` with versioned envelope and introduces a person-role link convention inside projects; future task-link support can extend the same linking pattern.

---

## D-009 — 2026-02-06 — Work People module in static localStorage-first MVP

- **Decision:** I decided to implement the Work mode `People` module as a fully client-side localStorage feature with archive-first deletion, list search/filter/sort, and a timestamped contact trail log per person.
- **Context:** The app is hosted on GitHub Pages with no backend, but stakeholder management needs real CRUD behavior while honoring the no-silent-loss data safety rule.
- **Options considered:** (1) keep People as placeholder navigation only, (2) implement hard-delete CRUD quickly, (3) implement localStorage CRUD with non-destructive archive and engagement history.
- **Why:** Option (3) delivers immediate product value in a static deployment, reduces irreversible data loss risk, and preserves an extensible data shape for later sync workflows.
- **Consequences / follow-ups:** Adds a new persisted local schema (`second-brain.work.people.work.v1`) and requires future sync work to map `contactTrail` and `lastUpdatedByField` metadata safely.

---

## D-010 — 2026-02-06 — Meetings module v1 with local-first versioned schema and non-destructive lifecycle

- **Decision:** I decided to implement a dedicated Work → Meetings module with weekly/monthly calendar views, list/detail review, markdown notes, and soft-delete archive behavior only.
- **Context:** Meeting capture and retrospective review are required now on static GitHub Pages hosting with localStorage, while sync (Drive) is planned for a later phase.
- **Options considered:** (1) keep Meetings as placeholder only, (2) implement list-only CRUD first, (3) implement split calendar/list module with status/audit metadata and soft-delete controls.
- **Why:** Option (3) satisfies the functional acceptance criteria and data safety expectations without adding dependencies or backend assumptions.
- **Consequences / follow-ups:** Adds new storage key `second-brain.work.meetings.work` using `{ schemaVersion, meetings[] }`, includes migration from legacy array format with backup (`.backup` key), and introduces `statusHistory`, `auditTrail`, and `lastUpdatedByField` metadata for future sync/conflict merge readiness.

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
