import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";

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
      id: generateId("elog_"),
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

      const rowTitle = document.createElement("p");
      rowTitle.className = "meeting-open-button";
      rowTitle.textContent = entry.date || "-";

      const metadata = document.createElement("div");
      metadata.className = "overview-inline-chips";

      metadata.append(
        buildActivityTypeChip(entry.type),
        buildExerciseMetadataChip(`${entry.distanceKm} km`),
        buildExerciseMetadataChip(`${entry.durationMins} mins`)
      );

      row.append(rowTitle, metadata);
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

/**
 * Activity-type chip conveys run/walk classification with distinct visual cues.
 */
function buildActivityTypeChip(activityType) {
  const chip = document.createElement("span");
  chip.className = "personal-log-chip personal-log-chip-activity";

  const normalizedType = String(activityType || "").toLowerCase();
  if (normalizedType === "run") {
    chip.classList.add("personal-log-chip-activity-run");
  } else if (normalizedType === "walk") {
    chip.classList.add("personal-log-chip-activity-walk");
  } else {
    chip.classList.add("personal-log-chip-neutral");
  }

  chip.textContent = activityType || "Unknown activity";
  return chip;
}

/**
 * Secondary metadata chips intentionally remain neutral to de-emphasize metrics.
 */
function buildExerciseMetadataChip(text) {
  const chip = document.createElement("span");
  chip.className = "personal-log-chip personal-log-chip-secondary";
  chip.textContent = text;
  return chip;
}
