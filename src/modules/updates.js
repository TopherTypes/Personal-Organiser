import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";

const UPDATES_SCHEMA_VERSION = 1;
const UPDATES_COLLECTION_KEY = "updates";
const WORK_UPDATES_STORAGE_KEY = "second-brain.work.updates.work.v1";

/**
 * Renders the work updates module and keeps data dependencies explicit.
 *
 * Data flow:
 * - `people` and `meetings` are read-only dependency snapshots supplied by dashboard wiring.
 * - Updates are persisted only through `saveUpdate` / `archiveUpdate` in this module.
 * - Storage remains mode-scoped and versioned so migration boundaries stay local.
 */
export function renderWorkUpdatesModule({ mode = "work", people = [], meetings = [] } = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard updates-module";

  const title = document.createElement("h1");
  title.textContent = "Work Updates";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Capture stakeholder update drafts with owner, due date, and meeting context while keeping storage isolated per mode.";

  const updates = loadUpdates(mode);
  const activeUpdates = updates.filter((update) => !update.archived);

  const summary = document.createElement("p");
  summary.className = "module-intro";
  summary.textContent = [
    `${activeUpdates.length} active update${activeUpdates.length === 1 ? "" : "s"}`,
    `${people.length} available people`,
    `${meetings.length} available meetings`
  ].join(" · ");

  const list = document.createElement("ul");
  list.className = "updates-list";

  if (activeUpdates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No active updates yet. Add one from the updates workflow.";
    section.append(title, intro, summary, empty);
    return section;
  }

  for (const update of activeUpdates) {
    const item = document.createElement("li");
    item.className = "updates-list-item";

    const ownerName = people.find((person) => person.id === update.ownerId)?.name || "No owner";
    const meetingName = meetings.find((meeting) => meeting.id === update.meetingId)?.name || "No linked meeting";

    item.textContent = `${update.text} · Owner: ${ownerName} · To update: ${update.toUpdate.length} · ${meetingName}`;
    list.appendChild(item);
  }

  section.append(title, intro, summary, list);
  return section;
}

/**
 * Loads mode-scoped updates from versioned local storage.
 */
export function loadUpdates(mode) {
  if (mode !== "work") {
    return [];
  }

  return loadVersionedCollection({
    storageKey: resolveUpdatesStorageKey(mode),
    collectionKey: UPDATES_COLLECTION_KEY,
    schemaVersion: UPDATES_SCHEMA_VERSION,
    normaliseItem: normaliseUpdate,
    fallback: []
  });
}

/**
 * Creates or updates an update record and appends an audit event.
 */
export function saveUpdate(mode, draft, editingId = "") {
  if (mode !== "work") {
    return { ok: false, error: "Updates are currently supported only in work mode." };
  }

  const normalisedDraft = normaliseUpdate(draft);
  if (!normalisedDraft.text) {
    return { ok: false, error: "Update text is required." };
  }
  if (!normalisedDraft.toUpdate.length) {
    return { ok: false, error: "At least one person to update is required." };
  }

  const now = new Date().toISOString();
  const updates = loadUpdates(mode);

  if (editingId) {
    const index = updates.findIndex((update) => update.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Update no longer exists." };
    }

    const current = updates[index];
    updates[index] = {
      ...current,
      ...normalisedDraft,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
      auditTrail: [...current.auditTrail, { at: now, action: "updated" }]
    };

    persistUpdates(mode, updates);
    return { ok: true, message: "Update saved." };
  }

  updates.push({
    ...normalisedDraft,
    id: buildId(),
    createdAt: now,
    updatedAt: now,
    auditTrail: [...normalisedDraft.auditTrail, { at: now, action: "created" }]
  });

  persistUpdates(mode, updates);
  return { ok: true, message: "Update created." };
}

/**
 * Archives/restores an update while retaining immutable history.
 */
export function archiveUpdate(mode, updateId, shouldArchive) {
  if (mode !== "work") {
    return;
  }

  const now = new Date().toISOString();
  const updates = loadUpdates(mode).map((update) => {
    if (update.id !== updateId) {
      return update;
    }

    return {
      ...update,
      archived: Boolean(shouldArchive),
      updatedAt: now,
      auditTrail: [...update.auditTrail, { at: now, action: shouldArchive ? "archived" : "restored" }]
    };
  });

  persistUpdates(mode, updates);
}

/**
 * Applies schema defaults and normalises nested `toUpdate` entries.
 */
export function normaliseUpdate(update) {
  const now = new Date().toISOString();
  const source = update && typeof update === "object" ? update : {};

  return {
    id: typeof source.id === "string" ? source.id : "",
    text: typeof source.text === "string" ? source.text.trim() : "",
    ownerId: typeof source.ownerId === "string" ? source.ownerId : "",
    toUpdate: normaliseToUpdateList(source.toUpdate),
    meetingId: typeof source.meetingId === "string" ? source.meetingId : "",
    dueDate: typeof source.dueDate === "string" ? source.dueDate : "",
    archived: Boolean(source.archived),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : now,
    auditTrail: Array.isArray(source.auditTrail) ? source.auditTrail : []
  };
}

function normaliseToUpdateList(toUpdate) {
  if (!Array.isArray(toUpdate)) {
    return [];
  }

  return toUpdate
    .map((entry) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed ? { personId: "", note: trimmed } : null;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const note = typeof entry.note === "string" ? entry.note.trim() : "";
      const personId = typeof entry.personId === "string" ? entry.personId : "";

      if (!note && !personId) {
        return null;
      }

      return {
        personId,
        note,
        status: typeof entry.status === "string" ? entry.status : "pending"
      };
    })
    .filter(Boolean);
}

function persistUpdates(mode, updates) {
  if (mode !== "work") {
    return;
  }

  persistVersionedCollection({
    storageKey: resolveUpdatesStorageKey(mode),
    collectionKey: UPDATES_COLLECTION_KEY,
    schemaVersion: UPDATES_SCHEMA_VERSION,
    records: updates
  });
}

function resolveUpdatesStorageKey(mode) {
  // Dedicated and explicitly versioned collection key required by feature spec.
  if (mode === "work") {
    return WORK_UPDATES_STORAGE_KEY;
  }

  return `second-brain.work.updates.${mode}.v${UPDATES_SCHEMA_VERSION}`;
}

function buildId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `upd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
