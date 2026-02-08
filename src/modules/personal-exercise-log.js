import { buildPersonalStorageKey } from "./personal-keys.js";

const PERSONAL_EXERCISE_LOG_KEY = buildPersonalStorageKey("exercise-log", 1);

/**
 * Exercise log focused on run/walk entries per section 5.2.
 */
export function renderPersonalExerciseLogModule() {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Exercise Log";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const typeWrap = document.createElement("label");
  typeWrap.className = "field-label";
  typeWrap.textContent = "Activity";
  const type = document.createElement("select");
  type.className = "field-input";
  ["Run", "Walk"].forEach((optionValue) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    type.appendChild(option);
  });
  typeWrap.appendChild(type);

  const date = buildInput("Date", "date", true);
  const distance = buildInput("Distance (km)", "number", false);
  const duration = buildInput("Duration (minutes)", "number", false);

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "enter-mode-button";
  save.textContent = "Add entry";

  const list = document.createElement("div");

  form.append(typeWrap, date.wrap, distance.wrap, duration.wrap, save);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const entries = loadEntries();
    entries.unshift({
      id: `elog_${Math.random().toString(36).slice(2, 10)}`,
      type: type.value,
      date: date.input.value,
      distanceKm: Number(distance.input.value || 0),
      durationMins: Number(duration.input.value || 0)
    });
    localStorage.setItem(PERSONAL_EXERCISE_LOG_KEY, JSON.stringify(entries));
    form.reset();
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    const entries = loadEntries();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No exercise entries yet.";
      list.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const row = document.createElement("article");
      row.className = "meeting-row";
      row.textContent = `${entry.date} · ${entry.type} · ${entry.distanceKm} km · ${entry.durationMins} mins`;
      list.appendChild(row);
    });
  }

  section.append(title, form, list);
  renderList();
  return section;
}

function loadEntries() {
  const raw = localStorage.getItem(PERSONAL_EXERCISE_LOG_KEY);
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
