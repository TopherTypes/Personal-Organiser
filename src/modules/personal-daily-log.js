import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";
import { buildInput, buildTextarea } from "./form-helpers.js";

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
      id: generateId("dlog_"),
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

      const heading = document.createElement("h3");
      heading.textContent = entry.date;

      const nutritionLine = document.createElement("p");
      nutritionLine.innerHTML = `<strong>Nutrition:</strong> ${entry.nutrition || "-"}`;

      const exerciseLine = document.createElement("p");
      exerciseLine.innerHTML = `<strong>Exercise:</strong> ${entry.exercise || "-"}`;

      const moodLine = document.createElement("p");
      const moodLabel = document.createElement("strong");
      moodLabel.textContent = "Mood: ";
      const moodChip = buildMoodChip(entry.mood);
      moodLine.append(moodLabel, moodChip);

      card.append(heading, nutritionLine, exerciseLine, moodLine);
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

/**
 * Builds a mood chip with semantic score band classes to keep visual mapping
 * consistent while leaving persisted values untouched.
 */
function buildMoodChip(rawMoodValue) {
  const numericMood = Number(rawMoodValue);
  const chip = document.createElement("span");
  chip.className = "personal-log-chip personal-log-chip-mood";

  if (!Number.isFinite(numericMood)) {
    chip.classList.add("personal-log-chip-neutral");
    chip.textContent = rawMoodValue || "-";
    return chip;
  }

  const { className, label } = getMoodBand(numericMood);
  chip.classList.add(className);
  chip.textContent = `${label} (${numericMood}/10)`;
  return chip;
}

/**
 * Maps numeric mood values into low/medium/high presentation bands.
 */
function getMoodBand(score) {
  if (score <= 3) {
    return { className: "personal-log-chip-mood-low", label: "Low" };
  }
  if (score <= 7) {
    return { className: "personal-log-chip-mood-medium", label: "Medium" };
  }
  return { className: "personal-log-chip-mood-high", label: "High" };
}

