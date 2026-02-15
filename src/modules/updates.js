import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";
import { buildEntityTokenMultiSelectField, readEntityTokenHiddenValues } from "./select-controls.js";
import { generateId } from "./id.js";
import { createModalDismissGuard } from "./modal-dismiss-guard.js";

const UPDATES_SCHEMA_VERSION = 1;
const UPDATES_COLLECTION_KEY = "updates";
const WORK_UPDATES_STORAGE_KEY = "second-brain.work.updates.work.v1";
const UPDATE_ENTITY_TYPES = {
  UPDATE: "update",
  ACTION: "action"
};
const ACTION_OWNER_ME = "me";
const PENDING_COUNT_BANDS = {
  low: 1,
  high: 3
};

/**
 * Renders the work updates module and keeps data dependencies explicit.
 *
 * Data flow:
 * - `people` and `meetings` are read-only dependency snapshots supplied by dashboard wiring.
 * - Updates are persisted only through `saveUpdate` / `archiveUpdate` in this module.
 * - Storage remains mode-scoped and versioned so migration boundaries stay local.
 */
export function renderWorkUpdatesModule({ mode = "work", people = [], meetings = [], focusCreateForm = false } = {}) {
  const state = {
    // Opening in create mode preserves keyboard shortcut behaviour from the old inline form.
    modalMode: focusCreateForm ? "create" : "",
    editingId: "",
    feedback: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard updates-module";

  const renderModule = () => {
    section.innerHTML = "";

    const header = document.createElement("div");
    header.className = "meetings-header";

    const title = document.createElement("h1");
    title.textContent = "Work Updates";

    const newUpdateButton = document.createElement("button");
    newUpdateButton.type = "button";
    newUpdateButton.className = "enter-mode-button";
    newUpdateButton.textContent = "New update";
    newUpdateButton.addEventListener("click", () => {
      state.modalMode = "create";
      state.editingId = "";
      renderModule();
    });
    header.append(title, newUpdateButton);

    const intro = document.createElement("p");
    intro.className = "module-intro";
    intro.textContent =
      "Capture meeting follow-ups as either updates or actions with owner/due-date controls and meeting context.";

    const updates = loadUpdates(mode);
    const activeUpdates = updates.filter((update) => !update.archived);
    const activePeople = selectActivePeople(people);

    const summary = document.createElement("p");
    summary.className = "module-intro";
    summary.textContent = [
      `${activeUpdates.length} active update${activeUpdates.length === 1 ? "" : "s"}`,
      `${people.length} available people`,
      `${meetings.length} available meetings`
    ].join(" · ");

    const tableWrap = document.createElement("div");
    tableWrap.className = "updates-table-wrap card";

    const table = document.createElement("table");
    table.className = "updates-table";

    const headerRow = document.createElement("tr");
    ["Type", "Update", "Owner", "Meeting", "Due date", "Pending", "Updated", "Actions"].forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.appendChild(cell);
    });

    const head = document.createElement("thead");
    head.appendChild(headerRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    if (!activeUpdates.length) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 8;
      emptyCell.className = "empty-state";
      emptyCell.textContent = "No active updates yet. Add one from the updates workflow.";
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
    }

    for (const update of activeUpdates) {
      const row = document.createElement("tr");
      const dueDateState = getUpdateDueDateState(update.dueDate);
      const pendingCount = selectPendingPeopleCount(update);
      const pendingLoadState = getPendingLoadState(pendingCount);
      // Preserve type semantics while exposing due/pending hooks for richer row highlighting.
      row.className = [
        "updates-row",
        `updates-row-type-${update.entityType === UPDATE_ENTITY_TYPES.ACTION ? "action" : "update"}`,
        `updates-row-due-${dueDateState}`,
        `updates-row-pending-${pendingLoadState}`
      ].join(" ");

      const typeCell = document.createElement("td");
      typeCell.appendChild(buildUpdateTypePill(update.entityType));

      const textCell = document.createElement("td");
      textCell.textContent = update.text;

      const ownerCell = document.createElement("td");
      ownerCell.textContent = resolveOwnerDisplayName(update, people);

      const meetingCell = document.createElement("td");
      meetingCell.textContent = meetings.find((meeting) => meeting.id === update.meetingId)?.name || "No linked meeting";

      const dueDateCell = document.createElement("td");
      dueDateCell.className = `updates-due-date-cell updates-due-date-${dueDateState}`;
      dueDateCell.textContent = update.dueDate || "Not set";

      const pendingCell = document.createElement("td");
      pendingCell.className = `updates-pending-cell updates-pending-${pendingLoadState}`;
      pendingCell.textContent = String(pendingCount);

      const completedCell = document.createElement("td");
      completedCell.textContent = String(selectCompletedPeopleCount(update));

      const actionCell = document.createElement("td");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "module-button-secondary";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => {
        state.editingId = update.id;
        state.modalMode = "edit";
        renderModule();
      });
      actionCell.appendChild(editButton);

      row.append(typeCell, textCell, ownerCell, meetingCell, dueDateCell, pendingCell, completedCell, actionCell);
      body.appendChild(row);
    }

    table.appendChild(body);
    tableWrap.appendChild(table);

    if (state.feedback) {
      const feedback = document.createElement("p");
      feedback.className = "feedback";
      feedback.textContent = state.feedback;
      section.appendChild(feedback);
      state.feedback = "";
    }

    section.append(header, intro, summary, tableWrap);

    if (state.modalMode) {
      const editing = updates.find((update) => update.id === state.editingId);
      section.appendChild(
        renderUpdateEditor({
          update: state.modalMode === "edit" ? editing : null,
          focusTextInput: state.modalMode === "create",
          people,
          meetings,
          onClose: () => {
            state.modalMode = "";
            state.editingId = "";
            renderModule();
          },
          onSave: (draft, editingId) => {
            const result = saveUpdate(mode, draft, editingId, activePeople);
            if (!result.ok) {
              state.feedback = result.error || "Unable to save update.";
              renderModule();
              return;
            }

            state.feedback = editingId ? "Update saved." : "Update created.";
            state.modalMode = "";
            state.editingId = "";
            renderModule();
          }
        })
      );
    }
  };

  renderModule();
  return section;
}

function renderUpdateEditor({ update, people, meetings, onClose, onSave, focusTextInput = false }) {
  const overlay = document.createElement("div");
  overlay.className = "meeting-modal-overlay";
  overlay.tabIndex = -1;

  const dismissGuard = createModalDismissGuard({ onClose });
  const requestClose = () => dismissGuard.requestClose();

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      requestClose();
    }
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
    }
  });

  const panel = document.createElement("section");
  panel.className = "meeting-modal entity-editor-modal";

  const isEditMode = Boolean(update);
  const heading = document.createElement("h2");
  heading.textContent = isEditMode ? "Edit update" : "New update";

  // Edit mode can receive a stale ID if the row was removed before the modal rendered.
  // Keep this fallback explicit so dismissal behaviour remains predictable.
  if (!isEditMode && update !== null) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "The selected update could not be found. It may have been deleted.";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "module-button-secondary";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", requestClose);

    panel.append(heading, message, closeButton);
    overlay.appendChild(panel);
    return overlay;
  }

  const activePeople = selectActivePeople(people);
  const seed = update || {
    text: "",
    entityType: UPDATE_ENTITY_TYPES.UPDATE,
    ownerId: "",
    meetingId: "",
    dueDate: "",
    toUpdate: []
  };

  const form = document.createElement("form");
  form.className = "updates-editor-form";

  const textLabel = document.createElement("label");
  textLabel.className = "field-label";
  textLabel.textContent = "Update";
  const textInput = document.createElement("textarea");
  textInput.className = "field-input field-textarea";
  // Clearing text during edit is interpreted as a quiet delete in `saveUpdate`.
  textInput.required = false;
  textInput.value = seed.text;
  textLabel.appendChild(textInput);

  const entityTypeLabel = document.createElement("label");
  entityTypeLabel.className = "field-label";
  entityTypeLabel.textContent = "Entity type";
  const entityTypeSelect = document.createElement("select");
  entityTypeSelect.className = "field-input";
  addOption(entityTypeSelect, UPDATE_ENTITY_TYPES.UPDATE, "Update");
  addOption(entityTypeSelect, UPDATE_ENTITY_TYPES.ACTION, "Action");
  entityTypeSelect.value = seed.entityType;
  entityTypeLabel.appendChild(entityTypeSelect);

  const toUpdateField = buildEntityTokenMultiSelectField({
    label: "People to update",
    options: activePeople.map((person) => ({ value: person.id, label: person.name || person.id })),
    values: normaliseToUpdateList(seed.toUpdate)
      .map((entry) => entry.personId)
      .filter(Boolean),
    emptyMessage: "Add people first to select update recipients.",
    inputPlaceholder: "Search people to update"
  });

  const ownerLabel = document.createElement("label");
  ownerLabel.className = "field-label";
  ownerLabel.textContent = "Owner (required for actions)";
  const ownerSelect = document.createElement("select");
  ownerSelect.className = "field-input";
  for (const option of buildUpdateOwnerOptions(activePeople)) {
    addOption(ownerSelect, option.value, option.label);
  }
  ownerSelect.value = seed.ownerId;
  ownerLabel.appendChild(ownerSelect);

  const meetingLabel = document.createElement("label");
  meetingLabel.className = "field-label";
  meetingLabel.textContent = "Linked meeting (optional)";
  const meetingSelect = document.createElement("select");
  meetingSelect.className = "field-input";
  addOption(meetingSelect, "", "No linked meeting");
  meetings.filter((meeting) => !meeting.archived).forEach((meeting) => addOption(meetingSelect, meeting.id, meeting.name));
  if (Array.from(meetingSelect.options).some((option) => option.value === seed.meetingId)) {
    meetingSelect.value = seed.meetingId;
  }
  meetingLabel.appendChild(meetingSelect);

  const dueDateLabel = document.createElement("label");
  dueDateLabel.className = "field-label";
  dueDateLabel.textContent = "Due date (required for actions)";
  const dueDateInput = document.createElement("input");
  dueDateInput.type = "date";
  dueDateInput.className = "field-input";
  dueDateInput.value = seed.dueDate;
  dueDateLabel.appendChild(dueDateInput);

  // Create and edit share the same save path, so action-specific requirements
  // are toggled from one helper to avoid workflow drift.
  const syncEditorRequirements = () => {
    const isAction = entityTypeSelect.value === UPDATE_ENTITY_TYPES.ACTION;
    ownerSelect.required = isAction;
    dueDateInput.required = isAction;
    if (!isAction) {
      dueDateInput.value = "";
    }
  };
  entityTypeSelect.addEventListener("change", syncEditorRequirements);
  syncEditorRequirements();

  const actions = document.createElement("div");
  actions.className = "tasks-row-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "module-button-secondary";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", requestClose);

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "enter-mode-button";
  saveButton.textContent = isEditMode ? "Save update" : "Create update";

  actions.append(cancelButton, saveButton);
  form.append(entityTypeLabel, textLabel, toUpdateField.wrapper, ownerLabel, meetingLabel, dueDateLabel, actions);

  // Always submit normalised recipient records so persistence retains canonical shape.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selectedIds = readEntityTokenHiddenValues(toUpdateField.hiddenInput);
    onSave(
      {
        text: textInput.value,
        entityType: entityTypeSelect.value,
        ownerId: ownerSelect.value,
        meetingId: meetingSelect.value,
        dueDate: dueDateInput.value,
        toUpdate: selectedIds.map((id) => ({ personId: id, status: "pending", required: true, updatedAt: "" }))
      },
      isEditMode ? seed.id : ""
    );
  });

  // Dirty tracking ensures backdrop/cancel/Escape all enforce the same confirmation flow.
  dismissGuard.bindDirtyTracking(form);

  panel.append(heading, form);
  overlay.appendChild(panel);

  if (focusTextInput) {
    window.requestAnimationFrame(() => {
      textInput.focus();
    });
  }

  return overlay;
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
export function saveUpdate(mode, draft, editingId = "", people = null) {
  if (mode !== "work") {
    return { ok: false, error: "Updates are currently supported only in work mode." };
  }

  const normalisedDraft = normaliseUpdate(draft);
  const isAction = normalisedDraft.entityType === UPDATE_ENTITY_TYPES.ACTION;

  // Quiet-delete semantics:
  // - Editing with empty text removes the existing record.
  // - Creating with empty text no-ops so accidental blank submits do not create noise.
  if (!normalisedDraft.text) {
    if (editingId) {
      const updates = loadUpdates(mode);
      const next = updates.filter((update) => update.id !== editingId);
      if (next.length === updates.length) {
        return { ok: false, error: "Update no longer exists." };
      }
      persistUpdates(mode, next);
      return { ok: true, message: "Update deleted." };
    }

    return { ok: true, message: "Skipped empty update." };
  }

  // Recipient requirements:
  // - Updates are communication items and require at least one recipient.
  // - Actions represent owned work and can exist without recipients.
  if (!isAction && !normalisedDraft.toUpdate.length) {
    return { ok: false, error: "At least one person to update is required for update items." };
  }

  if (isAction && !normalisedDraft.ownerId) {
    return { ok: false, error: "Actions require an owner." };
  }
  if (isAction && !normalisedDraft.dueDate) {
    return { ok: false, error: "Actions require a due date." };
  }

  // Referential integrity: `ownerId` is a soft foreign key to People.
  // We allow empty owner values for updates, but actions must have either an active person or "Me".
  if (Array.isArray(people)) {
    const validOwnerIds = new Set(
      people
        .filter((person) => person && !person.archived && typeof person.id === "string")
        .map((person) => person.id)
    );
    if (normalisedDraft.ownerId && normalisedDraft.ownerId !== ACTION_OWNER_ME && !validOwnerIds.has(normalisedDraft.ownerId)) {
      return { ok: false, error: "Selected owner no longer exists in active people." };
    }
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
 * Returns active people with stable, string-backed IDs.
 *
 * Keeping this helper centralised avoids per-screen filtering drift that could let
 * stale/deleted IDs slip into ownership references.
 */
export function selectActivePeople(people = []) {
  if (!Array.isArray(people)) {
    return [];
  }

  return people.filter(
    (person) => person && !person.archived && typeof person.id === "string" && person.id.trim()
  );
}

/**
 * Builds update-owner select options with an explicit optional default.
 *
 * Reusing this across modules keeps referential integrity behaviour consistent
 * and prevents free-typed IDs from being accepted in one workflow but rejected in another.
 */
export function buildUpdateOwnerOptions(people = []) {
  const activePeople = selectActivePeople(people);
  return [
    { value: "", label: "No owner" },
    { value: ACTION_OWNER_ME, label: "Me (create linked task)" },
    ...activePeople.map((person) => ({ value: person.id, label: person.name || person.id }))
  ];
}

function resolveOwnerDisplayName(update, people) {
  if (!update.ownerId) {
    return "No owner";
  }
  if (update.ownerId === ACTION_OWNER_ME) {
    return "Me";
  }

  const owner = people.find((person) => person.id === update.ownerId);
  if (!owner) {
    return "Unknown (archived/deleted)";
  }

  return owner.name || update.ownerId;
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

/**
 * Shared visual token for update/action type labels.
 */
function buildUpdateTypePill(entityType) {
  const pill = document.createElement("span");
  const isAction = entityType === UPDATE_ENTITY_TYPES.ACTION;
  pill.className = `update-type-pill ${isAction ? "is-action" : "is-update"}`;
  pill.textContent = isAction ? "Action" : "Update";
  return pill;
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
 * Buckets update due dates for urgency styling in table cells and row-level hooks.
 */
function getUpdateDueDateState(dueDate) {
  const dueTime = parseUpdateDateToMidnight(dueDate);
  if (!dueTime) {
    return "no-due-date";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();
  if (dueTime < todayTime) {
    return "overdue";
  }

  if (dueTime === todayTime) {
    return "due-today";
  }

  return "upcoming";
}

/**
 * Converts a pending recipient count into visual load bands.
 */
function getPendingLoadState(pendingCount) {
  if (pendingCount <= 0) {
    return "zero";
  }

  if (pendingCount >= PENDING_COUNT_BANDS.high) {
    return "high";
  }

  if (pendingCount >= PENDING_COUNT_BANDS.low) {
    return "low";
  }

  return "zero";
}

/**
 * Parses yyyy-mm-dd update dates into local-midnight timestamps for day-level comparisons.
 */
function parseUpdateDateToMidnight(dateValue) {
  if (!dateValue) {
    return null;
  }

  const [yearValue, monthValue, dayValue] = String(dateValue).split("-").map((segment) => Number(segment));
  if (![yearValue, monthValue, dayValue].every((segment) => Number.isInteger(segment))) {
    return null;
  }

  const parsedDate = new Date(yearValue, monthValue - 1, dayValue);
  parsedDate.setHours(0, 0, 0, 0);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.getTime();
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
    entityType: source.entityType === UPDATE_ENTITY_TYPES.ACTION ? UPDATE_ENTITY_TYPES.ACTION : UPDATE_ENTITY_TYPES.UPDATE,
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
  // - Oldest payloads stored `toUpdate` as plain id arrays (`["person-1", "person-2"]`).
  // - Transitional payloads from free-text forms stored note-only rows
  //   (`[{ personId: "", note: "Team Alpha" }]`) without canonical ids.
  //
  // We normalise both legacy shapes into the same structured recipient list so selectors,
  // counters, and persistence always operate on one stable schema. Note-only rows are
  // intentionally retained (when non-empty) to remain migration-safe for existing notes.
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
  // Keep `upd-` prefix for quick diagnostics while delegating UUID/fallback logic to shared helper.
  return generateId("upd-");
}
