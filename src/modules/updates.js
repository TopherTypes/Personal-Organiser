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

    const pendingCount = selectPendingPeopleCount(update);
    const completedCount = selectCompletedPeopleCount(update);

    item.textContent = `${update.text} · Owner: ${ownerName} · Pending: ${pendingCount} · Updated: ${completedCount} · ${meetingName}`;
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
 * Marks one person as updated for a given update id.
 *
 * `toUpdate` tracks per-person state rather than a single update-level flag because
 * one update can fan out to multiple recipients that complete asynchronously.
 */
export function markPersonUpdated(updateId, personId, at = new Date().toISOString()) {
  updatePersonStatus("work", updateId, personId, "updated", at);
}

/**
 * Optionally un-toggles a person back to pending.
 */
export function markPersonPending(updateId, personId) {
  updatePersonStatus("work", updateId, personId, "pending", "");
}

/**
 * Selector for how many recipients still need the update.
 */
export function selectPendingPeopleCount(update) {
  return normaliseToUpdateList(update?.toUpdate).filter((entry) => entry.status === "pending").length;
}

/**
 * Selector for how many recipients were already updated.
 */
export function selectCompletedPeopleCount(update) {
  return normaliseToUpdateList(update?.toUpdate).filter((entry) => entry.status === "updated").length;
}

/**
 * Selects update rows that involve one specific person.
 *
 * Reuse guidance:
 * - Keep this selector as the single source of truth for person-centric filtering
 *   so list views, meeting prefill flows, and reminders do not drift in behaviour.
 * - By default, this returns only pending rows from non-archived updates because
 *   most UX surfaces focus on actionable items.
 * - Set `includeCompleted` when a screen needs historical visibility.
 */
export function selectUpdatesForPerson(updates, personId, { includeCompleted = false, includeArchived = false } = {}) {
  if (!personId || !Array.isArray(updates)) {
    return [];
  }

  return updates.flatMap((update) => {
    if (!includeArchived && update?.archived) {
      return [];
    }

    const matchingEntries = normaliseToUpdateList(update?.toUpdate)
      .filter((entry) => entry.personId === personId)
      .filter((entry) => (includeCompleted ? true : entry.status === "pending"));

    return matchingEntries.map((entry) => ({
      update,
      entry,
    }));
  });
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

  // Schema migration note:
  // legacy records stored `toUpdate` as an array of person ids (`["person-1", "person-2"]`).
  // These are normalised into pending recipient entries so sync/merge code sees a stable shape.
  return toUpdate
    .map((entry) => {
      if (typeof entry === "string") {
        const personId = entry.trim();
        return personId
          ? {
              personId,
              required: true,
              status: "pending",
              updatedAt: ""
            }
          : null;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const personId = typeof entry.personId === "string" ? entry.personId : "";
      const note = typeof entry.note === "string" ? entry.note.trim() : "";
      const required = typeof entry.required === "boolean" ? entry.required : true;
      const status = entry.status === "updated" ? "updated" : "pending";
      const updatedAt = status === "updated" ? ensureIsoTimestamp(entry.updatedAt) : "";

      if (!personId && !note) {
        return null;
      }

      return {
        personId,
        required,
        status,
        updatedAt,
        note,
      };
    })
    .filter(Boolean);
}

function updatePersonStatus(mode, updateId, personId, status, at) {
  if (mode !== "work" || !updateId || !personId) {
    return;
  }

  const updates = loadUpdates(mode).map((update) => {
    if (update.id !== updateId) {
      return update;
    }

    const now = new Date().toISOString();
    const targetAt = status === "updated" ? ensureIsoTimestamp(at, now) : "";
    const entries = normaliseToUpdateList(update.toUpdate);
    const existingIndex = entries.findIndex((entry) => entry.personId === personId);

    if (existingIndex >= 0) {
      const current = entries[existingIndex];
      entries[existingIndex] = {
        ...current,
        status,
        updatedAt: targetAt,
      };
    } else {
      entries.push({
        personId,
        required: true,
        status,
        updatedAt: targetAt,
      });
    }

    return {
      ...update,
      toUpdate: entries,
      updatedAt: now,
      auditTrail: [...update.auditTrail, { at: now, action: status === "updated" ? "person-updated" : "person-pending", personId }]
    };
  });

  persistUpdates(mode, updates);
}

function ensureIsoTimestamp(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  // Canonical ISO output keeps timestamps deterministic during sync/merge.
  return parsed.toISOString();
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
