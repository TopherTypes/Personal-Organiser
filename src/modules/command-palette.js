// Cache-busted task import keeps command indexing aligned with the latest task module bundle.
import { loadTasks } from "./tasks.js?v=2026-02-18-1";
import { loadProjects } from "./projects-store.js";
import { loadMeetings } from "./meetings.js";
import { loadUpdates } from "./updates.js";
import { loadSprints } from "./sprints.js";
import { buildPersonalStorageKey } from "./personal-keys.js";
import { safeJsonParse } from "./storage-core.js";

const WORK_PEOPLE_STORAGE_KEY = "second-brain.work.people.work.v1";

/**
 * Reads a plain-array personal collection from localStorage using the shared key builder.
 */
function loadPersonalCollection(collectionKey) {
  const raw = localStorage.getItem(buildPersonalStorageKey(collectionKey, 1));
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Reads Work people records directly from localStorage and keeps only object rows.
 */
function loadWorkPeople() {
  const raw = localStorage.getItem(WORK_PEOPLE_STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((entry) => entry && typeof entry === "object");
}

/**
 * Builds a searchable cross-mode index from all requested local datasets.
 */
export function buildCommandPaletteIndex() {
  const index = [];

  const workTasks = loadTasks("work");
  const workProjects = loadProjects("work");
  const workPeople = loadWorkPeople();
  const workMeetings = loadMeetings("work");
  const workUpdates = loadUpdates("work");
  const workSprints = loadSprints("work");

  index.push(
    ...workTasks.map((task) =>
      createIndexEntry({
        mode: "work",
        entityType: "Task",
        moduleKey: "tasks",
        title: task.title,
        subtitle: task.status || "No status",
        id: task.id,
        keywords: [task.status, task.dueDate]
      })
    ),
    ...workProjects.map((project) =>
      createIndexEntry({
        mode: "work",
        entityType: "Project",
        moduleKey: "projects",
        title: project.title,
        subtitle: project.status || project.targetDate || "No status",
        id: project.id,
        keywords: [project.status, project.targetDate]
      })
    ),
    ...workPeople.map((person) =>
      createIndexEntry({
        mode: "work",
        entityType: "Person",
        moduleKey: "people",
        title: person.name,
        subtitle: person.role || person.team || "Contact",
        id: person.id,
        keywords: [person.role, person.team, person.notes]
      })
    ),
    ...workMeetings.map((meeting) =>
      createIndexEntry({
        mode: "work",
        entityType: "Meeting",
        moduleKey: "meetings",
        title: meeting.name,
        subtitle: meeting.date || "No date",
        id: meeting.id,
        focus: { meetingId: meeting.id },
        keywords: [meeting.date, meeting.type, meeting.notes]
      })
    ),
    ...workUpdates.map((update) =>
      createIndexEntry({
        mode: "work",
        entityType: "Update",
        moduleKey: "updates",
        title: update.summary || update.text || "",
        subtitle: update.status || "Pending",
        id: update.id,
        keywords: [update.status, update.personId, update.dueDate]
      })
    ),
    ...workSprints.map((sprint) =>
      createIndexEntry({
        mode: "work",
        entityType: "Sprint",
        moduleKey: "sprints",
        title: sprint.name,
        subtitle: sprint.status || "No status",
        id: sprint.id,
        keywords: [sprint.status, sprint.startDate, sprint.endDate]
      })
    )
  );

  const personalTasks = loadPersonalCollection("tasks");
  const personalProjects = loadPersonalCollection("projects");
  const personalPeople = loadPersonalCollection("people");
  const personalCalendar = loadPersonalCollection("calendar");
  const personalDaily = loadPersonalCollection("daily-log");
  const personalExercise = loadPersonalCollection("exercise-log");

  index.push(
    ...personalTasks.map((task) =>
      createIndexEntry({
        mode: "personal",
        entityType: "Task",
        moduleKey: "tasks",
        title: task.title,
        subtitle: task.status || "No status",
        id: task.id,
        keywords: [task.status, task.dueDate]
      })
    ),
    ...personalProjects.map((project) =>
      createIndexEntry({
        mode: "personal",
        entityType: "Project",
        moduleKey: "projects",
        title: project.title,
        subtitle: project.status || project.targetDate || "No status",
        id: project.id,
        keywords: [project.status, project.targetDate]
      })
    ),
    ...personalPeople.map((person) =>
      createIndexEntry({
        mode: "personal",
        entityType: "Person",
        moduleKey: "people",
        title: person.name,
        subtitle: person.relationship || "Contact",
        id: person.id,
        keywords: [person.relationship, person.notes]
      })
    ),
    ...personalCalendar.map((event) =>
      createIndexEntry({
        mode: "personal",
        entityType: "Calendar",
        moduleKey: "calendar",
        title: event.title,
        subtitle: event.date || "No date",
        id: event.id,
        keywords: [event.date, event.location, event.notes]
      })
    ),
    ...personalDaily.map((entry) =>
      createIndexEntry({
        mode: "personal",
        entityType: "Daily",
        moduleKey: "daily-log",
        title: entry.date,
        subtitle: entry.mood || "No mood",
        id: entry.id,
        keywords: [entry.mood, entry.notes]
      })
    ),
    ...personalExercise.map((entry) =>
      createIndexEntry({
        mode: "personal",
        entityType: "Exercise",
        moduleKey: "exercise-log",
        title: entry.activity || entry.date,
        subtitle: entry.date || "No date",
        id: entry.id,
        keywords: [entry.date, entry.duration, entry.notes]
      })
    )
  );

  return index;
}

/**
 * Creates an immutable index entry with safe fallback copy for missing fields.
 */
function createIndexEntry({ mode, entityType, moduleKey, title, subtitle, id, focus = null, keywords = [] }) {
  const primaryTitle = typeof title === "string" && title.trim() ? title.trim() : `Untitled ${entityType}`;
  const secondaryTitle = typeof subtitle === "string" && subtitle.trim() ? subtitle.trim() : "";
  return {
    id: `${mode}:${moduleKey}:${id || primaryTitle}`,
    mode,
    moduleKey,
    focus,
    entityType,
    title: primaryTitle,
    subtitle: secondaryTitle,
    haystack: `${primaryTitle} ${secondaryTitle} ${keywords.filter(Boolean).join(" ")}`.toLowerCase()
  };
}

/**
 * Filters and ranks palette entries against a user query.
 */
export function searchCommandPalette(query, limit = 30) {
  const allEntries = buildCommandPaletteIndex();
  const queryText = (query || "").trim().toLowerCase();

  if (!queryText) {
    return allEntries.slice(0, limit);
  }

  return allEntries
    .filter((entry) => entry.haystack.includes(queryText))
    .sort((first, second) => first.title.localeCompare(second.title))
    .slice(0, limit);
}

/**
 * Renders a command palette overlay with keyboard-friendly result list semantics.
 */
export function renderCommandPalette({
  isOpen,
  query,
  results,
  selectedIndex,
  onClose,
  onQueryChange,
  onSelect,
  onMoveSelection
}) {
  const overlay = document.createElement("div");
  overlay.className = "command-palette-overlay";

  if (!isOpen) {
    overlay.classList.add("hidden");
    return overlay;
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      onClose();
    }
  });

  const dialog = document.createElement("section");
  dialog.className = "command-palette";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Command palette");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "command-palette-input";
  input.placeholder = "Search tasks, projects, people, meetings…";
  input.value = query;
  input.autocomplete = "off";

  // Focus after mount so keyboard users can immediately type a new query.
  queueMicrotask(() => input.focus());

  input.addEventListener("input", (event) => {
    onQueryChange(event.target.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onMoveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMoveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[selectedIndex];
      if (selected) {
        onSelect(selected);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  });

  const list = document.createElement("ul");
  list.className = "command-palette-results";

  if (!results.length) {
    const empty = document.createElement("li");
    empty.className = "command-palette-empty";
    empty.textContent = "No matching records.";
    list.appendChild(empty);
  }

  results.forEach((result, index) => {
    const row = document.createElement("li");
    row.className = "command-palette-row";
    if (index === selectedIndex) {
      row.classList.add("active");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-palette-action";

    const heading = document.createElement("strong");
    heading.textContent = result.title;

    const meta = document.createElement("span");
    meta.className = "command-palette-meta";
    meta.textContent = `${result.mode.toUpperCase()} · ${result.entityType}${result.subtitle ? ` · ${result.subtitle}` : ""}`;

    button.append(heading, meta);

    button.addEventListener("mouseenter", () => {
      onMoveSelection(index - selectedIndex);
    });

    button.addEventListener("click", () => {
      onSelect(result);
    });

    row.appendChild(button);
    list.appendChild(row);
  });

  dialog.append(input, list);
  overlay.appendChild(dialog);
  return overlay;
}
