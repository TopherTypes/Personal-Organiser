import { loadProjects } from "./projects-store.js";

const TASK_STORAGE_KEY_PREFIX = "second-brain.work.tasks";
const TASK_SCHEMA_VERSION = 1;
const PEOPLE_STORAGE_KEY_PREFIX = "second-brain.work.people";

const TASK_STATUSES = [
  "backlog",
  "in progress",
  "blocked",
  "on hold",
  "completed",
  "cancelled"
];

const RECURRENCE_OPTIONS = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "weekdays",
  "weekends",
  "custom"
];

/**
 * Renders the work task module with CRUD, archive, filtering, and score-based ordering.
 */
export function renderWorkTasksModule({ mode = "work" } = {}) {
  const state = {
    mode,
    statusFilter: "all",
    assigneeFilter: "all",
    projectFilter: "all",
    includeArchived: false,
    isPanelOpen: false,
    editingId: "",
    feedback: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard tasks-module";

  const header = document.createElement("div");
  header.className = "meetings-header";

  const headingWrap = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "Work Tasks";
  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Capture one-off and recurring tasks, assign owners and projects, and triage by priority score.";
  headingWrap.append(title, intro);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "enter-mode-button";
  addButton.textContent = "New task";
  addButton.addEventListener("click", () => {
    state.editingId = "";
    state.isPanelOpen = true;
    renderModule();
  });

  header.append(headingWrap, addButton);

  const feedback = document.createElement("p");
  feedback.className = "feedback";

  const controls = document.createElement("div");
  controls.className = "people-controls";

  const list = document.createElement("div");
  list.className = "tasks-list";

  const panelWrap = document.createElement("div");
  panelWrap.className = "people-form-wrap";

  section.append(header, feedback, controls, list, panelWrap);

  function renderModule() {
    const people = loadPeople(state.mode);
    const projects = loadProjects(state.mode);
    const tasks = loadTasks(state.mode);

    controls.innerHTML = "";
    controls.append(
      createSelectFilter("Status", state.statusFilter, [
        { value: "all", label: "All statuses" },
        ...TASK_STATUSES.map((status) => ({ value: status, label: toTitleCase(status) }))
      ], (value) => {
        state.statusFilter = value;
        renderModule();
      }),
      createSelectFilter("Assignee", state.assigneeFilter, [
        { value: "all", label: "All assignees" },
        ...people.map((person) => ({ value: person.id, label: person.name }))
      ], (value) => {
        state.assigneeFilter = value;
        renderModule();
      }),
      createSelectFilter("Project", state.projectFilter, [
        { value: "all", label: "All projects" },
        ...projects.map((project) => ({ value: project.id, label: project.title }))
      ], (value) => {
        state.projectFilter = value;
        renderModule();
      })
    );

    const archiveToggleWrap = document.createElement("label");
    archiveToggleWrap.className = "field-label";
    archiveToggleWrap.textContent = "Include archived";
    const archiveToggle = document.createElement("input");
    archiveToggle.type = "checkbox";
    archiveToggle.checked = state.includeArchived;
    archiveToggle.addEventListener("change", () => {
      state.includeArchived = archiveToggle.checked;
      renderModule();
    });
    archiveToggleWrap.appendChild(archiveToggle);
    controls.appendChild(archiveToggleWrap);

    const filtered = tasks
      .filter((task) => (state.includeArchived ? true : !task.archived))
      .filter((task) => (state.statusFilter === "all" ? true : task.status === state.statusFilter))
      .filter((task) => (state.assigneeFilter === "all" ? true : task.assigneeId === state.assigneeFilter))
      .filter((task) => (state.projectFilter === "all" ? true : task.projectId === state.projectFilter))
      .map((task) => ({ ...task, priorityScore: computePriorityScore(task) }))
      .sort((first, second) => {
        if (second.priorityScore !== first.priorityScore) {
          return second.priorityScore - first.priorityScore;
        }

        return stableTieBreaker(first.id) - stableTieBreaker(second.id);
      });

    list.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No tasks match your current filters.";
      list.appendChild(empty);
    } else {
      for (const task of filtered) {
        const assignee = people.find((person) => person.id === task.assigneeId);
        const project = projects.find((entry) => entry.id === task.projectId);
        list.appendChild(
          createTaskCard(task, {
            assigneeLabel: assignee?.name || "Unassigned",
            projectLabel: project?.title || "No project",
            onEdit: () => {
              state.editingId = task.id;
              state.isPanelOpen = true;
              renderModule();
            },
            onArchiveToggle: () => {
              setTaskArchived(state.mode, task.id, !task.archived);
              state.feedback = task.archived ? "Task restored." : "Task archived.";
              renderModule();
            },
            onDelete: () => {
              if (!window.confirm("Delete this task permanently?")) {
                return;
              }
              deleteTask(state.mode, task.id);
              state.feedback = "Task deleted.";
              renderModule();
            }
          })
        );
      }
    }

    feedback.textContent = state.feedback;

    panelWrap.innerHTML = "";
    if (state.isPanelOpen) {
      const task = tasks.find((entry) => entry.id === state.editingId) || null;
      panelWrap.append(
        createTaskForm({
          task,
          people,
          projects,
          onCancel: () => {
            state.editingId = "";
            state.isPanelOpen = false;
            renderModule();
          },
          onSave: (payload) => {
            const result = saveTask(state.mode, payload, state.editingId);
            if (!result.ok) {
              state.feedback = result.error;
              renderModule();
              return;
            }

            state.feedback = result.wasEdit ? "Task updated." : "Task created.";
            state.isPanelOpen = false;
            state.editingId = "";
            renderModule();
          }
        })
      );
    }
  }

  renderModule();
  return section;
}

function createTaskCard(task, { assigneeLabel, projectLabel, onEdit, onArchiveToggle, onDelete }) {
  const card = document.createElement("article");
  card.className = "person-card";

  const top = document.createElement("div");
  top.className = "person-card-top";

  const title = document.createElement("h3");
  title.textContent = task.title;

  const scorePill = document.createElement("span");
  scorePill.className = "status-pill active";
  scorePill.textContent = `Priority ${task.priorityScore}`;

  top.append(title, scorePill);

  const details = document.createElement("p");
  details.className = "person-meta";
  details.textContent = `${toTitleCase(task.status)} • Effort ${task.effort}/10 • Impact ${task.impact}/10`;

  const relation = document.createElement("p");
  relation.className = "person-meta";
  relation.textContent = `${assigneeLabel} • ${projectLabel}`;

  const recurrence = document.createElement("p");
  recurrence.className = "person-meta";
  recurrence.textContent = `Recurrence: ${toTitleCase(task.recurrence)}${
    task.recurrence === "custom" && task.customRecurrence ? ` (${task.customRecurrence})` : ""
  }`;

  const due = document.createElement("p");
  due.className = "person-meta";
  due.textContent = `Due: ${task.dueDate || "Not set"} • Updated: ${new Date(task.updatedAt).toLocaleString()}`;

  const actions = document.createElement("div");
  actions.className = "person-actions";

  actions.append(
    button("Edit", onEdit),
    button(task.archived ? "Restore" : "Archive", onArchiveToggle),
    button("Delete", onDelete)
  );

  card.append(top, details, relation, recurrence, due, actions);
  return card;
}

function createTaskForm({ task, people, projects, onSave, onCancel }) {
  const form = document.createElement("form");
  form.className = "meeting-slideover";

  const heading = document.createElement("h2");
  heading.textContent = task ? "Edit task" : "New task";

  const title = createField("Title", "text", task?.title || "", true);
  const effort = createField("Effort (1-10)", "number", String(task?.effort || 5), true, {
    min: "1",
    max: "10"
  });
  const impact = createField("Impact (1-10)", "number", String(task?.impact || 5), true, {
    min: "1",
    max: "10"
  });
  const dueDate = createField("Due date", "date", task?.dueDate || "", false);

  const statusWrap = document.createElement("label");
  statusWrap.className = "field-label";
  statusWrap.textContent = "Status";
  const status = document.createElement("select");
  status.className = "field-input";
  for (const value of TASK_STATUSES) {
    addOption(status, value, toTitleCase(value));
  }
  status.value = task?.status || "backlog";
  statusWrap.appendChild(status);

  const assigneeWrap = document.createElement("label");
  assigneeWrap.className = "field-label";
  assigneeWrap.textContent = "Assignee";
  const assignee = document.createElement("select");
  assignee.className = "field-input";
  addOption(assignee, "", "Unassigned");
  for (const person of people) {
    addOption(assignee, person.id, person.name);
  }
  assignee.value = task?.assigneeId || "";
  assigneeWrap.appendChild(assignee);

  const projectWrap = document.createElement("label");
  projectWrap.className = "field-label";
  projectWrap.textContent = "Project";
  const project = document.createElement("select");
  project.className = "field-input";
  addOption(project, "", "No project");
  for (const entry of projects) {
    addOption(project, entry.id, entry.title);
  }
  project.value = task?.projectId || "";
  projectWrap.appendChild(project);

  const recurrenceWrap = document.createElement("label");
  recurrenceWrap.className = "field-label";
  recurrenceWrap.textContent = "Recurrence";
  const recurrence = document.createElement("select");
  recurrence.className = "field-input";
  for (const value of RECURRENCE_OPTIONS) {
    addOption(recurrence, value, toTitleCase(value));
  }
  recurrence.value = task?.recurrence || "none";
  recurrenceWrap.appendChild(recurrence);

  const customRecurrence = createField(
    "Custom recurrence",
    "text",
    task?.customRecurrence || "",
    false,
    {
      placeholder: "e.g. every 2 weeks"
    }
  );

  const notes = createField("Notes", "textarea", task?.notes || "", false);

  const actions = document.createElement("div");
  actions.className = "meeting-actions";
  actions.append(button(task ? "Save changes" : "Create task", null, "submit"), button("Cancel", onCancel));

  form.append(
    heading,
    title.wrap,
    effort.wrap,
    impact.wrap,
    statusWrap,
    assigneeWrap,
    projectWrap,
    dueDate.wrap,
    recurrenceWrap,
    customRecurrence.wrap,
    notes.wrap,
    actions
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({
      title: title.input.value.trim(),
      effort: Number(effort.input.value),
      impact: Number(impact.input.value),
      status: status.value,
      assigneeId: assignee.value,
      projectId: project.value,
      dueDate: dueDate.input.value,
      recurrence: recurrence.value,
      customRecurrence: customRecurrence.input.value.trim(),
      notes: notes.input.value.trim(),
      archived: Boolean(task?.archived)
    });
  });

  return form;
}

function createSelectFilter(labelText, selected, options, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;
  const select = document.createElement("select");
  select.className = "field-input";
  for (const option of options) {
    addOption(select, option.value, option.label);
  }
  select.value = selected;
  select.addEventListener("change", () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

function createField(labelText, type, value, required, attributes = {}) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
  input.className = "field-input";
  if (type !== "textarea") {
    input.type = type;
  }
  input.value = value;
  input.required = required;
  for (const [key, item] of Object.entries(attributes)) {
    input.setAttribute(key, item);
  }

  wrap.appendChild(input);
  return { wrap, input };
}

function saveTask(mode, payload, editingId = "") {
  if (!payload.title) {
    return { ok: false, error: "Task title is required." };
  }
  if (!TASK_STATUSES.includes(payload.status)) {
    return { ok: false, error: "Task status is invalid." };
  }
  if (!Number.isFinite(payload.effort) || payload.effort < 1 || payload.effort > 10) {
    return { ok: false, error: "Effort must be between 1 and 10." };
  }
  if (!Number.isFinite(payload.impact) || payload.impact < 1 || payload.impact > 10) {
    return { ok: false, error: "Impact must be between 1 and 10." };
  }

  const tasks = loadTasks(mode);
  const now = new Date().toISOString();

  if (editingId) {
    const index = tasks.findIndex((task) => task.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Task not found." };
    }

    const existing = tasks[index];
    tasks[index] = {
      ...existing,
      ...payload,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        title: now,
        effort: now,
        impact: now,
        status: now,
        assigneeId: now,
        projectId: now,
        dueDate: now,
        recurrence: now,
        customRecurrence: now,
        notes: now,
        archived: now
      }
    };

    persistTasks(mode, tasks);
    return { ok: true, wasEdit: true };
  }

  tasks.push(
    normaliseTask({
      id: buildTaskId(),
      ...payload,
      createdAt: now,
      updatedAt: now,
      lastUpdatedByField: {
        title: now,
        effort: now,
        impact: now,
        status: now,
        assigneeId: now,
        projectId: now,
        dueDate: now,
        recurrence: now,
        customRecurrence: now,
        notes: now,
        archived: now
      }
    })
  );

  persistTasks(mode, tasks);
  return { ok: true, wasEdit: false };
}

function deleteTask(mode, taskId) {
  const tasks = loadTasks(mode);
  persistTasks(
    mode,
    tasks.filter((task) => task.id !== taskId)
  );
}

function setTaskArchived(mode, taskId, archived) {
  const tasks = loadTasks(mode);
  const now = new Date().toISOString();
  const updated = tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          archived,
          updatedAt: now,
          lastUpdatedByField: {
            ...task.lastUpdatedByField,
            archived: now
          }
        }
      : task
  );
  persistTasks(mode, updated);
}

function computePriorityScore(task) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dueDateWeight = 50;
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diffDays <= 0) {
      dueDateWeight = 100 + Math.min(Math.abs(diffDays), 30);
    } else {
      dueDateWeight = Math.max(15, 100 - diffDays * 3);
    }
  }

  const statusWeight = task.status === "blocked" ? 8 : task.status === "in progress" ? 12 : 0;
  const recurrenceWeight = task.recurrence !== "none" ? 5 : 0;

  return Math.round(dueDateWeight + task.impact * 6 - task.effort * 2 + statusWeight + recurrenceWeight);
}

function stableTieBreaker(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 997;
  }
  return hash;
}

export function loadTasks(mode) {
  const storageKey = `${TASK_STORAGE_KEY_PREFIX}.${mode}.v1`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(normaliseTask);
    }

    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)) {
      return parsed.tasks.map(normaliseTask);
    }

    return [];
  } catch {
    return [];
  }
}

function persistTasks(mode, tasks) {
  const storageKey = `${TASK_STORAGE_KEY_PREFIX}.${mode}.v1`;
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: TASK_SCHEMA_VERSION, tasks }));
}

function normaliseTask(task) {
  return {
    id: task.id || buildTaskId(),
    title: task.title || "",
    effort: Number(task.effort) || 5,
    impact: Number(task.impact) || 5,
    status: TASK_STATUSES.includes(task.status) ? task.status : "backlog",
    assigneeId: task.assigneeId || "",
    projectId: task.projectId || "",
    dueDate: task.dueDate || "",
    recurrence: RECURRENCE_OPTIONS.includes(task.recurrence) ? task.recurrence : "none",
    customRecurrence: task.customRecurrence || "",
    notes: task.notes || "",
    archived: Boolean(task.archived),
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
    lastUpdatedByField:
      typeof task.lastUpdatedByField === "object" && task.lastUpdatedByField !== null
        ? task.lastUpdatedByField
        : {}
  };
}

function loadPeople(mode) {
  const storageKey = `${PEOPLE_STORAGE_KEY_PREFIX}.${mode}.v1`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((person) => ({ id: person.id || "", name: person.name || "Unnamed" }))
      : [];
  } catch {
    return [];
  }
}

function button(label, onClick, type = "button") {
  const item = document.createElement("button");
  item.type = type;
  item.className = "ghost-button";
  item.textContent = label;
  if (onClick) {
    item.addEventListener("click", onClick);
  }
  return item;
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function buildTaskId() {
  return `task_${Math.random().toString(36).slice(2, 10)}`;
}

function toTitleCase(value) {
  return value
    .split("-")
    .join(" ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
