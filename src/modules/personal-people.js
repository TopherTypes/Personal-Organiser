import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";

const PERSONAL_PEOPLE_KEY = buildPersonalStorageKey("people", 1);

/**
 * Personal People module rendered as a dense table with inline row expansion editing.
 *
 * This mirrors the compact table workflow introduced in tasks so more records remain
 * visible while still preserving full inline editing controls.
 */
export function renderPersonalPeopleModule() {
  const state = {
    expandedId: "",
    includeArchived: false,
    dirty: false,
    focusTriggerId: ""
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard people-module";

  const title = document.createElement("h1");
  title.textContent = "Personal People";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Track personal relationships, cadence targets, birthdays, and notes with a compact inline-edit table.";

  const controls = document.createElement("div");
  controls.className = "people-controls";
  const archiveToggleWrap = document.createElement("label");
  archiveToggleWrap.className = "field-label";
  archiveToggleWrap.textContent = "Include archived";
  const archiveToggle = document.createElement("input");
  archiveToggle.type = "checkbox";
  archiveToggle.addEventListener("change", () => {
    state.includeArchived = archiveToggle.checked;
    renderTable();
  });
  archiveToggleWrap.appendChild(archiveToggle);

  const newButton = document.createElement("button");
  newButton.type = "button";
  newButton.className = "enter-mode-button";
  newButton.textContent = "New contact";
  newButton.addEventListener("click", () => {
    if (!openEditor("__new__")) {
      return;
    }
    renderTable();
  });

  controls.append(archiveToggleWrap, newButton);

  const wrap = document.createElement("div");
  wrap.className = "updates-table-wrap card";

  const table = document.createElement("table");
  table.className = "updates-table people-compact-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Name</th>
        <th scope="col">Relationship</th>
        <th scope="col">Cadence</th>
        <th scope="col">Birthday</th>
        <th scope="col">Last contact</th>
        <th scope="col">Notes</th>
        <th scope="col">Actions</th>
      </tr>
    </thead>
  `;
  const body = document.createElement("tbody");
  table.appendChild(body);
  wrap.appendChild(table);

  section.append(title, intro, controls, wrap);

  function renderTable() {
    body.innerHTML = "";
    const contacts = loadContacts()
      .filter((contact) => (state.includeArchived ? true : !contact.archived))
      .sort((first, second) => first.name.localeCompare(second.name));

    if (state.expandedId === "__new__") {
      body.appendChild(
        createEditorRow({
          contact: createEmptyContact(),
          onSave: (payload) => {
            const contactsSnapshot = loadContacts();
            contactsSnapshot.unshift({
              ...createEmptyContact(),
              ...payload,
              id: generateId("ppl_")
            });
            persistContacts(contactsSnapshot);
            closeEditor();
            renderTable();
          },
          onCancel: () => {
            closeEditor();
            renderTable();
          },
          onDirty: () => {
            state.dirty = true;
          },
          mode: "create"
        })
      );
    }

    if (!contacts.length) {
      const emptyRow = document.createElement("tr");
      const empty = document.createElement("td");
      empty.colSpan = 7;
      empty.className = "empty-state";
      empty.textContent = "No personal contacts yet.";
      emptyRow.appendChild(empty);
      body.appendChild(emptyRow);
      return;
    }

    contacts.forEach((contact) => {
      body.appendChild(
        createDisplayRow(contact, {
          isExpanded: state.expandedId === contact.id,
          onEdit: () => {
            if (!openEditor(contact.id)) {
              return;
            }
            renderTable();
          },
          onToggleArchived: () => {
            const next = loadContacts().map((entry) =>
              entry.id === contact.id ? { ...entry, archived: !entry.archived } : entry
            );
            persistContacts(next);
            renderTable();
          }
        })
      );

      if (state.expandedId === contact.id) {
        body.appendChild(
          createEditorRow({
            contact,
            mode: "edit",
            onSave: (payload) => {
              const next = loadContacts().map((entry) =>
                entry.id === contact.id ? { ...entry, ...payload } : entry
              );
              persistContacts(next);
              closeEditor(contact.id);
              renderTable();
            },
            onCancel: () => {
              closeEditor(contact.id);
              renderTable();
            },
            onDirty: () => {
              state.dirty = true;
            },
            onToggleArchived: () => {
              const next = loadContacts().map((entry) =>
                entry.id === contact.id ? { ...entry, archived: !entry.archived } : entry
              );
              persistContacts(next);
              closeEditor(contact.id);
              renderTable();
            }
          })
        );
      }
    });

    if (state.focusTriggerId) {
      section.querySelector(`[data-people-edit-trigger="${state.focusTriggerId}"]`)?.focus();
      state.focusTriggerId = "";
    }
  }

  function openEditor(nextId) {
    if (state.dirty && state.expandedId && state.expandedId !== nextId && !window.confirm("Discard unsaved contact changes?")) {
      return false;
    }

    state.expandedId = nextId;
    state.dirty = false;
    return true;
  }

  function closeEditor(focusId = "") {
    state.expandedId = "";
    state.dirty = false;
    state.focusTriggerId = focusId;
  }

  renderTable();
  return section;
}

function createDisplayRow(contact, { isExpanded = false, onEdit, onToggleArchived }) {
  const row = document.createElement("tr");

  const name = document.createElement("td");
  name.className = "people-name-cell";
  name.textContent = contact.name;

  const relationship = document.createElement("td");
  relationship.textContent = contact.relationship || "—";

  const cadence = document.createElement("td");
  cadence.textContent = contact.cadenceTarget || "—";

  const birthday = document.createElement("td");
  birthday.textContent = contact.birthday || "—";

  const lastContact = document.createElement("td");
  lastContact.textContent = contact.lastContact || "—";

  const notes = document.createElement("td");
  notes.className = "people-notes-cell";
  notes.textContent = contact.notes || "—";

  const actions = document.createElement("td");
  actions.className = "tasks-row-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-button task-edit-trigger";
  edit.dataset.peopleEditTrigger = contact.id;
  edit.setAttribute("aria-expanded", String(isExpanded));
  edit.textContent = "Edit";
  edit.addEventListener("click", onEdit);

  const menu = document.createElement("details");
  menu.className = "task-row-menu";
  const summary = document.createElement("summary");
  summary.setAttribute("aria-label", `Contact actions for ${contact.name}`);
  summary.textContent = "⋯";
  const archive = document.createElement("button");
  archive.type = "button";
  archive.className = "secondary-button";
  archive.textContent = contact.archived ? "Unarchive" : "Archive";
  archive.addEventListener("click", () => {
    menu.open = false;
    onToggleArchived();
  });
  menu.append(summary, archive);

  actions.append(edit, menu);
  row.append(name, relationship, cadence, birthday, lastContact, notes, actions);
  return row;
}

function createEditorRow({ contact, onSave, onCancel, onDirty, mode, onToggleArchived = null }) {
  const row = document.createElement("tr");
  row.className = "tasks-editor-row";
  const cell = document.createElement("td");
  cell.colSpan = 7;

  const form = document.createElement("form");
  form.className = "task-inline-editor";

  const name = buildInput("Name", "text", true, contact.name || "");
  const relationship = buildInput("Relationship", "text", false, contact.relationship || "");
  const cadenceTarget = buildInput("Cadence target", "text", false, contact.cadenceTarget || "");
  const birthday = buildInput("Birthday", "date", false, contact.birthday || "");
  const lastContact = buildInput("Last contact", "date", false, contact.lastContact || "");
  const notes = buildTextarea("Notes", contact.notes || "");

  form.append(name.wrap, relationship.wrap, cadenceTarget.wrap, birthday.wrap, lastContact.wrap, notes.wrap);

  const actions = document.createElement("div");
  actions.className = "task-inline-editor-actions";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "primary-button";
  save.textContent = mode === "edit" ? "Save" : "Create";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", onCancel);

  actions.append(save, cancel);

  if (mode === "edit" && onToggleArchived) {
    const archive = document.createElement("button");
    archive.type = "button";
    archive.className = "secondary-button";
    archive.textContent = contact.archived ? "Unarchive" : "Archive";
    archive.addEventListener("click", onToggleArchived);
    actions.appendChild(archive);
  }

  form.appendChild(actions);

  [name.input, relationship.input, cadenceTarget.input, birthday.input, lastContact.input, notes.input].forEach((input) => {
    input.addEventListener("input", onDirty);
    input.addEventListener("change", onDirty);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({
      name: name.input.value.trim(),
      relationship: relationship.input.value.trim(),
      cadenceTarget: cadenceTarget.input.value.trim(),
      birthday: birthday.input.value,
      lastContact: lastContact.input.value,
      notes: notes.input.value.trim(),
      archived: Boolean(contact.archived)
    });
  });

  cell.appendChild(form);
  row.appendChild(cell);
  window.requestAnimationFrame(() => {
    name.input.focus();
  });
  return row;
}

function createEmptyContact() {
  return {
    id: "",
    name: "",
    relationship: "",
    cadenceTarget: "",
    birthday: "",
    notes: "",
    lastContact: "",
    archived: false
  };
}

/**
 * Shared snapshot loader used by other Personal modules (for example Projects)
 * so linked-entity pickers can consume the same data source as this CRM UI.
 */
export function loadPersonalPeopleSnapshot() {
  return loadContacts().map((contact) => ({
    ...contact,
    archived: Boolean(contact.archived)
  }));
}

function persistContacts(contacts) {
  localStorage.setItem(PERSONAL_PEOPLE_KEY, JSON.stringify(contacts));
}

function loadContacts() {
  const raw = localStorage.getItem(PERSONAL_PEOPLE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => ({
      ...createEmptyContact(),
      ...entry,
      archived: Boolean(entry?.archived)
    }));
  } catch {
    return [];
  }
}

function buildInput(labelText, type, required, value = "") {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("input");
  input.type = type;
  input.className = "field-input";
  input.required = required;
  input.value = value;
  wrap.appendChild(input);

  return { wrap, input };
}

function buildTextarea(labelText, value = "") {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("textarea");
  input.className = "field-input field-textarea";
  input.value = value;
  wrap.appendChild(input);

  return { wrap, input };
}
