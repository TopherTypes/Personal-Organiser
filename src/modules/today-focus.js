import { loadMeetings } from "./meetings.js";
import { loadTasks, markTaskCompleted, saveTask } from "./tasks.js";
import { loadUpdates, markPersonUpdated, selectPendingPeopleCount } from "./updates.js";
import { loadPersonalCalendarEvents } from "./personal-calendar.js";
import { safeJsonParse, safeJsonWrite } from "./storage-core.js";

const TOP_PRIORITIES_STORAGE_KEY = "second-brain.today-focus.priorities.v1";

/**
 * Render the Today Focus module.
 *
 * This module intentionally composes existing module datasets into a single triage surface
 * so users can decide what to do "now" before drilling into a dedicated module.
 */
export function renderTodayFocusModule({ mode = "work", uiContext = {} } = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard today-focus-module";

  const title = document.createElement("h1");
  title.textContent = "Today Focus";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent = "One-screen triage for urgent tasks, near-term commitments, and pending actions.";

  const prioritiesCard = createTopPrioritiesCard(mode);
  const overdueAndToday = createUrgentTasksCard({ mode, onNavigate: uiContext.onNavigate });
  const upcomingEvents = createUpcomingEventsCard(mode);
  const pendingActions = createPendingActionsCard({ mode, onNavigate: uiContext.onNavigate });

  const grid = document.createElement("div");
  grid.className = "overview-grid";
  grid.append(prioritiesCard, overdueAndToday, upcomingEvents, pendingActions);

  section.append(title, intro, grid);
  return section;
}

/**
 * Aggregation rules for "urgent tasks":
 * 1) Include active (non-archived, non-done) tasks.
 * 2) Keep tasks that are overdue OR due today.
 * 3) Sort by urgency score descending, then by due date ascending.
 *
 * Scoring rationale:
 * - Overdue days add weight because missed commitments are highest risk.
 * - Impact-effort delta biases toward high-value quick wins.
 * - Blocked/waiting tasks receive a small penalty to favor executable work first.
 */
function createUrgentTasksCard({ mode, onNavigate }) {
  const today = isoDateToday();
  const tasks = loadTasks(mode)
    .filter((task) => !task.archived)
    .filter((task) => !["Done", "Cancelled"].includes(task.status))
    .filter((task) => task.dueDate && task.dueDate <= today)
    .sort((first, second) => {
      const scoreDelta = computeTaskUrgencyScore(second, today) - computeTaskUrgencyScore(first, today);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return (first.dueDate || "").localeCompare(second.dueDate || "");
    })
    .slice(0, 8);

  return createCard({
    title: "Overdue + due today",
    description: "Fast actions for what is already late or due now.",
    emptyText: "No overdue or due-today tasks.",
    rows: tasks.map((task) => {
      const row = document.createElement("div");
      row.className = "overview-item-row";

      const label = document.createElement("p");
      label.className = "overview-item-title";
      label.textContent = `${task.title || "Untitled task"} · ${task.dueDate}`;

      const actions = document.createElement("div");
      actions.className = "tasks-row-actions";
      actions.append(
        buildActionButton("Start now", () => {
          onNavigate?.({ moduleKey: "tasks", quickAction: { moduleKey: "tasks", createIntent: "task" } });
        }),
        buildActionButton("Snooze to tomorrow", () => {
          const tomorrow = shiftIsoDate(today, 1);
          saveTask(mode, { ...task, dueDate: tomorrow }, task.id);
          row.closest(".card")?.replaceWith(createUrgentTasksCard({ mode, onNavigate }));
        }),
        buildActionButton("Mark done", () => {
          markTaskCompleted(mode, task.id);
          row.closest(".card")?.replaceWith(createUrgentTasksCard({ mode, onNavigate }));
        })
      );

      row.append(label, actions);
      return row;
    })
  });
}

function createUpcomingEventsCard(mode) {
  const today = isoDateToday();
  const events = mode === "work"
    ? loadMeetings("work").filter((meeting) => !meeting.archived)
    : loadPersonalCalendarEvents();

  const rows = events
    .filter((entry) => entry.date && entry.date >= today)
    .sort((first, second) => `${first.date}${first.startTime || ""}`.localeCompare(`${second.date}${second.startTime || ""}`))
    .slice(0, 6)
    .map((entry) => {
      const row = document.createElement("div");
      row.className = "overview-item-row";
      const label = document.createElement("p");
      label.className = "overview-item-title";
      const prefix = entry.startTime ? `${entry.date} ${entry.startTime}` : entry.date;
      label.textContent = `${prefix} · ${entry.name || entry.title || "Untitled event"}`;
      row.appendChild(label);
      return row;
    });

  return createCard({
    title: "Upcoming meetings/events",
    description: "Next commitments to prep for.",
    emptyText: "No upcoming meetings or events.",
    rows
  });
}

function createPendingActionsCard({ mode, onNavigate }) {
  const rows = mode === "work" ? buildWorkPendingRows() : buildPersonalPendingRows();

  return createCard({
    title: "Pending update/action items",
    description: mode === "work" ? "Outstanding recipients from active updates." : "Tasks currently blocked or waiting on others.",
    emptyText: "No pending update/action items.",
    rows,
    footerButton: buildActionButton("Open source module", () => {
      onNavigate?.({ moduleKey: mode === "work" ? "updates" : "tasks" });
    })
  });
}

function buildWorkPendingRows() {
  const updates = loadUpdates("work").filter((update) => update.lifecycle === "active");
  return updates
    .filter((update) => selectPendingPeopleCount(update) > 0)
    .slice(0, 6)
    .map((update) => {
      const row = document.createElement("div");
      row.className = "overview-item-row";
      const label = document.createElement("p");
      label.className = "overview-item-title";
      label.textContent = `${update.summary || "Untitled update"} · ${selectPendingPeopleCount(update)} pending`;

      const action = buildActionButton("Mark done", () => {
        const pendingRecipient = update.recipients.find((entry) => entry.status === "pending");
        if (pendingRecipient) {
          markPersonUpdated(update.id, pendingRecipient.personId);
          row.closest(".card")?.replaceWith(createPendingActionsCard({ mode: "work" }));
        }
      });

      row.append(label, action);
      return row;
    });
}

function buildPersonalPendingRows() {
  return loadTasks("personal")
    .filter((task) => !task.archived)
    .filter((task) => ["Blocked", "Waiting On"].includes(task.status))
    .slice(0, 6)
    .map((task) => {
      const row = document.createElement("div");
      row.className = "overview-item-row";
      const label = document.createElement("p");
      label.className = "overview-item-title";
      label.textContent = `${task.title || "Untitled task"} · ${task.status}`;
      row.appendChild(label);
      return row;
    });
}

function createTopPrioritiesCard(mode) {
  const today = isoDateToday();
  const priorities = loadTopPriorities(mode, today);

  const card = document.createElement("article");
  card.className = "card";

  const title = document.createElement("h2");
  title.textContent = "Top 3 priorities";

  const description = document.createElement("p");
  description.className = "module-intro";
  description.textContent = "Pinned daily priorities (saved per mode and date).";

  const list = document.createElement("div");
  list.className = "today-focus-priority-list";

  for (let index = 0; index < 3; index += 1) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "field-input";
    input.placeholder = `Priority ${index + 1}`;
    input.value = priorities[index] || "";
    input.addEventListener("change", () => {
      priorities[index] = input.value.trim();
      saveTopPriorities(mode, today, priorities);
    });
    list.appendChild(input);
  }

  card.append(title, description, list);
  return card;
}

function createCard({ title, description, emptyText, rows, footerButton = null }) {
  const card = document.createElement("article");
  card.className = "card";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const body = document.createElement("p");
  body.className = "module-intro";
  body.textContent = description;

  const content = document.createElement("div");
  content.className = "overview-list";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state module-empty-state";
    empty.textContent = emptyText;
    content.appendChild(empty);
  } else {
    content.append(...rows);
  }

  card.append(heading, body, content);
  if (footerButton) {
    card.appendChild(footerButton);
  }
  return card;
}

function buildActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function computeTaskUrgencyScore(task, today) {
  const dueDate = task.dueDate || today;
  const overdueDays = Math.max(0, daysBetween(dueDate, today));
  const executionPenalty = ["Blocked", "Waiting On"].includes(task.status) ? 8 : 0;
  const valueSignal = (Number(task.impact) || 0) - (Number(task.effort) || 0);
  return overdueDays * 12 + valueSignal * 4 - executionPenalty;
}

function loadTopPriorities(mode, date) {
  const parsed = safeJsonParse(localStorage.getItem(TOP_PRIORITIES_STORAGE_KEY), {});
  const entries = parsed?.[mode]?.[date];
  return Array.isArray(entries) ? entries.slice(0, 3) : ["", "", ""];
}

function saveTopPriorities(mode, date, priorities) {
  const parsed = safeJsonParse(localStorage.getItem(TOP_PRIORITIES_STORAGE_KEY), {});
  const next = {
    ...parsed,
    [mode]: {
      ...(parsed?.[mode] || {}),
      [date]: priorities.slice(0, 3)
    }
  };
  safeJsonWrite(TOP_PRIORITIES_STORAGE_KEY, next);
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startIsoDate, endIsoDate) {
  const start = new Date(`${startIsoDate}T00:00:00`);
  const end = new Date(`${endIsoDate}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
