import { loadMeetings, renderWorkMeetingsModule } from "./meetings.js";
import { renderWorkProjectsModule } from "./projects.js";
import { renderWorkTasksModule } from "./tasks.js";
import { renderWorkSprintsModule } from "./sprints.js";
import { PROJECT_PERSON_ROLES, loadPersonProjectLinks, loadProjects, upsertProjectPersonLink } from "./projects-store.js";
import { renderSettingsModule } from "./settings.js";
import { renderPersonalTasksModule } from "./personal-tasks.js";
import { renderPersonalProjectsModule } from "./personal-projects.js";
import { renderPersonalDailyLogModule } from "./personal-daily-log.js";
import { renderPersonalExerciseLogModule } from "./personal-exercise-log.js";
import { renderPersonalPeopleModule } from "./personal-people.js";
import { renderPersonalCalendarModule } from "./personal-calendar.js";
const STORAGE_KEY_PREFIX = "second-brain.work.people";

/**
 * Renders cross-life landing dashboard shown before a mode is entered.
 */
export function renderLandingDashboard({ onEnterMode }) {
  const section = document.createElement("section");
  section.className = "landing-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Choose where to focus";

  const intro = document.createElement("p");
  intro.textContent =
    "Start in Work or Personal mode. Data remains separated by design.";

  const cards = document.createElement("div");
  cards.className = "landing-cards";

  cards.append(
    createModeCard("Work", "Projects, tasks, meetings, and stakeholder updates.", "work", onEnterMode),
    createModeCard(
      "Personal",
      "Tasks, relationships, and daily wellbeing logs.",
      "personal",
      onEnterMode
    )
  );

  section.append(title, intro, cards);
  return section;
}

/**
 * Builds an individual landing card.
 */
function createModeCard(name, description, mode, onEnterMode) {
  const card = document.createElement("article");
  card.className = "landing-card";

  const heading = document.createElement("h2");
  heading.textContent = name;

  const copy = document.createElement("p");
  copy.textContent = description;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "enter-mode-button";
  button.textContent = `Enter ${name}`;
  button.addEventListener("click", () => onEnterMode(mode));

  card.append(heading, copy, button);
  return card;
}

/**
 * Renders mode content based on selected sidebar module.
 */
export function renderModeDashboard(mode, { activeModule = "dashboard", uiContext = {} } = {}) {
  if (mode === "work" && activeModule === "people") {
    return renderWorkPeopleModule(uiContext);
  }

  if (mode === "work" && activeModule === "meetings") {
    return renderWorkMeetingsModule({
      mode,
      people: loadPeople("work"),
      initialPrefill: uiContext.meetingPrefill || null,
      setUnsavedChangesGuard: uiContext.setUnsavedChangesGuard
    });
  }

  if (mode === "work" && activeModule === "tasks") {
    return renderWorkTasksModule({ mode });
  }

  if (mode === "work" && activeModule === "projects") {
    return renderWorkProjectsModule({
      mode,
      people: loadPeople("work"),
      meetings: loadMeetings("work")
    });
  }

  if (mode === "work" && activeModule === "sprints") {
    return renderWorkSprintsModule({ mode });
  }

  if (mode === "personal" && activeModule === "tasks") {
    return renderPersonalTasksModule();
  }

  if (mode === "personal" && activeModule === "projects") {
    return renderPersonalProjectsModule();
  }

  if (mode === "personal" && activeModule === "daily-log") {
    return renderPersonalDailyLogModule();
  }

  if (mode === "personal" && activeModule === "exercise-log") {
    return renderPersonalExerciseLogModule();
  }

  if (mode === "personal" && activeModule === "people") {
    return renderPersonalPeopleModule();
  }

  if (mode === "personal" && activeModule === "calendar") {
    return renderPersonalCalendarModule();
  }

  if (activeModule === "settings") {
    return renderSettingsModule({
      mode,
      settings: uiContext.settings || {},
      onSettingsChange: uiContext.onSettingsChange,
      onDataRestore: uiContext.onDataRestore
    });
  }

  return renderPlaceholderModule(mode, activeModule);
}

/**
 * Renders a placeholder module until each feature area is implemented.
 */
function renderPlaceholderModule(mode, activeModule) {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = `${toTitleCase(mode)} ${toTitleCase(activeModule)}`;

  const body = document.createElement("p");
  body.textContent =
    "This module is ready in navigation. Functional workflows will be delivered incrementally.";

  section.append(title, body);
  return section;
}

/**
 * Renders the work mode People module with localStorage-backed CRUD support.
 */
function renderWorkPeopleModule(uiContext = {}) {
  const state = createPeopleUiState("work");

  const section = document.createElement("section");
  section.className = "mode-dashboard people-module people-shell";

  const header = document.createElement("header");
  header.className = "people-page-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "people-title-wrap";

  const title = document.createElement("h1");
  title.textContent = "Work People";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Track work contacts, stakeholder relationships, and keep a timestamped log of engagements.";

  const metrics = document.createElement("div");
  metrics.className = "people-metrics";

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "button button-primary";
  createButton.textContent = "Add person";
  createButton.addEventListener("click", () => {
    state.editingId = null;
    state.isFormOpen = true;
    state.selectedPersonId = null;
    renderPeopleModule();
  });

  titleWrap.append(title, intro, metrics);
  header.append(titleWrap, createButton);

  const notice = document.createElement("p");
  notice.className = "info-banner";
  notice.textContent =
    "ℹ️ Data safety: records are archived (not deleted) and remain recoverable in this module.";

  const controls = document.createElement("div");
  controls.className = "people-controls";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "field-input";
  search.placeholder = "Search by name, organisation, role, relationship, or notes";
  search.value = state.search;
  search.setAttribute("aria-label", "Search people");
  search.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderPeopleModule();
  });

  const filter = document.createElement("select");
  filter.className = "field-input";
  filter.setAttribute("aria-label", "Filter by status");
  addOption(filter, "active", "Active only");
  addOption(filter, "archived", "Archived only");
  addOption(filter, "all", "All statuses");
  filter.value = state.filter;
  filter.addEventListener("change", (event) => {
    state.filter = event.target.value;
    renderPeopleModule();
  });

  const sort = document.createElement("select");
  sort.className = "field-input";
  sort.setAttribute("aria-label", "Sort people");
  addOption(sort, "updated-desc", "Recently updated");
  addOption(sort, "name-asc", "Name A → Z");
  addOption(sort, "name-desc", "Name Z → A");
  addOption(sort, "contact-desc", "Last contact newest");
  addOption(sort, "contact-asc", "Last contact oldest");
  sort.value = state.sort;
  sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderPeopleModule();
  });

  const clearFilters = document.createElement("button");
  clearFilters.type = "button";
  clearFilters.className = "button button-secondary clear-filters";
  clearFilters.textContent = "Clear filters";
  clearFilters.addEventListener("click", () => {
    state.search = "";
    state.filter = "active";
    state.sort = "updated-desc";
    renderPeopleModule();
  });

  controls.append(search, filter, sort, clearFilters);

  const message = document.createElement("p");
  message.className = "feedback";

  const workspace = document.createElement("div");
  workspace.className = "people-workspace";

  const listPanel = document.createElement("div");
  listPanel.className = "people-list-panel card";

  const listWrap = document.createElement("div");
  listWrap.className = "people-list";

  const detailPanel = document.createElement("section");
  detailPanel.className = "people-detail-panel card";
  detailPanel.setAttribute("aria-live", "polite");

  const formWrap = document.createElement("div");
  formWrap.className = "people-form-wrap";

  const toast = document.createElement("div");
  toast.className = "snackbar";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  listPanel.appendChild(listWrap);
  workspace.append(listPanel, detailPanel);
  section.append(header, notice, controls, message, workspace, formWrap, toast);

  function setToast(text) {
    toast.textContent = text;
    toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
    }, 2200);
  }

  function renderPeopleModule() {
    const result = queryPeople(state);
    const counts = getPeopleCounts(state.mode);

    metrics.innerHTML = "";
    metrics.append(
      createMetricChip("Total", counts.total),
      createMetricChip("Active", counts.active),
      createMetricChip("Archived", counts.archived)
    );

    message.textContent = state.feedback || `Showing ${result.length} contact(s).`;

    search.value = state.search;
    filter.value = state.filter;
    sort.value = state.sort;

    const hasActiveFilters = state.search.trim() || state.filter !== "active" || state.sort !== "updated-desc";
    clearFilters.hidden = !hasActiveFilters;

    if (!state.selectedPersonId && result.length > 0) {
      state.selectedPersonId = result[0].id;
    }

    if (state.selectedPersonId && !result.some((person) => person.id === state.selectedPersonId)) {
      state.selectedPersonId = result[0]?.id || null;
    }

    listWrap.innerHTML = "";
    if (result.length === 0) {
      listWrap.appendChild(createEmptyPeopleState({
        hasFilters: Boolean(state.search.trim() || state.filter !== "active"),
        onClear: () => {
          state.search = "";
          state.filter = "active";
          state.sort = "updated-desc";
          renderPeopleModule();
        },
        onAdd: () => {
          state.isFormOpen = true;
          state.editingId = null;
          renderPeopleModule();
        }
      }));
    } else {
      const list = document.createElement("ul");
      list.className = "people-selection-list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "People list");

      for (const person of result) {
        list.appendChild(
          createPersonListItem(person, {
            selected: state.selectedPersonId === person.id,
            onSelect: () => {
              state.selectedPersonId = person.id;
              state.feedback = "";
              renderPeopleModule();
            }
          })
        );
      }

      listWrap.appendChild(list);
    }

    detailPanel.innerHTML = "";
    const selectedPerson = state.selectedPersonId ? findPersonById(state.mode, state.selectedPersonId) : null;

    detailPanel.appendChild(
      createPersonDetailsPanel(selectedPerson, {
        onScheduleOneOnOne: (personRecord) => {
          if (typeof uiContext.onScheduleOneOnOne === "function") {
            uiContext.onScheduleOneOnOne(personRecord);
          }
        },
        onEdit: () => {
          state.editingId = selectedPerson.id;
          state.isFormOpen = true;
          renderPeopleModule();
        },
        onArchiveToggle: () => {
          const nextArchivedValue = !selectedPerson.archived;
          const confirmation = window.confirm(
            nextArchivedValue
              ? `Archive ${selectedPerson.name}? You can restore this record later.`
              : `Restore ${selectedPerson.name} to active contacts?`
          );

          if (!confirmation) {
            return;
          }

          archivePerson(state.mode, selectedPerson.id, nextArchivedValue);
          state.feedback = nextArchivedValue
            ? `Archived ${selectedPerson.name}.`
            : `Restored ${selectedPerson.name}.`;
          renderPeopleModule();
        },
        onQuickUpdate: (payload) => {
          const updateResult = quickUpdateContact(state.mode, selectedPerson.id, payload);
          if (updateResult.ok) {
            state.feedback = `Logged contact update for ${selectedPerson.name}.`;
            setToast("Contact logged successfully.");
          } else {
            state.feedback = updateResult.error;
          }
          renderPeopleModule();
        }
      })
    );

    formWrap.innerHTML = "";
    if (state.isFormOpen) {
      const activePerson = state.editingId ? findPersonById(state.mode, state.editingId) : null;
      formWrap.appendChild(
        createPersonForm({
          mode: state.mode,
          person: activePerson,
          onCancel: () => {
            state.isFormOpen = false;
            state.editingId = null;
            renderPeopleModule();
          },
          onSave: (payload) => {
            const saveResult = savePerson(state.mode, payload.person, state.editingId);
            if (!saveResult.ok) {
              state.feedback = saveResult.error;
              renderPeopleModule();
              return;
            }

            applyPersonProjectLinks(state.mode, saveResult.person.id, payload.projectLinks);
            state.isFormOpen = false;
            state.editingId = null;
            state.selectedPersonId = saveResult.person.id;
            state.feedback = saveResult.wasEdit
              ? `Updated ${payload.person.name}.`
              : `Added ${payload.person.name}.`;
            setToast(saveResult.wasEdit ? "Contact updated." : "Contact added.");
            renderPeopleModule();
          }
        })
      );
    }
  }

  renderPeopleModule();
  return section;
}

/**
 * Creates form state defaults for this isolated view.
 */
function createPeopleUiState(mode) {
  return {
    mode,
    search: "",
    filter: "active",
    sort: "updated-desc",
    isFormOpen: false,
    editingId: null,
    selectedPersonId: null,
    feedback: "",
    toastTimer: null
  };
}

/**
 * Builds compact metric chips for quick page-level scanning.
 */
function createMetricChip(label, value) {
  const chip = document.createElement("p");
  chip.className = "metric-chip";
  chip.textContent = `${label}: ${value}`;
  return chip;
}

/**
 * Returns total, active, and archived counts for the current mode.
 */
function getPeopleCounts(mode) {
  const people = loadPeople(mode);
  const archived = people.filter((person) => person.archived).length;
  return {
    total: people.length,
    archived,
    active: people.length - archived
  };
}

/**
 * Creates a listbox option for split-view people navigation.
 */
function createPersonListItem(person, { selected, onSelect }) {
  const item = document.createElement("li");
  item.className = "people-list-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "people-list-button";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(selected));

  if (selected) {
    item.classList.add("selected");
  }

  button.addEventListener("click", onSelect);

  const header = document.createElement("div");
  header.className = "people-list-item-head";

  const name = document.createElement("strong");
  name.textContent = person.name;

  const status = document.createElement("span");
  status.className = person.archived ? "status-badge archived" : "status-badge active";
  status.textContent = person.archived ? "Archived" : "Active";

  const orgRole = document.createElement("p");
  orgRole.className = "person-meta";
  orgRole.textContent = `${person.organisation || "No organisation"} · ${person.role || "No role"}`;

  const relationship = document.createElement("p");
  relationship.className = "person-meta";
  relationship.textContent = `Relationship: ${person.relationship || "Not set"}`;

  const lastContact = document.createElement("p");
  lastContact.className = "person-meta";
  lastContact.textContent = `Last contact: ${person.lastContactDate || "Not logged"}`;

  header.append(name, status);
  button.append(header, orgRole, relationship, lastContact);
  item.appendChild(button);
  return item;
}

/**
 * Renders right-side details view for selected person.
 */
function createPersonDetailsPanel(person, { onEdit, onArchiveToggle, onQuickUpdate, onScheduleOneOnOne }) {
  if (!person) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Select a contact to review details and log interactions.";
    return empty;
  }

  const wrap = document.createElement("div");
  wrap.className = "people-details";

  const header = document.createElement("header");
  header.className = "person-detail-header";

  const identity = document.createElement("div");

  const name = document.createElement("h2");
  name.textContent = person.name;

  const meta = document.createElement("p");
  meta.className = "person-meta";
  meta.textContent = `${person.role || "No role"} · ${person.organisation || "No organisation"}`;

  const relationship = document.createElement("p");
  relationship.className = "person-meta";
  relationship.textContent = `Relationship: ${person.relationship || "Not set"}`;

  const status = document.createElement("span");
  status.className = person.archived ? "status-badge archived" : "status-badge active";
  status.textContent = person.archived ? "Archived" : "Active";

  identity.append(name, meta, relationship);
  header.append(identity, status);

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const logContact = document.createElement("button");
  logContact.type = "button";
  logContact.className = "button button-primary";
  logContact.textContent = "Log contact";
  logContact.addEventListener("click", () => {
    const dateField = wrap.querySelector(".quick-update-date");
    const noteField = wrap.querySelector(".quick-update-note");
    if (!dateField || !noteField) {
      return;
    }

    onQuickUpdate({
      date: dateField.value,
      note: noteField.value.trim()
    });
  });

  const scheduleOneOnOne = document.createElement("button");
  scheduleOneOnOne.type = "button";
  scheduleOneOnOne.className = "button button-secondary";
  scheduleOneOnOne.textContent = "Schedule 1:1";
  scheduleOneOnOne.addEventListener("click", () => onScheduleOneOnOne(person));

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "button button-secondary";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", onEdit);

  const archiveButton = document.createElement("button");
  archiveButton.type = "button";
  archiveButton.className = "button button-danger-subtle";
  archiveButton.textContent = person.archived ? "Restore" : "Archive";
  archiveButton.addEventListener("click", onArchiveToggle);

  actions.append(logContact, scheduleOneOnOne, editButton, archiveButton);

  const channels = document.createElement("p");
  channels.className = "person-meta";
  channels.textContent = `Email: ${person.email || "-"} · Phone: ${person.phone || "-"}`;

  const quickUpdate = document.createElement("div");
  quickUpdate.className = "quick-update card-muted";

  const quickTitle = document.createElement("h3");
  quickTitle.textContent = "Log interaction";

  const quickDescription = document.createElement("p");
  quickDescription.className = "person-meta";
  quickDescription.textContent = "Add the latest engagement touchpoint and note.";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "field-input quick-update-date";
  dateInput.value = isoDateToday();
  dateInput.setAttribute("aria-label", `Interaction date for ${person.name}`);

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "field-input quick-update-note";
  noteInput.placeholder = "Add a concise summary of this touchpoint";
  noteInput.setAttribute("aria-label", `Interaction note for ${person.name}`);

  quickUpdate.append(quickTitle, quickDescription, dateInput, noteInput);

  const timeline = document.createElement("section");
  timeline.className = "engagement-timeline";

  const timelineHeading = document.createElement("h3");
  timelineHeading.textContent = "Engagement timeline";

  const trailList = document.createElement("ul");
  trailList.className = "contact-trail";
  if (person.contactTrail.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No contact trail yet.";
    trailList.appendChild(empty);
  } else {
    for (const entry of person.contactTrail.slice().reverse()) {
      const line = document.createElement("li");
      const entryDate = document.createElement("strong");
      entryDate.textContent = entry.date;

      const entryNote = document.createElement("span");
      entryNote.textContent = entry.note || "No note";

      line.append(entryDate, entryNote);
      trailList.appendChild(line);
    }
  }

  timeline.append(timelineHeading, trailList);
  wrap.append(header, actions, channels, quickUpdate, timeline);
  return wrap;
}

/**
 * Renders empty states for no contacts and no search matches.
 */
function createEmptyPeopleState({ hasFilters, onClear, onAdd }) {
  const empty = document.createElement("div");
  empty.className = "empty-state-block";

  const title = document.createElement("h3");
  title.textContent = hasFilters ? "No matching contacts" : "No contacts yet";

  const copy = document.createElement("p");
  copy.className = "empty-state";
  copy.textContent = hasFilters
    ? "Try a different search, status filter, or reset your controls."
    : "Add your first work contact to start tracking interactions and relationships.";

  const actions = document.createElement("div");
  actions.className = "empty-state-actions";

  if (hasFilters) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "button button-secondary";
    clear.textContent = "Clear search and filters";
    clear.addEventListener("click", onClear);
    actions.appendChild(clear);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "button button-primary";
  add.textContent = "Add person";
  add.addEventListener("click", onAdd);
  actions.appendChild(add);

  empty.append(title, copy, actions);
  return empty;
}

/**
 * Creates create/edit form with required MVP fields.
 */
function createPersonForm({ mode, person, onCancel, onSave }) {
  const form = document.createElement("form");
  form.className = "people-form";

  const heading = document.createElement("h2");
  heading.textContent = person ? "Edit contact" : "New contact";
  form.appendChild(heading);

  const fields = {
    name: createField("Name", "text", person?.name || "", true),
    role: createField("Role/title", "text", person?.role || ""),
    organisation: createField("Organisation", "text", person?.organisation || ""),
    relationship: createField("Relationship to work", "text", person?.relationship || ""),
    email: createField("Email", "email", person?.email || ""),
    phone: createField("Phone", "text", person?.phone || ""),
    lastContactDate: createField(
      "Last contact date",
      "date",
      person?.lastContactDate || isoDateToday()
    ),
    notes: createField("Notes", "textarea", person?.notes || "")
  };

  for (const field of Object.values(fields)) {
    form.appendChild(field.row);
  }

  const projectLinksField = document.createElement("div");
  projectLinksField.className = "field-row";

  const projectLabel = document.createElement("span");
  projectLabel.className = "field-label";
  projectLabel.textContent = "Project links and roles";

  const projects = loadProjects(mode);
  const existingLinks = person ? loadPersonProjectLinks(mode, person.id) : [];
  const linkControls = buildPersonProjectLinkControls(projects, existingLinks);

  projectLinksField.append(projectLabel, linkControls.wrap);
  form.appendChild(projectLinksField);

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ghost-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", onCancel);

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "enter-mode-button";
  saveButton.textContent = person ? "Save changes" : "Create contact";

  actions.append(cancelButton, saveButton);
  form.appendChild(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({
      person: {
        name: fields.name.control.value.trim(),
        role: fields.role.control.value.trim(),
        organisation: fields.organisation.control.value.trim(),
        relationship: fields.relationship.control.value.trim(),
        email: fields.email.control.value.trim(),
        phone: fields.phone.control.value.trim(),
        lastContactDate: fields.lastContactDate.control.value,
        notes: fields.notes.control.value.trim()
      },
      projectLinks: linkControls.read()
    });
  });

  return form;
}

/**
 * Creates a labeled field row and control.
 */
function createField(labelText, type, value, required = false) {
  const row = document.createElement("label");
  row.className = "field-row";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = labelText;

  let control;
  if (type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 3;
  } else {
    control = document.createElement("input");
    control.type = type;
  }

  control.className = "field-input";
  control.value = value;
  control.required = required;

  row.append(label, control);
  return { row, control };
}

function buildPersonProjectLinkControls(projects, existingLinks) {
  const wrap = document.createElement("div");
  wrap.className = "project-people-role-grid";

  const controls = projects.map((project) => {
    const row = document.createElement("div");
    row.className = "project-person-role-row";

    const name = document.createElement("strong");
    name.textContent = project.title;

    const existing = existingLinks.find((link) => link.projectId === project.id);
    const roles = document.createElement("select");
    roles.className = "field-input";
    roles.multiple = true;
    roles.size = 3;

    PROJECT_PERSON_ROLES.forEach((role) => {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      option.selected = Boolean(existing?.roles.includes(role));
      roles.appendChild(option);
    });

    row.append(name, roles);
    wrap.appendChild(row);
    return { projectId: project.id, roles };
  });

  return {
    wrap,
    read() {
      return controls
        .map((entry) => ({
          projectId: entry.projectId,
          roles: Array.from(entry.roles.selectedOptions).map((option) => option.value)
        }))
        .filter((entry) => entry.roles.length > 0);
    }
  };
}

/**
 * Reconciles project links when editing people from the People module.
 */
function applyPersonProjectLinks(mode, personId, projectLinks) {
  const allProjects = loadProjects(mode);
  const selectedProjectIds = new Set(projectLinks.map((entry) => entry.projectId));

  allProjects.forEach((project) => {
    const selected = projectLinks.find((entry) => entry.projectId === project.id);
    upsertProjectPersonLink(mode, project.id, personId, selected?.roles || []);

    if (!selectedProjectIds.has(project.id)) {
      upsertProjectPersonLink(mode, project.id, personId, []);
    }
  });
}

/**
 * Queries contacts by search/filter/sort while keeping immutable source order safe.
 */
function queryPeople(state) {
  const people = loadPeople(state.mode);

  const searched = people.filter((person) => {
    const haystack = [
      person.name,
      person.role,
      person.organisation,
      person.relationship,
      person.notes,
      person.email,
      person.phone
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(state.search.toLowerCase());
  });

  const filtered = searched.filter((person) => {
    if (state.filter === "all") {
      return true;
    }

    return state.filter === "archived" ? person.archived : !person.archived;
  });

  return filtered.sort((first, second) => sortPeople(first, second, state.sort));
}

/**
 * Stores a create/update operation while preserving contact history.
 */
function savePerson(mode, payload, editingId) {
  if (!payload.name) {
    return { ok: false, error: "Name is required." };
  }

  const people = loadPeople(mode);
  const now = new Date().toISOString();

  if (editingId) {
    const index = people.findIndex((person) => person.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Unable to find selected person." };
    }

    const existing = people[index];
    const updated = {
      ...existing,
      ...payload,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        name: now,
        role: now,
        organisation: now,
        relationship: now,
        email: now,
        phone: now,
        lastContactDate: now,
        notes: now
      }
    };

    people[index] = updated;
    persistPeople(mode, people);
    return { ok: true, wasEdit: true, person: updated };
  }

  const nextPerson = {
    id: buildId(),
    ...payload,
    archived: false,
    contactTrail: payload.lastContactDate
      ? [{ date: payload.lastContactDate, note: payload.notes || "Created record" }]
      : [],
    createdAt: now,
    updatedAt: now,
    lastUpdatedByField: {
      name: now,
      role: now,
      organisation: now,
      relationship: now,
      email: now,
      phone: now,
      lastContactDate: now,
      notes: now,
      archived: now
    }
  };

  people.push(nextPerson);
  persistPeople(mode, people);
  return { ok: true, wasEdit: false, person: nextPerson };
}

/**
 * Archive/restore toggle to avoid destructive data loss.
 */
function archivePerson(mode, personId, archivedValue) {
  const people = loadPeople(mode);
  const now = new Date().toISOString();

  const updated = people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    return {
      ...person,
      archived: archivedValue,
      updatedAt: now,
      lastUpdatedByField: {
        ...person.lastUpdatedByField,
        archived: now
      }
    };
  });

  persistPeople(mode, updated);
}

/**
 * Lightweight update path for common stakeholder touchpoint logging.
 */
function quickUpdateContact(mode, personId, { date, note }) {
  if (!date) {
    return { ok: false, error: "Contact date is required for quick updates." };
  }

  const people = loadPeople(mode);
  const now = new Date().toISOString();

  const updated = people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    return {
      ...person,
      lastContactDate: date,
      notes: note || person.notes,
      updatedAt: now,
      contactTrail: [...person.contactTrail, { date, note }],
      lastUpdatedByField: {
        ...person.lastUpdatedByField,
        lastContactDate: now,
        notes: now
      }
    };
  });

  persistPeople(mode, updated);
  return { ok: true };
}

/**
 * Finds an entity by ID and returns null when missing.
 */
function findPersonById(mode, id) {
  return loadPeople(mode).find((person) => person.id === id) || null;
}

/**
 * Reads and validates localStorage-backed People records.
 */
function loadPeople(mode) {
  const storageKey = `${STORAGE_KEY_PREFIX}.${mode}.v1`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalisePerson);
  } catch {
    return [];
  }
}

/**
 * Persists people in a single write to reduce partial-update risk.
 */
function persistPeople(mode, people) {
  const storageKey = `${STORAGE_KEY_PREFIX}.${mode}.v1`;
  localStorage.setItem(storageKey, JSON.stringify(people));
}

/**
 * Ensures records remain backwards-compatible as fields evolve.
 */
function normalisePerson(person) {
  return {
    id: person.id || buildId(),
    name: person.name || "",
    role: person.role || "",
    organisation: person.organisation || "",
    relationship: person.relationship || "",
    email: person.email || "",
    phone: person.phone || "",
    lastContactDate: person.lastContactDate || "",
    notes: person.notes || "",
    archived: Boolean(person.archived),
    contactTrail: Array.isArray(person.contactTrail) ? person.contactTrail : [],
    createdAt: person.createdAt || new Date().toISOString(),
    updatedAt: person.updatedAt || new Date().toISOString(),
    lastUpdatedByField:
      typeof person.lastUpdatedByField === "object" && person.lastUpdatedByField !== null
        ? person.lastUpdatedByField
        : {}
  };
}

/**
 * Provides stable sort behaviors from a constrained enum.
 */
function sortPeople(first, second, sortMode) {
  switch (sortMode) {
    case "name-asc":
      return first.name.localeCompare(second.name);
    case "name-desc":
      return second.name.localeCompare(first.name);
    case "contact-desc":
      return (second.lastContactDate || "").localeCompare(first.lastContactDate || "");
    case "contact-asc":
      return (first.lastContactDate || "").localeCompare(second.lastContactDate || "");
    case "updated-desc":
    default:
      return (second.updatedAt || "").localeCompare(first.updatedAt || "");
  }
}

/**
 * Adds a select option element in a terse reusable way.
 */
function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

/**
 * Generates short IDs suitable for local single-user records.
 */
function buildId() {
  return `person_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns today's date in YYYY-MM-DD format for date inputs.
 */
function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Title-case helper for placeholder module headings.
 */
function toTitleCase(input) {
  return input
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
