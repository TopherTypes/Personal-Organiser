import {
  PROJECT_PERSON_ROLES,
  deleteProject,
  loadProjects,
  normaliseProject,
  saveProject,
  upsertProjectPersonLink
} from "./projects-store.js";

/**
 * Renders Work Projects module with card list, slide-over create/edit and full details view.
 */
export function renderWorkProjectsModule({ mode = "work", people = [], meetings = [] } = {}) {
  const state = {
    filter: "all",
    search: "",
    isEditorOpen: false,
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

    const header = document.createElement("div");
    header.className = "people-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h1");
    title.textContent = "Work Projects";

    const intro = document.createElement("p");
    intro.className = "module-intro";
    intro.textContent =
      "Group related meetings and people in one place. Links are non-destructive and can be updated later.";

    titleWrap.append(title, intro);

    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "enter-mode-button";
    newButton.textContent = "New project";
    newButton.addEventListener("click", () => {
      state.editingId = "";
      state.isEditorOpen = true;
      renderModule();
    });

    header.append(titleWrap, newButton);

    const controls = document.createElement("div");
    controls.className = "people-controls";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "field-input";
    search.placeholder = "Search project title, description, status";
    search.value = state.search;
    search.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderModule();
    });

    const filter = document.createElement("select");
    filter.className = "field-input";
    addOption(filter, "all", "All statuses");
    addOption(filter, "planned", "Planned");
    addOption(filter, "active", "Active");
    addOption(filter, "on-hold", "On hold");
    addOption(filter, "completed", "Completed");
    filter.value = state.filter;
    filter.addEventListener("change", (event) => {
      state.filter = event.target.value;
      renderModule();
    });

    const sortInfo = document.createElement("p");
    sortInfo.className = "archive-note";
    sortInfo.textContent =
      "Cards are sorted by last update across the project and linked meetings to surface active work.";

    controls.append(search, filter, document.createElement("div"));

    const list = document.createElement("div");
    list.className = "projects-card-list";

    const projects = queryProjects(loadProjects(mode), meetings, state);
    if (!projects.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        "No projects match the current filters. Create a project to start linking people and meetings.";
      list.appendChild(empty);
    }

    for (const project of projects) {
      list.appendChild(
        buildProjectCard(project, people, meetings, {
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

    section.append(header, controls, sortInfo, list);

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
  const panel = document.createElement("aside");
  panel.className = "meeting-slideover";

  const form = document.createElement("form");
  form.className = "people-form";

  const heading = document.createElement("h2");
  heading.textContent = project ? "Edit project" : "New project";

  const title = buildLabeledInput("Title", "text", project?.title || "", true);
  const description = buildTextArea("Description", project?.description || "");
  const startDate = buildLabeledInput("Start date", "date", project?.startDate || "");
  const targetDate = buildLabeledInput("Target date", "date", project?.targetDate || "");

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
  cancel.addEventListener("click", onClose);

  actions.append(saveButton, cancel);

  form.append(
    heading,
    title.wrapper,
    description.wrapper,
    startDate.wrapper,
    targetDate.wrapper,
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
      status: status.value,
      personLinks: selectedPersonLinks,
      meetingIds: selectedMeetingIds
    });
  });

  panel.appendChild(form);
  return panel;
}

function buildProjectCard(project, people, meetings, handlers) {
  const card = document.createElement("article");
  card.className = "person-card";

  const top = document.createElement("div");
  top.className = "person-card-top";

  const heading = document.createElement("h3");
  heading.textContent = project.title;

  const status = document.createElement("span");
  status.className = "status-pill active";
  status.textContent = project.status;
  top.append(heading, status);

  const description = document.createElement("p");
  description.className = "person-note";
  description.textContent = project.description || "No description provided.";

  const linkedPeople = project.peopleLinks.map((link) => {
    const person = people.find((entry) => entry.id === link.personId);
    return person ? `${person.name} (${link.roles.join(", ")})` : "Unknown";
  });

  const linkedMeetings = meetings.filter((meeting) => meeting.projectId === project.id && !meeting.archived);

  const meta = document.createElement("p");
  meta.className = "person-meta";
  meta.textContent = `${linkedPeople.length} people linked · ${linkedMeetings.length} meetings linked · Updated ${new Date(
    deriveProjectUpdatedAt(project, meetings)
  ).toLocaleString()}`;

  const linkPreview = document.createElement("p");
  linkPreview.className = "person-meta";
  linkPreview.textContent = linkedPeople.slice(0, 2).join("; ") || "No linked people yet.";

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const view = document.createElement("button");
  view.type = "button";
  view.className = "ghost-button";
  view.textContent = "View details";
  view.addEventListener("click", handlers.onView);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "ghost-button";
  edit.textContent = "Edit";
  edit.addEventListener("click", handlers.onEdit);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost-button";
  remove.textContent = "Delete";
  remove.addEventListener("click", handlers.onDelete);

  actions.append(view, edit, remove);
  card.append(top, description, meta, linkPreview, actions);
  return card;
}

function queryProjects(projects, meetings, state) {
  return projects
    .filter((project) => {
      if (state.filter !== "all" && project.status !== state.filter) {
        return false;
      }
      const haystack = `${project.title} ${project.description} ${project.status}`.toLowerCase();
      return haystack.includes(state.search.toLowerCase());
    })
    .sort(
      (a, b) =>
        deriveProjectUpdatedAt(b, meetings).localeCompare(deriveProjectUpdatedAt(a, meetings))
    );
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

  const controls = people.map((person) => {
    const row = document.createElement("div");
    row.className = "project-person-role-row";

    const name = document.createElement("strong");
    name.textContent = person.name;

    const saved = existingLinks.find((entry) => entry.personId === person.id);

    const roleSelect = document.createElement("select");
    roleSelect.className = "field-input";
    roleSelect.multiple = true;
    roleSelect.size = 3;

    PROJECT_PERSON_ROLES.forEach((role) => {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      option.selected = Boolean(saved?.roles.includes(role));
      roleSelect.appendChild(option);
    });

    row.append(name, roleSelect);
    wrap.appendChild(row);

    return {
      personId: person.id,
      roleSelect
    };
  });

  return {
    wrap,
    read() {
      return controls
        .map((entry) => ({
          personId: entry.personId,
          roles: Array.from(entry.roleSelect.selectedOptions).map((option) => option.value)
        }))
        .filter((entry) => entry.roles.length > 0);
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
