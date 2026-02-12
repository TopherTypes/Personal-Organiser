import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";

/**
 * Personal modules use versioned localStorage keys so schema upgrades can roll forward safely.
 *
 * Tasks stay in a Personal-only namespace to prevent accidental overlap with Work planning data
 * and to keep sync/import behavior mode-scoped.
 */
const PERSONAL_TASKS_KEY = buildPersonalStorageKey("tasks", 1);
const TASK_STATUSES = ["Backlog", "Ready", "In Progress", "Done", "Cancelled"];

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

  form.append(taskInput.wrap, dueInput.wrap, statusWrap, submit);

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
      meta.textContent = `Status: ${task.status} · Due: ${task.dueDate || "Not set"}`;

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

    row.append(titleInput, dueInput, statusSelect, save, cancel);
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
  const raw = localStorage.getItem(PERSONAL_TASKS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persists the full personal task collection as canonical JSON under the versioned key;
 * malformed JSON fallback remains in loadPersonalTasks for corrupted/external payloads.
 */
function persistPersonalTasks(tasks) {
  localStorage.setItem(PERSONAL_TASKS_KEY, JSON.stringify(tasks));
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
