import { buildPersonalStorageKey } from "./personal-keys.js";

const PERSONAL_PEOPLE_KEY = buildPersonalStorageKey("people", 1);

/**
 * Personal People CRM module using section 11.2 fields and personal-only storage.
 */
export function renderPersonalPeopleModule() {
  const section = document.createElement("section");
  section.className = "mode-dashboard people-module";

  const title = document.createElement("h1");
  title.textContent = "Personal People";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Track personal relationships, cadence targets, birthdays, and notes without sharing Work contacts.";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const name = buildInput("Name", "text", true);
  const relationship = buildInput("Relationship", "text", false);
  const cadenceTarget = buildInput("Cadence target", "text", false);
  cadenceTarget.input.placeholder = "e.g. monthly / every 30 days";
  const birthday = buildInput("Birthday", "date", false);
  const notes = buildTextarea("Notes");

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "enter-mode-button";
  submit.textContent = "Add contact";

  form.append(name.wrap, relationship.wrap, cadenceTarget.wrap, birthday.wrap, notes.wrap, submit);

  const list = document.createElement("div");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const contacts = loadContacts();
    contacts.unshift({
      id: `ppl_${Math.random().toString(36).slice(2, 10)}`,
      name: name.input.value.trim(),
      relationship: relationship.input.value.trim(),
      cadenceTarget: cadenceTarget.input.value.trim(),
      birthday: birthday.input.value,
      notes: notes.input.value.trim(),
      lastContact: ""
    });
    localStorage.setItem(PERSONAL_PEOPLE_KEY, JSON.stringify(contacts));
    form.reset();
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    const contacts = loadContacts();

    if (!contacts.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No personal contacts yet.";
      list.appendChild(empty);
      return;
    }

    contacts.forEach((contact) => {
      const row = document.createElement("article");
      row.className = "project-card";
      row.innerHTML = `<h3>${contact.name}</h3>
        <p><strong>Relationship:</strong> ${contact.relationship || "-"}</p>
        <p><strong>Cadence:</strong> ${contact.cadenceTarget || "-"}</p>
        <p><strong>Birthday:</strong> ${contact.birthday || "-"}</p>
        <p><strong>Notes:</strong> ${contact.notes || "-"}</p>`;
      list.appendChild(row);
    });
  }

  section.append(title, intro, form, list);
  renderList();
  return section;
}

function loadContacts() {
  const raw = localStorage.getItem(PERSONAL_PEOPLE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildInput(labelText, type, required) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("input");
  input.type = type;
  input.className = "field-input";
  input.required = required;
  wrap.appendChild(input);

  return { wrap, input };
}

function buildTextarea(labelText) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("textarea");
  input.className = "field-input field-textarea";
  wrap.appendChild(input);

  return { wrap, input };
}
