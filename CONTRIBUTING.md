# Contributing

This repo is primarily built with **Codex + prompts** and maintained by a **single owner**. The goal of this guide is to keep changes small, safe, and easy to review — especially around **sync + data integrity**.

---

## How we work (high-level)

### Default workflow (recommended)
Even as a solo repo, the safest pattern is:

1. Create a **feature branch**
2. Make the change in small commits
3. Open a **Pull Request** back into `main`
4. Do a quick verification pass
5. Merge to `main`

Why this helps: it keeps `main` stable, makes it easier to revert, and gives Codex a cleaner structure for change sets.

> If you’re making a tiny change (docs typo, etc.), direct commits to `main` are acceptable — but the default is branches + PRs.

---

## Branching convention

- `main` — always “deployable”
- Feature branches:
  - `feat/<short-description>` for new capability
  - `fix/<short-description>` for bugs
  - `chore/<short-description>` for maintenance/refactors

Examples:
- `feat/work-tasks-list`
- `fix/offline-queue-duplication`
- `chore/refactor-storage-layer`

---

## Task intake (how work is defined)

Tasks are supplied as **prompts** (not tracked as a formal issue template in this repo).

When writing a task prompt, include:
- **Goal** (what outcome you want)
- **Scope** (what’s in / out)
- **Acceptance criteria** (bullet list)
- **Edge cases** (especially around sync + offline)
- **Files likely touched** (if you know)

---

## Code style

### Preferences
- Use **double quotes** (never smart quotes).
- Use **semicolons**.
- Prioritise **human-readable code**.
- Prefer **clear comments** over cleverness.

### Practical guidelines
- Keep functions small and named for what they do.
- Avoid “magic” constants — prefer named constants.
- Separate UI from data logic where possible.
- When in doubt: follow existing patterns in the repo.

---

## Project structure (light guidance)

This is intentionally loose, but a common structure that scales well:

- `src/app/` — app shell, routing/mode switching, global state
- `src/ui/` — UI rendering and event wiring
- `src/data/` — storage, models, sync, migrations
- `src/services/` — Google Drive + auth integration
- `src/utils/` — pure helpers

You don’t have to create all of these from day one — but if a new module clearly fits one, place it there.

---

## Validation (Definition of Done)

A change is “done” when:

1. **Works on GitHub Pages** (no broken paths, no assumptions about `/` root).
2. **No regression** in existing behaviour (especially: loading, saving, syncing).
3. **Docs updated** if behaviour or decisions changed:
   - `docs/SPECS.md` for “what it does”
   - `docs/DECISIONS.md` for “why we chose this”
4. **Version bumped** appropriately (see below).
5. **Testing completed** (manual checklist) and any missing tests are either:
   - added immediately, or
   - explicitly noted as follow-up work.

---

## Manual smoke test checklist (minimum)

Run this checklist before merging to `main`:

### General
- [ ] App loads in Chrome/Edge
- [ ] Work/Personal mode switch works
- [ ] No console errors on first load

### Data safety
- [ ] Create a record → refresh → record persists
- [ ] Export works and produces a usable file
- [ ] Import (if present) restores data correctly

### Offline + sync (as applicable)
- [ ] Make edits offline → reconnect → sync completes
- [ ] Switching device does not overwrite newer Drive data
- [ ] Conflicts do not cause silent data loss (a backup/merge artifact is preserved)

---

## Versioning

Use a simple, human approach:

- `MAJOR.MINOR.PATCH`
  - **MAJOR**: breaking data model / migrations or major UX shift
  - **MINOR**: new feature that doesn’t break existing data
  - **PATCH**: bugfixes, small improvements, internal refactors

Where the version lives:
- Maintain a single version constant (e.g., `src/version.js`) and display it somewhere (e.g., footer or “About”).
- For this repo baseline, update `APP_VERSION` in `src/version.js` and add matching release notes in `CHANGELOG.md` whenever behaviour changes.

> If a change alters stored data shape or sync rules, bump at least **MINOR** and add a decision entry.

---

## Tooling (formatting + linting)

To keep the codebase consistent, we **may** use:
- **Prettier**: automatic code formatting
- **ESLint**: basic JavaScript linting (catch common mistakes)

These are **dev-only** tools (they do not ship to the browser runtime) and exist to reduce “style churn” and prevent simple errors.

If/when added, the repo should include:
- `npm run format`
- `npm run lint`

> If tooling is not yet set up, keep formatting consistent manually and don’t introduce multiple styles.

---

## High-risk areas (extra care required)

Changes touching any of the following should be treated as “high risk”:

- Google Drive sync / conflict resolution
- Offline queueing / replay logic
- Data migrations / schema changes
- Import/export format

For high-risk changes:
- Add or update notes in `docs/SPECS.md`
- Add a short entry in `docs/DECISIONS.md` if a choice was made
- Ensure a backup/recovery path exists (never overwrite without a way back)

---

## Commit messages

Plain English is fine. Prefer messages that answer:
- What changed?
- Why?

Examples:
- `Fix conflict merge creating duplicate contacts`
- `Add basic meeting log with notes`
- `Refactor storage layer to isolate Drive sync`
