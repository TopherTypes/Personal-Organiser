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
