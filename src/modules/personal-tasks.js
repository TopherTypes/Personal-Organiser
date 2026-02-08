import { buildPersonalStorageKey } from "./personal-keys.js";

const PERSONAL_TASKS_KEY = buildPersonalStorageKey("tasks", 1);

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
  const form = document.createElement("form");
  form.className = "meeting-form";

  const taskInput = buildInput("Task title", "text", true);
  const dueInput = buildInput("Due date", "date", false);

  const statusWrap = document.createElement("label");
  statusWrap.className = "field-label";
  statusWrap.textContent = "Status";
  const status = document.createElement("select");
  status.className = "field-input";
  ["Backlog", "Ready", "In Progress", "Done", "Cancelled"].forEach((value) => {
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
    const tasks = loadPersonalTasks();
    tasks.push({
      id: `ptask_${Math.random().toString(36).slice(2, 10)}`,
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
    const tasks = loadPersonalTasks();
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

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "module-button-secondary";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        persistPersonalTasks(tasks.filter((entry) => entry.id !== task.id));
        renderList();
      });

      row.append(heading, meta, remove);
      list.appendChild(row);
    }
  }

  section.append(title, intro, form, list);
  renderList();
  return section;
}

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
