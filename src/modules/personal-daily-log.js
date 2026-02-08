import { buildPersonalStorageKey } from "./personal-keys.js";

const PERSONAL_DAILY_LOG_KEY = buildPersonalStorageKey("daily-log", 1);

/**
 * Daily log for nutrition/exercise summaries per spec 5.2 and section 6.1.
 */
export function renderPersonalDailyLogModule() {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Daily Log";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const date = buildInput("Date", "date", true);
  date.input.value = new Date().toISOString().slice(0, 10);
  const nutrition = buildTextarea("Nutrition summary");
  const exercise = buildTextarea("Exercise summary");
  const mood = buildInput("Mood (1-10)", "number", false);
  mood.input.min = "1";
  mood.input.max = "10";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "enter-mode-button";
  save.textContent = "Save daily log";

  const list = document.createElement("div");

  form.append(date.wrap, nutrition.wrap, exercise.wrap, mood.wrap, save);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const entries = loadEntries();
    const payload = {
      id: `dlog_${Math.random().toString(36).slice(2, 10)}`,
      date: date.input.value,
      nutrition: nutrition.input.value.trim(),
      exercise: exercise.input.value.trim(),
      mood: mood.input.value,
      createdAt: new Date().toISOString()
    };
    entries.unshift(payload);
    persistEntries(entries);
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    const entries = loadEntries();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No daily logs yet.";
      list.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "project-card";
      card.innerHTML = `<h3>${entry.date}</h3>
        <p><strong>Nutrition:</strong> ${entry.nutrition || "-"}</p>
        <p><strong>Exercise:</strong> ${entry.exercise || "-"}</p>
        <p><strong>Mood:</strong> ${entry.mood || "-"}</p>`;
      list.appendChild(card);
    });
  }

  section.append(title, form, list);
  renderList();
  return section;
}

function loadEntries() {
  const raw = localStorage.getItem(PERSONAL_DAILY_LOG_KEY);
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

function persistEntries(entries) {
  localStorage.setItem(PERSONAL_DAILY_LOG_KEY, JSON.stringify(entries));
}

function buildInput(labelText, type, required) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
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
