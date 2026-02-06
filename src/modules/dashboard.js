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
export function renderModeDashboard(mode, { activeModule = "dashboard" } = {}) {
  if (mode === "work" && activeModule === "people") {
    return renderWorkPeopleModule();
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
function renderWorkPeopleModule() {
  const state = createPeopleUiState("work");

  const section = document.createElement("section");
  section.className = "mode-dashboard people-module";

  const header = document.createElement("div");
  header.className = "people-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "Work People";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Track work contacts, stakeholder relationships, and keep a timestamped log of engagements.";

  titleWrap.append(title, intro);

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "enter-mode-button";
  createButton.textContent = "Add person";
  createButton.addEventListener("click", () => {
    state.editingId = null;
    state.isFormOpen = true;
    renderPeopleModule();
  });

  header.append(titleWrap, createButton);

  const notice = document.createElement("p");
  notice.className = "archive-note";
  notice.textContent =
    "Data safety: records are archived (not deleted) and remain recoverable in this module.";

  const controls = document.createElement("div");
  controls.className = "people-controls";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "field-input";
  search.placeholder = "Search name, organisation, role, relationship, note";
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
  addOption(filter, "all", "All");
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

  controls.append(search, filter, sort);

  const message = document.createElement("p");
  message.className = "feedback";

  const listWrap = document.createElement("div");
  listWrap.className = "people-list";

  const formWrap = document.createElement("div");
  formWrap.className = "people-form-wrap";

  section.append(header, notice, controls, message, listWrap, formWrap);

  function renderPeopleModule() {
    const result = queryPeople(state);
    message.textContent = state.feedback || `Showing ${result.length} contact(s).`;

    listWrap.innerHTML = "";
    if (result.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        state.filter === "archived"
          ? "No archived contacts yet."
          : "No contacts match your filters. Add your first stakeholder to get started.";
      listWrap.appendChild(empty);
    } else {
      for (const person of result) {
        listWrap.appendChild(
          createPersonCard(person, {
            onEdit: () => {
              state.editingId = person.id;
              state.isFormOpen = true;
              renderPeopleModule();
            },
            onArchiveToggle: () => {
              archivePerson(state.mode, person.id, !person.archived);
              state.feedback = person.archived
                ? `Restored ${person.name}.`
                : `Archived ${person.name}.`;
              renderPeopleModule();
            },
            onQuickUpdate: (payload) => {
              const updateResult = quickUpdateContact(state.mode, person.id, payload);
              if (updateResult.ok) {
                state.feedback = `Logged contact update for ${person.name}.`;
              } else {
                state.feedback = updateResult.error;
              }
              renderPeopleModule();
            }
          })
        );
      }
    }

    formWrap.innerHTML = "";
    if (state.isFormOpen) {
      const activePerson = state.editingId ? findPersonById(state.mode, state.editingId) : null;
      formWrap.appendChild(
        createPersonForm({
          person: activePerson,
          onCancel: () => {
            state.isFormOpen = false;
            state.editingId = null;
            renderPeopleModule();
          },
          onSave: (payload) => {
            const saveResult = savePerson(state.mode, payload, state.editingId);
            if (!saveResult.ok) {
              state.feedback = saveResult.error;
              renderPeopleModule();
              return;
            }

            state.isFormOpen = false;
            state.editingId = null;
            state.feedback = saveResult.wasEdit
              ? `Updated ${payload.name}.`
              : `Added ${payload.name}.`;
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
    feedback: ""
  };
}

/**
 * Creates a card row with key details and quick contact update controls.
 */
function createPersonCard(person, { onEdit, onArchiveToggle, onQuickUpdate }) {
  const card = document.createElement("article");
  card.className = "person-card";

  const top = document.createElement("div");
  top.className = "person-card-top";

  const heading = document.createElement("h3");
  heading.textContent = person.name;

  const pill = document.createElement("span");
  pill.className = person.archived ? "status-pill archived" : "status-pill active";
  pill.textContent = person.archived ? "Archived" : "Active";

  top.append(heading, pill);

  const detail = document.createElement("p");
  detail.className = "person-meta";
  detail.textContent = `${person.role || "No role"} • ${person.organisation || "No organisation"}`;

  const relationship = document.createElement("p");
  relationship.className = "person-meta";
  relationship.textContent = `Relationship: ${person.relationship || "Not set"}`;

  const contact = document.createElement("p");
  contact.className = "person-meta";
  contact.textContent = `Email: ${person.email || "-"} • Phone: ${person.phone || "-"}`;

  const lastContact = document.createElement("p");
  lastContact.className = "person-meta";
  lastContact.textContent = `Last contact: ${person.lastContactDate || "Not logged"}`;

  const note = document.createElement("p");
  note.className = "person-note";
  note.textContent = `Latest note: ${person.notes || "No notes yet"}`;

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "ghost-button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", onEdit);

  const archiveButton = document.createElement("button");
  archiveButton.type = "button";
  archiveButton.className = "ghost-button";
  archiveButton.textContent = person.archived ? "Restore" : "Archive";
  archiveButton.addEventListener("click", onArchiveToggle);

  actions.append(editButton, archiveButton);

  const quick = document.createElement("form");
  quick.className = "quick-update";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "field-input";
  dateInput.value = isoDateToday();
  dateInput.setAttribute("aria-label", `Contact date for ${person.name}`);

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "field-input";
  noteInput.placeholder = "Quick contact note";
  noteInput.setAttribute("aria-label", `Contact note for ${person.name}`);

  const saveQuickButton = document.createElement("button");
  saveQuickButton.type = "submit";
  saveQuickButton.className = "ghost-button";
  saveQuickButton.textContent = "Log contact";

  quick.append(dateInput, noteInput, saveQuickButton);
  quick.addEventListener("submit", (event) => {
    event.preventDefault();
    onQuickUpdate({
      date: dateInput.value,
      note: noteInput.value.trim()
    });
  });

  const trailList = document.createElement("ul");
  trailList.className = "contact-trail";
  if (person.contactTrail.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No contact trail yet.";
    trailList.appendChild(empty);
  } else {
    for (const entry of person.contactTrail.slice(-5).reverse()) {
      const line = document.createElement("li");
      line.textContent = `${entry.date} — ${entry.note || "No note"}`;
      trailList.appendChild(line);
    }
  }

  card.append(top, detail, relationship, contact, lastContact, note, actions, quick, trailList);
  return card;
}

/**
 * Creates create/edit form with required MVP fields.
 */
function createPersonForm({ person, onCancel, onSave }) {
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
      name: fields.name.control.value.trim(),
      role: fields.role.control.value.trim(),
      organisation: fields.organisation.control.value.trim(),
      relationship: fields.relationship.control.value.trim(),
      email: fields.email.control.value.trim(),
      phone: fields.phone.control.value.trim(),
      lastContactDate: fields.lastContactDate.control.value,
      notes: fields.notes.control.value.trim()
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
    return { ok: true, wasEdit: true };
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
  return { ok: true, wasEdit: false };
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
