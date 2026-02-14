import { loadProjects } from "./projects-store.js";
import { loadVersionedCollection, persistVersionedCollection, safeJsonParse } from "./storage-core.js";
import { hydrateSelectOptions } from "./select-controls.js";
import { generateId } from "./id.js";
import { createModalDismissGuard } from "./modal-dismiss-guard.js";

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
    // Allows app-shell quick actions to deep-link directly into create mode.
    isPanelOpen: openComposer,
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

  // Editor overlays are mounted in this dedicated host to keep module layout stable
  // while toggling create/edit state.
  const panelWrap = document.createElement("div");

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
      // Task lists prioritise scheduled execution date first, then due date, so teams can
      // sequence planned work while still respecting hard deadlines.
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
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No tasks match your current filters.";
      list.appendChild(empty);
    } else {
      const table = createTaskTable();
      list.appendChild(table);

      // Build lookup maps once to avoid repeated linear scans while rerendering rows.
      const peopleById = new Map(people.map((person) => [person.id, person]));
      const projectsById = new Map(projects.map((project) => [project.id, project]));
      const taskById = new Map(tasks.map((entry) => [entry.id, entry]));
      for (const task of filtered) {
        const assignee = peopleById.get(task.assigneeId);
        const project = projectsById.get(task.projectId);
        table.appendChild(
          createTaskTableRow(task, {
            assigneeLabel: assignee?.name || "Unassigned",
            projectLabel: project?.title || "No project",
            dependencyStateLabel: buildDependencyStateLabel(task, taskById),
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
    feedback.hidden = !state.feedback;

    panelWrap.innerHTML = "";
    if (state.isPanelOpen) {
      const task = tasks.find((entry) => entry.id === state.editingId) || null;
      panelWrap.append(
        createTaskForm({
          task,
          tasks,
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

/**
 * Builds the compact pseudo-table shell used by the tasks list.
 */
function createTaskTable() {
  const table = document.createElement("div");
  table.className = "tasks-table";

  const header = document.createElement("div");
  header.className = "tasks-table-row tasks-table-head";
  ["Task", "Status", "Dependencies", "Assignee / Project", "Schedule / Due", "Priority", "Actions"].forEach((label) => {
    const headCell = document.createElement("strong");
    headCell.className = "tasks-cell";
    headCell.textContent = label;
    header.appendChild(headCell);
  });

  table.appendChild(header);
  return table;
}

/**
 * Renders a single task row for the compact task pseudo-table view.
 */
function createTaskTableRow(task, { assigneeLabel, projectLabel, dependencyStateLabel, onEdit, onArchiveToggle, onDelete }) {
  const row = document.createElement("article");
  row.className = "tasks-table-row";

  const taskCell = document.createElement("div");
  taskCell.className = "tasks-cell tasks-cell-title";

  const title = document.createElement("strong");
  title.textContent = task.title;

  const taskMeta = document.createElement("small");
  taskMeta.className = "person-meta";
  taskMeta.innerHTML = "";

  const effortSpan = document.createElement("span");
  effortSpan.className = "task-meta-inline";
  effortSpan.textContent = `Effort ${task.effort}/10`;

  const impactSpan = document.createElement("span");
  impactSpan.className = "task-meta-inline";
  impactSpan.textContent = `Impact ${task.impact}/10`;

  const recurrenceSpan = document.createElement("span");
  recurrenceSpan.className = "task-meta-inline";
  recurrenceSpan.textContent = `${toTitleCase(task.recurrence)}${
    task.recurrence === "custom" && task.customRecurrence ? ` (${task.customRecurrence})` : ""
  }`;

  taskMeta.append(effortSpan, document.createTextNode(" • "), impactSpan, document.createTextNode(" • "), recurrenceSpan);

  taskCell.append(title, taskMeta);

  const statusCell = document.createElement("div");
  statusCell.className = "tasks-cell";
  statusCell.textContent = toTitleCase(task.status);

  const relationCell = document.createElement("div");
  relationCell.className = "tasks-cell";
  relationCell.textContent = `${assigneeLabel} • ${projectLabel}`;

  const dependencyCell = document.createElement("div");
  dependencyCell.className = "tasks-cell";
  dependencyCell.textContent = dependencyStateLabel;

  const dueCell = document.createElement("div");
  dueCell.className = "tasks-cell";

  const duePrimary = document.createElement("span");
  duePrimary.textContent = task.scheduleDate
    ? `Scheduled ${task.scheduleDate}`
    : task.dueDate
      ? `Due ${task.dueDate}`
      : "Not set";
  dueCell.appendChild(duePrimary);

  // Keep due date visible as secondary metadata when schedule date is set so users can
  // quickly compare intent (scheduled execution) versus obligation (deadline).
  if (task.scheduleDate && task.dueDate) {
    const dueSecondary = document.createElement("small");
    dueSecondary.className = "person-meta";
    dueSecondary.textContent = `Due ${task.dueDate}`;
    dueCell.appendChild(dueSecondary);
  }

  const priorityCell = document.createElement("div");
  priorityCell.className = "tasks-cell";

  const priorityPill = document.createElement("span");
  priorityPill.className = "task-score-pill";
  priorityPill.textContent = `Score ${task.priorityScore}`;
  priorityCell.appendChild(priorityPill);

  const actions = document.createElement("div");
  actions.className = "tasks-cell tasks-row-actions";
  actions.append(
    button("Edit", onEdit),
    button(task.archived ? "Restore" : "Archive", onArchiveToggle),
    button("Delete", onDelete)
  );

  row.append(taskCell, statusCell, dependencyCell, relationCell, dueCell, priorityCell, actions);
  return row;
}

function createTaskForm({ task, tasks, people, projects, onSave, onCancel }) {
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
  form.className = "meeting-modal meeting-form entity-editor-modal task-form";

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
  const scheduleDate = createField("Schedule date", "date", task?.scheduleDate || "", false);

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

  const recurrenceInterval = createField(
    "Recurrence interval",
    "number",
    String(task?.recurrenceMeta?.interval || 1),
    false,
    {
      min: "1",
      step: "1"
    }
  );

  const notes = createField("Notes", "textarea", task?.notes || "", false);

  const blockedByTaskIds = buildTaskDependencyPickerField({
    label: "Blocked by",
    tasks,
    people,
    projects,
    currentTaskId: task?.id || "",
    selectedIds: parseTaskIdList(task?.blockedByTaskIds),
    primaryAssigneeId: task?.assigneeId || "",
    primaryProjectId: task?.projectId || "",
    emptyMessage: "Create another task first to link dependencies."
  });
  const blockingTaskIds = buildTaskDependencyPickerField({
    label: "Blocking",
    tasks,
    people,
    projects,
    currentTaskId: task?.id || "",
    selectedIds: parseTaskIdList(task?.blockingTaskIds),
    primaryAssigneeId: task?.assigneeId || "",
    primaryProjectId: task?.projectId || "",
    emptyMessage: "Create another task first to link dependencies."
  });

  const actions = document.createElement("div");
  actions.className = "meeting-actions";
  actions.append(button(task ? "Save changes" : "Create task", null, "submit"), button("Cancel", requestClose));

  /**
   * Builds a semantically grouped section in the task editor to improve scanability
   * while preserving the original field nodes and submission mapping.
   */
  const createFormSection = (titleText, descriptionText, ...content) => {
    const section = document.createElement("section");
    section.className = "task-form-section";

    const sectionHeading = document.createElement("h3");
    sectionHeading.className = "task-form-section-title";
    sectionHeading.textContent = titleText;

    section.appendChild(sectionHeading);

    if (descriptionText) {
      const sectionDescription = document.createElement("p");
      sectionDescription.className = "task-form-section-description";
      sectionDescription.textContent = descriptionText;
      section.appendChild(sectionDescription);
    }

    section.append(...content);
    return section;
  };

  // Core keeps the mandatory identifying fields first for intuitive keyboard flow.
  const coreRow = document.createElement("div");
  coreRow.className = "task-form-grid task-form-grid-2";
  coreRow.append(title.wrap, statusWrap);

  // Planning groups time-related fields together to reduce vertical sprawl.
  const planningPrimaryRow = document.createElement("div");
  planningPrimaryRow.className = "task-form-grid task-form-grid-2";
  planningPrimaryRow.append(scheduleDate.wrap, dueDate.wrap);

  const planningTertiaryRow = document.createElement("div");
  planningTertiaryRow.className = "task-form-grid task-form-grid-2";
  planningTertiaryRow.append(recurrenceWrap);

  const planningSecondaryRow = document.createElement("div");
  planningSecondaryRow.className = "task-form-grid task-form-grid-2";
  planningSecondaryRow.append(customRecurrence.wrap, recurrenceInterval.wrap);

  const ownershipRow = document.createElement("div");
  ownershipRow.className = "task-form-grid task-form-grid-2";
  ownershipRow.append(assigneeWrap, projectWrap);

  const effortPriorityRow = document.createElement("div");
  effortPriorityRow.className = "task-form-grid task-form-grid-2";
  effortPriorityRow.append(effort.wrap, impact.wrap);

  const dependencyRow = document.createElement("div");
  dependencyRow.className = "task-form-grid task-form-grid-2";
  dependencyRow.append(blockedByTaskIds.wrapper, blockingTaskIds.wrapper);

  const coreSection = createFormSection("Core", "Capture what the task is and where it currently stands.", coreRow);
  const planningSection = createFormSection(
    "Planning",
    "Manage timeline and recurrence settings in one place.",
    planningPrimaryRow,
    planningTertiaryRow,
    planningSecondaryRow
  );
  const ownershipSection = createFormSection("Ownership", "Assign accountability and project context.", ownershipRow);
  const effortPrioritySection = createFormSection(
    "Effort / Priority",
    "Score implementation effort and expected impact.",
    effortPriorityRow
  );
  const dependenciesSection = createFormSection(
    "Dependencies",
    "Track task relationships that block or unblock execution.",
    dependencyRow
  );
  const notesSection = createFormSection("Notes", "Capture additional implementation details.", notes.wrap);

  form.append(
    heading,
    coreSection,
    planningSection,
    ownershipSection,
    effortPrioritySection,
    dependenciesSection,
    notesSection,
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
      scheduleDate: scheduleDate.input.value,
      dueDate: dueDate.input.value,
      recurrence: recurrence.value,
      customRecurrence: customRecurrence.input.value.trim(),
      recurrenceInterval: Number(recurrenceInterval.input.value) || 1,
      // Dependency IDs still flow through parseTaskIdList during save, preserving canonical validation.
      blockedByTaskIds: readDependencyPickerHiddenValues(blockedByTaskIds.hiddenInput),
      blockingTaskIds: readDependencyPickerHiddenValues(blockingTaskIds.hiddenInput),
      notes: notes.input.value.trim(),
      archived: Boolean(task?.archived)
    });
  });

  // Treat any field mutation as draft edits so dismiss guards prevent silent loss.
  dismissGuard.bindDirtyTracking(form);

  overlay.appendChild(form);
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

  return { wrapper, hiddenInput };
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
  if (mode !== "work") {
    return [];
  }

  const storageKey = `${TASK_STORAGE_KEY_PREFIX}.${mode}.v1`;
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
  if (mode !== "work") {
    return;
  }

  const storageKey = `${TASK_STORAGE_KEY_PREFIX}.${mode}.v1`;
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
