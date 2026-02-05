# The Second Brain

A single-page HTML app that *remembers the details so I can steer the big picture*.

This is a **personal organiser for me only**, with **two separate modes** (and hard-separated data):
- **Work** — tasks, meetings, notes, updates, stakeholder tracking
- **Personal** — tasks, contacts/relationships, reminders, daily logs (nutrition + exercise)

The app is hosted on **GitHub Pages**, with data stored in **my Google Drive**.

---

## What this repo is

- A **one-page web app** (HTML/CSS/JS) designed to run in the browser with no install.
- **Offline-first**: works offline using local working storage and syncs when connectivity returns.
- **No server / no backend**: GitHub Pages hosts static files only; all user data lives in Google Drive.

> **Intended users:** just me.

---

## Core capabilities (MVP scope)

### Must-have
- **Task management** (Work + Personal)
- **Contacts / relationship tracking** (Work + Personal)
  - last-contacted date, notes, key details
- **Meetings** (Work + Personal)
  - meeting log + notes
- **Personal daily logs**
  - nutrition + exercise basics
- **Export**
  - always provide a way to export/backup data

### Design intent
- Keep the UI **simple** and fast.
- Let the app handle the “remembering” and prompting (e.g., birthdays, key life events, time since last contact).
- Enable future reporting/exports without turning the MVP into a spreadsheet monster.

---

## Data, privacy, and security model

- **Source of truth:** my **Google Drive**.
- **Local storage:** used as working/cache/offline queue; it should never silently replace Drive data.
- **Authentication:** Google OAuth (you’ll see a login/consent flow).
- **Access control:** only my Google account/Drive should be usable. (This is a personal tool; not multi-user.)

---

## Offline + sync expectations

- You can make changes offline; they will **queue and sync later**.
- Sync must be **conflict-safe** and designed to prevent silent data loss when switching devices.

### Conflict resolution (high-level policy)
- Every change should be timestamped.
- On sync, the system should resolve conflicts using a **“most recent change wins”** approach **per record / per field**, while preserving a recoverable history (e.g., backups/merge artifacts) so nothing important is lost.

> The precise algorithm and guarantees are defined in `docs/SPECS.md`.

---

## Browser support

- Primary: **Chrome / Edge**
- Best-effort compatibility elsewhere where reasonable.

---

## Third-party libraries

- Prefer **no third-party libraries**.
- Exceptions are allowed where a library is close to unavoidable (e.g., **PDF export**), but must be justified in `docs/DECISIONS.md`.

---

## Repo structure

- `index.html` — app shell/entry point (GitHub Pages root)
- `src/` — app JS/CSS modules
- `assets/` — icons/images/fonts
- `docs/` — product spec + decisions

> Use relative paths (e.g., `./src/...`) rather than absolute (`/src/...`) for GitHub Pages portability.

---

## How to run

### In the browser (the normal way)
Open the GitHub Pages URL once it’s enabled.

### Locally (dev)
You can open `index.html` directly, but some browser features behave better with a tiny local server.

- Python:
  - `python -m http.server 8000`
- Node:
  - `npx serve .`

Then visit:
- `http://localhost:8000`

---

## Documentation

- Product/spec: `docs/SPECS.md`
- Decisions log: `docs/DECISIONS.md`
- Contribution workflow: `CONTRIBUTING.md`

---

## Non-goals (explicit)

- Not multi-user
- Not trying to replicate existing tools (it may resemble them, but it’s built to fit my needs exactly)
- No custom backend / no server-side app (static hosting + Google Drive only)
