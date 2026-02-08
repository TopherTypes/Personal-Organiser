# The Second Brain — Product Spec

This document defines **what the app is** and **how it should behave**. It is the source of truth for implementation.

---

## 1. Purpose

**The Second Brain** is a single-page personal organiser that *remembers the details so I can steer the big picture*.

It is one app for my whole life, with two modes:
- **Work mode** — structured delivery: projects, sprints, meetings, stakeholders, tasks
- **Personal mode** — life admin + growth: tasks, contacts/relationships, daily logs, timeboxing

The app is hosted on **GitHub Pages** (static hosting) and stores user data in **my Google Drive** (source of truth).

---

## 2. Core principles

- **Personal-only**: not multi-user; no collaboration features.
- **Offline-first**: the app remains usable offline; changes queue locally until sync.
- **Data safety > convenience**: never silently lose or overwrite data.
- **Two worlds, one home**: Work and Personal are separate experiences and data sets.
- **Simple UI, rich memory**: the app handles “remembering” and prompts; I stay focused on decisions and direction.

---

## 3. Non-goals (v1)

- Multi-user, sharing, or collaboration
- Attachments (files/images stored in the app)
- Google Calendar integration (two-way or one-way)
- Email/Gmail integration
- Full-text global search
- Encryption / custom crypto beyond standard Google OAuth/Drive protections
- Complex permissions, roles, audit logs

---

## 4. App entry, modes, and navigation

### 4.1 Entry flow
On launch:
- Show a **dashboard** that covers both Work and Personal at a glance.
- Provide a clear choice to enter **Work** or **Personal** mode.

### 4.2 Mode switching
- The app must always display a **mode switch** at the top to jump between Work and Personal quickly.
- Switching mode must not cross-contaminate data (see Storage model).

### 4.3 Navigation model
- Each mode uses a **sidebar** with “apps/modules”.
- Each module has an **icon + label**.
- Modules may cross-link entities (e.g., a Meeting references People; an Action links to a Task later).

### 4.4 Top bar (always visible)
- Mode switch (Work/Personal)
- Sync status (always visible; see Sync UI)

Global search is not required for MVP.

---

## 5. Modules (MVP)

### 5.1 Work mode modules (initial)
- Dashboard
- Tasks
- Projects
- Sprints
- Meetings
- People (Work CRM)
- Updates (general updates log)
- Settings / Sync

### 5.2 Personal mode modules (initial)
- Dashboard
- Tasks
- Projects / Timeboxing (optional)
- Daily Log (nutrition + exercise summary)
- Exercise Log (Run/Walk entries)
- People (Personal CRM)
- Calendar (optional; lightweight personal meeting-like log)
- Settings / Sync

> Note: Personal “Calendar” is optional and may be a simplified version of Meetings.

---

## 6. Data model (entities, IDs, links)

### 6.1 Entity types
The app uses distinct entity types with unique IDs:
- **Task**
- **Project**
- **Sprint** (Work required; Personal optional)
- **Meeting** (Work primary; Personal optional “Calendar”)
- **Person** (Work contact vs Personal contact are separate types/collections)
- **DailyLog** (personal)
- **ExerciseLogEntry** (Run / Walk initially)
- **Update** (general updates log)

### 6.2 IDs
- Every entity must have a stable unique ID.
- IDs must be safe for JSON serialization and Drive storage.

### 6.3 Cross-linking
Cross-links are required:
- Meetings reference attendees (People)
- Meetings may reference Projects and Tasks (later automation)
- People can link to Projects (Work)
- Tasks can link to Projects, Sprints, Meetings, and People (as needed)

### 6.4 Attachments
- Text-only for MVP.
- Links are supported (URLs), but no file attachments.

---

## 7. Tasks

### 7.1 Task fields (minimum)
- `title` (required)
- `status` (required)
- `impact` (required) — numeric or categorical
- `effort` (required) — numeric or categorical
- `priorityScore` (computed) — derived from impact, effort, and optionally due date
- `dueDate` (optional)
- `sprintPoints` (required in Work; optional in Personal)
- `tags` (optional)
- `notes` (optional)
- `links` (optional)
- `relatedMeetingId` (optional)

### 7.2 Status values
Allowed values:
- `Backlog`
- `Ready`
- `In Progress`
- `Blocked`
- `Waiting On`
- `Done`
- `Cancelled`

### 7.3 Priority scoring (MVP policy)
Priority is computed from:
- **Impact** (higher = more priority)
- **Effort** (higher = less priority)
- **Due date** (if present, increases priority as the date approaches)

The exact formula can evolve, but must be:
- deterministic
- explainable in UI (show score + factors)
- configurable later without breaking stored data

### 7.4 Dependencies
MVP supports:
- Hard dependency links: **Task A blocks Task B**
- Visual dependency view is a future enhancement (e.g., Gantt).

### 7.5 Recurring tasks
Supported recurrence rules:
- daily
- weekly
- monthly
- weekdays only
- custom interval (every N days)

Recurrence behaviour:
- Recurring tasks create **new instances** each recurrence, so past occurrences remain trackable.

---

## 8. Projects

### 8.1 Project fields (minimum)
- `name` (required)
- `description` (optional)
- `status` (optional)
- `startDate` (optional)
- `targetDate` (optional)
- `decisions` (optional list)
- `updates` (optional list or links to Update entities)

> Work and Personal can both use Projects; in Personal they are optional and may be treated more lightly.

---

## 9. Sprints (Work)

### 9.1 Sprint fields (minimum)
- `name`
- `startDate`
- `endDate`
- `capacity` (optional numeric)
- `committedPoints`
- `completedPoints`

Sprints are part of Work mode; Personal supports timeboxing optionally.

---

## 10. Meetings (Work) and Calendar (Personal optional)

### 10.1 Work meeting fields (minimum)
- `title`
- `dateTime`
- `attendees` (list of Person IDs)
- `chair` (optional Person ID)
- `notes` (text)
- `actions` (text for MVP; later may become tasks)
- `decisions` (text)
- `links` (optional)

### 10.2 Action expansion (post-MVP intent)
- Some meeting actions will later be promotable into Tasks.
- MVP stores actions as text only.

### 10.3 Personal “Calendar” (optional)
- A simplified log similar to Meetings, designed for personal scheduling/notes.
- If included, it should reuse as much of the Meeting structure as sensible while keeping UI lighter.

---

## 11. People (CRM)

### 11.1 Work contact fields (minimum)
- `name` (required)
- `organisation` (required)
- `email` (required)
- `team` (optional)
- `role` (optional)
- `relationshipNotes` (optional)
- `lastContact` (optional date)
- `cadence` (optional; see below)
- `projectLinks` (list of Project IDs)
- `links` (optional)
- `tags` (optional)

### 11.2 Personal contact fields (minimum)
- `name` (required)
- `relationship` (optional)
- `lastContact` (optional date)
- `cadenceTarget` (optional; see below)
- `birthday` (optional; year may be unknown)
- `importantDates` (optional list of `{ label, date }`)
- `notes` (optional)
- `reminders` (derived; see below)

### 11.3 Cadence format
Cadence must support both:
- “every X days” (numeric interval), and/or
- friendly buckets (weekly / monthly / quarterly)

Cadence is used to drive prompts and “remembering” features.

### 11.4 Reminders and prompts (derived)
Prompts are derived from cadence + important dates + activity:
Examples:
- “You haven't spoken to Lianne in a while — drop her a message.”
- “You haven't exercised in 3 days — maybe go for a walk.”
- “Becky's birthday is coming up — have you thought about what you want to do?”
- “You haven't made progress on Project X in a while — want to set time aside?”

Post-MVP intent:
- Contact “quality” may matter (in-person > call > messages), and cadence adapts accordingly.

---

## 12. Personal logs

### 12.1 Daily log fields (minimum)
- `date`
- `calories`
- `water`
- `sleepHours`
- `mood`
- `threeAchievements` (list of 3 strings)
- `oneGratitude`
- `steps`
- `distanceTravelled`

### 12.2 Exercise log entries
Two initial exercise types:
- **Run**
- **Walk**

They share the same fields:
- `type` (Run|Walk)
- `date`
- `time`
- `distance`
- `duration`
- `effort` (1–10)
- `notes` (optional)

Future enhancement: add more exercise types without breaking stored data.

---

## 13. Storage model (Google Drive source of truth)

### 13.1 Drive layout (MVP)
- A dedicated folder in Google Drive: `SecondBrain/` (name can be adjusted later)
- Files:
  - `work.json` — Work dataset
  - `personal.json` — Personal dataset
  - `meta.json` — app metadata (version, last sync markers, etc.)
  - `backups/` — rolling backups (see below)

### 13.2 Datasets
Work and Personal data are hard-separated:
- Separate files (`work.json` and `personal.json`)
- No shared entities between them in MVP

### 13.3 First-run wizard
On first run, the app provides a wizard to:
- authenticate with Google
- create the Drive folder structure
- create initial JSON files (if missing)
- confirm basic preferences (mode labels, optional modules, etc.)

---

## 14. Offline, sync, and conflict resolution

### 14.1 Local shadow data
- The app maintains local shadow data for offline edits.
- The app must queue changes and sync later without losing data.

### 14.2 Per-field timestamps
- Every entity field (or every meaningful field group) must have a `lastUpdated` timestamp.
- Conflict resolution is **field-level**:
  - if both Drive and local changed the same field, the newer timestamp wins.

### 14.3 Conflict rule (MVP)
- Default: **choose newest value** for the conflicting field.
- The system must preserve recoverability via backups (see below) so conflicts never cause irreversible loss.

### 14.4 Sync UI (always visible)
The UI must show, at minimum:
- last successful sync time
- pending local changes count
- conflict count (if any)
- current sync state (idle/syncing/offline/error)

### 14.5 Backups + revert
- Keep **last 5 versions** on Drive for each dataset.
- Provide a UI to:
  - view available backup versions (timestamped)
  - revert to a selected version safely

> Implementation detail: backups may be stored as separate files in `backups/` with timestamps.

---

## 15. Import/export

### 15.1 Export
- Export format: **JSON** (MVP).
- Export supports three actions in Settings: **Work**, **Personal**, or **Combined**.
- Export payload includes metadata: `schema`, `schemaVersion`, `appVersion`, `exportedAt`, and dataset blocks keyed by `work` / `personal`.

### 15.2 Import
- Import prompts the user to choose:
  - merge (default), or
  - replace
- Import only accepts validated payloads that match the supported schema + schema version.
- Before import writes are applied, the app must create a timestamped backup snapshot of touched storage keys.
- If an import fails while applying writes, the app must rollback to the pre-import snapshot.

Merge behaviour must be conflict-safe and consistent with field-level timestamps:
- Object values merge recursively by key.
- Arrays with stable object `id` fields merge by id, preferring the newest `updatedAt`/`lastUpdated`/`lastUpdatedAt` value.
- Arrays without stable ids are replaced by imported arrays.
- Primitive values are replaced by imported values.

---

## 16. UI/UX guidelines

- Desktop-first; mobile is “usable in a pinch” and may become a “lite” mode later.
- Card-based, clean visuals.
- Dark mode preferred (support dark mode early if practical).
- Subtle, responsive micro-animations are encouraged, but must not distract.

---

## 17. Versioning and migrations

- Maintain an app version constant.
- If stored data structure changes:
  - bump version appropriately
  - implement migration logic where needed
  - record the decision in `docs/DECISIONS.md`

---

## 18. Open questions (intentionally deferred)

These are acknowledged but not required for MVP:
- Gantt/dependency visualisation
- Advanced reporting/exports (CSV, PDFs, dashboards)
- Contact “quality” weighting for cadence
- Automated meeting-to-update generation
- Global search
