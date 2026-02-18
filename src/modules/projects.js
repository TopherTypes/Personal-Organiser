import {
  PROJECT_CADENCE_UNITS,
  PROJECT_PERSON_ROLES,
  deriveNextExpectedUpdateDate,
  deleteProject,
  loadProjects,
  normaliseProject,
  saveProject,
  upsertProjectPersonLink
} from "./projects-store.js";
import { buildEntityTokenMultiSelectField, readEntityTokenHiddenValues } from "./select-controls.js";
import { createModalDismissGuard } from "./modal-dismiss-guard.js";

/**
 * Renders Work Projects module with card list, slide-over create/edit and full details view.
 */
export function renderWorkProjectsModule({ mode = "work", people = [], meetings = [], openComposer = false } = {}) {
  const initialViewMode = readProjectsViewModePreference();
  const state = {
    filter: "all",
    search: "",
    sort: "recently-updated",
    viewMode: initialViewMode,
    // Quick-action deep links can request the create editor at first module paint.
    isEditorOpen: openComposer,
    editingId: "",
    viewingId: "",
    feedback: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard projects-module";

  function renderModule() {
    section.innerHTML = "";

    if (state.viewingId) {
      section.appendChild(renderProjectDetails());
      return;
    }

    const header = renderProjectsHeader({
      mode,
      onCreateProject: () => {
        state.editingId = "";
        state.isEditorOpen = true;
        renderModule();
      }
    });

    const projects = queryProjects(loadProjects(mode), meetings, state);
    const toolbar = renderProjectsToolbar({
      state,
      onSearchChange: (value) => {
        state.search = value;
        renderModule();
      },
      onFilterChange: (value) => {
        state.filter = value;
        renderModule();
      },
      onSortChange: (value) => {
        state.sort = value;
        renderModule();
      },
      onViewModeChange: (value) => {
        state.viewMode = value;
        persistProjectsViewModePreference(value);
        renderModule();
      }
    });

    const resultsSummary = renderProjectsResultsSummary(projects, state.filter);

    const list = document.createElement("div");
    list.className = `projects-results projects-view-${state.viewMode}`;
    if (!projects.length) {
      const empty = renderProjectsEmptyState({
        hasFilter: state.filter !== "all" || Boolean(state.search.trim()),
        onClearFilters: () => {
          state.filter = "all";
          state.search = "";
          renderModule();
        }
      });
      list.appendChild(empty);
    }

    for (const project of projects) {
      const item = state.viewMode === "list" ? buildProjectRowV2 : buildProjectCardV2;
      list.appendChild(
        item(project, people, meetings, {
          onEdit: () => {
            state.editingId = project.id;
            state.isEditorOpen = true;
            renderModule();
          },
          onView: () => {
            state.viewingId = project.id;
            renderModule();
          },
          onDelete: () => {
            const counts = countLinks(project, meetings);
            const shouldDelete = window.confirm(
              `Delete project \"${project.title}\"? This removes ${counts.people} people links and ${counts.meetings} meeting links. People and meetings records will remain.`
            );
            if (!shouldDelete) {
              return;
            }

            const result = deleteProject(mode, project.id);
            if (!result.ok) {
              state.feedback = result.error;
              renderModule();
              return;
            }

            unlinkMeetingsForDeletedProject(project.id, meetings, mode);
            state.feedback = `Deleted ${project.title}. Linked entities were retained.`;
            renderModule();
          }
        })
      );
    }

    if (state.feedback) {
      const feedback = document.createElement("p");
      feedback.className = "feedback";
      feedback.textContent = state.feedback;
      section.appendChild(feedback);
      state.feedback = "";
    }

    section.append(header, toolbar, resultsSummary, list);

    if (state.isEditorOpen) {
      const editing = state.editingId
        ? loadProjects(mode).find((project) => project.id === state.editingId)
        : null;
      section.appendChild(
        renderProjectEditor({
          people,
          meetings,
          project: editing,
          onClose: () => {
            state.isEditorOpen = false;
            state.editingId = "";
            renderModule();
          },
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
        })
      );
    }
  }

  function renderProjectDetails() {
    const project = loadProjects(mode).find((entry) => entry.id === state.viewingId);
    const wrap = document.createElement("div");
    wrap.className = "project-details-view";

    if (!project) {
      const missing = document.createElement("p");
      missing.className = "empty-state";
      missing.textContent = "Project not found. It may have been deleted.";
      wrap.appendChild(missing);
      return wrap;
    }

    const back = document.createElement("button");
    back.type = "button";
    back.className = "module-button-secondary";
    back.textContent = "← Back to projects";
    back.addEventListener("click", () => {
      state.viewingId = "";
      renderModule();
    });

    const heading = document.createElement("h1");
    heading.textContent = project.title;

    const summary = document.createElement("p");
    summary.className = "module-intro";
    summary.textContent = project.description || "No description provided.";

    const overview = document.createElement("div");
    overview.className = "project-overview-grid";

    overview.append(
      buildOverviewCard("Status", project.status),
      buildOverviewCard("Start date", project.startDate || "Not set"),
      buildOverviewCard("Target date", project.targetDate || "Not set"),
      buildOverviewCard("Last updated", new Date(project.updatedAt).toLocaleString())
    );

    const linkedPeople = people
      .map((person) => {
        const link = project.peopleLinks.find((entry) => entry.personId === person.id);
        return link ? `${person.name} (${link.roles.join(", ") || "linked"})` : "";
      })
      .filter(Boolean);

    const peopleList = document.createElement("ul");
    peopleList.className = "contact-trail";
    if (!linkedPeople.length) {
      const empty = document.createElement("li");
      empty.textContent = "No linked people.";
      peopleList.appendChild(empty);
    } else {
      linkedPeople.forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        peopleList.appendChild(item);
      });
    }

    const meetingList = document.createElement("ul");
    meetingList.className = "contact-trail";
    const linkedMeetings = meetings.filter((meeting) => meeting.projectId === project.id && !meeting.archived);
    if (!linkedMeetings.length) {
      const empty = document.createElement("li");
      empty.textContent = "No linked meetings.";
      meetingList.appendChild(empty);
    } else {
      linkedMeetings.forEach((meeting) => {
        const item = document.createElement("li");
        item.textContent = `${meeting.name} (${meeting.date})`;
        meetingList.appendChild(item);
      });
    }

    const detailsCard = document.createElement("article");
    detailsCard.className = "person-card";
    const peopleHeading = document.createElement("h2");
    peopleHeading.textContent = "Linked people";
    const meetingsHeading = document.createElement("h2");
    meetingsHeading.textContent = "Linked meetings";

    detailsCard.append(peopleHeading, peopleList, meetingsHeading, meetingList);

    wrap.append(back, heading, summary, overview, detailsCard);
    return wrap;
  }

  renderModule();
  return section;
}

function renderProjectEditor({ people, meetings, project, onClose, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "meeting-modal-overlay";
  overlay.tabIndex = -1;

  const dismissGuard = createModalDismissGuard({ onClose });
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
  heading.textContent = project ? "Edit project" : "New project";

  const title = buildLabeledInput("Title", "text", project?.title || "", true);
  const description = buildTextArea("Description", project?.description || "");
  const startDate = buildLabeledInput("Start date", "date", project?.startDate || "");
  const targetDate = buildLabeledInput("Target date", "date", project?.targetDate || "");
  const lastProgressUpdate = buildLabeledInput(
    "Last progress update",
    "date",
    project?.lastProgressUpdate || ""
  );

  const cadenceRow = document.createElement("div");
  cadenceRow.className = "field-row";
  const cadenceInterval = buildLabeledInput(
    "Cadence interval",
    "number",
    String(project?.cadenceInterval || 1),
    true
  );
  cadenceInterval.input.min = "1";

  const cadenceUnitWrap = document.createElement("label");
  cadenceUnitWrap.className = "field-label";
  cadenceUnitWrap.textContent = "Cadence unit";
  const cadenceUnit = document.createElement("select");
  cadenceUnit.className = "field-input";
  PROJECT_CADENCE_UNITS.forEach((unit) => {
    addOption(cadenceUnit, unit, unit[0].toUpperCase() + unit.slice(1));
  });
  cadenceUnit.value = project?.cadenceUnit || "weeks";
  cadenceUnitWrap.appendChild(cadenceUnit);
  cadenceRow.append(cadenceInterval.wrapper, cadenceUnitWrap);

  const statusWrap = document.createElement("label");
  statusWrap.className = "field-label";
  statusWrap.textContent = "Status";
  const status = document.createElement("select");
  status.className = "field-input";
  status.required = true;
  addOption(status, "planned", "Planned");
  addOption(status, "active", "Active");
  addOption(status, "on-hold", "On hold");
  addOption(status, "completed", "Completed");
  status.value = project?.status || "planned";
  statusWrap.appendChild(status);

  const personLinks = document.createElement("div");
  personLinks.className = "field-row";
  const personLabel = document.createElement("span");
  personLabel.className = "field-label";
  personLabel.textContent = "Link people and roles";
  personLinks.appendChild(personLabel);

  const personRoleControls = buildPersonRoleControls(people, project?.peopleLinks || []);
  personLinks.appendChild(personRoleControls.wrap);

  const meetingsWrap = document.createElement("label");
  meetingsWrap.className = "field-label";
  meetingsWrap.textContent = "Link meetings";
  const meetingSelect = document.createElement("select");
  meetingSelect.className = "field-input";
  meetingSelect.multiple = true;
  meetingSelect.size = 5;

  const linkedMeetingIds = meetings
    .filter((meeting) => meeting.projectId === project?.id)
    .map((meeting) => meeting.id);

  meetings
    .filter((meeting) => !meeting.archived)
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .forEach((meeting) => {
      const option = document.createElement("option");
      option.value = meeting.id;
      option.textContent = `${meeting.date} · ${meeting.name}`;
      option.selected = linkedMeetingIds.includes(meeting.id);
      meetingSelect.appendChild(option);
    });
  meetingsWrap.appendChild(meetingSelect);

  const actions = document.createElement("div");
  actions.className = "meeting-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "enter-mode-button";
  saveButton.textContent = project ? "Save project" : "Create project";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "module-button-secondary";
  cancel.textContent = "Close";
  cancel.addEventListener("click", requestClose);

  actions.append(saveButton, cancel);

  form.append(
    heading,
    title.wrapper,
    description.wrapper,
    startDate.wrapper,
    targetDate.wrapper,
    lastProgressUpdate.wrapper,
    cadenceRow,
    statusWrap,
    personLinks,
    meetingsWrap,
    actions
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selectedPersonLinks = personRoleControls.read();
    const hasStakeholder = selectedPersonLinks.some((entry) => entry.roles.includes("stakeholder"));

    if (!hasStakeholder) {
      alert("At least one stakeholder must be linked when creating or editing a project.");
      return;
    }

    const selectedMeetingIds = Array.from(meetingSelect.selectedOptions).map((option) => option.value);

    onSave({
      title: title.input.value.trim(),
      description: description.textarea.value.trim(),
      startDate: startDate.input.value,
      targetDate: targetDate.input.value,
      lastProgressUpdate: lastProgressUpdate.input.value,
      cadenceInterval: Number.parseInt(cadenceInterval.input.value, 10) || 1,
      cadenceUnit: cadenceUnit.value,
      status: status.value,
      personLinks: selectedPersonLinks,
      meetingIds: selectedMeetingIds
    });
  });

  // Once users mutate any form control, dismissing requires explicit confirmation.
  dismissGuard.bindDirtyTracking(form);

  overlay.appendChild(form);
  return overlay;
}

function renderProjectsHeader({ mode, onCreateProject }) {
  const header = document.createElement("header");
  header.className = "projects-header-v2";

  const titleWrap = document.createElement("div");
  titleWrap.className = "projects-header-copy";

  const title = document.createElement("h1");
  const isPersonalMode = mode === "personal";
  title.textContent = isPersonalMode ? "Personal Projects" : "Work Projects";

  const subtitle = document.createElement("p");
  subtitle.className = "module-intro";
  subtitle.textContent = isPersonalMode
    ? "Track goals, people, and momentum in one compact project workspace."
    : "Scan status, freshness, and next expected updates across all active workstreams.";

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "enter-mode-button";
  createButton.textContent = "New project";
  createButton.addEventListener("click", onCreateProject);

  titleWrap.append(title, subtitle);
  header.append(titleWrap, createButton);
  return header;
}

function renderProjectsToolbar({ state, onSearchChange, onFilterChange, onSortChange, onViewModeChange }) {
  const toolbar = document.createElement("div");
  toolbar.className = "projects-toolbar";

  const searchWrap = document.createElement("label");
  searchWrap.className = "projects-search";
  searchWrap.setAttribute("aria-label", "Search projects");

  const searchIcon = document.createElement("span");
  searchIcon.className = "projects-search-icon";
  searchIcon.textContent = "⌕";
  searchIcon.setAttribute("aria-hidden", "true");

  const search = document.createElement("input");
  search.type = "search";
  search.className = "field-input";
  search.placeholder = "Search title, description, or status";
  search.value = state.search;
  search.addEventListener("input", (event) => onSearchChange(event.target.value));
  searchWrap.append(searchIcon, search);

  const filter = document.createElement("select");
  filter.className = "field-input";
  filter.setAttribute("aria-label", "Filter by status");
  addOption(filter, "all", "Status: All");
  addOption(filter, "planned", "Status: Planned");
  addOption(filter, "active", "Status: Active");
  addOption(filter, "on-hold", "Status: On hold");
  addOption(filter, "completed", "Status: Completed");
  filter.value = state.filter;
  filter.addEventListener("change", (event) => onFilterChange(event.target.value));

  const sort = document.createElement("select");
  sort.className = "field-input";
  sort.setAttribute("aria-label", "Sort projects");
  addOption(sort, "name", "Name A–Z");
  addOption(sort, "recently-updated", "Recently updated");
  addOption(sort, "next-expected", "Next expected soonest");
  sort.value = state.sort;
  sort.addEventListener("change", (event) => onSortChange(event.target.value));

  const viewToggle = document.createElement("div");
  viewToggle.className = "projects-view-toggle";
  viewToggle.setAttribute("role", "group");
  viewToggle.setAttribute("aria-label", "Project layout view");

  [
    { value: "grid", label: "Grid" },
    { value: "list", label: "List" }
  ].forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "projects-view-toggle-button";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(state.viewMode === option.value));
    if (state.viewMode === option.value) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => onViewModeChange(option.value));
    viewToggle.appendChild(button);
  });

  toolbar.append(searchWrap, filter, sort, viewToggle);
  return toolbar;
}

function renderProjectsResultsSummary(projects, filter) {
  const summary = document.createElement("p");
  summary.className = "projects-results-summary";
  const filterText = filter !== "all" ? ` · Filter: ${humaniseProjectStatus(filter)}` : "";
  summary.textContent = `${projects.length} ${projects.length === 1 ? "project" : "projects"}${filterText}`;
  return summary;
}

function renderProjectsEmptyState({ hasFilter, onClearFilters }) {
  const empty = document.createElement("div");
  empty.className = "empty-state projects-empty-state";

  const heading = document.createElement("p");
  heading.textContent = hasFilter
    ? "No projects match the current search and filter settings."
    : "No projects yet. Create your first project to start tracking progress.";

  empty.appendChild(heading);
  if (hasFilter) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "ghost-button clear-filters";
    clearButton.textContent = "Clear filters";
    clearButton.addEventListener("click", onClearFilters);
    empty.appendChild(clearButton);
  }

  return empty;
}

function buildProjectCardV2(project, _people, meetings, handlers) {
  const card = document.createElement("article");
  card.className = "project-card-v2";

  const top = buildProjectTopRow(project, meetings);
  const description = buildProjectDescription(project);
  const stats = buildProjectStatsRow(project, meetings);
  const meta = buildProjectMetaRow(project, meetings);
  const actions = buildProjectActions(project, handlers);

  card.append(top, description, stats, meta, actions);
  return card;
}

function buildProjectRowV2(project, _people, meetings, handlers) {
  const row = document.createElement("article");
  row.className = "project-row-v2";

  const left = document.createElement("div");
  left.className = "project-row-main";
  left.append(buildProjectTopRow(project, meetings), buildProjectDescription(project));

  const right = document.createElement("div");
  right.className = "project-row-side";
  right.append(buildProjectStatsRow(project, meetings, { compact: true }), buildProjectActions(project, handlers));

  row.append(left, right);
  return row;
}

function buildProjectTopRow(project, meetings) {
  const top = document.createElement("div");
  top.className = "project-v2-top";

  const title = document.createElement("h3");
  title.className = "project-v2-title";
  title.title = project.title;
  title.textContent = project.title;

  const right = document.createElement("div");
  right.className = "project-v2-top-right";

  if (isProjectRecentlyUpdated(project, meetings)) {
    const recent = document.createElement("span");
    recent.className = "project-recent-dot";
    recent.textContent = "Updated recently";
    right.appendChild(recent);
  }

  const status = document.createElement("span");
  status.className = `status-pill ${deriveProjectStatusClass(project)}`;
  status.textContent = humaniseProjectStatus(project.status);

  right.appendChild(status);
  top.append(title, right);
  return top;
}

function buildProjectDescription(project) {
  const description = document.createElement("p");
  description.className = "project-v2-summary";
  description.textContent = project.description || "No description provided.";
  return description;
}

function buildProjectStatsRow(project, meetings, { compact = false } = {}) {
  const linkedMeetings = meetings.filter((meeting) => meeting.projectId === project.id && !meeting.archived);
  const nextExpected = deriveNextExpectedUpdateDate(project);
  const overdue = isDateOverdue(nextExpected);

  const stats = document.createElement("div");
  stats.className = `project-stats-row${compact ? " is-compact" : ""}`;
  stats.append(
    buildProjectStatChip("👤", String(project.peopleLinks.length), "People linked"),
    buildProjectStatChip("📅", String(linkedMeetings.length), "Meetings linked"),
    buildProjectStatChip("⏱", humaniseCadence(project), "Cadence"),
    buildProjectStatChip("➜", nextExpected || "Waiting", "Next expected", overdue)
  );
  return stats;
}

function buildProjectStatChip(icon, text, label, isAlert = false) {
  const chip = document.createElement("p");
  chip.className = `project-stat-chip${isAlert ? " is-alert" : ""}`;
  chip.setAttribute("aria-label", `${label}: ${text}`);
  chip.textContent = `${icon} ${text}`;
  return chip;
}

function buildProjectMetaRow(project, meetings) {
  const meta = document.createElement("p");
  meta.className = "project-v2-meta";
  const updatedAt = deriveProjectUpdatedAt(project, meetings);
  meta.textContent = `Updated: ${formatProjectDate(updatedAt)} · Last progress: ${project.lastProgressUpdate || "Not recorded"}`;
  return meta;
}

function buildProjectActions(project, handlers) {
  const actions = document.createElement("div");
  actions.className = "project-v2-actions";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "enter-mode-button project-open-button";
  open.textContent = "Open";
  open.setAttribute("aria-label", `Open details for ${project.title}`);
  open.addEventListener("click", handlers.onView);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "ghost-button project-icon-button";
  edit.textContent = "✎";
  edit.setAttribute("aria-label", `Edit ${project.title}`);
  edit.title = "Edit";
  edit.addEventListener("click", handlers.onEdit);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost-button project-icon-button project-delete-button";
  remove.textContent = "🗑";
  remove.setAttribute("aria-label", `Delete ${project.title}`);
  remove.title = "Delete";
  remove.addEventListener("click", handlers.onDelete);

  actions.append(open, edit, remove);
  return actions;
}

/**
 * Maps project status values to pill variants, with safe fallback handling for
 * legacy/unknown data and archived records.
 */
function deriveProjectStatusClass(project) {
  if (project.archived || project.status === "archived") {
    return "archived";
  }

  const statusClassMap = {
    planned: "planned",
    active: "active",
    "on-hold": "on-hold",
    completed: "completed"
  };

  const normalisedStatus = String(project.status || "")
    .trim()
    .toLowerCase();

  return statusClassMap[normalisedStatus] || "neutral";
}

function queryProjects(projects, meetings, state) {
  const filteredProjects = projects
    .filter((project) => {
      if (state.filter !== "all" && project.status !== state.filter) {
        return false;
      }
      const haystack = `${project.title} ${project.description} ${project.status}`.toLowerCase();
      return haystack.includes(state.search.toLowerCase());
    });

  return sortProjects(filteredProjects, meetings, state.sort);
}

/**
 * Sorts projects using deterministic comparators so toolbar selection can
 * switch views without mutating original persistence order.
 */
function sortProjects(projects, meetings, sortMode) {
  const ordered = [...projects];

  ordered.sort((left, right) => {
    if (sortMode === "name") {
      return left.title.localeCompare(right.title);
    }

    if (sortMode === "next-expected") {
      return compareOptionalDates(deriveNextExpectedUpdateDate(left), deriveNextExpectedUpdateDate(right));
    }

    return compareOptionalDates(deriveProjectUpdatedAt(right, meetings), deriveProjectUpdatedAt(left, meetings));
  });

  return ordered;
}

function compareOptionalDates(left, right) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return left.localeCompare(right);
}

function humaniseProjectStatus(status) {
  return String(status || "unknown")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function humaniseCadence(project) {
  const unit = String(project.cadenceUnit || "weeks").replace(/s$/, "");
  const pluralSuffix = project.cadenceInterval === 1 ? "" : "s";
  return `${project.cadenceInterval} ${unit}${pluralSuffix}`;
}

function formatProjectDate(value) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function isDateOverdue(dateIso) {
  if (!dateIso) {
    return false;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  return dateIso < todayIso;
}

function isProjectRecentlyUpdated(project, meetings) {
  const updatedAt = deriveProjectUpdatedAt(project, meetings);
  if (!updatedAt) {
    return false;
  }
  const ageInMs = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(ageInMs)) {
    return false;
  }
  return ageInMs <= 1000 * 60 * 60 * 24 * 3;
}

/**
 * Persists desktop view preference between sessions for faster return visits.
 */
function readProjectsViewModePreference() {
  const value = localStorage.getItem("second-brain.work.projects.viewMode");
  return value === "list" ? "list" : "grid";
}

function persistProjectsViewModePreference(viewMode) {
  localStorage.setItem("second-brain.work.projects.viewMode", viewMode === "list" ? "list" : "grid");
}

function deriveProjectUpdatedAt(project, meetings) {
  const linkedMeetingUpdates = meetings
    .filter((meeting) => meeting.projectId === project.id)
    .map((meeting) => meeting.updatedAt || "");

  return [project.updatedAt || "", ...linkedMeetingUpdates].sort().slice(-1)[0] || project.updatedAt;
}

function countLinks(project, meetings) {
  return {
    people: project.peopleLinks.length,
    meetings: meetings.filter((meeting) => meeting.projectId === project.id).length
  };
}

function applyProjectLinks(mode, projectId, personLinks, meetingIds) {
  personLinks.forEach((entry) => {
    upsertProjectPersonLink(mode, projectId, entry.personId, entry.roles);
  });

  const projects = loadProjects(mode);
  const project = projects.find((entry) => entry.id === projectId) || normaliseProject({ id: projectId });

  const existingPersonIds = new Set(personLinks.map((entry) => entry.personId));
  project.peopleLinks
    .filter((entry) => !existingPersonIds.has(entry.personId))
    .forEach((entry) => {
      upsertProjectPersonLink(mode, projectId, entry.personId, []);
    });

  const storedMeetings = loadMeetingsForProjectLinking(mode);
  const now = new Date().toISOString();
  const selected = new Set(meetingIds);
  const updated = storedMeetings.map((meeting) => {
    if (meeting.projectId === projectId && !selected.has(meeting.id)) {
      return {
        ...meeting,
        projectId: "",
        updatedAt: now
      };
    }

    if (selected.has(meeting.id)) {
      return {
        ...meeting,
        projectId,
        updatedAt: now
      };
    }

    return meeting;
  });

  persistMeetingsForProjectLinking(mode, updated);
}

function unlinkMeetingsForDeletedProject(projectId, meetings, mode) {
  const now = new Date().toISOString();
  const updated = meetings.map((meeting) =>
    meeting.projectId === projectId
      ? {
          ...meeting,
          projectId: "",
          updatedAt: now
        }
      : meeting
  );

  persistMeetingsForProjectLinking(mode, updated);
}

/**
 * Meetings persistence helpers are duplicated here to avoid cross-module cyclic imports.
 */
function loadMeetingsForProjectLinking(mode) {
  if (mode !== "work") {
    return [];
  }
  const raw = localStorage.getItem("second-brain.work.meetings.work");
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.meetings)) {
      return parsed.meetings;
    }
    return [];
  } catch {
    return [];
  }
}

function persistMeetingsForProjectLinking(mode, meetings) {
  if (mode !== "work") {
    return;
  }

  localStorage.setItem(
    "second-brain.work.meetings.work",
    JSON.stringify({ schemaVersion: 1, meetings })
  );
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

function buildPersonRoleControls(people, existingLinks) {
  const wrap = document.createElement("div");
  wrap.className = "project-people-role-grid";

  const activePeople = people
    .filter((person) => !person.archived)
    .map((person) => ({ value: person.id, label: person.name || person.id }));

  const roleControls = PROJECT_PERSON_ROLES.map((role) => {
    const row = document.createElement("div");
    row.className = "project-person-role-row";

    const roleHeading = document.createElement("strong");
    roleHeading.textContent = role;

    const preselectedPersonIds = existingLinks
      .filter((entry) => entry.roles.includes(role))
      .map((entry) => entry.personId);

    const peopleField = buildEntityTokenMultiSelectField({
      label: "People",
      className: "field-label project-role-people-field",
      options: activePeople,
      values: preselectedPersonIds,
      inputPlaceholder: `Type to add ${role.toLowerCase()}s`
    });

    row.append(roleHeading, peopleField.wrapper);
    wrap.appendChild(row);

    return {
      role,
      hiddenInput: peopleField.hiddenInput
    };
  });

  return {
    wrap,
    read() {
      const roleMap = new Map();

      roleControls.forEach((entry) => {
        const selectedIds = readEntityTokenHiddenValues(entry.hiddenInput);
        selectedIds.forEach((personId) => {
          if (!roleMap.has(personId)) {
            roleMap.set(personId, new Set());
          }
          roleMap.get(personId).add(entry.role);
        });
      });

      return [...roleMap.entries()].map(([personId, roles]) => ({
        personId,
        roles: [...roles]
      }));
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
  textarea.className = "field-input field-textarea";
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
