import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";
import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";

/**
 * Personal modules use versioned localStorage keys so schema upgrades can roll forward safely.
 *
 * Tasks stay in a Personal-only namespace to prevent accidental overlap with Work planning data
 * and to keep sync/import behavior mode-scoped.
 */
const PERSONAL_TASKS_KEY = buildPersonalStorageKey("tasks", 1);
const PERSONAL_TASKS_COLLECTION_FIELD = "tasks";
const PERSONAL_TASKS_SCHEMA_VERSION = 1;
const TASK_STATUSES = ["Backlog", "Ready", "In Progress", "Done", "Cancelled"];
const RECURRENCE_FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const MAX_RECURRENCE_GENERATIONS_PER_LOAD = 24;

/**
 * Normalises a task payload from either legacy-array records or versioned envelopes.
 *
 * This keeps load behavior stable across schema revisions by validating expected field shapes,
 * adding safe defaults, and constraining statuses to the supported enum.
 */
function normalisePersonalTask(task) {
  const resolvedStatus = TASK_STATUSES.includes(task?.status) ? task.status : TASK_STATUSES[0];

  const recurrenceMeta = normaliseRecurrenceMeta(task?.recurrenceMeta);

  return {
    id: typeof task?.id === "string" && task.id.trim() ? task.id : generateId("ptask_"),
    title: typeof task?.title === "string" ? task.title.trim() : "",
    dueDate: typeof task?.dueDate === "string" ? task.dueDate : "",
    status: resolvedStatus,
    recurrenceMeta: recurrenceMeta || null,
    createdAt:
      typeof task?.createdAt === "string" && task.createdAt.trim()
        ? task.createdAt
        : new Date().toISOString(),
    updatedAt: typeof task?.updatedAt === "string" ? task.updatedAt : undefined
  };
}

/**
 * Renders the Personal Tasks module (spec 5.2) with lightweight CRUD support.
 */
export function renderPersonalTasksModule() {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Tasks";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Track personal tasks with clear status and optional due dates without mixing Work data.";

  const list = document.createElement("div");
  list.className = "entity-scroll-list tasks-list";
  const form = document.createElement("form");
  form.className = "meeting-form";

  const taskInput = buildInput("Task title", "text", true);
  const dueInput = buildInput("Due date", "date", false);

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

  const recurrenceIntervalInput = buildInput("Recurrence interval", "number", false);
  recurrenceIntervalInput.input.min = "1";
  recurrenceIntervalInput.input.step = "1";
  recurrenceIntervalInput.input.value = "1";

  const statusWrap = document.createElement("label");
  statusWrap.className = "field-label";
  statusWrap.textContent = "Status";
  const status = document.createElement("select");
  status.className = "field-input";
  TASK_STATUSES.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    status.appendChild(option);
  });
  statusWrap.appendChild(status);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "enter-mode-button";
  submit.textContent = "Add task";

  form.append(taskInput.wrap, dueInput.wrap, statusWrap, recurrenceWrap, recurrenceIntervalInput.wrap, submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // Reuse the same due-date ordering used by render so newly added items land in stable priority order.
    const tasks = loadPersonalTasks().sort((first, second) => {
      const firstDue = first.dueDate || "9999-12-31";
      const secondDue = second.dueDate || "9999-12-31";
      return firstDue.localeCompare(secondDue);
    });
    // Mutate the in-memory snapshot first, then persist once, to avoid partial writes.
    tasks.push({
      id: generateId("ptask_"),
      title: taskInput.input.value.trim(),
      dueDate: dueInput.input.value,
      status: status.value,
      recurrenceMeta: buildRecurrenceMeta(recurrence.value, recurrenceIntervalInput.input.value),
      createdAt: new Date().toISOString()
    });
    persistPersonalTasks(tasks);
    form.reset();
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    // Keep soonest due tasks at the top; empty due dates are intentionally treated as lowest urgency.
    const tasks = loadPersonalTasks().sort((first, second) => {
      const firstDue = first.dueDate || "9999-12-31";
      const secondDue = second.dueDate || "9999-12-31";
      return firstDue.localeCompare(secondDue);
    });
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No personal tasks yet.";
      list.appendChild(empty);
      return;
    }

    for (const task of tasks) {
      const row = document.createElement("article");
      row.className = "meeting-row";

      const heading = document.createElement("strong");
      heading.textContent = task.title;

      const meta = document.createElement("p");
      meta.className = "meeting-meta";
      const recurrenceLabel = task.recurrenceMeta
        ? `${task.recurrenceMeta.frequency} every ${task.recurrenceMeta.interval}`
        : "none";
      meta.textContent = `Status: ${task.status} · Due: ${task.dueDate || "Not set"} · Recurs: ${recurrenceLabel}`;

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "module-button-secondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        renderEditState(row, task, tasks);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "module-button-secondary";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        // Rebuild without the selected task so delete is idempotent even if the button is clicked twice.
        persistPersonalTasks(tasks.filter((entry) => entry.id !== task.id));
        renderList();
      });

      row.append(heading, meta, edit, remove);
      list.appendChild(row);
    }
  }

  /**
   * Swaps a list row into edit mode. Changes stay local to this row until Save is clicked,
   * so Cancel can safely return to read mode without touching persisted storage.
   */
  function renderEditState(row, task, tasks) {
    row.innerHTML = "";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "field-input";
    titleInput.value = task.title;
    titleInput.required = true;

    const dueInput = document.createElement("input");
    dueInput.type = "date";
    dueInput.className = "field-input";
    dueInput.value = task.dueDate || "";

    const statusSelect = document.createElement("select");
    statusSelect.className = "field-input";
    TASK_STATUSES.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = task.status === value;
      statusSelect.appendChild(option);
    });

    const recurrenceSelect = document.createElement("select");
    recurrenceSelect.className = "field-input";
    RECURRENCE_FREQUENCIES.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.slice(0, 1).toUpperCase() + value.slice(1);
      option.selected = (task.recurrenceMeta?.frequency || "none") === value;
      recurrenceSelect.appendChild(option);
    });

    const recurrenceInterval = document.createElement("input");
    recurrenceInterval.type = "number";
    recurrenceInterval.className = "field-input";
    recurrenceInterval.min = "1";
    recurrenceInterval.step = "1";
    recurrenceInterval.value = String(task.recurrenceMeta?.interval || 1);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "enter-mode-button";
    save.textContent = "Save";
    save.addEventListener("click", () => {
      const nextTitle = titleInput.value.trim();
      if (!nextTitle) {
        titleInput.reportValidity();
        return;
      }

      // Update in memory first and persist once so save remains atomic.
      const updatedTasks = tasks.map((entry) => {
        if (entry.id !== task.id) {
          return entry;
        }

        return {
          ...entry,
          title: nextTitle,
          dueDate: dueInput.value,
          status: statusSelect.value,
          recurrenceMeta: buildRecurrenceMeta(recurrenceSelect.value, recurrenceInterval.value, task.recurrenceMeta),
          updatedAt: new Date().toISOString()
        };
      });

      persistPersonalTasks(updatedTasks);
      renderList();
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "module-button-secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      // Re-render from persisted state only; no write is performed when abandoning edits.
      renderList();
    });

    row.append(titleInput, dueInput, statusSelect, recurrenceSelect, recurrenceInterval, save, cancel);
  }

  section.append(title, intro, form, list);
  renderList();
  return section;
}

/**
 * Loads persisted personal tasks and falls back to an empty array when localStorage is empty,
 * non-array, or contains malformed JSON.
 */
function loadPersonalTasks() {
  const tasks = loadVersionedCollection({
    storageKey: PERSONAL_TASKS_KEY,
    collectionKey: PERSONAL_TASKS_COLLECTION_FIELD,
    schemaVersion: PERSONAL_TASKS_SCHEMA_VERSION,
    normaliseItem: normalisePersonalTask,
    fallback: []
  });

  const withGeneratedRecurring = generateRecurringPersonalTasks(tasks);
  if (withGeneratedRecurring.length !== tasks.length) {
    persistPersonalTasks(withGeneratedRecurring);
  }

  return withGeneratedRecurring;
}

/**
 * Persists the full personal task collection as canonical JSON under the versioned key;
 * malformed JSON fallback remains in loadPersonalTasks for corrupted/external payloads.
 */
function persistPersonalTasks(tasks) {
  persistVersionedCollection({
    storageKey: PERSONAL_TASKS_KEY,
    collectionKey: PERSONAL_TASKS_COLLECTION_FIELD,
    schemaVersion: PERSONAL_TASKS_SCHEMA_VERSION,
    records: tasks.map(normalisePersonalTask)
  });
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
        : generateId("ptask_")
  };
}

function buildRecurrenceMeta(frequency, intervalValue, previousMeta = null) {
  if (!RECURRENCE_FREQUENCIES.includes(frequency) || frequency === "none") {
    return null;
  }

  return {
    frequency,
    interval: Math.max(1, Number.parseInt(String(intervalValue || "1"), 10) || 1),
    parentRecurrenceId: previousMeta?.parentRecurrenceId || generateId("ptask_")
  };
}

function generateRecurringPersonalTasks(tasks) {
  const generated = [...tasks];
  const today = new Date().toISOString().slice(0, 10);
  const seenSeriesDueDates = new Set(
    generated
      .filter((task) => task.recurrenceMeta?.parentRecurrenceId && task.dueDate)
      .map((task) => `${task.recurrenceMeta.parentRecurrenceId}:${task.dueDate}`)
  );

  const latestBySeries = new Map();
  for (const task of generated) {
    const seriesId = task.recurrenceMeta?.parentRecurrenceId;
    if (!seriesId || !task.dueDate) {
      continue;
    }
    const current = latestBySeries.get(seriesId);
    if (!current || task.dueDate > current.dueDate) {
      latestBySeries.set(seriesId, task);
    }
  }

  for (const latest of latestBySeries.values()) {
    let candidate = latest;
    let guard = 0;
    while ((candidate.status === "Done" || candidate.dueDate < today) && guard < MAX_RECURRENCE_GENERATIONS_PER_LOAD) {
      const nextDueDate = shiftDateByRecurrence(candidate.dueDate, candidate.recurrenceMeta.frequency, candidate.recurrenceMeta.interval);
      if (!nextDueDate) {
        break;
      }

      const key = `${candidate.recurrenceMeta.parentRecurrenceId}:${nextDueDate}`;
      if (seenSeriesDueDates.has(key)) {
        break;
      }

      const nextTask = normalisePersonalTask({
        ...candidate,
        id: generateId("ptask_"),
        status: "Backlog",
        dueDate: nextDueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      generated.push(nextTask);
      seenSeriesDueDates.add(key);
      candidate = nextTask;
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
