import { loadProjects } from "./projects-store.js";
import { loadVersionedCollection, persistVersionedCollection, safeJsonParse } from "./storage-core.js";
import { hydrateSelectOptions } from "./select-controls.js";
import { generateId } from "./id.js";
import { createModalDismissGuard } from "./modal-dismiss-guard.js";
import { buildPersonalStorageKey } from "./personal-keys.js";

const TASK_STORAGE_KEY_PREFIX = "second-brain.work.tasks";
const TASK_SCHEMA_VERSION = 1;
const PEOPLE_STORAGE_KEY_PREFIX = "second-brain.work.people";

const TASK_STATUSES = [
  "Backlog",
  "Ready",
  "In Progress",
  "Blocked",
  "Waiting On",
  "Done",
  "Cancelled"
];

/**
 * Maps canonical task status values to stable class-name suffixes used by status badges.
 */
const TASK_STATUS_CLASS_SUFFIX = {
  Backlog: "backlog",
  Ready: "ready",
  "In Progress": "in-progress",
  Blocked: "blocked",
  "Waiting On": "waiting-on",
  Done: "done",
  Cancelled: "cancelled"
};

const PRIORITY_SCORE_BANDS = {
  high: 80,
  medium: 50
};

/**
 * Maps historic/legacy task status values to canonical status values from SPECS §7.2.
 * This keeps older localStorage records loadable while converging all writes to canonical values.
 */
const LEGACY_STATUS_MIGRATION_MAP = {
  backlog: "Backlog",
  ready: "Ready",
  "in progress": "In Progress",
  blocked: "Blocked",
  "on hold": "Waiting On",
  "waiting on": "Waiting On",
  completed: "Done",
  done: "Done",
  cancelled: "Cancelled",
  canceled: "Cancelled"
};

const RECURRENCE_OPTIONS = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "weekdays",
  "weekends",
  "custom"
];

const RECURRENCE_FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const MAX_RECURRENCE_GENERATIONS_PER_LOAD = 24;
const TASK_DATE_FALLBACK = "9999-12-31";
const TASK_DEPENDENCY_RECENT_LIMIT = 6;

/**
 * Renders the work task module with CRUD, archive, filtering, and score-based ordering.
 */
export function renderWorkTasksModule({ mode = "work", openComposer = false } = {}) {
  const state = {
    mode,
    statusFilter: "all",
    assigneeFilter: "all",
    projectFilter: "all",
    includeArchived: false,
    drawerOpen: openComposer,
    drawerTaskId: "",
    drawerInitialSection: "core",
    // Keep a single active inline editing row to preserve table density.
    editingTaskId: "",
    hasInlineEdits: false,
    // Persisted focus-return target improves keyboard workflow when collapsing rows.
    focusEditButtonTaskId: "",
    feedback: "",
    newlyCreatedTaskId: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard tasks-module";

  const header = document.createElement("div");
  header.className = "meetings-header";

  const headingWrap = document.createElement("div");
  const title = document.createElement("h1");
  const isPersonalMode = state.mode === "personal";
  title.textContent = isPersonalMode ? "Personal Tasks" : "Work Tasks";
  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent = isPersonalMode
    ? "Capture one-off and recurring tasks with the same planning workflow used in Work mode."
    : "Capture one-off and recurring tasks, assign owners and projects, and triage by priority score.";
  headingWrap.append(title, intro);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "enter-mode-button";
  addButton.textContent = "New task";
  addButton.addEventListener("click", () => {
    openTaskDrawer();
    renderModule();
  });

  const archiveDoneButton = document.createElement("button");
  archiveDoneButton.type = "button";
  archiveDoneButton.className = "secondary-button";
  archiveDoneButton.textContent = "Archive done tasks";
  archiveDoneButton.addEventListener("click", () => {
    const archivedCount = archiveCompletedTasks(state.mode);
    state.feedback = archivedCount > 0
      ? `Archived ${archivedCount} completed ${archivedCount === 1 ? "task" : "tasks"}.`
      : "No done tasks to archive.";
    renderModule();
  });

  const headerActions = document.createElement("div");
  headerActions.className = "tasks-header-actions";
  headerActions.append(addButton, archiveDoneButton);

  header.append(headingWrap, headerActions);

  const feedback = document.createElement("p");
  feedback.className = "feedback";

  const controls = document.createElement("div");
  controls.className = "people-controls tasks-toolbar";

  const list = document.createElement("div");
  list.className = "tasks-list";

  const modalHost = document.createElement("div");
  modalHost.className = "tasks-modal-host";

  section.append(header, feedback, controls, list, modalHost);

  function renderModule() {
    const people = loadPeople(state.mode);
    const projects = loadProjects(state.mode);
    const tasks = loadTasks(state.mode);

    controls.innerHTML = "";
    const filtersWrap = document.createElement("div");
    filtersWrap.className = "tasks-toolbar-filters";
    filtersWrap.append(
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
    controls.appendChild(filtersWrap);

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
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "tasks-toolbar-actions";
    actionsWrap.appendChild(archiveToggleWrap);

    const hasActiveFilters = state.statusFilter !== "all"
      || state.assigneeFilter !== "all"
      || state.projectFilter !== "all"
      || state.includeArchived;
    if (hasActiveFilters) {
      const clearFiltersButton = document.createElement("button");
      clearFiltersButton.type = "button";
      clearFiltersButton.className = "secondary-button clear-filters";
      clearFiltersButton.textContent = "Clear filters";
      clearFiltersButton.addEventListener("click", () => {
        state.statusFilter = "all";
        state.assigneeFilter = "all";
        state.projectFilter = "all";
        state.includeArchived = false;
        renderModule();
      });
      actionsWrap.appendChild(clearFiltersButton);
    }
    controls.appendChild(actionsWrap);

    const filtered = tasks
      .filter((task) => (state.includeArchived ? true : !task.archived))
      .filter((task) => (state.statusFilter === "all" ? true : task.status === state.statusFilter))
      .filter((task) => (state.assigneeFilter === "all" ? true : task.assigneeId === state.assigneeFilter))
      .filter((task) => (state.projectFilter === "all" ? true : task.projectId === state.projectFilter))
      .map((task) => ({ ...task, priorityScore: computePriorityScore(task) }))
      .sort((first, second) => {
        const firstTimelineDate = getTaskTimelineSortDate(first);
        const secondTimelineDate = getTaskTimelineSortDate(second);
        if (firstTimelineDate !== secondTimelineDate) {
          return firstTimelineDate.localeCompare(secondTimelineDate);
        }

        if (second.priorityScore !== first.priorityScore) {
          return second.priorityScore - first.priorityScore;
        }

        return stableTieBreaker(first.id) - stableTieBreaker(second.id);
      });

    list.innerHTML = "";
    modalHost.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No tasks match your current filters.";
      list.appendChild(empty);
    } else {
      const { wrap: tableWrap, body: tableBody } = createTaskTable();
      list.appendChild(tableWrap);

      const taskById = new Map(tasks.map((entry) => [entry.id, entry]));
      for (const task of filtered) {
        const dependencyState = resolveDependencyState(task, taskById);
        tableBody.appendChild(
          createTaskTableRow(task, {
            isEditing: state.editingTaskId === task.id,
            people,
            projects,
            dependencyState,
            isNewlyCreated: state.newlyCreatedTaskId === task.id,
            onOpenEditor: () => {
              if (!requestInlineEditorSwitch(task.id)) {
                return;
              }
              state.focusEditButtonTaskId = task.id;
              renderModule();
            },
            onCancelEdit: () => {
              closeInlineEditor(task.id);
              renderModule();
            },
            onToggleArchived: () => {
              updateTaskInline(state.mode, task.id, { archived: !task.archived });
              state.feedback = task.archived ? "Task unarchived." : "Task archived.";
              renderModule();
            },
            onOpenFullEditor: () => {
              openTaskDrawer(task.id);
              renderModule();
            },
            onOpenDependencies: () => {
              openTaskDrawer(task.id, "dependencies");
              renderModule();
            },
            onSaveInline: (payload) => {
              const result = saveTask(state.mode, payload, task.id);
              if (!result.ok) {
                state.feedback = result.error;
                renderModule();
                return;
              }

              state.feedback = "Task updated.";
              closeInlineEditor(task.id);
              renderModule();
            },
            onEditDirty: () => {
              state.hasInlineEdits = true;
            }
          })
        );
      }
    }

    if (state.drawerOpen) {
      const activeTask = state.drawerTaskId ? tasks.find((item) => item.id === state.drawerTaskId) : null;
      modalHost.appendChild(
        createTaskDrawer({
          task: activeTask,
          tasks,
          people,
          projects,
          initialSection: state.drawerInitialSection,
          onSave: (payload) => {
            const result = saveTask(state.mode, payload, activeTask?.id || "");
            if (!result.ok) {
              state.feedback = result.error;
              renderModule();
              return;
            }

            const reloadedTasks = loadTasks(state.mode);
            if (!activeTask) {
              const created = reloadedTasks[reloadedTasks.length - 1];
              state.newlyCreatedTaskId = created?.id || "";
            }
            state.feedback = activeTask ? "Task updated." : "Task created.";
            closeTaskDrawer();
            renderModule();
            if (state.newlyCreatedTaskId) {
              setTimeout(() => {
                state.newlyCreatedTaskId = "";
                renderModule();
              }, 1400);
            }
          },
          onCancel: () => {
            closeTaskDrawer();
            renderModule();
          }
        })
      );
    }

    feedback.textContent = state.feedback;
    feedback.hidden = !state.feedback;

    if (state.focusEditButtonTaskId) {
      const button = section.querySelector(`[data-task-edit-trigger="${state.focusEditButtonTaskId}"]`);
      button?.focus();
      state.focusEditButtonTaskId = "";
    }
  }

  function requestInlineEditorSwitch(nextTaskId) {
    if (!state.hasInlineEdits || !state.editingTaskId || state.editingTaskId === nextTaskId) {
      state.editingTaskId = nextTaskId;
      state.hasInlineEdits = false;
      return true;
    }

    if (!window.confirm("Discard unsaved task changes?")) {
      return false;
    }

    state.editingTaskId = nextTaskId;
    state.hasInlineEdits = false;
    return true;
  }

  function closeInlineEditor(focusTaskId = "") {
    state.editingTaskId = "";
    state.hasInlineEdits = false;
    state.focusEditButtonTaskId = focusTaskId;
  }

  function openTaskDrawer(taskId = "", initialSection = "core") {
    state.drawerOpen = true;
    state.drawerTaskId = taskId;
    state.drawerInitialSection = initialSection;
  }

  function closeTaskDrawer() {
    state.drawerOpen = false;
    state.drawerTaskId = "";
    state.drawerInitialSection = "core";
  }

  renderModule();
  return section;
}

/**
 * Builds the task table used by the compact task workflow.
 */
function createTaskTable() {
  const wrap = document.createElement("div");
  wrap.className = "tasks-table-wrap";

  const table = document.createElement("table");
  table.className = "tasks-table";

  const headRow = document.createElement("tr");
  ["Title", "Status", "Due date", "Priority", "Actions"].forEach((labelText) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = labelText;
    headRow.appendChild(cell);
  });

  const thead = document.createElement("thead");
  thead.appendChild(headRow);

  const body = document.createElement("tbody");
  table.append(thead, body);
  wrap.appendChild(table);
  return { wrap, body };
}

/**
 * Creates a task table row that can switch between read-only and inline-edit modes.
 */
function createTaskTableRow(task, {
  isEditing,
  people,
  projects,
  dependencyState,
  isNewlyCreated,
  onOpenEditor,
  onOpenFullEditor,
  onOpenDependencies,
  onCancelEdit,
  onToggleArchived,
  onSaveInline,
  onEditDirty
}) {
  const row = document.createElement("tr");
  row.className = `task-table-row${isNewlyCreated ? " task-table-row-new" : ""}`;

  if (!isEditing) {
    row.append(
      createTaskTitleCell(task, dependencyState, onOpenDependencies),
      createTableStatusCell(task.status),
      createTableDueDateCell(task.dueDate),
      createTablePriorityCell(task.priorityScore),
      createTaskActionsCell({ task, onOpenEditor, onOpenFullEditor, onToggleArchived })
    );
    return row;
  }

  const title = document.createElement("input");
  title.className = "field-input";
  title.type = "text";
  title.required = true;
  title.value = task.title || "";

  const status = document.createElement("select");
  status.className = "field-input";
  TASK_STATUSES.forEach((value) => addOption(status, value, value));
  status.value = task.status || "Backlog";

  const dueDate = document.createElement("input");
  dueDate.className = "field-input";
  dueDate.type = "date";
  dueDate.value = task.dueDate || "";

  const effort = document.createElement("input");
  effort.className = "field-input";
  effort.type = "number";
  effort.min = "1";
  effort.max = "10";
  effort.value = String(task.effort || 5);

  const impact = document.createElement("input");
  impact.className = "field-input";
  impact.type = "number";
  impact.min = "1";
  impact.max = "10";
  impact.value = String(task.impact || 5);

  const actions = document.createElement("td");
  actions.className = "tasks-table-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save";
  /**
   * Persists the current inline row draft and lets the caller transition
   * back to read-only mode after a successful save.
   */
  const commitInlineDraft = () => {
    onSaveInline({
      title: title.value.trim(),
      effort: clampTaskScaleValue(effort.value, task.effort || 5),
      impact: clampTaskScaleValue(impact.value, task.impact || 5),
      status: status.value,
      assigneeId: task.assigneeId || "",
      projectId: task.projectId || "",
      scheduleDate: task.scheduleDate || "",
      dueDate: dueDate.value,
      blockedByTaskIds: task.blockedByTaskIds || [],
      blockingTaskIds: task.blockingTaskIds || [],
      recurrence: task.recurrence || "none",
      customRecurrence: task.customRecurrence || "",
      recurrenceMeta: task.recurrenceMeta || { frequency: "none", interval: 1 },
      recurrenceInterval: task.recurrenceMeta?.interval || 1,
      notes: task.notes || "",
      archived: task.archived || false
    });
  };

  saveButton.addEventListener("click", commitInlineDraft);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", onCancelEdit);

  actions.append(saveButton, cancelButton);

  // Any user input marks the row dirty so editor-switch confirmation can protect unsaved changes.
  const inlineFields = [title, status, dueDate, effort, impact];
  inlineFields.forEach((field) => {
    field.addEventListener("input", onEditDirty);
    field.addEventListener("change", onEditDirty);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelEdit();
        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      commitInlineDraft();
    });
  });

  row.append(
    createTableInputCell(createInlineTitleCell(title, dependencyState, onOpenDependencies)),
    createTableInputCell(status),
    createTableInputCell(dueDate),
    createTableInputCell(createInlinePriorityFields(effort, impact)),
    actions
  );

  setTimeout(() => title.focus(), 0);
  return row;
}


function createTaskTitleCell(task, dependencyState, onOpenDependencies) {
  const cell = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "task-title-cell-wrap";

  const title = document.createElement("span");
  title.className = "task-title-clamp";
  title.textContent = task.title || "Untitled task";
  title.title = task.title || "Untitled task";

  wrap.appendChild(title);

  if (dependencyState.hasDependencies) {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.className = `task-dependency-indicator${dependencyState.isBlocked ? " is-blocked" : ""}`;
    indicator.textContent = dependencyState.isBlocked ? "⛓ Blocked" : "⛓";
    indicator.title = dependencyState.tooltip;
    indicator.setAttribute("aria-label", dependencyState.tooltip);
    indicator.addEventListener("click", onOpenDependencies);
    wrap.appendChild(indicator);
  }

  cell.appendChild(wrap);
  return cell;
}

function createInlineTitleCell(titleInput, dependencyState, onOpenDependencies) {
  const wrap = document.createElement("div");
  wrap.className = "task-title-cell-wrap";
  wrap.appendChild(titleInput);

  if (dependencyState.hasDependencies) {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.className = `task-dependency-indicator${dependencyState.isBlocked ? " is-blocked" : ""}`;
    indicator.textContent = dependencyState.isBlocked ? "⛓ Blocked" : "⛓";
    indicator.title = dependencyState.tooltip;
    indicator.setAttribute("aria-label", dependencyState.tooltip);
    indicator.addEventListener("click", onOpenDependencies);
    wrap.appendChild(indicator);
  }

  return wrap;
}

function createTableTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

/**
 * Formats a persisted yyyy-mm-dd value into the locale-friendly short date used by table cells.
 *
 * Returning an em dash for blank/invalid values keeps dense table rows readable while still
 * making the absence of a schedule/due date explicit to users.
 */
function formatTaskDateDisplay(dateValue) {
  if (!dateValue) {
    return "—";
  }

  const parsedDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return "—";
  }

  return parsedDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function createTableStatusCell(status) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `task-status-badge task-status-${getTaskStatusClassSuffix(status)}`;
  badge.textContent = status;
  cell.appendChild(badge);
  return cell;
}

/**
 * Applies semantic urgency styling to due-date values so users can triage from
 * the table scan line without opening row details.
 */
function createTableDueDateCell(dateValue) {
  const cell = document.createElement("td");
  const state = getDueDateState(dateValue);
  cell.className = `task-due-date-cell task-due-date-${state}`;
  cell.textContent = formatTaskDateDisplay(dateValue);
  return cell;
}

function getDueDateState(dateValue) {
  if (!dateValue) {
    return "no-date";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) {
    return "no-date";
  }

  if (dueDate < today) {
    return "overdue";
  }

  return "upcoming";
}

function createTablePriorityCell(priorityScore) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `task-meta-pill task-meta-pill-${getPriorityScoreBand(priorityScore)}`;
  badge.textContent = String(priorityScore);
  cell.appendChild(badge);
  return cell;
}


/**
 * Returns a CSS-safe suffix for task status badges used in table and modal surfaces.
 */
function getTaskStatusClassSuffix(status) {
  return TASK_STATUS_CLASS_SUFFIX[status] || "backlog";
}

/**
 * Buckets priority score for at-a-glance visual triage bands.
 */
function getPriorityScoreBand(priorityScore) {
  if (priorityScore >= PRIORITY_SCORE_BANDS.high) {
    return "high";
  }

  if (priorityScore >= PRIORITY_SCORE_BANDS.medium) {
    return "medium";
  }
  return "low";
}

function createTaskActionsCell({ task, onOpenEditor, onOpenFullEditor, onToggleArchived }) {
  const cell = document.createElement("td");
  cell.className = "tasks-table-actions";

  const editButton = createIconButton("✏", "Inline edit task", "task-icon-button");
  editButton.dataset.taskEditTrigger = task.id;
  editButton.addEventListener("click", onOpenEditor);

  const drawerButton = createIconButton("▦", "Open full task editor", "task-icon-button");
  drawerButton.addEventListener("click", onOpenFullEditor);

  const archiveButton = createIconButton("🗄", task.archived ? "Unarchive task" : "Archive task", "task-icon-button");
  archiveButton.addEventListener("click", onToggleArchived);

  cell.append(editButton, drawerButton, archiveButton);
  return cell;
}

function createIconButton(icon, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = icon;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function createTableInputCell(content) {
  const cell = document.createElement("td");
  if (content instanceof Node) {
    cell.appendChild(content);
  } else {
    cell.textContent = String(content || "");
  }
  return cell;
}

function createInlinePriorityFields(effort, impact) {
  const wrap = document.createElement("div");
  wrap.className = "task-inline-priority-fields";

  const effortWrap = document.createElement("label");
  effortWrap.className = "task-inline-priority-item";
  effortWrap.textContent = "E";
  effortWrap.appendChild(effort);

  const impactWrap = document.createElement("label");
  impactWrap.className = "task-inline-priority-item";
  impactWrap.textContent = "I";
  impactWrap.appendChild(impact);

  wrap.append(effortWrap, impactWrap);
  return wrap;
}

function createTaskDrawer({ task, tasks, people, projects, initialSection = "core", onSave, onCancel }) {
  const isEditMode = Boolean(task);
  const overlay = document.createElement("div");
  overlay.className = "task-drawer-overlay";
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
  form.className = "task-drawer";

  const header = document.createElement("header");
  header.className = "task-drawer-header";
  const headingWrap = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = isEditMode ? "Edit task" : "New task";
  const priorityNote = document.createElement("p");
  priorityNote.className = "task-drawer-priority";
  headingWrap.append(heading, priorityNote);

  const closeButton = createIconButton("✕", "Close task editor", "task-icon-button");
  closeButton.addEventListener("click", requestClose);
  header.append(headingWrap, closeButton);

  const body = document.createElement("div");
  body.className = "task-drawer-body";

  const title = createField("Title", "text", task?.title || "", true);
  const statusWrap = document.createElement("label");
  statusWrap.className = "field-label";
  statusWrap.textContent = "Status";
  const status = document.createElement("select");
  status.className = "field-input";
  for (const value of TASK_STATUSES) {
    addOption(status, value, toTitleCase(value));
  }
  status.value = task?.status || "Backlog";
  statusWrap.appendChild(status);

  const dueDate = createField("Due date", "date", task?.dueDate || "", false);
  const effort = createField("Effort", "number", String(task?.effort || 5), true, { min: "1", max: "10" });
  const impact = createField("Impact", "number", String(task?.impact || 5), true, { min: "1", max: "10" });

  const assigneeWrap = document.createElement("label");
  assigneeWrap.className = "field-label";
  assigneeWrap.textContent = "Assignee";
  const assignee = document.createElement("select");
  assignee.className = "field-input";
  addOption(assignee, "", "Unassigned");
  for (const person of people) addOption(assignee, person.id, person.name);
  assignee.value = task?.assigneeId || "";
  assigneeWrap.appendChild(assignee);

  const projectWrap = document.createElement("label");
  projectWrap.className = "field-label";
  projectWrap.textContent = "Project";
  const project = document.createElement("select");
  project.className = "field-input";
  addOption(project, "", "No project");
  for (const entry of projects) addOption(project, entry.id, entry.title);
  project.value = task?.projectId || "";
  projectWrap.appendChild(project);

  const coreSection = document.createElement("section");
  coreSection.className = "task-drawer-section";
  coreSection.dataset.section = "core";
  const coreTitle = document.createElement("h3");
  coreTitle.textContent = "Core";
  const coreGrid = document.createElement("div");
  coreGrid.className = "task-drawer-grid";
  const effortImpactRow = document.createElement("div");
  effortImpactRow.className = "task-drawer-grid task-drawer-grid-2";
  effortImpactRow.append(effort.wrap, impact.wrap);
  coreGrid.append(title.wrap, statusWrap, dueDate.wrap, effortImpactRow, assigneeWrap, projectWrap);
  coreSection.append(coreTitle, coreGrid);

  const recurrence = document.createElement("select");
  recurrence.className = "field-input";
  for (const value of RECURRENCE_OPTIONS) addOption(recurrence, value, toTitleCase(value));
  recurrence.value = task?.recurrence || "none";
  const recurrenceWrap = document.createElement("label");
  recurrenceWrap.className = "field-label";
  recurrenceWrap.textContent = "Recurrence type";
  recurrenceWrap.appendChild(recurrence);
  const recurrenceInterval = createField("Recurrence interval", "number", String(task?.recurrenceMeta?.interval || 1), false, { min: "1", step: "1" });
  const customRecurrence = createField("Notes about recurrence", "text", task?.customRecurrence || "", false);
  const recurrenceFields = document.createElement("div");
  recurrenceFields.className = "task-drawer-grid task-drawer-grid-2";
  recurrenceFields.append(recurrenceInterval.wrap, customRecurrence.wrap);

  const recurrenceSection = document.createElement("details");
  recurrenceSection.className = "task-drawer-collapsible";
  const recurrenceSummary = document.createElement("summary");
  recurrenceSummary.textContent = "Recurrence";
  recurrenceSection.append(recurrenceSummary, recurrenceWrap, recurrenceFields);

  const blockedByTaskIds = buildTaskDependencyPickerField({
    label: "Blocked by", tasks, people, projects, currentTaskId: task?.id || "", selectedIds: parseTaskIdList(task?.blockedByTaskIds), primaryAssigneeId: task?.assigneeId || "", primaryProjectId: task?.projectId || "", emptyMessage: "Create another task first to link dependencies."
  });
  const blockingTaskIds = buildTaskDependencyPickerField({
    label: "Blocking", tasks, people, projects, currentTaskId: task?.id || "", selectedIds: parseTaskIdList(task?.blockingTaskIds), primaryAssigneeId: task?.assigneeId || "", primaryProjectId: task?.projectId || "", emptyMessage: "Create another task first to link dependencies."
  });
  const dependencyGrid = document.createElement("div");
  dependencyGrid.className = "task-drawer-grid task-drawer-grid-2 task-drawer-dependency-grid";
  dependencyGrid.append(blockedByTaskIds.wrapper, blockingTaskIds.wrapper);

  const dependencyOpenToggleWrap = document.createElement("label");
  dependencyOpenToggleWrap.className = "field-label";
  dependencyOpenToggleWrap.textContent = "Open tasks only";
  const dependencyOpenToggle = document.createElement("input");
  dependencyOpenToggle.type = "checkbox";
  dependencyOpenToggle.checked = true;
  dependencyOpenToggleWrap.appendChild(dependencyOpenToggle);
  dependencyOpenToggle.addEventListener("change", () => {
    const filter = dependencyOpenToggle.checked ? "open" : "all";
    blockedByTaskIds.applyFilter(filter);
    blockingTaskIds.applyFilter(filter);
  });

  const dependencySection = document.createElement("details");
  dependencySection.className = "task-drawer-collapsible";
  dependencySection.dataset.section = "dependencies";
  const dependencySummary = document.createElement("summary");
  dependencySummary.textContent = "Dependencies";
  dependencySection.append(dependencySummary, dependencyOpenToggleWrap, dependencyGrid);

  const notes = createField("Notes", "textarea", task?.notes || "", false);
  const notesSection = document.createElement("details");
  notesSection.className = "task-drawer-collapsible";
  const notesSummary = document.createElement("summary");
  notesSummary.textContent = "Notes";
  notesSection.append(notesSummary, notes.wrap);

  const footer = document.createElement("footer");
  footer.className = "task-drawer-footer";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "primary-button";
  saveButton.textContent = isEditMode ? "Save changes" : "Create task";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", requestClose);
  footer.append(saveButton, cancelButton);

  body.append(coreSection, recurrenceSection, dependencySection, notesSection);
  form.append(header, body, footer);

  const refreshPriority = () => {
    const priority = computePriorityScore({
      dueDate: dueDate.input.value,
      effort: clampTaskScaleValue(effort.input.value, 5),
      impact: clampTaskScaleValue(impact.input.value, 5)
    });
    priorityNote.textContent = `Priority: ${priority} (ℹ Priority is calculated from Effort, Impact, and Due date.)`;
  };
  [dueDate.input, effort.input, impact.input].forEach((field) => {
    field.addEventListener("input", refreshPriority);
    field.addEventListener("change", refreshPriority);
  });
  refreshPriority();

  const initialPayloadBaseline = JSON.stringify({
    status: status.value,
    dueDate: dueDate.input.value,
    effort: effort.input.value,
    impact: impact.input.value
  });

  title.input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || isEditMode) return;
    const currentBaseline = JSON.stringify({
      status: status.value,
      dueDate: dueDate.input.value,
      effort: effort.input.value,
      impact: impact.input.value
    });
    if (currentBaseline !== initialPayloadBaseline) return;
    event.preventDefault();
    form.requestSubmit();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({
      title: title.input.value.trim(),
      effort: clampTaskScaleValue(effort.input.value, task?.effort || 5),
      impact: clampTaskScaleValue(impact.input.value, task?.impact || 5),
      status: status.value,
      assigneeId: assignee.value,
      projectId: project.value,
      scheduleDate: task?.scheduleDate || "",
      dueDate: dueDate.input.value,
      recurrence: recurrence.value,
      customRecurrence: customRecurrence.input.value.trim(),
      recurrenceInterval: Number(recurrenceInterval.input.value) || 1,
      blockedByTaskIds: readDependencyPickerHiddenValues(blockedByTaskIds.hiddenInput),
      blockingTaskIds: readDependencyPickerHiddenValues(blockingTaskIds.hiddenInput),
      notes: notes.input.value.trim(),
      archived: Boolean(task?.archived)
    });
  });

  dismissGuard.bindDirtyTracking(form);
  overlay.appendChild(form);

  if (initialSection === "dependencies") {
    dependencySection.open = true;
  }

  setTimeout(() => {
    title.input.focus();
  }, 0);

  return overlay;
}

function createSelectFilter(labelText, selected, options, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;
  const select = document.createElement("select");
  select.className = "field-input";
  hydrateSelectOptions(select, options);
  select.value = selected;
  select.addEventListener("change", () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

/**
 * Creates a scalable tokenised dependency picker with built-in filters and recency quick-picks.
 *
 * The picker intentionally mirrors the entity token pattern so dependency selection remains
 * discoverable even when a workspace has a large task corpus.
 */
function buildTaskDependencyPickerField({
  label,
  tasks,
  people,
  projects,
  currentTaskId = "",
  selectedIds = [],
  primaryAssigneeId = "",
  primaryProjectId = "",
  emptyMessage = ""
}) {
  const wrapper = document.createElement("label");
  wrapper.className = "field-label";
  wrapper.textContent = label;

  const picker = document.createElement("div");
  picker.className = "field-input entity-token-field dependency-picker";

  const filterRow = document.createElement("div");
  filterRow.className = "dependency-picker-controls";

  const filterSelect = document.createElement("select");
  filterSelect.className = "field-input";

  const tokenList = document.createElement("div");
  tokenList.className = "token-multi-select-list";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "field-input";
  input.placeholder = "Search tasks by title, status, assignee, or project";

  const suggestions = document.createElement("ul");
  suggestions.className = "token-multi-select-suggestions";

  const quickPickRow = document.createElement("div");
  quickPickRow.className = "dependency-picker-quick-picks";

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";

  const peopleById = new Map(people.map((person) => [person.id, person.name || "Unassigned"]));
  const projectsById = new Map(projects.map((project) => [project.id, project.title || "No project"]));

  const candidates = tasks
    // Anti-self-linking starts in the UI so impossible choices are never offered.
    .filter((entry) => entry.id && entry.id !== currentTaskId)
    .map((entry) => ({
      id: entry.id,
      title: entry.title || "Untitled task",
      status: normaliseTaskStatus(entry.status),
      assigneeId: entry.assigneeId || "",
      assigneeLabel: peopleById.get(entry.assigneeId) || "Unassigned",
      projectId: entry.projectId || "",
      projectLabel: projectsById.get(entry.projectId) || "No project",
      updatedAt: entry.updatedAt || "",
      searchBlob: `${entry.title || ""} ${normaliseTaskStatus(entry.status)} ${
        peopleById.get(entry.assigneeId) || "Unassigned"
      } ${projectsById.get(entry.projectId) || "No project"}`.toLowerCase()
    }));

  const selected = [];

  const filterOptions = buildDependencyFilterOptions({
    statuses: TASK_STATUSES,
    primaryProjectId,
    primaryAssigneeId
  });
  hydrateSelectOptions(filterSelect, filterOptions);
  filterSelect.value = "open";

  const quickPickIds = getRecentDependencyTaskIds(candidates, TASK_DEPENDENCY_RECENT_LIMIT);
  const recentTaskIdSet = new Set(quickPickIds);

  const syncHiddenInput = () => {
    hiddenInput.value = selected.join(",");
  };

  const addDependency = (id) => {
    if (!id || selected.includes(id) || !candidates.some((entry) => entry.id === id)) {
      return;
    }
    selected.push(id);
    input.value = "";
    renderTokens();
    renderSuggestions();
    renderQuickPicks();
    syncHiddenInput();
  };

  const removeDependency = (id) => {
    const index = selected.indexOf(id);
    if (index < 0) {
      return;
    }
    selected.splice(index, 1);
    renderTokens();
    renderSuggestions();
    renderQuickPicks();
    syncHiddenInput();
  };

  const getVisibleCandidates = () => {
    const filterText = input.value.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (selected.includes(candidate.id)) {
        return false;
      }

      const activeFilter = filterSelect.value;
      if (!matchesDependencyFilter(candidate, activeFilter, {
        primaryProjectId,
        primaryAssigneeId,
        recentTaskIdSet
      })) {
        return false;
      }

      return !filterText || candidate.searchBlob.includes(filterText);
    });
  };

  const renderTokens = () => {
    tokenList.innerHTML = "";
    selected.forEach((id) => {
      const candidate = candidates.find((entry) => entry.id === id);
      if (!candidate) {
        return;
      }

      const token = document.createElement("span");
      token.className = "entity-token";

      const labelEl = document.createElement("span");
      labelEl.className = "entity-token-label";
      labelEl.textContent = `${candidate.title} · ${toTitleCase(candidate.status)}`;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "entity-token-remove";
      removeButton.setAttribute("aria-label", `Remove dependency ${candidate.title}`);
      removeButton.textContent = "×";
      removeButton.addEventListener("click", () => removeDependency(id));

      token.append(labelEl, removeButton);
      tokenList.appendChild(token);
    });
  };

  const renderSuggestions = () => {
    suggestions.innerHTML = "";
    getVisibleCandidates().slice(0, 25).forEach((candidate) => {
      const option = document.createElement("li");
      option.className = "token-multi-select-option";
      option.textContent = `${candidate.title} · ${toTitleCase(candidate.status)} · ${candidate.assigneeLabel}`;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        addDependency(candidate.id);
      });
      suggestions.appendChild(option);
    });
  };

  const renderQuickPicks = () => {
    quickPickRow.innerHTML = "";
    quickPickIds.forEach((id) => {
      if (selected.includes(id)) {
        return;
      }
      const candidate = candidates.find((entry) => entry.id === id);
      if (!candidate) {
        return;
      }
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ghost-button dependency-picker-quick-chip";
      chip.textContent = candidate.title;
      chip.addEventListener("click", () => addDependency(id));
      quickPickRow.appendChild(chip);
    });
  };

  filterSelect.addEventListener("change", renderSuggestions);
  input.addEventListener("input", renderSuggestions);
  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const firstCandidate = getVisibleCandidates()[0];
    if (!firstCandidate) {
      return;
    }
    event.preventDefault();
    addDependency(firstCandidate.id);
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      suggestions.innerHTML = "";
    }, 100);
  });

  parseTaskIdList(selectedIds).forEach((id) => {
    if (candidates.some((candidate) => candidate.id === id)) {
      selected.push(id);
    }
  });

  renderTokens();
  renderQuickPicks();
  syncHiddenInput();

  picker.append(filterRow, tokenList, input, suggestions, quickPickRow);
  filterRow.appendChild(filterSelect);
  wrapper.append(picker, hiddenInput);

  if (emptyMessage && candidates.length === 0) {
    const note = document.createElement("small");
    note.className = "module-intro";
    note.textContent = emptyMessage;
    wrapper.appendChild(note);
    input.disabled = true;
    filterSelect.disabled = true;
  }

  return {
    wrapper,
    hiddenInput,
    applyFilter: (value) => {
      filterSelect.value = value;
      renderSuggestions();
    }
  };
}

/**
 * Exposes a consistent filter contract for dependency lookups and quick narrowing.
 */
function buildDependencyFilterOptions({ statuses, primaryProjectId, primaryAssigneeId }) {
  const options = [
    { value: "open", label: "Open tasks" },
    { value: "all", label: "All tasks" },
    { value: "recent", label: "Recently edited" }
  ];

  if (primaryProjectId) {
    options.push({ value: "same-project", label: "Same project" });
  }
  if (primaryAssigneeId) {
    options.push({ value: "same-assignee", label: "Same assignee" });
  }

  statuses.forEach((status) => {
    options.push({ value: `status:${status}`, label: `Status: ${toTitleCase(status)}` });
  });
  return options;
}

/**
 * Centralises dependency filter semantics so form UI and future APIs stay in sync.
 */
function matchesDependencyFilter(candidate, filterValue, { primaryProjectId, primaryAssigneeId, recentTaskIdSet }) {
  if (filterValue === "all") {
    return true;
  }
  if (filterValue === "open") {
    return !["Done", "Cancelled"].includes(candidate.status);
  }
  if (filterValue === "recent") {
    return recentTaskIdSet?.has(candidate.id) || false;
  }
  if (filterValue === "same-project") {
    return Boolean(primaryProjectId) && candidate.projectId === primaryProjectId;
  }
  if (filterValue === "same-assignee") {
    return Boolean(primaryAssigneeId) && candidate.assigneeId === primaryAssigneeId;
  }
  if (filterValue.startsWith("status:")) {
    return candidate.status === filterValue.slice("status:".length);
  }
  return true;
}

/**
 * Produces a short list of recent open tasks for one-click dependency quick picks.
 */
function getRecentDependencyTaskIds(candidates, limit) {
  return [...candidates]
    .filter((candidate) => !["Done", "Cancelled"].includes(candidate.status))
    .sort((first, second) => {
      const firstTime = Date.parse(first.updatedAt || "") || 0;
      const secondTime = Date.parse(second.updatedAt || "") || 0;
      return secondTime - firstTime;
    })
    .slice(0, Math.max(0, limit))
    .map((candidate) => candidate.id);
}

function readDependencyPickerHiddenValues(hiddenInput) {
  return parseTaskIdList(hiddenInput?.value || "");
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

export function saveTask(mode, payload, editingId = "") {
  if (!payload.title) {
    return { ok: false, error: "Task title is required." };
  }
  const canonicalStatus = normaliseTaskStatus(payload.status);
  if (!TASK_STATUSES.includes(canonicalStatus)) {
    return { ok: false, error: "Task status is invalid." };
  }
  if (!Number.isFinite(payload.effort) || payload.effort < 1 || payload.effort > 10) {
    return { ok: false, error: "Effort must be between 1 and 10." };
  }
  if (!Number.isFinite(payload.impact) || payload.impact < 1 || payload.impact > 10) {
    return { ok: false, error: "Impact must be between 1 and 10." };
  }

  if (!Array.isArray(payload.blockedByTaskIds) || !Array.isArray(payload.blockingTaskIds)) {
    return { ok: false, error: "Dependency references are invalid." };
  }

  const normalisedBlockedByTaskIds = parseTaskIdList(payload.blockedByTaskIds);
  const normalisedBlockingTaskIds = parseTaskIdList(payload.blockingTaskIds);

  const tasks = loadTasks(mode);
  const now = new Date().toISOString();
  const allowedDependencyTaskIds = new Set(tasks.map((task) => task.id));
  if (editingId) {
    allowedDependencyTaskIds.delete(editingId);
  }

  const canonicalBlockedByTaskIds = normalisedBlockedByTaskIds.filter((id) => allowedDependencyTaskIds.has(id));
  const canonicalBlockingTaskIds = normalisedBlockingTaskIds.filter((id) => allowedDependencyTaskIds.has(id));

  if (editingId) {
    const index = tasks.findIndex((task) => task.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Task not found." };
    }

    const existing = tasks[index];
    const recurrenceMeta = buildRecurrenceMetaFromPayload(payload, existing);
    tasks[index] = {
      ...existing,
      ...payload,
      status: canonicalStatus,
      blockedByTaskIds: canonicalBlockedByTaskIds,
      blockingTaskIds: canonicalBlockingTaskIds,
      recurrenceMeta,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        title: now,
        effort: now,
        impact: now,
        status: now,
        assigneeId: now,
        projectId: now,
        scheduleDate: now,
        dueDate: now,
        recurrence: now,
        customRecurrence: now,
        recurrenceMeta: now,
        recurrenceInterval: now,
        blockedByTaskIds: now,
        blockingTaskIds: now,
        notes: now,
        archived: now
      }
    };

    persistTasks(mode, tasks);
    return { ok: true, wasEdit: true };
  }

  const recurrenceMeta = buildRecurrenceMetaFromPayload(payload, null);
  tasks.push(
    normaliseTask({
      id: buildTaskId(),
      ...payload,
      status: canonicalStatus,
      blockedByTaskIds: canonicalBlockedByTaskIds,
      blockingTaskIds: canonicalBlockingTaskIds,
      recurrenceMeta,
      createdAt: now,
      updatedAt: now,
      lastUpdatedByField: {
        title: now,
        effort: now,
        impact: now,
        status: now,
        assigneeId: now,
        projectId: now,
        scheduleDate: now,
        dueDate: now,
        recurrence: now,
        customRecurrence: now,
        recurrenceMeta: now,
        recurrenceInterval: now,
        blockedByTaskIds: now,
        blockingTaskIds: now,
        notes: now,
        archived: now
      }
    })
  );

  persistTasks(mode, tasks);
  return { ok: true, wasEdit: false };
}

/**
 * Marks a task complete from lightweight surfaces (for example dashboard overviews)
 * without forcing users through the full edit form workflow.
 */
export function markTaskCompleted(mode, taskId) {
  const tasks = loadTasks(mode);
  const now = new Date().toISOString();
  let wasUpdated = false;

  const updated = tasks.map((task) => {
    if (task.id !== taskId || task.status === "Done") {
      return task;
    }

    wasUpdated = true;
    return {
      ...task,
      status: "Done",
      updatedAt: now,
      lastUpdatedByField: {
        ...task.lastUpdatedByField,
        status: now
      }
    };
  });

  if (wasUpdated) {
    persistTasks(mode, updated);
  }

  return wasUpdated;
}

/**
 * Archives all non-archived tasks currently marked as Done.
 *
 * Returns the number of tasks that were archived so callers can surface
 * immediate user feedback in table-level actions.
 */
export function archiveCompletedTasks(mode) {
  const tasks = loadTasks(mode);
  const now = new Date().toISOString();
  let archivedCount = 0;

  const updated = tasks.map((task) => {
    if (task.archived || task.status !== "Done") {
      return task;
    }

    archivedCount += 1;
    return {
      ...task,
      archived: true,
      updatedAt: now,
      lastUpdatedByField: {
        ...task.lastUpdatedByField,
        archived: now
      }
    };
  });

  if (archivedCount > 0) {
    persistTasks(mode, updated);
  }

  return archivedCount;
}

/**
 * Applies small inline updates from the task table while preserving per-field audit metadata.
 */
function updateTaskInline(mode, taskId, updates) {
  const tasks = loadTasks(mode);
  const now = new Date().toISOString();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const nextTask = { ...task };
    const nextUpdatedFields = { ...task.lastUpdatedByField };

    if (Object.hasOwn(updates, "status")) {
      nextTask.status = normaliseTaskStatus(updates.status);
      nextUpdatedFields.status = now;
    }

    if (Object.hasOwn(updates, "assigneeId")) {
      nextTask.assigneeId = updates.assigneeId || "";
      nextUpdatedFields.assigneeId = now;
    }

    if (Object.hasOwn(updates, "projectId")) {
      nextTask.projectId = updates.projectId || "";
      nextUpdatedFields.projectId = now;
    }

    if (Object.hasOwn(updates, "scheduleDate")) {
      nextTask.scheduleDate = updates.scheduleDate || "";
      nextUpdatedFields.scheduleDate = now;
    }

    if (Object.hasOwn(updates, "dueDate")) {
      nextTask.dueDate = updates.dueDate || "";
      nextUpdatedFields.dueDate = now;
    }

    if (Object.hasOwn(updates, "effort")) {
      nextTask.effort = clampTaskScaleValue(updates.effort, task.effort);
      nextUpdatedFields.effort = now;
    }

    if (Object.hasOwn(updates, "impact")) {
      nextTask.impact = clampTaskScaleValue(updates.impact, task.impact);
      nextUpdatedFields.impact = now;
    }

    if (Object.hasOwn(updates, "archived")) {
      nextTask.archived = Boolean(updates.archived);
      nextUpdatedFields.archived = now;
    }

    return {
      ...nextTask,
      updatedAt: now,
      lastUpdatedByField: nextUpdatedFields
    };
  });

  persistTasks(mode, updated);
}


/**
 * Clamps effort/impact scale values into the valid 1-10 range used by task scoring.
 *
 * The fallback keeps inline edit updates resilient if an empty/invalid value slips
 * through browser input constraints.
 */
function clampTaskScaleValue(value, fallbackValue = 5) {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return Math.min(10, Math.max(1, Number(fallbackValue) || 5));
  }

  return Math.min(10, Math.max(1, Math.round(parsedValue)));
}

function computePriorityScore(task) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Weight due dates more heavily so urgent/overdue work naturally rises to the top.
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

  const statusWeight = task.status === "Blocked" ? 8 : task.status === "In Progress" ? 12 : 0;
  const dependencyWeight = task.blockedByTaskIds.length > 0 ? -6 : 0;
  const recurrenceWeight = task.recurrence !== "none" ? 5 : 0;

  return Math.round(
    dueDateWeight + task.impact * 6 - task.effort * 2 + statusWeight + dependencyWeight + recurrenceWeight
  );
}

function stableTieBreaker(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 997;
  }
  return hash;
}

export function loadTasks(mode) {
  const storageKey = resolveTaskStorageKey(mode);
  if (!storageKey) {
    return [];
  }

  const tasks = loadVersionedCollection({
    storageKey,
    collectionKey: "tasks",
    schemaVersion: TASK_SCHEMA_VERSION,
    normaliseItem: normaliseTask,
    fallback: []
  });

  const withGeneratedRecurring = generateRecurringWorkTaskInstances(tasks);
  if (withGeneratedRecurring.length !== tasks.length) {
    persistTasks(mode, withGeneratedRecurring);
  }

  return withGeneratedRecurring;
}

function persistTasks(mode, tasks) {
  const storageKey = resolveTaskStorageKey(mode);
  if (!storageKey) {
    return;
  }

  persistVersionedCollection({
    storageKey,
    collectionKey: "tasks",
    schemaVersion: TASK_SCHEMA_VERSION,
    records: tasks
  });
}

export function normaliseTask(task) {
  const recurrenceMeta = normaliseRecurrenceMeta(task?.recurrenceMeta);
  // Legacy migration support: pre-metadata recurrence values are migrated to the new shape.
  const migratedRecurrenceMeta = recurrenceMeta || buildRecurrenceMetaFromLegacyTask(task);

  return {
    id: task.id || buildTaskId(),
    title: task.title || "",
    effort: Number(task.effort) || 5,
    impact: Number(task.impact) || 5,
    status: normaliseTaskStatus(task.status),
    assigneeId: task.assigneeId || "",
    projectId: task.projectId || "",
    // Migration-safe default keeps legacy records fully compatible with new sort precedence.
    scheduleDate: task.scheduleDate || "",
    dueDate: task.dueDate || "",
    recurrence: RECURRENCE_OPTIONS.includes(task.recurrence) ? task.recurrence : "none",
    customRecurrence: task.customRecurrence || "",
    recurrenceMeta: migratedRecurrenceMeta,
    blockedByTaskIds: parseTaskIdList(task.blockedByTaskIds),
    blockingTaskIds: parseTaskIdList(task.blockingTaskIds),
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

/**
 * Returns the task's planning date using precedence: scheduleDate, then dueDate.
 */
export function getTaskTimelineDate(task) {
  return task?.scheduleDate || task?.dueDate || "";
}

/**
 * Produces a stable sortable date string for timeline ordering, with a high fallback date.
 */
export function getTaskTimelineSortDate(task) {
  return getTaskTimelineDate(task) || TASK_DATE_FALLBACK;
}

function buildRecurrenceMetaFromPayload(payload, existingTask = null) {
  const legacyFrequency = mapLegacyRecurrenceToFrequency(payload.recurrence);
  if (legacyFrequency === "none") {
    return null;
  }

  return {
    frequency: legacyFrequency,
    interval: sanitiseRecurrenceInterval(payload.recurrenceInterval),
    parentRecurrenceId:
      payload.recurrenceMeta?.parentRecurrenceId || existingTask?.recurrenceMeta?.parentRecurrenceId || buildTaskId()
  };
}

function normaliseRecurrenceMeta(recurrenceMeta) {
  if (!recurrenceMeta || typeof recurrenceMeta !== "object") {
    return null;
  }

  const frequency = RECURRENCE_FREQUENCIES.includes(recurrenceMeta.frequency)
    ? recurrenceMeta.frequency
    : "none";
  if (frequency === "none") {
    return null;
  }

  return {
    frequency,
    interval: sanitiseRecurrenceInterval(recurrenceMeta.interval),
    parentRecurrenceId:
      typeof recurrenceMeta.parentRecurrenceId === "string" && recurrenceMeta.parentRecurrenceId.trim()
        ? recurrenceMeta.parentRecurrenceId
        : buildTaskId()
  };
}

function buildRecurrenceMetaFromLegacyTask(task) {
  const frequency = mapLegacyRecurrenceToFrequency(task?.recurrence);
  if (frequency === "none") {
    return null;
  }

  return {
    frequency,
    interval: 1,
    parentRecurrenceId: task?.id || buildTaskId()
  };
}

function mapLegacyRecurrenceToFrequency(recurrence) {
  if (recurrence === "daily") {
    return "daily";
  }
  if (recurrence === "weekly" || recurrence === "weekdays" || recurrence === "weekends") {
    return "weekly";
  }
  if (recurrence === "monthly") {
    return "monthly";
  }
  return "none";
}

function sanitiseRecurrenceInterval(value) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function generateRecurringWorkTaskInstances(tasks) {
  const generated = [...tasks];
  const today = isoDateToday();
  const seenSeriesDueDates = new Set(
    generated
      .filter((task) => task.recurrenceMeta?.parentRecurrenceId && task.dueDate)
      .map((task) => `${task.recurrenceMeta.parentRecurrenceId}:${task.dueDate}`)
  );

  // Recurrence generation runs from the latest dated occurrence in each series to avoid duplicates.
  const latestBySeries = new Map();
  for (const task of generated) {
    const seriesId = task.recurrenceMeta?.parentRecurrenceId;
    if (!seriesId || !task.dueDate) {
      continue;
    }

    const existingLatest = latestBySeries.get(seriesId);
    if (!existingLatest || task.dueDate > existingLatest.dueDate) {
      latestBySeries.set(seriesId, task);
    }
  }

  for (const latestTask of latestBySeries.values()) {
    let candidate = latestTask;
    let guard = 0;
    while (shouldGenerateNextTaskOccurrence(candidate, today) && guard < MAX_RECURRENCE_GENERATIONS_PER_LOAD) {
      const nextDueDate = shiftIsoDateByRecurrence(
        candidate.dueDate,
        candidate.recurrenceMeta.frequency,
        candidate.recurrenceMeta.interval
      );
      if (!nextDueDate) {
        break;
      }

      const seriesDateKey = `${candidate.recurrenceMeta.parentRecurrenceId}:${nextDueDate}`;
      if (seenSeriesDueDates.has(seriesDateKey)) {
        break;
      }

      const nextTask = normaliseTask({
        ...candidate,
        id: buildTaskId(),
        status: "Backlog",
        dueDate: nextDueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      generated.push(nextTask);
      seenSeriesDueDates.add(seriesDateKey);
      candidate = nextTask;
      guard += 1;
    }
  }

  return generated;
}

function shouldGenerateNextTaskOccurrence(task, today) {
  if (!task.recurrenceMeta || !task.dueDate) {
    return false;
  }

  const isCompleted = task.status === "Done";
  const hasDatePassed = task.dueDate < today;
  return isCompleted || hasDatePassed;
}

function shiftIsoDateByRecurrence(isoDate, frequency, interval) {
  const baseDate = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) {
    return "";
  }

  if (frequency === "daily") {
    baseDate.setDate(baseDate.getDate() + interval);
  } else if (frequency === "weekly") {
    baseDate.setDate(baseDate.getDate() + interval * 7);
  } else if (frequency === "monthly") {
    baseDate.setMonth(baseDate.getMonth() + interval);
  } else {
    return "";
  }

  return baseDate.toISOString().slice(0, 10);
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

export function normaliseTaskStatus(status) {
  const canonical = LEGACY_STATUS_MIGRATION_MAP[String(status || "").trim().toLowerCase()];
  return TASK_STATUSES.includes(canonical) ? canonical : "Backlog";
}

function parseTaskIdList(value) {
  // Migration-safe fallback: legacy records persisted dependency IDs as comma-separated strings.
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function resolveDependencyState(task, taskById) {
  const blockedByOpenCount = (task.blockedByTaskIds || []).filter((id) => {
    const dependency = taskById.get(id);
    return dependency && !["Done", "Cancelled"].includes(dependency.status);
  }).length;
  const blockingCount = (task.blockingTaskIds || []).length;
  const blockedByCount = (task.blockedByTaskIds || []).length;
  const hasDependencies = blockedByCount > 0 || blockingCount > 0;
  const isBlocked = blockedByOpenCount > 0;
  const tooltipParts = [];
  if (blockedByCount > 0) tooltipParts.push(`Blocked by: ${blockedByCount} tasks`);
  if (blockingCount > 0) tooltipParts.push(`Blocking: ${blockingCount} tasks`);
  if (isBlocked) tooltipParts.push("Blocked");
  return {
    hasDependencies,
    isBlocked,
    blockedByOpenCount,
    tooltip: tooltipParts.join(" • ") || "No dependencies"
  };
}

function buildDependencyStateLabel(task, taskById) {
  const blockedByOpenCount = task.blockedByTaskIds.filter((id) => {
    const dependency = taskById.get(id);
    return dependency && !["Done", "Cancelled"].includes(dependency.status);
  }).length;
  const blockingOpenCount = task.blockingTaskIds.filter((id) => {
    const dependency = taskById.get(id);
    return dependency && !["Done", "Cancelled"].includes(dependency.status);
  }).length;

  if (blockedByOpenCount > 0 && blockingOpenCount > 0) {
    return `Blocked (${blockedByOpenCount}) • Blocking (${blockingOpenCount})`;
  }
  if (blockedByOpenCount > 0) {
    return `Blocked (${blockedByOpenCount})`;
  }
  if (blockingOpenCount > 0) {
    return `Blocking (${blockingOpenCount})`;
  }
  if (task.blockedByTaskIds.length > 0 || task.blockingTaskIds.length > 0) {
    return "Dependencies clear";
  }
  return "None";
}

function loadPeople(mode) {
  if (mode === "personal") {
    const personalStorageKey = buildPersonalStorageKey("people", 1);
    const raw = localStorage.getItem(personalStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = safeJsonParse(raw, []);
    return Array.isArray(parsed)
      ? parsed.map((person) => ({
          id: person.id || "",
          name: person.name || "Unnamed",
          archived: Boolean(person.archived)
        }))
      : [];
  }

  const storageKey = `${PEOPLE_STORAGE_KEY_PREFIX}.${mode}.v1`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed)
    ? parsed.map((person) => ({ id: person.id || "", name: person.name || "Unnamed" }))
    : [];
}

/**
 * Resolves storage keys per mode so personal tasks persist independently
 * from work tasks while still reusing the same task schema.
 */
function resolveTaskStorageKey(mode) {
  if (mode === "work") {
    return `${TASK_STORAGE_KEY_PREFIX}.${mode}.v1`;
  }

  if (mode === "personal") {
    return buildPersonalStorageKey("tasks", 1);
  }

  return "";
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
  return generateId("task_");
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
