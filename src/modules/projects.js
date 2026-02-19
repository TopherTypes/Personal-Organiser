import {
  PROJECT_CADENCE_UNITS,
  PROJECT_PERSON_ROLES,
  deleteProject,
  loadProjects,
  normaliseProject,
  saveProject,
  upsertProjectPersonLink
} from "./projects-store.js";
import { loadTasks } from "./tasks.js";
import { buildEntityTokenMultiSelectField, readEntityTokenHiddenValues } from "./select-controls.js";
import { createModalDismissGuard } from "./modal-dismiss-guard.js";
import { computeProjectHealth } from "./project-health.js";
import { generateId } from "./id.js";

export function renderWorkProjectsModule({ mode = "work", people = [], meetings = [], openComposer = false, onNavigate = null } = {}) {
  const state = {
    statusFilter: "all",
    healthFilter: "all",
    hasOverdueTasksOnly: false,
    search: "",
    sort: "recently-updated",
    viewMode: readProjectsViewModePreference(),
    isEditorOpen: openComposer,
    editingId: "",
    viewingId: "",
    feedback: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard projects-module";

  function renderModule() {
    section.innerHTML = "";
    const tasks = loadTasks(mode);
    const projects = loadProjects(mode);

    if (state.viewingId) {
      section.appendChild(renderProjectDetails(projects, tasks));
      return;
    }

    const enriched = queryProjects(projects, tasks, state);
    section.append(
      renderProjectsHeader({ mode, onCreateProject: () => { state.editingId = ""; state.isEditorOpen = true; renderModule(); } }),
      renderProjectsToolbar({ state, onChange: (patch) => { Object.assign(state, patch); renderModule(); }, onViewModeChange: (viewMode) => { state.viewMode = viewMode; persistProjectsViewModePreference(viewMode); renderModule(); } }),
      renderProjectsResultsSummary(enriched, state)
    );

    const list = document.createElement("div");
    list.className = `projects-results projects-view-${state.viewMode}`;
    if (!enriched.length) {
      list.appendChild(renderProjectsEmptyState({ hasFilter: Boolean(state.search.trim()) || state.statusFilter !== "all" || state.healthFilter !== "all" || state.hasOverdueTasksOnly, onClearFilters: () => { state.statusFilter = "all"; state.healthFilter = "all"; state.hasOverdueTasksOnly = false; state.search = ""; renderModule(); } }));
    }

    enriched.forEach(({ project, health, taskSummary }) => {
      const handlers = {
        onOpen: () => { state.viewingId = project.id; renderModule(); },
        onEdit: () => { state.editingId = project.id; state.isEditorOpen = true; renderModule(); },
        onDelete: () => {
          if (!window.confirm(`Delete project "${project.title}"?`)) return;
          const result = deleteProject(mode, project.id);
          if (!result.ok) {
            state.feedback = result.error;
          } else {
            unlinkMeetingsForDeletedProject(project.id, meetings, mode);
            state.feedback = `Deleted ${project.title}.`;
          }
          renderModule();
        },
        onLogUpdate: () => {
          const text = window.prompt("Log a progress update", "");
          if (!text || !text.trim()) return;
          const updates = Array.isArray(project.updates) ? [...project.updates] : [];
          updates.unshift({ id: generateId("project-update"), text: text.trim(), createdAt: new Date().toISOString() });
          const result = saveProject(mode, { ...project, updates, lastProgressUpdate: new Date().toISOString().slice(0, 10) }, project.id);
          if (!result.ok) {
            state.feedback = result.error;
          } else {
            state.feedback = "Update logged.";
          }
          renderModule();
        },
        onNewTask: () => {
          if (typeof onNavigate === "function") {
            onNavigate({ moduleKey: "tasks", focus: { projectId: project.id, createIntent: "task" } });
            return;
          }
          window.alert("Task creation opens in Tasks module.");
        }
      };

      list.appendChild(state.viewMode === "list"
        ? buildProjectRow(project, health, taskSummary, handlers)
        : buildProjectCard(project, health, taskSummary, handlers));
    });

    section.appendChild(list);

    if (state.feedback) {
      const feedback = document.createElement("p");
      feedback.className = "feedback";
      feedback.textContent = state.feedback;
      section.appendChild(feedback);
      state.feedback = "";
    }

    if (state.isEditorOpen) {
      const editing = state.editingId ? projects.find((project) => project.id === state.editingId) : null;
      section.appendChild(renderProjectEditor({
        people,
        meetings,
        project: editing,
        onClose: () => { state.isEditorOpen = false; state.editingId = ""; renderModule(); },
        onSave: (payload) => {
          const saveResult = saveProject(mode, payload, state.editingId);
          if (!saveResult.ok) {
            state.feedback = saveResult.error;
            renderModule();
            return;
          }
          applyProjectLinks(mode, saveResult.project.id, payload.personLinks, payload.meetingIds);
          state.feedback = saveResult.wasEdit ? "Project updated." : "Project created.";
          state.isEditorOpen = false;
          state.editingId = "";
          renderModule();
        }
      }));
    }
  }

  function renderProjectDetails(projects, tasks) {
    const project = projects.find((entry) => entry.id === state.viewingId);
    const wrap = document.createElement("div");
    wrap.className = "project-details-view";
    if (!project) {
      const missing = document.createElement("p");
      missing.className = "empty-state";
      missing.textContent = "Project not found.";
      wrap.appendChild(missing);
      return wrap;
    }

    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    const health = computeProjectHealth(project, projectTasks, new Date());

    const back = document.createElement("button");
    back.type = "button";
    back.className = "module-button-secondary";
    back.textContent = "← Back to projects";
    back.addEventListener("click", () => { state.viewingId = ""; renderModule(); });

    const command = document.createElement("article");
    command.className = "project-command-panel";
    const heading = document.createElement("h1");
    heading.textContent = project.title;
    const meta = document.createElement("p");
    meta.className = "project-freshness-line";
    meta.textContent = buildFreshnessText(health, new Date());

    const badges = document.createElement("div");
    badges.className = "project-command-badges";
    badges.append(createStatusPill(project.status), createHealthBadge(health));

    const actions = document.createElement("div");
    actions.className = "project-command-actions";
    actions.append(
      buildActionButton("Log update", () => {
        const text = window.prompt("Log a progress update", "");
        if (!text || !text.trim()) return;
        const updates = Array.isArray(project.updates) ? [...project.updates] : [];
        updates.unshift({ id: generateId("project-update"), text: text.trim(), createdAt: new Date().toISOString() });
        saveProject(mode, { ...project, updates, lastProgressUpdate: new Date().toISOString().slice(0, 10) }, project.id);
        renderModule();
      }, "enter-mode-button"),
      buildActionButton("Add task", () => onNavigate?.({ moduleKey: "tasks", focus: { projectId: project.id, createIntent: "task" } }), "secondary-button"),
      buildActionButton("Create meeting", () => window.alert("Meeting creation coming soon."), "secondary-button")
    );

    const left = document.createElement("div");
    left.append(heading, badges, meta);
    command.append(left, actions);

    const summary = document.createElement("div");
    summary.className = "project-health-summary-row";
    summary.append(
      buildOverviewCard("Next update due", health.nextExpectedUpdateDate || "Not set"),
      buildOverviewCard("Freshness", buildFreshnessText(health, new Date())),
      buildOverviewCard("Overdue tasks", String(health.overdueTasksCount)),
      buildOverviewCard("Open tasks", String(health.openTasksCount))
    );

    const taskSection = document.createElement("section");
    taskSection.className = "project-detail-section";
    const taskTitle = document.createElement("h2");
    taskTitle.textContent = "Tasks for this project";
    const taskList = document.createElement("ul");
    taskList.className = "project-task-list";
    projectTasks.filter((task) => !task.archived && !["Done", "Cancelled"].includes(task.status)).forEach((task) => {
      const li = document.createElement("li");
      li.textContent = `${task.title} · ${task.status} · ${task.dueDate || "No due date"}`;
      taskList.appendChild(li);
    });
    if (!taskList.children.length) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "No open tasks for this project.";
      taskList.appendChild(li);
    }
    taskSection.append(taskTitle, taskList);

    const updatesSection = document.createElement("section");
    updatesSection.className = "project-detail-section";
    const updatesTitle = document.createElement("h2");
    updatesTitle.textContent = "Updates";
    const updatesList = document.createElement("ul");
    updatesList.className = "project-updates-list";
    (project.updates || []).slice(0, 6).forEach((update) => {
      const item = document.createElement("li");
      item.textContent = `${new Date(update.createdAt).toLocaleString()} · ${update.text}`;
      updatesList.appendChild(item);
    });
    if (!updatesList.children.length) {
      const item = document.createElement("li");
      item.className = "empty-state";
      item.textContent = "No updates logged yet.";
      updatesList.appendChild(item);
    }
    updatesSection.append(updatesTitle, updatesList);

<<<<<<< codex/overhaul-projects-module-ui/ux-design
    wrap.append(back, command, summary, taskSection, updatesSection, buildLinkedEntitiesCard(project, people));
=======
    wrap.append(back, command, summary, taskSection, updatesSection, buildLinkedEntitiesCard(project));
>>>>>>> main
    return wrap;
  }

  renderModule();
  return section;
}

function queryProjects(projects, tasks, state) {
  const enriched = projects.map((project) => {
    const tasksForProject = tasks.filter((task) => task.projectId === project.id);
    const health = computeProjectHealth(project, tasksForProject, new Date());
    return {
      project,
      health,
      taskSummary: {
        openCount: health.openTasksCount,
        overdueCount: health.overdueTasksCount,
        highPriorityCount: health.highPriorityCount,
        blockedCount: health.blockedTasksCount,
        needsAttentionScore: computeNeedsAttentionScore(health)
      }
    };
  }).filter(({ project, health }) => {
    if (state.statusFilter !== "all" && project.status !== state.statusFilter) return false;
    if (state.healthFilter !== "all" && health.healthStatus !== state.healthFilter) return false;
    if (state.hasOverdueTasksOnly && health.overdueTasksCount === 0) return false;
    const haystack = `${project.title} ${project.description} ${project.status}`.toLowerCase();
    return haystack.includes(state.search.toLowerCase());
  });

  return sortProjects(enriched, state.sort);
}

function sortProjects(projects, sortMode) {
  const ordered = [...projects];
  ordered.sort((left, right) => {
    if (sortMode === "alphabetical") return left.project.title.localeCompare(right.project.title);
    if (sortMode === "due-for-update") return compareOptionalDates(left.health.nextExpectedUpdateDate, right.health.nextExpectedUpdateDate);
    if (sortMode === "needs-attention") return right.taskSummary.needsAttentionScore - left.taskSummary.needsAttentionScore;
    return compareOptionalDates(right.project.updatedAt, left.project.updatedAt);
  });
  return ordered;
}

function compareOptionalDates(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

function computeNeedsAttentionScore(health) {
  const base = health.healthStatus === "overdue" ? 1000 : health.healthStatus === "at_risk" ? 500 : 100;
  return base + health.overdueTasksCount * 25 + health.blockedTasksCount * 8;
}

function renderProjectsHeader({ mode, onCreateProject }) {
  const header = document.createElement("header");
  header.className = "projects-header-v2";
  const titleWrap = document.createElement("div");
  titleWrap.className = "projects-header-copy";
  const title = document.createElement("h1");
  title.textContent = mode === "personal" ? "Personal Projects" : "Work Projects";
  const subtitle = document.createElement("p");
  subtitle.className = "module-intro";
  subtitle.textContent = "Portfolio radar with health, freshness, and task pressure in one scan.";
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "enter-mode-button";
  createButton.textContent = "New project";
  createButton.addEventListener("click", onCreateProject);
  titleWrap.append(title, subtitle);
  header.append(titleWrap, createButton);
  return header;
}

function renderProjectsToolbar({ state, onChange, onViewModeChange }) {
  const toolbar = document.createElement("div");
  toolbar.className = "projects-toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "field-input";
  search.placeholder = "Search projects";
  search.value = state.search;
  search.addEventListener("input", (event) => onChange({ search: event.target.value }));

  const status = document.createElement("select");
  status.className = "field-input";
  ["all", "planned", "active", "on-hold", "completed"].forEach((value) => addOption(status, value, `Status: ${humaniseProjectStatus(value)}`));
  status.value = state.statusFilter;
  status.addEventListener("change", (event) => onChange({ statusFilter: event.target.value }));

  const health = document.createElement("select");
  health.className = "field-input";
  addOption(health, "all", "Health: All");
  addOption(health, "healthy", "Health: Healthy");
  addOption(health, "at_risk", "Health: At risk");
  addOption(health, "overdue", "Health: Overdue");
  health.value = state.healthFilter;
  health.addEventListener("change", (event) => onChange({ healthFilter: event.target.value }));

  const overdueToggle = document.createElement("label");
  overdueToggle.className = "field-label";
  overdueToggle.textContent = "Has overdue tasks";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = state.hasOverdueTasksOnly;
  toggle.addEventListener("change", () => onChange({ hasOverdueTasksOnly: toggle.checked }));
  overdueToggle.appendChild(toggle);

  const sort = document.createElement("select");
  sort.className = "field-input";
  addOption(sort, "needs-attention", "Needs attention");
  addOption(sort, "recently-updated", "Recently updated");
  addOption(sort, "alphabetical", "Alphabetical");
  addOption(sort, "due-for-update", "Due for update");
  sort.value = state.sort;
  sort.addEventListener("change", (event) => onChange({ sort: event.target.value }));

  const toggleWrap = document.createElement("div");
  toggleWrap.className = "projects-view-toggle";
  [{ value: "grid", label: "Grid" }, { value: "list", label: "List" }].forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `projects-view-toggle-button${state.viewMode === item.value ? " active" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", () => onViewModeChange(item.value));
    toggleWrap.appendChild(button);
  });

  toolbar.append(search, status, health, overdueToggle, sort, toggleWrap);
  return toolbar;
}

function renderProjectsResultsSummary(projects) {
  const summary = document.createElement("p");
  summary.className = "projects-results-summary";
  summary.textContent = `${projects.length} projects`;
  return summary;
}

function renderProjectsEmptyState({ hasFilter, onClearFilters }) {
  const empty = document.createElement("div");
  empty.className = "empty-state projects-empty-state";
  empty.textContent = hasFilter ? "No projects match current filters." : "No projects yet.";
  if (hasFilter) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ghost-button";
    clear.textContent = "Clear filters";
    clear.addEventListener("click", onClearFilters);
    empty.appendChild(clear);
  }
  return empty;
}

function buildProjectCard(project, health, taskSummary, handlers) {
  const card = document.createElement("article");
  card.className = `project-card-v2 project-health-${health.healthStatus}${health.healthStatus !== "healthy" ? " project-needs-attention" : ""}`;
  card.append(
    buildProjectTopRow(project, health),
    buildFreshnessNode(health),
    buildProjectTaskSummary(taskSummary),
    buildProjectMetaRow(project, health),
    buildProjectActions(project, handlers)
  );
  return card;
}

function buildProjectRow(project, health, taskSummary, handlers) {
  const row = document.createElement("article");
  row.className = "project-row-v2";
  row.append(buildProjectTopRow(project, health), buildFreshnessNode(health), buildProjectTaskSummary(taskSummary), buildProjectActions(project, handlers));
  return row;
}

function buildProjectTopRow(project, health) {
  const top = document.createElement("div");
  top.className = "project-v2-top";
  const title = document.createElement("h3");
  title.className = "project-v2-title";
  title.textContent = project.title;
  title.title = project.title;

  const right = document.createElement("div");
  right.className = "project-v2-top-right";
  right.append(createStatusPill(project.status), createHealthBadge(health));
  top.append(title, right);
  return top;
}

function buildFreshnessNode(health) {
  const text = document.createElement("p");
  text.className = "project-freshness-line";
  text.textContent = buildFreshnessText(health, new Date());
  return text;
}

function buildFreshnessText(health, now) {
  if (!health.nextExpectedUpdateDate) {
    return health.daysSinceUpdate === null ? "No update recorded yet" : `Updated ${health.daysSinceUpdate} days ago`;
  }
  const diff = diffDays(new Date(`${health.nextExpectedUpdateDate}T00:00:00Z`), now);
  if (diff < 0) return `Overdue by ${Math.abs(diff)} days`;
  if (diff === 0) return "Update due today";
  return `Update due in ${diff} days`;
}

function buildProjectTaskSummary(taskSummary) {
  const strip = document.createElement("div");
  strip.className = "project-task-summary-strip";
  strip.append(
    buildProjectStatChip("Open", String(taskSummary.openCount)),
    buildProjectStatChip("Overdue", String(taskSummary.overdueCount), taskSummary.overdueCount > 0),
    buildProjectStatChip("High priority", String(taskSummary.highPriorityCount)),
    buildProjectStatChip("Blocked", String(taskSummary.blockedCount), taskSummary.blockedCount > 0)
  );
  return strip;
}

function buildProjectStatChip(label, value, alert = false) {
  const chip = document.createElement("span");
  chip.className = `project-stat-chip${alert ? " is-alert" : ""}`;
  chip.textContent = `${label}: ${value}`;
  return chip;
}

function buildProjectMetaRow(project, health) {
  const meta = document.createElement("p");
  meta.className = "project-v2-meta";
  meta.textContent = `Last progress: ${project.lastProgressUpdate || "Not recorded"} · Next expected: ${health.nextExpectedUpdateDate || "Not set"}`;
  return meta;
}

function buildProjectActions(project, handlers) {
  const actions = document.createElement("div");
  actions.className = "project-v2-actions";
  actions.append(
    buildActionButton("Open", handlers.onOpen, "enter-mode-button project-open-button"),
    buildIconAction("📝", "Log update", handlers.onLogUpdate),
    buildIconAction("➕", "New task", handlers.onNewTask),
    buildIconAction("✎", "Edit", handlers.onEdit),
    buildIconAction("🗑", "Delete", handlers.onDelete)
  );
  return actions;
}

function createStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = `status-pill ${deriveProjectStatusClass({ status })}`;
  pill.textContent = humaniseProjectStatus(status);
  return pill;
}

function createHealthBadge(health) {
  const wrap = document.createElement("span");
  wrap.className = `project-health-pill ${health.healthStatus}`;
  wrap.textContent = humaniseHealthStatus(health.healthStatus);
  const info = document.createElement("span");
  info.className = "project-health-tooltip-icon";
  info.textContent = "ⓘ";
  info.title = health.reasonList.length ? health.reasonList.join(" • ") : "No active risk reasons";
  wrap.appendChild(info);
  return wrap;
}

function humaniseHealthStatus(status) {
  if (status === "at_risk") return "At risk";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildIconAction(icon, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button project-icon-button";
  button.textContent = icon;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function buildActionButton(label, onClick, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderProjectEditor({ people, meetings, project, onClose, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "task-drawer-overlay project-editor-overlay";
  const dismissGuard = createModalDismissGuard({ onClose });
  const requestClose = () => dismissGuard.requestClose();
  overlay.addEventListener("click", (event) => { if (event.target === overlay) requestClose(); });
  overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); requestClose(); } });

  const form = document.createElement("form");
  form.className = "task-drawer project-editor-drawer";

  const header = document.createElement("header");
  header.className = "task-drawer-header";
  const heading = document.createElement("h2");
  heading.textContent = project ? "Edit project" : "New project";
  const close = buildIconAction("✕", "Close", requestClose);
  close.classList.add("task-icon-button");
  header.append(heading, close);

  const body = document.createElement("div");
  body.className = "task-drawer-body";

  const title = buildLabeledInput("Title", "text", project?.title || "", true);
  const description = buildTextArea("Description", project?.description || "");
  const status = buildSelectField("Status", ["planned", "active", "on-hold", "completed"], project?.status || "planned");
  const cadenceInterval = buildLabeledInput("Cadence interval", "number", String(project?.cadenceInterval || 2), true);
  cadenceInterval.input.min = "1";
  const cadenceUnit = buildSelectField("Cadence unit", PROJECT_CADENCE_UNITS, project?.cadenceUnit || "weeks");
  const lastProgress = buildLabeledInput("Last progress update", "date", project?.lastProgressUpdate || "");
  const startDate = buildLabeledInput("Start date", "date", project?.startDate || "");
  const targetDate = buildLabeledInput("Target date", "date", project?.targetDate || "");

  const peopleControls = buildPersonRoleControls(people, project?.peopleLinks || []);
  const meetingsField = document.createElement("label");
  meetingsField.className = "field-label";
  meetingsField.textContent = "Linked meetings";
  const meetingSelect = document.createElement("select");
  meetingSelect.className = "field-input";
  meetingSelect.multiple = true;
  meetingSelect.size = 6;
  const linkedMeetingIds = meetings.filter((meeting) => meeting.projectId === project?.id).map((meeting) => meeting.id);
  meetings.filter((meeting) => !meeting.archived).forEach((meeting) => {
    const option = document.createElement("option");
    option.value = meeting.id;
    option.textContent = `${meeting.date} · ${meeting.name}`;
    option.selected = linkedMeetingIds.includes(meeting.id);
    meetingSelect.appendChild(option);
  });
  meetingsField.appendChild(meetingSelect);

  const core = createEditorSection("Core", true, [title.wrapper, description.wrapper, status.wrapper]);
  const cadence = createEditorSection("Cadence", true, [cadenceInterval.wrapper, cadenceUnit.wrapper, lastProgress.wrapper]);
  const timeline = createEditorSection("Timeline", false, [startDate.wrapper, targetDate.wrapper]);
  const links = createEditorSection("Links", false, [peopleControls.wrap, meetingsField]);
  body.append(core, cadence, timeline, links);

  const footer = document.createElement("footer");
  footer.className = "task-drawer-footer";
  const cancel = buildActionButton("Cancel", requestClose, "module-button-secondary");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "enter-mode-button";
  submit.textContent = project ? "Save project" : "Create project";
  footer.append(cancel, submit);

  form.append(header, body, footer);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!title.input.value.trim()) {
      title.input.setCustomValidity("Title is required");
      title.input.reportValidity();
      return;
    }
    title.input.setCustomValidity("");
    const selectedPersonLinks = peopleControls.read();
    const selectedMeetingIds = Array.from(meetingSelect.selectedOptions).map((entry) => entry.value);
    onSave({
      title: title.input.value.trim(),
      description: description.textarea.value.trim(),
      status: status.input.value,
      cadenceInterval: Number.parseInt(cadenceInterval.input.value, 10) || 2,
      cadenceUnit: cadenceUnit.input.value,
      lastProgressUpdate: lastProgress.input.value,
      startDate: startDate.input.value,
      targetDate: targetDate.input.value,
      personLinks: selectedPersonLinks,
      meetingIds: selectedMeetingIds,
      updates: project?.updates || []
    });
  });

  dismissGuard.bindDirtyTracking(form);
  overlay.appendChild(form);
  return overlay;
}

function createEditorSection(title, expanded, children) {
  const section = document.createElement("details");
  section.className = "project-editor-section";
  section.open = expanded;
  const summary = document.createElement("summary");
  summary.textContent = title;
  const grid = document.createElement("div");
  grid.className = "project-editor-grid";
  children.forEach((child) => grid.appendChild(child));
  section.append(summary, grid);
  return section;
}

function buildSelectField(labelText, values, selected) {
  const wrapper = document.createElement("label");
  wrapper.className = "field-label";
  wrapper.textContent = labelText;
  const input = document.createElement("select");
  input.className = "field-input";
  values.forEach((value) => addOption(input, value, humaniseProjectStatus(value)));
  input.value = selected;
  wrapper.appendChild(input);
  return { wrapper, input };
}

function readProjectsViewModePreference() {
  return localStorage.getItem("second-brain.work.projects.viewMode") === "list" ? "list" : "grid";
}

function persistProjectsViewModePreference(viewMode) {
  localStorage.setItem("second-brain.work.projects.viewMode", viewMode === "list" ? "list" : "grid");
}

function deriveProjectStatusClass(project) {
  const statusClassMap = { planned: "planned", active: "active", "on-hold": "on-hold", completed: "completed" };
  return statusClassMap[String(project.status || "").toLowerCase()] || "neutral";
}

function humaniseProjectStatus(status) {
  return String(status || "unknown").replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function diffDays(later, earlier) {
  return Math.floor((Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate()) - Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate())) / (1000 * 60 * 60 * 24));
}

function buildOverviewCard(label, value) {
  const card = document.createElement("article");
  card.className = "person-card";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const text = document.createElement("p");
  text.className = "person-note";
  text.textContent = value;
  card.append(heading, text);
  return card;
}

<<<<<<< codex/overhaul-projects-module-ui/ux-design
function buildLinkedEntitiesCard(project, people = []) {
=======
function buildLinkedEntitiesCard(project) {
>>>>>>> main
  const detailsCard = document.createElement("article");
  detailsCard.className = "person-card";
  const peopleHeading = document.createElement("h2");
  peopleHeading.textContent = "Linked people";
  const peopleList = document.createElement("ul");
  peopleList.className = "contact-trail";
  if (!project.peopleLinks.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No linked people yet.";
    peopleList.appendChild(empty);
  } else {
<<<<<<< codex/overhaul-projects-module-ui/ux-design
    // Resolve persisted person IDs to human-readable names for scanability.
    const peopleById = new Map(people.map((person) => [person.id, person.name || person.id]));
    project.peopleLinks.forEach((entry) => {
      const item = document.createElement("li");
      const displayName = peopleById.get(entry.personId) || entry.personId;
      item.textContent = `${displayName} (${entry.roles.join(", ") || "linked"})`;
=======
    project.peopleLinks.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.personId} (${entry.roles.join(", ") || "linked"})`;
>>>>>>> main
      peopleList.appendChild(item);
    });
  }
  detailsCard.append(peopleHeading, peopleList);
  return detailsCard;
}

function buildPersonRoleControls(people, existingLinks) {
  const wrap = document.createElement("div");
  wrap.className = "project-people-role-grid";
  const activePeople = people.filter((person) => !person.archived).map((person) => ({ value: person.id, label: person.name || person.id }));
  const roleControls = PROJECT_PERSON_ROLES.map((role) => {
    const row = document.createElement("div");
    row.className = "project-person-role-row";
    const roleHeading = document.createElement("strong");
    roleHeading.textContent = role;
    const preselectedPersonIds = existingLinks.filter((entry) => entry.roles.includes(role)).map((entry) => entry.personId);
    const peopleField = buildEntityTokenMultiSelectField({ label: "People", className: "field-label project-role-people-field", options: activePeople, values: preselectedPersonIds, inputPlaceholder: `Type to add ${role.toLowerCase()}s` });
    row.append(roleHeading, peopleField.wrapper);
    wrap.appendChild(row);
    return { role, hiddenInput: peopleField.hiddenInput };
  });

  return {
    wrap,
    read() {
      const roleMap = new Map();
      roleControls.forEach((entry) => {
        readEntityTokenHiddenValues(entry.hiddenInput).forEach((personId) => {
          if (!roleMap.has(personId)) roleMap.set(personId, new Set());
          roleMap.get(personId).add(entry.role);
        });
      });
      return Array.from(roleMap.entries()).map(([personId, roles]) => ({ personId, roles: Array.from(roles) }));
    }
  };
}

function buildLabeledInput(label, type, value, required = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field-label";
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
  input.value = value;
  input.required = required;
  wrapper.appendChild(input);
  return { wrapper, input };
}

function buildTextArea(label, value) {
  const wrapper = document.createElement("label");
  wrapper.className = "field-label";
  wrapper.textContent = label;
  const textarea = document.createElement("textarea");
  textarea.className = "field-input";
  textarea.rows = 4;
  textarea.value = value;
  wrapper.appendChild(textarea);
  return { wrapper, textarea };
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function applyProjectLinks(mode, projectId, personLinks, meetingIds) {
  personLinks.forEach((entry) => upsertProjectPersonLink(mode, projectId, entry.personId, entry.roles));
  const projects = loadProjects(mode);
  const project = projects.find((entry) => entry.id === projectId) || normaliseProject({ id: projectId });
  const existingPersonIds = new Set(personLinks.map((entry) => entry.personId));
  project.peopleLinks.filter((entry) => !existingPersonIds.has(entry.personId)).forEach((entry) => upsertProjectPersonLink(mode, projectId, entry.personId, []));

  const storedMeetings = loadMeetingsForProjectLinking(mode);
  const now = new Date().toISOString();
  const selected = new Set(meetingIds);
  const updated = storedMeetings.map((meeting) => {
    if (meeting.projectId === projectId && !selected.has(meeting.id)) return { ...meeting, projectId: "", updatedAt: now };
    if (selected.has(meeting.id)) return { ...meeting, projectId, updatedAt: now };
    return meeting;
  });
  persistMeetingsForProjectLinking(mode, updated);
}

function unlinkMeetingsForDeletedProject(projectId, meetings, mode) {
  const now = new Date().toISOString();
  persistMeetingsForProjectLinking(mode, meetings.map((meeting) => (meeting.projectId === projectId ? { ...meeting, projectId: "", updatedAt: now } : meeting)));
}

function loadMeetingsForProjectLinking(mode) {
  if (mode !== "work") return [];
  const raw = localStorage.getItem("second-brain.work.meetings.work");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.meetings)) return parsed.meetings;
  } catch {
    return [];
  }
  return [];
}

function persistMeetingsForProjectLinking(mode, meetings) {
  if (mode !== "work") return;
  localStorage.setItem("second-brain.work.meetings.work", JSON.stringify({ schemaVersion: 1, meetings }));
}
