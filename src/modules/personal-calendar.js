import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";
import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";

/**
 * Personal calendar entries are stored under a versioned key to support safe future schema changes.
 *
 * The key is Personal-mode scoped so private schedule notes never collide with Work calendar data.
 */
const PERSONAL_CALENDAR_KEY = buildPersonalStorageKey("calendar", 1);
const PERSONAL_CALENDAR_COLLECTION_FIELD = "events";
const PERSONAL_CALENDAR_SCHEMA_VERSION = 1;
const RECURRENCE_FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const MAX_RECURRENCE_GENERATIONS_PER_LOAD = 24;

/**
 * Normalises calendar entries from both legacy array payloads and versioned envelopes.
 *
 * The normaliser enforces predictable string fields and injects safe defaults so rendering,
 * sorting, and update workflows keep working even when old or malformed payloads are loaded.
 */
function normaliseCalendarEvent(event) {
  const recurrenceMeta = normaliseRecurrenceMeta(event?.recurrenceMeta);

  return {
    id: typeof event?.id === "string" && event.id.trim() ? event.id : generateId("pcal_"),
    title: typeof event?.title === "string" ? event.title.trim() : "",
    date: typeof event?.date === "string" ? event.date : "",
    notes: typeof event?.notes === "string" ? event.notes : "",
    recurrenceMeta,
    updatedAt:
      typeof event?.updatedAt === "string" && event.updatedAt.trim()
        ? event.updatedAt
        : new Date().toISOString()
  };
}

/**
 * Lightweight personal calendar module (meeting-like log) aligned to spec 10.3.
 */
export function renderPersonalCalendarModule({ focusCreateForm = false } = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Calendar";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Capture personal calendar notes as a simplified meeting-style log with isolated Personal storage.";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const name = buildInput("Title", "text", true);
  const date = buildInput("Date", "date", true);
  const notes = document.createElement("textarea");
  notes.className = "field-input field-textarea";

  const notesWrap = document.createElement("label");
  notesWrap.className = "field-label";
  notesWrap.textContent = "Notes";
  notesWrap.appendChild(notes);

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "enter-mode-button";
  save.textContent = "Save event";

  const list = document.createElement("div");

  const recurrenceWrap = document.createElement("label");
  recurrenceWrap.className = "field-label";
  recurrenceWrap.textContent = "Recurrence";
  const recurrence = document.createElement("select");
  recurrence.className = "field-input";
  RECURRENCE_FREQUENCIES.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.slice(0, 1).toUpperCase() + value.slice(1);
    recurrence.appendChild(option);
  });
  recurrenceWrap.appendChild(recurrence);

  const recurrenceInterval = buildInput("Recurrence interval", "number", false);
  recurrenceInterval.input.min = "1";
  recurrenceInterval.input.step = "1";
  recurrenceInterval.input.value = "1";

  form.append(name.wrap, date.wrap, recurrenceWrap, recurrenceInterval.wrap, notesWrap, save);
  if (focusCreateForm) {
    // Autofocus aligns floating quick action intent with the first editable field.
    window.requestAnimationFrame(() => name.input.focus());
  }


  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const events = loadEvents();
    // Append to the loaded snapshot and persist once so each submit produces one atomic collection write.
    events.push({
      id: generateId("pcal_"),
      title: name.input.value.trim(),
      date: date.input.value,
      recurrenceMeta: buildRecurrenceMeta(recurrence.value, recurrenceInterval.input.value),
      notes: notes.value.trim(),
      // Timestamp is persisted so cross-device sync can resolve stale writes more accurately later.
      updatedAt: new Date().toISOString()
    });
    persistEvents(events);
    form.reset();
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    // Chronological sort keeps planning scans consistent regardless of insertion order.
    const events = loadEvents().sort((a, b) => a.date.localeCompare(b.date));
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No calendar entries yet.";
      list.appendChild(empty);
      return;
    }

    events.forEach((entry) => {
      const row = document.createElement("article");
      row.className = "meeting-row";

      // Use textContent for persisted user input so literal text is rendered without HTML/script injection.
      const summary = document.createElement("strong");
      summary.textContent = `${entry.date} · ${entry.title}`;

      const details = document.createElement("p");
      const recurrenceLabel = entry.recurrenceMeta
        ? `${entry.recurrenceMeta.frequency} every ${entry.recurrenceMeta.interval}`
        : "none";
      details.textContent = `${entry.notes || "No notes"} · Recurs: ${recurrenceLabel}`;

      const controls = document.createElement("div");
      controls.className = "row-controls";

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary-button";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => {
        const updated = collectEditedEventValues(entry);
        if (!updated) {
          return;
        }

        updateEventById(entry.id, {
          ...updated,
          // Every mutation updates the merge timestamp to help future sync conflict resolution.
          updatedAt: new Date().toISOString()
        });
        renderList();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "secondary-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        const confirmed = window.confirm(
          `Delete \"${entry.title}\" on ${entry.date}? This cannot be undone.`
        );

        if (!confirmed) {
          return;
        }

        deleteEventById(entry.id);
        renderList();
      });

      controls.append(editButton, deleteButton);
      row.append(summary, details, controls);
      list.appendChild(row);
    });
  }

  section.append(title, intro, form, list);
  renderList();
  return section;
}

/**
 * Loads calendar entries defensively and returns an empty array when localStorage contains
 * no value, malformed JSON, or a non-array payload.
 */
function loadEvents() {
  const events = loadVersionedCollection({
    storageKey: PERSONAL_CALENDAR_KEY,
    collectionKey: PERSONAL_CALENDAR_COLLECTION_FIELD,
    schemaVersion: PERSONAL_CALENDAR_SCHEMA_VERSION,
    normaliseItem: normaliseCalendarEvent,
    fallback: []
  });

  const withGeneratedRecurring = generateRecurringEvents(events);
  if (withGeneratedRecurring.length !== events.length) {
    persistEvents(withGeneratedRecurring);
  }

  return withGeneratedRecurring;
}

/**
 * Exposes personal calendar events for cross-module aggregation views.
 */
export function loadPersonalCalendarEvents() {
  return loadEvents();
}

/**
 * Persists the complete event collection as JSON; malformed JSON fallback is handled by loadEvents
 * for corrupted or externally written payloads.
 */
function persistEvents(events) {
  persistVersionedCollection({
    storageKey: PERSONAL_CALENDAR_KEY,
    collectionKey: PERSONAL_CALENDAR_COLLECTION_FIELD,
    schemaVersion: PERSONAL_CALENDAR_SCHEMA_VERSION,
    records: events.map(normaliseCalendarEvent)
  });
}

/**
 * Updates a single calendar entry by stable ID so accidental positional edits cannot corrupt data.
 */
function updateEventById(eventId, nextValues) {
  const events = loadEvents();
  const index = events.findIndex((event) => event.id === eventId);
  if (index === -1) {
    return;
  }

  events[index] = {
    ...events[index],
    ...nextValues
  };
  persistEvents(events);
}

/**
 * Removes an entry by ID and persists the remaining collection in one write.
 */
function deleteEventById(eventId) {
  const nextEvents = loadEvents().filter((event) => event.id !== eventId);
  persistEvents(nextEvents);
}

/**
 * Uses lightweight prompts to edit all mutable fields while preserving cancellation semantics.
 */
function collectEditedEventValues(entry) {
  const titleInput = window.prompt("Edit title", entry.title);
  if (titleInput === null) {
    return null;
  }

  const dateInput = window.prompt("Edit date (YYYY-MM-DD)", entry.date);
  if (dateInput === null) {
    return null;
  }

  const notesInput = window.prompt("Edit notes", entry.notes || "");
  if (notesInput === null) {
    return null;
  }

  const trimmedTitle = titleInput.trim();
  const trimmedDate = dateInput.trim();
  if (!trimmedTitle || !trimmedDate) {
    window.alert("Title and date are required to save calendar updates.");
    return null;
  }

  return {
    title: trimmedTitle,
    date: trimmedDate,
    notes: notesInput.trim()
  };
}

function buildInput(labelText, type, required) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.className = "field-input";
  input.required = required;
  wrap.appendChild(input);
  return { wrap, input };
}

function normaliseRecurrenceMeta(recurrenceMeta) {
  if (!recurrenceMeta || typeof recurrenceMeta !== "object") {
    return null;
  }

  if (!RECURRENCE_FREQUENCIES.includes(recurrenceMeta.frequency) || recurrenceMeta.frequency === "none") {
    return null;
  }

  return {
    frequency: recurrenceMeta.frequency,
    interval: Math.max(1, Number.parseInt(String(recurrenceMeta.interval || "1"), 10) || 1),
    parentRecurrenceId:
      typeof recurrenceMeta.parentRecurrenceId === "string" && recurrenceMeta.parentRecurrenceId.trim()
        ? recurrenceMeta.parentRecurrenceId
        : generateId("pcal_")
  };
}

function buildRecurrenceMeta(frequency, intervalValue, previousMeta = null) {
  if (!RECURRENCE_FREQUENCIES.includes(frequency) || frequency === "none") {
    return null;
  }

  return {
    frequency,
    interval: Math.max(1, Number.parseInt(String(intervalValue || "1"), 10) || 1),
    parentRecurrenceId: previousMeta?.parentRecurrenceId || generateId("pcal_")
  };
}

function generateRecurringEvents(events) {
  const generated = [...events];
  const today = new Date().toISOString().slice(0, 10);
  const seenSeriesDates = new Set(
    generated
      .filter((event) => event.recurrenceMeta?.parentRecurrenceId && event.date)
      .map((event) => `${event.recurrenceMeta.parentRecurrenceId}:${event.date}`)
  );

  const latestBySeries = new Map();
  for (const event of generated) {
    const seriesId = event.recurrenceMeta?.parentRecurrenceId;
    if (!seriesId || !event.date) {
      continue;
    }
    const latest = latestBySeries.get(seriesId);
    if (!latest || event.date > latest.date) {
      latestBySeries.set(seriesId, event);
    }
  }

  for (const latest of latestBySeries.values()) {
    let candidate = latest;
    let guard = 0;
    while (candidate.date < today && guard < MAX_RECURRENCE_GENERATIONS_PER_LOAD) {
      const nextDate = shiftDateByRecurrence(candidate.date, candidate.recurrenceMeta.frequency, candidate.recurrenceMeta.interval);
      if (!nextDate) {
        break;
      }
      const key = `${candidate.recurrenceMeta.parentRecurrenceId}:${nextDate}`;
      if (seenSeriesDates.has(key)) {
        break;
      }

      const nextEvent = normaliseCalendarEvent({
        ...candidate,
        id: generateId("pcal_"),
        date: nextDate,
        updatedAt: new Date().toISOString()
      });

      generated.push(nextEvent);
      seenSeriesDates.add(key);
      candidate = nextEvent;
      guard += 1;
    }
  }

  return generated;
}

function shiftDateByRecurrence(isoDate, frequency, interval) {
  const value = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  if (frequency === "daily") {
    value.setDate(value.getDate() + interval);
  } else if (frequency === "weekly") {
    value.setDate(value.getDate() + interval * 7);
  } else if (frequency === "monthly") {
    value.setMonth(value.getMonth() + interval);
  } else {
    return "";
  }

  return value.toISOString().slice(0, 10);
}
