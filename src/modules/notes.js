import { generateId } from "./id.js";
import { buildPersonalStorageKey } from "./personal-keys.js";
import { createModalDismissGuard } from "./modal-dismiss-guard.js";
import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";

const WORK_NOTES_STORAGE_KEY = "second-brain.work.notes.work.v1";
const NOTES_COLLECTION_KEY = "notes";
const NOTES_SCHEMA_VERSION = 1;

/**
 * Renders a first-class notes workspace with search, filtering, and modal CRUD editing.
 */
export function renderNotesModule({ mode = "work", openComposer = false } = {}) {
  const state = {
    mode,
    query: "",
    dateFilter: "",
    includeArchived: false,
    editingId: "",
    // Supports app-level quick-create handoff from the floating action control.
    isEditorOpen: openComposer,
    feedback: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard tasks-module notes-module";

  const header = document.createElement("div");
  header.className = "meetings-header";

  const headingWrap = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = mode === "personal" ? "Personal Notes" : "Work Notes";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Capture quick thoughts, decisions, and reference text independently from projects and tasks.";
  headingWrap.append(title, intro);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "enter-mode-button";
  addButton.textContent = "New note";
  addButton.addEventListener("click", () => {
    state.editingId = "";
    state.isEditorOpen = true;
    renderModule();
  });

  header.append(headingWrap, addButton);

  const feedback = document.createElement("p");
  feedback.className = "feedback";

  const controls = document.createElement("div");
  controls.className = "people-controls";

  const list = document.createElement("div");
  list.className = "meetings-list";

  const modalHost = document.createElement("div");

  section.append(header, feedback, controls, list, modalHost);

  function renderModule() {
    const notes = loadNotes(state.mode);
    controls.innerHTML = "";

    const queryWrap = document.createElement("label");
    queryWrap.className = "field-label";
    queryWrap.textContent = "Search";

    const queryInput = document.createElement("input");
    queryInput.className = "field-input";
    queryInput.type = "search";
    queryInput.placeholder = "Find text in title or body";
    queryInput.value = state.query;
    queryInput.addEventListener("input", () => {
      state.query = queryInput.value;
      renderModule();
    });
    queryWrap.appendChild(queryInput);

    const dateWrap = document.createElement("label");
    dateWrap.className = "field-label";
    dateWrap.textContent = "Created/updated on";

    const dateInput = document.createElement("input");
    dateInput.className = "field-input";
    dateInput.type = "date";
    dateInput.value = state.dateFilter;
    dateInput.addEventListener("change", () => {
      state.dateFilter = dateInput.value;
      renderModule();
    });
    dateWrap.appendChild(dateInput);

    const archiveWrap = document.createElement("label");
    archiveWrap.className = "field-label";
    archiveWrap.textContent = "Include archived";

    const archiveToggle = document.createElement("input");
    archiveToggle.type = "checkbox";
    archiveToggle.checked = state.includeArchived;
    archiveToggle.addEventListener("change", () => {
      state.includeArchived = archiveToggle.checked;
      renderModule();
    });
    archiveWrap.appendChild(archiveToggle);

    controls.append(queryWrap, dateWrap, archiveWrap);

    const filtered = selectVisibleNotes(notes, {
      query: state.query,
      dateFilter: state.dateFilter,
      includeArchived: state.includeArchived
    });

    list.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        notes.length === 0
          ? "No notes added. Create your first note to capture ideas, decisions, or reminders."
          : "No notes match your filters. Try clearing search text/date filters.";
      list.appendChild(empty);
    } else {
      for (const note of filtered) {
        list.appendChild(
          createNoteCard(note, {
            onEdit: () => {
              state.editingId = note.id;
              state.isEditorOpen = true;
              renderModule();
            },
            onArchiveToggle: () => {
              setNoteArchived(state.mode, note.id, !note.archived);
              state.feedback = note.archived ? "Note restored." : "Note archived.";
              renderModule();
            }
          })
        );
      }
    }

    feedback.textContent = state.feedback;
    feedback.hidden = !state.feedback;

    modalHost.innerHTML = "";
    if (state.isEditorOpen) {
      const editingNote = notes.find((entry) => entry.id === state.editingId) || null;
      modalHost.append(
        createNoteForm({
          note: editingNote,
          onCancel: () => {
            state.editingId = "";
            state.isEditorOpen = false;
            renderModule();
          },
          onSave: (payload) => {
            const result = saveNote(state.mode, payload, state.editingId);
            if (!result.ok) {
              state.feedback = result.error;
              renderModule();
              return;
            }

            state.feedback = result.wasEdit ? "Note updated." : "Note created.";
            state.editingId = "";
            state.isEditorOpen = false;
            renderModule();
          }
        })
      );
    }
  }

  renderModule();
  return section;
}

/**
 * Loads notes per mode and applies migration-safe normalization defaults.
 */
export function loadNotes(mode) {
  const storageKey = resolveNoteStorageKey(mode);
  if (!storageKey) {
    return [];
  }

  return loadVersionedCollection({
    storageKey,
    collectionKey: NOTES_COLLECTION_KEY,
    schemaVersion: NOTES_SCHEMA_VERSION,
    normaliseItem: normaliseNote,
    fallback: []
  });
}

function persistNotes(mode, notes) {
  const storageKey = resolveNoteStorageKey(mode);
  if (!storageKey) {
    return false;
  }

  return persistVersionedCollection({
    storageKey,
    collectionKey: NOTES_COLLECTION_KEY,
    schemaVersion: NOTES_SCHEMA_VERSION,
    records: notes
  });
}

/**
 * Upserts a note record while maintaining immutable create timestamps.
 */
export function saveNote(mode, payload, editingId = "") {
  const body = String(payload?.body || "").trim();
  if (!body) {
    return { ok: false, error: "Note body is required." };
  }

  const notes = loadNotes(mode);
  const now = new Date().toISOString();
  const title = String(payload?.title || "").trim();

  if (editingId) {
    const noteIndex = notes.findIndex((note) => note.id === editingId);
    if (noteIndex < 0) {
      return { ok: false, error: "Note not found." };
    }

    const existing = notes[noteIndex];
    notes[noteIndex] = {
      ...existing,
      title,
      body,
      archived: Boolean(payload?.archived),
      updatedAt: now
    };

    persistNotes(mode, notes);
    return { ok: true, wasEdit: true, note: notes[noteIndex] };
  }

  const created = {
    id: buildNoteId(),
    title,
    body,
    createdAt: now,
    updatedAt: now,
    archived: Boolean(payload?.archived)
  };

  notes.unshift(created);
  persistNotes(mode, notes);
  return { ok: true, wasEdit: false, note: created };
}

/**
 * Sets the archived state for an existing note and updates its edit timestamp.
 */
export function setNoteArchived(mode, noteId, archived) {
  const notes = loadNotes(mode);
  const note = notes.find((entry) => entry.id === noteId);
  if (!note) {
    return { ok: false, error: "Note not found." };
  }

  note.archived = Boolean(archived);
  note.updatedAt = new Date().toISOString();
  persistNotes(mode, notes);
  return { ok: true };
}

/**
 * Normalises any legacy/incomplete payload to the notes schema.
 */
export function normaliseNote(note) {
  const now = new Date().toISOString();
  return {
    id: note?.id || buildNoteId(),
    title: String(note?.title || ""),
    body: String(note?.body || ""),
    createdAt: note?.createdAt || now,
    updatedAt: note?.updatedAt || note?.createdAt || now,
    archived: Boolean(note?.archived)
  };
}

function selectVisibleNotes(notes, { query, dateFilter, includeArchived }) {
  const search = query.trim().toLowerCase();

  return notes
    .filter((note) => (includeArchived ? true : !note.archived))
    .filter((note) => {
      if (!search) {
        return true;
      }
      return `${note.title}\n${note.body}`.toLowerCase().includes(search);
    })
    .filter((note) => {
      if (!dateFilter) {
        return true;
      }
      const createdDate = String(note.createdAt || "").slice(0, 10);
      const updatedDate = String(note.updatedAt || "").slice(0, 10);
      return createdDate === dateFilter || updatedDate === dateFilter;
    })
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

function createNoteCard(note, { onEdit, onArchiveToggle }) {
  const card = document.createElement("article");
  card.className = "person-card";

  const top = document.createElement("div");
  top.className = "person-row";

  const heading = document.createElement("h3");
  heading.textContent = note.title || "Untitled note";

  const actions = document.createElement("div");
  actions.className = "person-actions";
  actions.append(button("Edit", onEdit), button(note.archived ? "Restore" : "Archive", onArchiveToggle));

  top.append(heading, actions);

  const body = document.createElement("p");
  body.textContent = note.body;

  const meta = document.createElement("p");
  meta.className = "person-meta";
  meta.textContent = `Created ${formatDateTime(note.createdAt)} • Updated ${formatDateTime(note.updatedAt)}`;

  card.append(top, body, meta);
  return card;
}

function createNoteForm({ note, onSave, onCancel }) {
  const overlay = document.createElement("div");
  overlay.className = "meeting-modal-overlay";
  overlay.tabIndex = -1;

  const dismissGuard = createModalDismissGuard({ onClose: onCancel });
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

  const form = document.createElement("form");
  form.className = "meeting-modal meeting-form entity-editor-modal";

  const heading = document.createElement("h2");
  heading.textContent = note ? "Edit note" : "New note";

  const titleWrap = document.createElement("label");
  titleWrap.className = "field-label";
  titleWrap.textContent = "Title (optional)";
  const titleInput = document.createElement("input");
  titleInput.className = "field-input";
  titleInput.type = "text";
  titleInput.value = note?.title || "";
  titleWrap.appendChild(titleInput);

  const bodyWrap = document.createElement("label");
  bodyWrap.className = "field-label";
  bodyWrap.textContent = "Body";
  const bodyInput = document.createElement("textarea");
  bodyInput.className = "field-input field-textarea";
  bodyInput.required = true;
  bodyInput.rows = 10;
  bodyInput.value = note?.body || "";
  bodyWrap.appendChild(bodyInput);

  const actions = document.createElement("div");
  actions.className = "meeting-actions";
  actions.append(button(note ? "Save changes" : "Create note", null, "submit"), button("Cancel", requestClose));

  form.append(heading, titleWrap, bodyWrap, actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({ title: titleInput.value, body: bodyInput.value, archived: Boolean(note?.archived) });
  });

  dismissGuard.bindDirtyTracking(form);

  overlay.appendChild(form);
  return overlay;
}

function resolveNoteStorageKey(mode) {
  if (mode === "work") {
    return WORK_NOTES_STORAGE_KEY;
  }

  if (mode === "personal") {
    return buildPersonalStorageKey("notes", 1);
  }

  return "";
}

function buildNoteId() {
  return generateId("note_");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function button(label, onClick, type = "button") {
  const entry = document.createElement("button");
  entry.type = type;
  entry.className = "button button-secondary";
  entry.textContent = label;

  if (onClick) {
    entry.addEventListener("click", onClick);
  }

  return entry;
}
