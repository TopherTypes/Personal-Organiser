import { buildPersonalStorageKey } from "./personal-keys.js";

const PERSONAL_CALENDAR_KEY = buildPersonalStorageKey("calendar", 1);

/**
 * Lightweight personal calendar module (meeting-like log) aligned to spec 10.3.
 */
export function renderPersonalCalendarModule() {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Calendar";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Capture personal calendar notes as a simplified meeting-style log with isolated Personal storage.";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const name = buildInput("Title", "text", true);
  const date = buildInput("Date", "date", true);
  const notes = document.createElement("textarea");
  notes.className = "field-input field-textarea";

  const notesWrap = document.createElement("label");
  notesWrap.className = "field-label";
  notesWrap.textContent = "Notes";
  notesWrap.appendChild(notes);

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "enter-mode-button";
  save.textContent = "Save event";

  const list = document.createElement("div");

  form.append(name.wrap, date.wrap, notesWrap, save);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const events = loadEvents();
    events.push({
      id: `pcal_${Math.random().toString(36).slice(2, 10)}`,
      title: name.input.value.trim(),
      date: date.input.value,
      notes: notes.value.trim()
    });
    localStorage.setItem(PERSONAL_CALENDAR_KEY, JSON.stringify(events));
    form.reset();
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    const events = loadEvents().sort((a, b) => a.date.localeCompare(b.date));
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No calendar entries yet.";
      list.appendChild(empty);
      return;
    }

    events.forEach((entry) => {
      const row = document.createElement("article");
      row.className = "meeting-row";
      row.innerHTML = `<strong>${entry.date} · ${entry.title}</strong><p>${entry.notes || "No notes"}</p>`;
      list.appendChild(row);
    });
  }

  section.append(title, intro, form, list);
  renderList();
  return section;
}

function loadEvents() {
  const raw = localStorage.getItem(PERSONAL_CALENDAR_KEY);
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
