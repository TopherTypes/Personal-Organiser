# Changelog

All notable changes to **The Second Brain** will be documented in this file.

The format is based on **Keep a Changelog**, and this project adheres to **Semantic Versioning**.

- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- Semantic Versioning: https://semver.org/spec/v2.0.0.html

> If a change alters stored data shape or sync/conflict behaviour, add an entry to `docs/DECISIONS.md` too.

---

## [Unreleased]

### Added
-

### Changed
-

### Deprecated
-

### Removed
-

### Fixed
-

### Security
-

---

## [0.6.0] - 2026-02-07

### Added
- Work mode **Sprints** module with localStorage-backed CRUD, slide-over create/edit experience, and dedicated sprint full-screen detail view.
- Sprint data model with `id`, `name`, `startDate`, `endDate`, `status`, linked `taskIds`, `createdAt`, `updatedAt`, and field-level update metadata for future merge/sync safety.
- Task linking workflow allowing one task to belong to multiple sprints, including planning-only backlog add controls in the sprint detail view.
- Sprint metrics for **forecast total** (task count), **completed total**, and **pace** (`Ahead`, `On track`, `Behind`) using completion-percent versus elapsed-time-percent.

### Changed
- Added single-active-sprint enforcement for `active` status and date-window validation requiring today's date to be within sprint start/end bounds.
- Sprint archive/restore is now confirmation-gated and non-destructive to satisfy the no-silent-data-loss safety requirement.
- Version increased to `0.6.0` due to new user-facing behaviour and added persisted sprint schema.

### Fixed
- N/A.

---

## [0.5.0] - 2026-02-06

### Added
- Work mode **Tasks** module with localStorage-backed CRUD, side-menu entry, and slide-over create/edit panel.
- Task assignment to existing People and Projects entities, with status filters plus assignee/project filters.
- Non-destructive archive/restore workflow and optional archived visibility toggle.
- Recurrence rule storage supporting `daily`, `weekly`, `monthly`, `weekdays`, `weekends`, and `custom` options.
- Automated priority score based on due-date urgency plus effort/impact signals, with deterministic tie-breaking for stable ordering.

### Changed
- Version increased to `0.5.0` due to new user-facing behaviour and persisted task data shape.

### Fixed
- N/A.

---

## [0.4.0] - 2026-02-06

### Added
- Work mode **Projects** module with localStorage-backed CRUD, card view sorted by derived latest activity, slide-over create/edit form, and dedicated full-details view.
- Project entity model (`title`, `description`, `startDate`, `targetDate`, required `status`) with people-role links supporting multi-role assignments.
- Project link controls from three entry points: project editor (link people/meetings), meeting editor (single project selection), and person editor (project role assignment).
- Delete confirmation flow that reports impacted links and removes only links while preserving people and meeting records.

### Changed
- Meetings editor now uses project dropdown values instead of free-text IDs and validates project existence before save.
- Version increased to `0.4.0` due to new user-facing behavior and added persisted project schema.

### Fixed
- N/A.

---

## [0.3.0] - 2026-02-06

### Added
- Work mode **Meetings** module with localStorage-backed CRUD in a split layout (calendar + scoped list), including weekly default view (Monday start), monthly browse view, and slide-over editor.
- Meeting note workflow with markdown-capable text entry, auto-save draft + explicit save, search/filter on meeting name and notes, and historical review support.
- Meeting state model with lifecycle statuses (`scheduled`, `completed`, `rescheduled`, `cancelled`, `missed`) and both `statusHistory` + `auditTrail` metadata.
- Non-destructive meeting archive/restore controls (no hard delete), aligned to data safety requirements.
- People-module entry point for quick "Schedule 1:1" handoff that pre-fills a new meeting draft.
- Unsaved changes guard for module/mode navigation in the SPA shell.

### Changed
- App shell now passes module UI context for cross-module entry points and unsaved-change signaling.
- Meetings persistence now uses a versioned storage envelope with a safe migration path from legacy array shape plus backup snapshot key.
- Version increased to `0.3.0` due to new end-user behavior and persisted data shape.

### Fixed
- N/A.

---

## [0.2.0] - 2026-02-06

### Added
- Work mode **People** module with localStorage-backed CRUD capabilities for contacts: create, read/list, update, and archive/restore (instead of destructive delete).
- Sidebar module interaction model so selecting `People` opens its dedicated module view.
- Dedicated contact create/edit form with MVP fields (`name`, `role/title`, `organisation`, `relationship`, `email`, `phone`, `lastContactDate`, `notes`).
- Quick contact update interaction in list rows for logging a date + note.
- Contact trail log per person to keep recent engagement history visible.
- Search, filter, and sort controls for finding contacts quickly.

### Changed
- App shell state now tracks active module per mode to support module-level navigation.
- Version increased to `0.2.0` due to new end-user behaviour and persisted data.

### Fixed
- N/A.

---

## [0.1.0] - 2026-02-05

### Added
- Initial GitHub Pages-ready SPA baseline at repo root with `index.html` and relative `./` asset/module paths.
- Minimal UI shell aligned to navigation specs:
  - Always-visible top bar with mode switch (disabled until mode entry)
  - Always-visible sync placeholder status (`Offline / Not configured`)
  - Mode-specific sidebar modules with icon + label
  - Cross-life landing dashboard with Work/Personal entry buttons
- Versioning mechanism via `src/version.js` (`APP_VERSION`) and visible footer version display.
- Placeholder source structure for incremental development (`src/app.js`, `src/modules/*`, `src/styles.css`).

### Changed
- Documentation files moved to `docs/` structure for consistency (`docs/SPECS.md`, `docs/DECISIONS.md`).
- `README.md` and contribution guidance aligned with the docs folder and baseline app structure.

### Fixed
- N/A (baseline release).
