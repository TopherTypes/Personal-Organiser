import { loadTasks } from "./tasks.js";

const SPRINT_STORAGE_KEY = "second-brain.work.sprints.work";
const SPRINT_BACKUP_KEY = `${SPRINT_STORAGE_KEY}.backup`;
const SPRINT_SCHEMA_VERSION = 1;

const SPRINT_STATUSES = ["planning", "active", "completed", "archived"];

/**
 * Renders the Work Sprints module.
 *
 * UX notes:
 * - Create and edit share a slide-over form.
 * - Sprint details open as a full-screen view within the module region.
 * - Archive is soft-delete only and always asks for confirmation.
 */
export function renderWorkSprintsModule({ mode = "work" } = {}) {
  const state = {
    mode,
    statusFilter: "active-only",
    includeArchived: false,
    isPanelOpen: false,
    editingId: "",
    viewingId: "",
    feedback: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard sprints-module";

  const header = document.createElement("div");
  header.className = "meetings-header";

  const headingWrap = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "Work Sprints";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Plan focused sprint windows, attach tasks, and track whether delivery pace is ahead, on track, or behind.";
  headingWrap.append(title, intro);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "enter-mode-button";
  addButton.textContent = "New sprint";
  addButton.addEventListener("click", () => {
    state.editingId = "";
    state.isPanelOpen = true;
    renderModule();
  });

  header.append(headingWrap, addButton);

  const notice = document.createElement("p");
  notice.className = "archive-note";
  notice.textContent =
    "Data safety: sprints are archived instead of permanently deleted and can be restored at any time.";

  const feedback = document.createElement("p");
  feedback.className = "feedback";

  const controls = document.createElement("div");
  controls.className = "people-controls";

  const body = document.createElement("div");
  body.className = "sprints-content";

  const panelWrap = document.createElement("div");
  panelWrap.className = "people-form-wrap";

  section.append(header, notice, feedback, controls, body, panelWrap);

  function renderModule() {
    const tasks = loadTasks(state.mode);
    const sprints = loadSprints(state.mode);

    controls.innerHTML = "";
    controls.append(
      createSelectFilter("Sprint status", state.statusFilter, [
        { value: "active-only", label: "Planning + Active + Completed" },
        { value: "planning", label: "Planning" },
        { value: "active", label: "Active" },
        { value: "completed", label: "Completed" },
        { value: "archived", label: "Archived" },
        { value: "all", label: "All statuses" }
      ], (value) => {
        state.statusFilter = value;
        renderModule();
      })
    );

    const archivedToggleWrap = document.createElement("label");
    archivedToggleWrap.className = "field-label";
    archivedToggleWrap.textContent = "Include archived";

    const archivedToggle = document.createElement("input");
    archivedToggle.type = "checkbox";
    archivedToggle.checked = state.includeArchived;
    archivedToggle.addEventListener("change", () => {
      state.includeArchived = archivedToggle.checked;
      renderModule();
    });

    archivedToggleWrap.appendChild(archivedToggle);
    controls.appendChild(archivedToggleWrap);

    const sprintRows = querySprints(sprints, state);

    feedback.textContent = state.feedback || `Showing ${sprintRows.length} sprint(s).`;

    body.innerHTML = "";
    if (state.viewingId) {
      const sprint = sprints.find((entry) => entry.id === state.viewingId);
      if (sprint) {
        body.appendChild(
          createSprintDetailView({
            sprint,
            tasks,
            onBack: () => {
              state.viewingId = "";
              renderModule();
            },
            onRemoveTask: (taskId) => {
              const result = removeTaskFromSprint(state.mode, sprint.id, taskId);
              state.feedback = result.ok ? "Task removed from sprint." : result.error;
              renderModule();
            },
            onAddTask: (taskId) => {
              const result = addTaskToSprint(state.mode, sprint.id, taskId);
              state.feedback = result.ok ? "Task added to sprint." : result.error;
              renderModule();
            },
            onEdit: () => {
              state.editingId = sprint.id;
              state.isPanelOpen = true;
              renderModule();
            }
          })
        );
      }
    } else if (sprintRows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No sprints match your current filters.";
      body.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "sprints-list";
      for (const sprint of sprintRows) {
        list.appendChild(
          createSprintCard(sprint, tasks, {
            onView: () => {
              state.viewingId = sprint.id;
              renderModule();
            },
            onEdit: () => {
              state.editingId = sprint.id;
              state.isPanelOpen = true;
              renderModule();
            },
            onArchiveToggle: () => {
              const action = sprint.archived ? "restore" : "archive";
              if (!window.confirm(`Are you sure you want to ${action} this sprint?`)) {
                return;
              }
              const result = setSprintArchived(state.mode, sprint.id, !sprint.archived);
              state.feedback = result.ok
                ? sprint.archived
                  ? "Sprint restored."
                  : "Sprint archived."
                : result.error;
              renderModule();
            }
          })
        );
      }
      body.appendChild(list);
    }

    panelWrap.innerHTML = "";
    if (state.isPanelOpen) {
      const sprint = sprints.find((entry) => entry.id === state.editingId) || null;
      panelWrap.append(
        createSprintForm({
          sprint,
          tasks,
          onCancel: () => {
            state.editingId = "";
            state.isPanelOpen = false;
            renderModule();
          },
          onSave: (payload) => {
            const result = saveSprint(state.mode, payload, state.editingId);
            if (!result.ok) {
              state.feedback = result.error;
              renderModule();
              return;
            }

            state.feedback = result.wasEdit ? "Sprint updated." : "Sprint created.";
            state.editingId = "";
            state.isPanelOpen = false;
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
 * Creates a compact sprint summary card with derived progress metrics.
 */
function createSprintCard(sprint, tasks, { onView, onEdit, onArchiveToggle }) {
  const card = document.createElement("article");
  card.className = "person-card";

  const top = document.createElement("div");
  top.className = "person-card-top";

  const heading = document.createElement("h3");
  heading.textContent = sprint.name;

  const status = document.createElement("span");
  status.className = sprint.archived ? "status-pill archived" : `status-pill ${paceClass(sprint, tasks)}`;
  status.textContent = sprint.archived ? "Archived" : toTitleCase(sprint.status);

  top.append(heading, status);

  const metrics = computeSprintMetrics(sprint, tasks);

  const dates = document.createElement("p");
  dates.className = "person-meta";
  dates.textContent = `${sprint.startDate} → ${sprint.endDate}`;

  const progress = document.createElement("p");
  progress.className = "person-meta";
  progress.textContent = `Forecast ${metrics.forecastTotal} • Completed ${metrics.completedTotal} • Pace: ${metrics.paceLabel}`;

  const updated = document.createElement("p");
  updated.className = "person-meta";
  updated.textContent = `Updated ${new Date(sprint.updatedAt).toLocaleString()}`;

  const actions = document.createElement("div");
  actions.className = "person-actions";
  actions.append(button("View", onView), button("Edit", onEdit), button(sprint.archived ? "Restore" : "Archive", onArchiveToggle));

  card.append(top, dates, progress, updated, actions);
  return card;
}

/**
 * Renders the full sprint details screen.
 *
 * Backlog task candidates are only visible while a sprint is in planning.
 */
function createSprintDetailView({ sprint, tasks, onBack, onRemoveTask, onAddTask, onEdit }) {
  const wrap = document.createElement("div");
  wrap.className = "sprint-detail-view";

  const top = document.createElement("div");
  top.className = "meetings-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = sprint.name;
  const subtitle = document.createElement("p");
  subtitle.className = "module-intro";
  subtitle.textContent = `${toTitleCase(sprint.status)} sprint • ${sprint.startDate} → ${sprint.endDate}`;
  titleWrap.append(title, subtitle);

  const topActions = document.createElement("div");
  topActions.append(button("Back to list", onBack), button("Edit sprint", onEdit));

  top.append(titleWrap, topActions);

  const metrics = computeSprintMetrics(sprint, tasks);
  const metricsGrid = document.createElement("div");
  metricsGrid.className = "project-overview-grid";
  metricsGrid.append(
    metricCard("Forecast", String(metrics.forecastTotal)),
    metricCard("Completed", String(metrics.completedTotal)),
    metricCard("Pace", metrics.paceLabel)
  );

  const linkedTasks = tasks.filter((task) => sprint.taskIds.includes(task.id) && !task.archived);

  const linkedSection = document.createElement("section");
  linkedSection.className = "person-card";
  const linkedTitle = document.createElement("h3");
  linkedTitle.textContent = "Sprint tasks";
  linkedSection.appendChild(linkedTitle);

  if (linkedTasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tasks linked yet.";
    linkedSection.appendChild(empty);
  } else {
    for (const task of linkedTasks) {
      const row = document.createElement("div");
      row.className = "person-actions";

      const info = document.createElement("p");
      info.className = "person-meta";
      info.textContent = `${task.title} • ${toTitleCase(task.status)}`;

      row.append(info, button("Remove", () => onRemoveTask(task.id)));
      linkedSection.appendChild(row);
    }
  }

  wrap.append(top, metricsGrid, linkedSection);

  if (sprint.status === "planning") {
    const backlogSection = document.createElement("section");
    backlogSection.className = "person-card";

    const backlogTitle = document.createElement("h3");
    backlogTitle.textContent = "Backlog tasks (planning only)";
    backlogSection.appendChild(backlogTitle);

    const backlogCandidates = tasks.filter((task) => !task.archived && task.status !== "completed" && !sprint.taskIds.includes(task.id));

    if (backlogCandidates.length === 0) {
      const noBacklog = document.createElement("p");
      noBacklog.className = "empty-state";
      noBacklog.textContent = "No backlog tasks available to add.";
      backlogSection.appendChild(noBacklog);
    } else {
      for (const task of backlogCandidates) {
        const row = document.createElement("div");
        row.className = "person-actions";

        const info = document.createElement("p");
        info.className = "person-meta";
        info.textContent = `${task.title} • ${toTitleCase(task.status)}`;

        row.append(info, button("Add", () => onAddTask(task.id)));
        backlogSection.appendChild(row);
      }
    }

    wrap.appendChild(backlogSection);
  }

  return wrap;
}

/**
 * Slide-over sprint editor. Create and edit use the same form.
 */
function createSprintForm({ sprint, tasks, onSave, onCancel }) {
  const form = document.createElement("form");
  form.className = "meeting-slideover";

  const title = document.createElement("h2");
  title.textContent = sprint ? "Edit sprint" : "New sprint";

  const name = createField("Sprint name", "text", sprint?.name || "", true);
  const startDate = createField("Start date", "date", sprint?.startDate || "", true);
  const endDate = createField("End date", "date", sprint?.endDate || "", true);

  const statusWrap = document.createElement("label");
  statusWrap.className = "field-label";
  statusWrap.textContent = "Status";
  const status = document.createElement("select");
  status.className = "field-input";
  for (const entry of SPRINT_STATUSES) {
    addOption(status, entry, toTitleCase(entry));
  }
  status.value = sprint?.status || "planning";
  statusWrap.appendChild(status);

  const tasksWrap = document.createElement("label");
  tasksWrap.className = "field-label";
  tasksWrap.textContent = "Sprint tasks";

  const tasksInput = document.createElement("select");
  tasksInput.className = "field-input";
  tasksInput.multiple = true;
  tasksInput.size = 8;

  const visibleTasks = tasks.filter((task) => !task.archived);
  for (const task of visibleTasks) {
    addOption(tasksInput, task.id, `${task.title} (${toTitleCase(task.status)})`);
  }

  for (const taskId of sprint?.taskIds || []) {
    const option = Array.from(tasksInput.options).find((item) => item.value === taskId);
    if (option) {
      option.selected = true;
    }
  }

  tasksWrap.appendChild(tasksInput);

  const help = document.createElement("p");
  help.className = "person-meta";
  help.textContent = "Hold Ctrl/Cmd to select multiple tasks. Tasks can be linked to multiple sprints.";

  const actions = document.createElement("div");
  actions.className = "meeting-actions";
  actions.append(button(sprint ? "Save changes" : "Create sprint", null, "submit"), button("Cancel", onCancel));

  form.append(title, name.wrap, startDate.wrap, endDate.wrap, statusWrap, tasksWrap, help, actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const selectedTaskIds = Array.from(tasksInput.selectedOptions).map((option) => option.value);

    onSave({
      name: name.input.value.trim(),
      startDate: startDate.input.value,
      endDate: endDate.input.value,
      status: status.value,
      taskIds: selectedTaskIds,
      archived: Boolean(sprint?.archived)
    });
  });

  return form;
}

/**
 * Creates validated sprint records and applies single-active-sprint constraints.
 */
function saveSprint(mode, payload, editingId = "") {
  if (!payload.name) {
    return { ok: false, error: "Sprint name is required." };
  }
  if (!payload.startDate || !payload.endDate) {
    return { ok: false, error: "Sprint start and end dates are required." };
  }
  if (payload.endDate < payload.startDate) {
    return { ok: false, error: "Sprint end date must be on or after start date." };
  }
  if (!SPRINT_STATUSES.includes(payload.status)) {
    return { ok: false, error: "Sprint status is invalid." };
  }

  const now = new Date().toISOString();
  const sprints = loadSprints(mode);
  const nextArchived = Boolean(payload.archived || payload.status === "archived");

  const activeConflict = sprints.find(
    (sprint) =>
      sprint.id !== editingId &&
      !sprint.archived &&
      sprint.status === "active"
  );

  if (payload.status === "active" && activeConflict) {
    return { ok: false, error: `Only one active sprint is allowed. \"${activeConflict.name}\" is already active.` };
  }

  if (payload.status === "active") {
    const today = isoDateOnly(now);
    if (today < payload.startDate || today > payload.endDate) {
      return {
        ok: false,
        error: "An active sprint must include today's date within the sprint date range."
      };
    }
  }

  if (editingId) {
    const index = sprints.findIndex((sprint) => sprint.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Sprint not found." };
    }

    const existing = sprints[index];
    sprints[index] = {
      ...existing,
      ...payload,
      taskIds: uniqueTaskIds(payload.taskIds),
      archived: nextArchived,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        name: now,
        startDate: now,
        endDate: now,
        status: now,
        taskIds: now,
        archived: now
      }
    };

    persistSprints(mode, sprints);
    return { ok: true, wasEdit: true };
  }

  const sprint = normaliseSprint({
    id: buildSprintId(),
    ...payload,
    taskIds: uniqueTaskIds(payload.taskIds),
    archived: nextArchived,
    createdAt: now,
    updatedAt: now,
    lastUpdatedByField: {
      name: now,
      startDate: now,
      endDate: now,
      status: now,
      taskIds: now,
      archived: now
    }
  });

  sprints.push(sprint);
  persistSprints(mode, sprints);
  return { ok: true, wasEdit: false };
}

function addTaskToSprint(mode, sprintId, taskId) {
  const sprints = loadSprints(mode);
  const now = new Date().toISOString();
  const index = sprints.findIndex((entry) => entry.id === sprintId);
  if (index < 0) {
    return { ok: false, error: "Sprint not found." };
  }

  const sprint = sprints[index];
  if (sprint.taskIds.includes(taskId)) {
    return { ok: false, error: "Task is already linked to this sprint." };
  }

  sprints[index] = {
    ...sprint,
    taskIds: [...sprint.taskIds, taskId],
    updatedAt: now,
    lastUpdatedByField: {
      ...sprint.lastUpdatedByField,
      taskIds: now
    }
  };

  persistSprints(mode, sprints);
  return { ok: true };
}

function removeTaskFromSprint(mode, sprintId, taskId) {
  const sprints = loadSprints(mode);
  const now = new Date().toISOString();
  const index = sprints.findIndex((entry) => entry.id === sprintId);
  if (index < 0) {
    return { ok: false, error: "Sprint not found." };
  }

  const sprint = sprints[index];
  sprints[index] = {
    ...sprint,
    taskIds: sprint.taskIds.filter((entry) => entry !== taskId),
    updatedAt: now,
    lastUpdatedByField: {
      ...sprint.lastUpdatedByField,
      taskIds: now
    }
  };

  persistSprints(mode, sprints);
  return { ok: true };
}

function setSprintArchived(mode, sprintId, archived) {
  const sprints = loadSprints(mode);
  const index = sprints.findIndex((entry) => entry.id === sprintId);
  if (index < 0) {
    return { ok: false, error: "Sprint not found." };
  }

  const now = new Date().toISOString();
  const sprint = sprints[index];
  sprints[index] = {
    ...sprint,
    archived,
    status: archived ? "archived" : sprint.status === "archived" ? "planning" : sprint.status,
    updatedAt: now,
    lastUpdatedByField: {
      ...sprint.lastUpdatedByField,
      archived: now,
      status: now
    }
  };

  persistSprints(mode, sprints);
  return { ok: true };
}

/**
 * Computes sprint delivery metrics from linked tasks.
 *
 * - Forecast total = count of linked non-archived tasks.
 * - Completed total = count of linked tasks with `completed` status.
 * - Pace = compare completion percent against elapsed sprint-time percent.
 */
function computeSprintMetrics(sprint, tasks) {
  const linkedTasks = tasks.filter((task) => sprint.taskIds.includes(task.id) && !task.archived);
  const forecastTotal = linkedTasks.length;
  const completedTotal = linkedTasks.filter((task) => task.status === "completed").length;

  const completionPercent = forecastTotal === 0 ? 0 : completedTotal / forecastTotal;
  const elapsedPercent = computeElapsedPercent(sprint.startDate, sprint.endDate);

  let paceLabel = "No forecast";
  if (forecastTotal > 0 && sprint.status === "completed") {
    paceLabel = completionPercent >= 1 ? "Completed" : "Closed with carryover";
  } else if (forecastTotal > 0 && sprint.status === "planning") {
    paceLabel = "Planning";
  } else if (forecastTotal > 0 && sprint.status === "active") {
    const delta = completionPercent - elapsedPercent;
    if (delta > 0.1) {
      paceLabel = "Ahead";
    } else if (delta < -0.1) {
      paceLabel = "Behind";
    } else {
      paceLabel = "On track";
    }
  }

  return {
    forecastTotal,
    completedTotal,
    paceLabel
  };
}

function computeElapsedPercent(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) {
    return 0;
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  const now = new Date();

  if (now <= start) {
    return 0;
  }
  if (now >= end) {
    return 1;
  }

  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

function querySprints(sprints, state) {
  return sprints
    .filter((sprint) => (state.includeArchived ? true : !sprint.archived))
    .filter((sprint) => {
      if (state.statusFilter === "all") {
        return true;
      }
      if (state.statusFilter === "active-only") {
        return ["planning", "active", "completed"].includes(sprint.status);
      }
      return sprint.status === state.statusFilter;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Loads sprint data from localStorage and migrates legacy array shape safely.
 */
export function loadSprints(mode = "work") {
  if (mode !== "work") {
    return [];
  }

  const raw = localStorage.getItem(SPRINT_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Preserve original payload before envelope migration to avoid data loss.
      localStorage.setItem(SPRINT_BACKUP_KEY, raw);
      const migrated = parsed.map(normaliseSprint);
      persistSprints(mode, migrated);
      return migrated;
    }

    if (parsed && typeof parsed === "object" && Array.isArray(parsed.sprints)) {
      return parsed.sprints.map(normaliseSprint);
    }

    return [];
  } catch {
    return [];
  }
}

function persistSprints(mode = "work", sprints = []) {
  if (mode !== "work") {
    return;
  }

  localStorage.setItem(
    SPRINT_STORAGE_KEY,
    JSON.stringify({ schemaVersion: SPRINT_SCHEMA_VERSION, sprints })
  );
}

function normaliseSprint(sprint) {
  return {
    id: sprint.id || buildSprintId(),
    name: sprint.name || "",
    startDate: sprint.startDate || "",
    endDate: sprint.endDate || "",
    status: SPRINT_STATUSES.includes(sprint.status) ? sprint.status : "planning",
    taskIds: uniqueTaskIds(sprint.taskIds),
    archived: Boolean(sprint.archived || sprint.status === "archived"),
    createdAt: sprint.createdAt || new Date().toISOString(),
    updatedAt: sprint.updatedAt || new Date().toISOString(),
    lastUpdatedByField:
      sprint.lastUpdatedByField && typeof sprint.lastUpdatedByField === "object"
        ? sprint.lastUpdatedByField
        : {}
  };
}

function uniqueTaskIds(taskIds) {
  if (!Array.isArray(taskIds)) {
    return [];
  }
  return Array.from(new Set(taskIds.filter(Boolean)));
}

function metricCard(label, value) {
  const card = document.createElement("article");
  card.className = "person-card";

  const heading = document.createElement("h3");
  heading.textContent = label;

  const body = document.createElement("p");
  body.className = "person-meta";
  body.textContent = value;

  card.append(heading, body);
  return card;
}

function paceClass(sprint, tasks) {
  const pace = computeSprintMetrics(sprint, tasks).paceLabel;
  if (pace === "Ahead") {
    return "active";
  }
  if (pace === "Behind") {
    return "archived";
  }
  return "active";
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

function createField(labelText, type, value, required) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
  input.value = value;
  input.required = required;

  wrap.appendChild(input);
  return { wrap, input };
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
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

function buildSprintId() {
  return `sprint_${Math.random().toString(36).slice(2, 10)}`;
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

function isoDateOnly(value) {
  return value.slice(0, 10);
}
