import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";

/**
 * Personal modules store payloads behind versioned keys so schema changes can be introduced safely.
 *
 * Project records are intentionally mode-isolated to avoid cross-mode leakage between personal goals
 * and work delivery plans.
 */
const PERSONAL_PROJECTS_KEY = buildPersonalStorageKey("projects", 1);

/**
 * Personal Projects / Timeboxing module per spec 5.2.
 */
export function renderPersonalProjectsModule({ focusCreateForm = false } = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Projects / Timeboxing";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Organise personal projects and optional timeboxes while keeping storage isolated from Work projects.";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const name = buildInput("Project name", "text", true);
  const target = buildInput("Target date", "date", false);
  const notes = document.createElement("textarea");
  notes.className = "field-input field-textarea";
  notes.placeholder = "Notes / timebox details";

  const notesWrap = document.createElement("label");
  notesWrap.className = "field-label";
  notesWrap.textContent = "Notes";
  notesWrap.appendChild(notes);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "enter-mode-button";
  submit.textContent = "Save project";

  form.append(name.wrap, target.wrap, notesWrap, submit);
  if (focusCreateForm) {
    // Quick-action autofocus keeps create flow fast for keyboard and screen-reader users.
    window.requestAnimationFrame(() => name.input.focus());
  }


  const list = document.createElement("div");
  list.className = "entity-scroll-list projects-card-list";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const projects = loadPersonalProjects();
    // Append before persist so the write is a single snapshot update of the collection.
    projects.push({
      id: generateId("pproj_"),
      name: name.input.value.trim(),
      targetDate: target.input.value,
      notes: notes.value.trim(),
      updatedAt: new Date().toISOString()
    });
    persistPersonalProjects(projects);
    form.reset();
    renderList();
  });

  function renderList() {
    list.innerHTML = "";
    // Alphabetical ordering keeps project discovery predictable as the list grows.
    const projects = loadPersonalProjects().sort((a, b) => a.name.localeCompare(b.name));
    if (!projects.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No personal projects yet.";
      list.appendChild(empty);
      return;
    }

    projects.forEach((project) => {
      const card = document.createElement("article");
      card.className = "project-card";

      const heading = document.createElement("h3");
      heading.textContent = project.name;
      const meta = document.createElement("p");
      meta.className = "meeting-meta";
      meta.textContent = `Target: ${project.targetDate || "Not set"}`;

      const detail = document.createElement("p");
      detail.textContent = project.notes || "No notes.";

      card.append(heading, meta, detail);
      list.appendChild(card);
    });
  }

  section.append(title, intro, form, list);
  renderList();
  return section;
}

/**
 * Loads personal projects defensively and returns an empty array when JSON is missing,
 * malformed, or not an array payload.
 */
function loadPersonalProjects() {
  const raw = localStorage.getItem(PERSONAL_PROJECTS_KEY);
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

/**
 * Persists the full personal project collection as canonical JSON so future loads only need
 * malformed-payload fallback for external/corrupted writes.
 */
function persistPersonalProjects(projects) {
  localStorage.setItem(PERSONAL_PROJECTS_KEY, JSON.stringify(projects));
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
