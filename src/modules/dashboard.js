import { loadMeetings, renderWorkMeetingsModule } from "./meetings.js";
import { renderWorkProjectsModule } from "./projects.js";
import { loadTasks, renderWorkTasksModule } from "./tasks.js";
import { loadSprints, renderWorkSprintsModule } from "./sprints.js";
import { PROJECT_PERSON_ROLES, loadPersonProjectLinks, loadProjects, upsertProjectPersonLink } from "./projects-store.js";
import { loadUpdates, markPersonPending, markPersonUpdated, renderWorkUpdatesModule, selectUpdatesForPerson } from "./updates.js";
import { renderSettingsModule } from "./settings.js";
import { renderPersonalTasksModule } from "./personal-tasks.js";
import { renderPersonalProjectsModule } from "./personal-projects.js";
import { renderPersonalDailyLogModule } from "./personal-daily-log.js";
import { renderPersonalExerciseLogModule } from "./personal-exercise-log.js";
import { renderPersonalPeopleModule } from "./personal-people.js";
import { renderPersonalCalendarModule } from "./personal-calendar.js";
import { renderNotesModule } from "./notes.js";
import { buildPersonalStorageKey } from "./personal-keys.js";
import { safeJsonParse, safeJsonWrite } from "./storage-core.js";
import { generateId } from "./id.js";
const STORAGE_KEY_PREFIX = "second-brain.work.people";
const DATASET_BACKUP_PREFIX = "backups/";

/**
 * Renders cross-life landing dashboard shown before a mode is entered.
 */
export function renderLandingDashboard({ onEnterMode }) {
  const section = document.createElement("section");
  section.className = "landing-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Choose where to focus";

  const intro = document.createElement("p");
  intro.textContent =
    "Start in Work or Personal mode. Data remains separated by design.";

  const cards = document.createElement("div");
  cards.className = "landing-cards";

  cards.append(
    createModeCard("Work", "Projects, tasks, meetings, and stakeholder updates.", "work", onEnterMode),
    createModeCard(
      "Personal",
      "Tasks, relationships, and daily wellbeing logs.",
      "personal",
      onEnterMode
    )
  );

  section.append(title, intro, cards);
  return section;
}

/**
 * Builds an individual landing card.
 */
function createModeCard(name, description, mode, onEnterMode) {
  const card = document.createElement("article");
  card.className = "landing-card";

  const heading = document.createElement("h2");
  heading.textContent = name;

  const copy = document.createElement("p");
  copy.textContent = description;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "enter-mode-button";
  button.textContent = `Enter ${name}`;
  button.addEventListener("click", () => onEnterMode(mode));

  card.append(heading, copy, button);
  return card;
}

/**
 * Renders mode content based on selected sidebar module.
 */
export function renderModeDashboard(mode, { activeModule = "dashboard", uiContext = {} } = {}) {
  if (activeModule === "dashboard") {
    return mode === "work"
      ? renderWorkOverviewDashboard(uiContext)
      : renderPersonalOverviewDashboard(uiContext);
  }

  if (mode === "work" && activeModule === "people") {
    return renderWorkPeopleModule(uiContext);
  }

  if (mode === "work" && activeModule === "meetings") {
    return renderWorkMeetingsModule({
      mode,
      people: loadPeople("work"),
      initialPrefill: uiContext.meetingPrefill || null,
      initialMeetingId: uiContext.meetingFocusId || "",
      setUnsavedChangesGuard: uiContext.setUnsavedChangesGuard
    });
  }

  if (mode === "work" && activeModule === "tasks") {
    return renderWorkTasksModule({ mode });
  }

  if (mode === "work" && activeModule === "projects") {
    return renderWorkProjectsModule({
      mode,
      people: loadPeople("work"),
      meetings: loadMeetings("work")
    });
  }

  if (mode === "work" && activeModule === "sprints") {
    return renderWorkSprintsModule({ mode });
  }

  if (mode === "work" && activeModule === "updates") {
    // Dashboard owns orchestration only: it injects dependency snapshots (people/meetings)
    // while the Updates module owns persistence boundaries and versioned storage writes.
    return renderWorkUpdatesModule({
      mode,
      people: loadPeople("work"),
      meetings: loadMeetings("work")
    });
  }

  if (mode === "personal" && activeModule === "tasks") {
    return renderPersonalTasksModule();
  }

  if (mode === "personal" && activeModule === "projects") {
    return renderPersonalProjectsModule();
  }

  if (mode === "personal" && activeModule === "daily-log") {
    return renderPersonalDailyLogModule();
  }

  if (mode === "personal" && activeModule === "exercise-log") {
    return renderPersonalExerciseLogModule();
  }

  if (mode === "personal" && activeModule === "people") {
    return renderPersonalPeopleModule();
  }

  if (mode === "personal" && activeModule === "calendar") {
    return renderPersonalCalendarModule();
  }


  if (["work", "personal"].includes(mode) && activeModule === "notes") {
    return renderNotesModule({ mode });
  }

  if (activeModule === "settings") {
    return renderSettingsModule({
      mode,
      settings: uiContext.settings || {},
      onSettingsChange: uiContext.onSettingsChange,
      onDataRestore: uiContext.onDataRestore,
      onBackupRestore: uiContext.onBackupRestore,
      onFullDataReset: uiContext.onFullDataReset,
      syncState: uiContext.syncState,
      onResolveSyncConflicts: uiContext.onResolveSyncConflicts
    });
  }

  return renderPlaceholderModule(mode, activeModule);
}

/**
 * Builds a one-screen work dashboard with actionable, deep-linking summaries.
 */
function renderWorkOverviewDashboard(uiContext = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard overview-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Work Dashboard";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent = "A compact snapshot of execution risk, priorities, and upcoming commitments.";

  const people = loadPeople("work");
  const tasks = loadTasks("work").filter((task) => !task.archived);
  const projects = loadProjects("work");
  const meetings = loadMeetings("work").filter((meeting) => !meeting.archived);
  const sprints = loadSprints("work").filter((sprint) => !sprint.archived);
  const updates = loadUpdates("work");
  const today = isoDateToday();

  const meetingRows = meetings
    .filter((meeting) => meeting.date === today)
    .sort((first, second) => `${first.startTime || ""}${first.name}`.localeCompare(`${second.startTime || ""}${second.name}`))
    .slice(0, 4);

  const focusTasks = tasks
    .filter((task) => !["Done", "Cancelled"].includes(task.status))
    .sort((first, second) => {
      const dueA = first.dueDate || "9999-12-31";
      const dueB = second.dueDate || "9999-12-31";
      if (dueA !== dueB) {
        return dueA.localeCompare(dueB);
      }
      return (second.impact - second.effort) - (first.impact - first.effort);
    })
    .slice(0, 5);

  const activeProjects = projects.filter((project) => !["completed", "cancelled", "archived"].includes(String(project.status).toLowerCase()));
  const atRiskProjects = activeProjects.filter((project) => project.targetDate && project.targetDate < today).slice(0, 4);
  const pendingUpdates = updates.reduce((count, update) => count + update.toUpdate.filter((item) => item.status === "pending").length, 0);
  const activeSprintCount = sprints.filter((sprint) => sprint.status === "active").length;

  const metrics = document.createElement("div");
  metrics.className = "overview-metrics";
  metrics.append(
    createMetricCard("Open tasks", String(tasks.length), "tasks", uiContext),
    createMetricCard("Meetings today", String(meetingRows.length), "meetings", uiContext),
    createMetricCard("Active projects", String(activeProjects.length), "projects", uiContext),
    createMetricCard("Pending updates", String(pendingUpdates), "updates", uiContext),
    createMetricCard("Active sprints", String(activeSprintCount), "sprints", uiContext)
  );

  // Lightweight trend charts stay fully local by deriving series from already
  // persisted entities (tasks/meetings) without any server dependency.
  const trends = createDashboardTrendsSection({
    title: "Execution trends",
    description: "7/30/90-day patterns for completion throughput, overdue pressure, and meetings rhythm.",
    buildCards: ({ rangeDays }) => [
      createTaskCompletionTrendCard(tasks, today, rangeDays),
      createOverdueDriftTrendCard(tasks, today, rangeDays),
      createMeetingsByWeekTrendCard(meetings, today, rangeDays)
    ]
  });

  const grid = document.createElement("div");
  grid.className = "overview-grid";

  grid.append(
    createOverviewListCard({
      title: "Today's meetings",
      description: "Open directly in Meetings to edit agenda or attendees.",
      emptyText: "No meetings scheduled for today.",
      items: meetingRows,
      getLabel: (meeting) => `${meeting.startTime || "Any time"} · ${meeting.name || "Untitled meeting"}`,
      onItemClick: (meeting) =>
        navigateFromDashboard(uiContext, {
          moduleKey: "meetings",
          focus: { meetingId: meeting.id }
        }),
      footerAction: createFooterAction("View all meetings", () => navigateFromDashboard(uiContext, { moduleKey: "meetings" }))
    }),
    createOverviewListCard({
      title: "Priority tasks",
      description: "Sorted by nearest due date and impact.",
      emptyText: "No active tasks to triage.",
      items: focusTasks,
      getLabel: (task) => `${task.title || "Untitled task"} · ${task.dueDate || "No due date"} · ${task.status}`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }),
      footerAction: createFooterAction("Open task board", () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }))
    }),
    createOverviewListCard({
      title: "Projects needing attention",
      description: "Overdue targets or status drift.",
      emptyText: "No overdue active projects.",
      items: atRiskProjects,
      getLabel: (project) => `${project.title || "Untitled project"} · target ${project.targetDate || "n/a"}`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "projects" }),
      footerAction: createFooterAction("Open projects", () => navigateFromDashboard(uiContext, { moduleKey: "projects" }))
    }),
    createOverviewListCard({
      title: "People requiring update",
      description: "Stakeholders with pending work updates.",
      emptyText: "No pending update recipients right now.",
      items: people
        // `selectUpdatesForPerson` returns `{ update, entry }` rows and defaults to pending-only,
        // so non-zero length already indicates the person has pending follow-ups.
        .filter((person) => selectUpdatesForPerson(updates, person.id).length > 0)
        .slice(0, 4),
      getLabel: (person) => `${person.name || "Unnamed person"} · ${selectUpdatesForPerson(updates, person.id).length} pending`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "updates" }),
      footerAction: createFooterAction("Open updates", () => navigateFromDashboard(uiContext, { moduleKey: "updates" }))
    })
  );

  section.append(title, intro, metrics, trends, grid);
  return section;
}

/**
 * Builds a personal-mode dashboard that keeps key routines visible in one view.
 */
function renderPersonalOverviewDashboard(uiContext = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard overview-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Dashboard";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent = "A single-screen overview of your day, plans, and wellbeing trends.";

  const today = isoDateToday();
  const tasks = loadPersonalCollection("tasks");
  const projects = loadPersonalCollection("projects");
  const events = loadPersonalCollection("calendar");
  const dailyLogs = loadPersonalCollection("daily-log");
  const exerciseEntries = loadPersonalCollection("exercise-log");

  const todayTasks = tasks.filter((task) => task.dueDate === today && !["Done", "Cancelled"].includes(task.status)).slice(0, 5);
  const recurringTasks = tasks.filter((task) => task.recurrenceMeta && task.recurrenceMeta.frequency !== "none");
  const upcomingEvents = events.filter((entry) => entry.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const recurringEvents = events.filter((entry) => entry.recurrenceMeta && entry.recurrenceMeta.frequency !== "none");
  const activeProjects = projects.filter((project) => !project.targetDate || project.targetDate >= today).slice(0, 4);
  const thisWeekExercise = exerciseEntries.filter((entry) => entry.date && daysBetween(entry.date, today) <= 7 && daysBetween(entry.date, today) >= 0);
  const latestMood = dailyLogs.find((entry) => entry.date)?.mood || "-";

  const metrics = document.createElement("div");
  metrics.className = "overview-metrics";
  metrics.append(
    createMetricCard("Tasks due today", String(todayTasks.length), "tasks", uiContext),
    createMetricCard("Upcoming events", String(upcomingEvents.length), "calendar", uiContext),
    createMetricCard("Recurring tasks", String(recurringTasks.length), "tasks", uiContext),
    createMetricCard("Recurring events", String(recurringEvents.length), "calendar", uiContext),
    createMetricCard("Active projects", String(activeProjects.length), "projects", uiContext),
    createMetricCard("Exercise entries (7d)", String(thisWeekExercise.length), "exercise-log", uiContext),
    createMetricCard("Latest mood", String(latestMood), "daily-log", uiContext)
  );

  // Personal trends intentionally reuse the same chart primitives as work mode
  // so the UI stays consistent while metrics remain mode-specific.
  const trends = createDashboardTrendsSection({
    title: "Personal consistency trends",
    description: "7/30/90-day signals across tasks, overdue drift, calendar cadence, and routines.",
    buildCards: ({ rangeDays }) => [
      createTaskCompletionTrendCard(tasks, today, rangeDays),
      createOverdueDriftTrendCard(tasks, today, rangeDays),
      createMeetingsByWeekTrendCard(events, today, rangeDays, { dateKey: "date", heading: "Calendar meetings by week" }),
      createHabitConsistencyTrendCard(dailyLogs, exerciseEntries, today, rangeDays)
    ]
  });

  const grid = document.createElement("div");
  grid.className = "overview-grid";
  grid.append(
    createOverviewListCard({
      title: "Due today",
      description: "Personal tasks requiring attention today.",
      emptyText: "No personal tasks due today.",
      items: todayTasks,
      getLabel: (task) =>
        `${task.title || "Untitled task"} · ${task.status}${
          task.recurrenceMeta ? ` · repeats ${task.recurrenceMeta.frequency}/${task.recurrenceMeta.interval}` : ""
        }`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }),
      footerAction: createFooterAction("Open tasks", () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }))
    }),
    createOverviewListCard({
      title: "Upcoming calendar",
      description: "Next personal events.",
      emptyText: "No upcoming calendar entries.",
      items: upcomingEvents,
      getLabel: (event) =>
        `${event.date} · ${event.title || "Untitled event"}${
          event.recurrenceMeta ? ` · repeats ${event.recurrenceMeta.frequency}/${event.recurrenceMeta.interval}` : ""
        }`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "calendar" }),
      footerAction: createFooterAction("Open calendar", () => navigateFromDashboard(uiContext, { moduleKey: "calendar" }))
    }),
    createOverviewListCard({
      title: "Projects in motion",
      description: "Current personal projects/timeboxes.",
      emptyText: "No active personal projects.",
      items: activeProjects,
      getLabel: (project) => `${project.name || "Untitled project"} · target ${project.targetDate || "not set"}`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "projects" }),
      footerAction: createFooterAction("Open projects", () => navigateFromDashboard(uiContext, { moduleKey: "projects" }))
    }),
    createOverviewListCard({
      title: "Health check",
      description: "Recent daily logs and exercise momentum.",
      emptyText: "No daily logs available yet.",
      items: dailyLogs.slice(0, 4),
      getLabel: (entry) => `${entry.date || "No date"} · Mood ${entry.mood || "-"}`,
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "daily-log" }),
      footerAction: createFooterAction("Open daily log", () => navigateFromDashboard(uiContext, { moduleKey: "daily-log" }))
    })
  );

  section.append(title, intro, metrics, trends, grid);
  return section;
}


/**
 * Dispatches dashboard navigation requests to the app shell.
 */
function navigateFromDashboard(uiContext, payload) {
  if (typeof uiContext.onNavigate === "function") {
    uiContext.onNavigate(payload);
  }
}

/**
 * Creates a compact metric tile that links to a module when clicked.
 */
function createMetricCard(label, value, moduleKey, uiContext) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "overview-metric-card";
  button.addEventListener("click", () => navigateFromDashboard(uiContext, { moduleKey }));

  const heading = document.createElement("span");
  heading.className = "overview-metric-label";
  heading.textContent = label;

  const metricValue = document.createElement("strong");
  metricValue.className = "overview-metric-value";
  metricValue.textContent = value;

  button.append(heading, metricValue);
  return button;
}

/**
 * Builds a reusable list card pattern for overview dashboards.
 */
function createOverviewListCard({ title, description, emptyText, items, getLabel, onItemClick, footerAction }) {
  const card = document.createElement("article");
  card.className = "overview-card";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.className = "overview-card-description";
  copy.textContent = description;

  const list = document.createElement("div");
  list.className = "overview-list";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    list.appendChild(empty);
  }

  for (const item of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "overview-list-item";
    row.textContent = getLabel(item);
    row.addEventListener("click", () => onItemClick(item));
    list.appendChild(row);
  }

  card.append(heading, copy, list);
  if (footerAction) {
    card.appendChild(footerAction);
  }

  return card;
}

/**
 * Creates the card footer action so users can jump to full module views.
 */
function createFooterAction(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "overview-footer-action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Renders reusable dashboard trend controls and chart cards with local state.
 */
function createDashboardTrendsSection({ title, description, buildCards }) {
  const section = document.createElement("section");
  section.className = "overview-trends";

  const header = document.createElement("div");
  header.className = "overview-trends-header";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.className = "overview-card-description";
  copy.textContent = description;

  const controls = document.createElement("div");
  controls.className = "trend-range-controls";

  const body = document.createElement("div");
  body.className = "overview-trend-grid";

  let rangeDays = 30;
  const options = [7, 30, 90];

  function render() {
    controls.innerHTML = "";
    body.innerHTML = "";

    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `trend-range-button${option === rangeDays ? " active" : ""}`;
      button.textContent = `${option}d`;
      button.addEventListener("click", () => {
        rangeDays = option;
        render();
      });
      controls.appendChild(button);
    }

    const cards = buildCards({ rangeDays }) || [];
    for (const card of cards) {
      body.appendChild(card);
    }
  }

  header.append(heading, copy, controls);
  section.append(header, body);
  render();
  return section;
}

/**
 * Shows daily count of tasks completed in the selected date window.
 */
function createTaskCompletionTrendCard(tasks, todayIso, rangeDays) {
  const dates = buildDateWindow(todayIso, rangeDays);
  const countsByDate = new Map(dates.map((date) => [date, 0]));

  for (const task of tasks) {
    if (!String(task.status || "").toLowerCase().includes("done")) {
      continue;
    }
    const completedDate = toIsoDate(task.updatedAt || task.createdAt || "");
    if (completedDate && countsByDate.has(completedDate)) {
      countsByDate.set(completedDate, countsByDate.get(completedDate) + 1);
    }
  }

  return createTrendBarCard({
    title: "Task completion over time",
    description: "Completed tasks per day.",
    rows: compressDailySeriesToBuckets(dates, countsByDate, 8),
    valueSuffix: " done"
  });
}

/**
 * Shows how many tasks are overdue per day to reveal backlog drift.
 */
function createOverdueDriftTrendCard(tasks, todayIso, rangeDays) {
  const dates = buildDateWindow(todayIso, rangeDays);
  const rows = dates.map((date) => {
    const overdueCount = tasks.reduce((count, task) => {
      if (!task.dueDate || task.dueDate >= date) {
        return count;
      }

      const done = String(task.status || "").toLowerCase().includes("done");
      const completedDate = toIsoDate(task.updatedAt || "");
      const resolvedByDate = done && completedDate && completedDate <= date;
      return resolvedByDate ? count : count + 1;
    }, 0);

    return { label: compactDateLabel(date), value: overdueCount };
  });

  return createTrendBarCard({
    title: "Overdue drift",
    description: "Open overdue task load by day.",
    rows: compressRows(rows, 8),
    valueSuffix: " overdue"
  });
}

/**
 * Aggregates dated records into weekly counts (e.g., meetings/calendar events).
 */
function createMeetingsByWeekTrendCard(records, todayIso, rangeDays, { dateKey = "date", heading = "Meetings by week" } = {}) {
  const minDate = shiftIsoDate(todayIso, -(rangeDays - 1));
  const weekMap = new Map();

  for (const record of records) {
    const iso = record?.[dateKey];
    if (!iso || iso < minDate || iso > todayIso) {
      continue;
    }
    const weekStart = startOfIsoWeek(iso);
    weekMap.set(weekStart, (weekMap.get(weekStart) || 0) + 1);
  }

  const rows = Array.from(weekMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, count]) => ({ label: `Wk ${compactDateLabel(weekStart)}`, value: count }));

  return createTrendBarCard({
    title: heading,
    description: "Weekly count in selected range.",
    rows,
    valueSuffix: " meetings"
  });
}

/**
 * Tracks routine consistency using daily log and exercise entry coverage.
 */
function createHabitConsistencyTrendCard(dailyLogs, exerciseEntries, todayIso, rangeDays) {
  const minDate = shiftIsoDate(todayIso, -(rangeDays - 1));
  const dailyDates = new Set(dailyLogs.map((entry) => entry.date).filter((date) => date && date >= minDate && date <= todayIso));
  const exerciseDates = new Set(exerciseEntries.map((entry) => entry.date).filter((date) => date && date >= minDate && date <= todayIso));

  const weekStarts = new Set([...dailyDates, ...exerciseDates].map((date) => startOfIsoWeek(date)));
  const rows = Array.from(weekStarts)
    .sort((a, b) => a.localeCompare(b))
    .map((weekStart) => {
      let score = 0;
      for (let index = 0; index < 7; index += 1) {
        const day = shiftIsoDate(weekStart, index);
        if (day < minDate || day > todayIso) {
          continue;
        }
        if (dailyDates.has(day) || exerciseDates.has(day)) {
          score += 1;
        }
      }
      return { label: `Wk ${compactDateLabel(weekStart)}`, value: score };
    });

  return createTrendBarCard({
    title: "Habit/log consistency",
    description: "Days per week with either daily log or exercise entry.",
    rows,
    maxValue: 7,
    valueSuffix: "/7 days"
  });
}

/**
 * Shared presentational card for dependency-free chart-like bars.
 */
function createTrendBarCard({ title, description, rows, maxValue = null, valueSuffix = "" }) {
  const card = document.createElement("article");
  card.className = "overview-card trend-card";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.className = "overview-card-description";
  copy.textContent = description;

  const bars = document.createElement("div");
  bars.className = "trend-bars";

  const safeRows = rows.length ? rows : [{ label: "No data", value: 0 }];
  const peak = Number.isFinite(maxValue) ? maxValue : Math.max(1, ...safeRows.map((row) => row.value || 0));

  for (const row of safeRows) {
    const track = document.createElement("div");
    track.className = "trend-bar-row";

    const label = document.createElement("span");
    label.className = "trend-bar-label";
    label.textContent = row.label;

    const rail = document.createElement("div");
    rail.className = "trend-bar-rail";

    const fill = document.createElement("div");
    fill.className = "trend-bar-fill";
    fill.style.width = `${Math.max(4, Math.round(((row.value || 0) / peak) * 100))}%`;

    const value = document.createElement("span");
    value.className = "trend-bar-value";
    value.textContent = `${row.value || 0}${valueSuffix}`;

    rail.appendChild(fill);
    track.append(label, rail, value);
    bars.appendChild(track);
  }

  card.append(heading, copy, bars);
  return card;
}

function buildDateWindow(todayIso, rangeDays) {
  const dates = [];
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    dates.push(shiftIsoDate(todayIso, -offset));
  }
  return dates;
}

function compressDailySeriesToBuckets(dates, countsByDate, maxBuckets) {
  const rows = dates.map((date) => ({ label: compactDateLabel(date), value: countsByDate.get(date) || 0 }));
  return compressRows(rows, maxBuckets);
}

function compressRows(rows, maxBuckets) {
  if (rows.length <= maxBuckets) {
    return rows;
  }
  const bucketSize = Math.ceil(rows.length / maxBuckets);
  const compressed = [];
  for (let index = 0; index < rows.length; index += bucketSize) {
    const slice = rows.slice(index, index + bucketSize);
    const total = slice.reduce((sum, row) => sum + row.value, 0);
    compressed.push({ label: `${slice[0].label}-${slice[slice.length - 1].label}`, value: total });
  }
  return compressed;
}

function shiftIsoDate(isoDate, dayDelta) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

function toIsoDate(value) {
  if (!value) {
    return "";
  }
  return String(value).slice(0, 10);
}

function compactDateLabel(isoDate) {
  return isoDate.slice(5);
}

function startOfIsoWeek(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  const day = date.getDay();
  const offsetFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - offsetFromMonday);
  return date.toISOString().slice(0, 10);
}

/**
 * Reads personal collection records with defensive JSON parsing.
 */
function loadPersonalCollection(moduleName, version = 1) {
  const key = buildPersonalStorageKey(moduleName, version);
  const raw = localStorage.getItem(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      if (moduleName === "calendar" && Array.isArray(parsed.events)) {
        return parsed.events;
      }
      if (Array.isArray(parsed[moduleName])) {
        return parsed[moduleName];
      }
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Calculates calendar-day distance where positive means the second date is later.
 */
function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  return Math.round((to - from) / 86400000);
}

/**
 * Renders a placeholder module until each feature area is implemented.
 */
function renderPlaceholderModule(mode, activeModule) {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = `${toTitleCase(mode)} ${toTitleCase(activeModule)}`;

  const body = document.createElement("p");
  body.textContent =
    "This module is ready in navigation. Functional workflows will be delivered incrementally.";

  section.append(title, body);
  return section;
}

/**
 * Renders the work mode People module with localStorage-backed CRUD support.
 */
function renderWorkPeopleModule(uiContext = {}) {
  const state = createPeopleUiState("work");

  const section = document.createElement("section");
  section.className = "mode-dashboard people-module people-shell";

  const header = document.createElement("header");
  header.className = "people-page-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "people-title-wrap";

  const title = document.createElement("h1");
  title.textContent = "Work People";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Track work contacts, stakeholder relationships, and keep a timestamped log of engagements.";

  const metrics = document.createElement("div");
  metrics.className = "people-metrics";

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "button button-primary";
  createButton.textContent = "Add person";
  createButton.addEventListener("click", () => {
    state.editingId = null;
    state.isFormOpen = true;
    state.selectedPersonId = null;
    renderPeopleModule();
  });

  titleWrap.append(title, intro, metrics);
  header.append(titleWrap, createButton);

  const notice = document.createElement("p");
  notice.className = "info-banner";
  notice.textContent =
    "ℹ️ Data safety: records are archived (not deleted) and remain recoverable in this module.";

  const controls = document.createElement("div");
  controls.className = "people-controls";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "field-input";
  search.placeholder = "Search by name, organisation, role, relationship, or notes";
  search.value = state.search;
  search.setAttribute("aria-label", "Search people");
  search.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderPeopleModule();
  });

  const filter = document.createElement("select");
  filter.className = "field-input";
  filter.setAttribute("aria-label", "Filter by status");
  addOption(filter, "active", "Active only");
  addOption(filter, "archived", "Archived only");
  addOption(filter, "all", "All statuses");
  filter.value = state.filter;
  filter.addEventListener("change", (event) => {
    state.filter = event.target.value;
    renderPeopleModule();
  });

  const sort = document.createElement("select");
  sort.className = "field-input";
  sort.setAttribute("aria-label", "Sort people");
  addOption(sort, "updated-desc", "Recently updated");
  addOption(sort, "name-asc", "Name A → Z");
  addOption(sort, "name-desc", "Name Z → A");
  addOption(sort, "contact-desc", "Last contact newest");
  addOption(sort, "contact-asc", "Last contact oldest");
  sort.value = state.sort;
  sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderPeopleModule();
  });

  const clearFilters = document.createElement("button");
  clearFilters.type = "button";
  clearFilters.className = "button button-secondary clear-filters";
  clearFilters.textContent = "Clear filters";
  clearFilters.addEventListener("click", () => {
    state.search = "";
    state.filter = "active";
    state.sort = "name-asc";
    renderPeopleModule();
  });

  controls.append(search, filter, sort, clearFilters);

  const message = document.createElement("p");
  message.className = "feedback";

  const workspace = document.createElement("div");
  workspace.className = "people-workspace";

  const listPanel = document.createElement("div");
  listPanel.className = "people-list-panel card";

  const listWrap = document.createElement("div");
  listWrap.className = "people-list";

  const detailPanel = document.createElement("section");
  detailPanel.className = "people-detail-panel card";
  detailPanel.setAttribute("aria-live", "polite");

  const formWrap = document.createElement("div");
  formWrap.className = "people-form-wrap";

  const toast = document.createElement("div");
  toast.className = "snackbar";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  listPanel.appendChild(listWrap);
  workspace.append(listPanel, detailPanel);
  section.append(header, notice, controls, message, workspace, formWrap, toast);

  function setToast(text) {
    toast.textContent = text;
    toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
    }, 2200);
  }

  function renderPeopleModule() {
    const result = queryPeople(state);
    const counts = getPeopleCounts(state.mode);

    metrics.innerHTML = "";
    metrics.append(
      createMetricChip("Total", counts.total),
      createMetricChip("Active", counts.active),
      createMetricChip("Archived", counts.archived)
    );

    message.textContent = state.feedback || `Showing ${result.length} contact(s).`;

    search.value = state.search;
    filter.value = state.filter;
    sort.value = state.sort;

    const hasActiveFilters = state.search.trim() || state.filter !== "active" || state.sort !== "name-asc";
    clearFilters.hidden = !hasActiveFilters;

    if (!state.selectedPersonId && result.length > 0) {
      state.selectedPersonId = result[0].id;
    }

    if (state.selectedPersonId && !result.some((person) => person.id === state.selectedPersonId)) {
      state.selectedPersonId = result[0]?.id || null;
    }

    listWrap.innerHTML = "";
    if (result.length === 0) {
      listWrap.appendChild(createEmptyPeopleState({
        hasFilters: Boolean(state.search.trim() || state.filter !== "active"),
        onClear: () => {
          state.search = "";
          state.filter = "active";
          state.sort = "name-asc";
          renderPeopleModule();
        },
        onAdd: () => {
          state.isFormOpen = true;
          state.editingId = null;
          renderPeopleModule();
        }
      }));
    } else {
      const list = document.createElement("ul");
      list.className = "people-selection-list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "People list");

      for (const person of result) {
        list.appendChild(
          createPersonListItem(person, {
            selected: state.selectedPersonId === person.id,
            onSelect: () => {
              state.selectedPersonId = person.id;
              state.feedback = "";
              renderPeopleModule();
            }
          })
        );
      }

      /**
       * Supports arrow-key navigation within the split-view listbox so keyboard
       * users can switch records without leaving the list context.
       */
      list.addEventListener("keydown", (event) => {
        const selectable = Array.from(list.querySelectorAll(".people-list-button"));
        if (!selectable.length) {
          return;
        }

        const activeIndex = selectable.findIndex((button) => button.dataset.personId === state.selectedPersonId);
        const currentIndex = activeIndex >= 0 ? activeIndex : 0;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          selectable[Math.min(currentIndex + 1, selectable.length - 1)].click();
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          selectable[Math.max(currentIndex - 1, 0)].click();
          return;
        }

        if (event.key === "Home") {
          event.preventDefault();
          selectable[0].click();
          return;
        }

        if (event.key === "End") {
          event.preventDefault();
          selectable[selectable.length - 1].click();
        }
      });

      listWrap.appendChild(list);
    }

    detailPanel.innerHTML = "";
    const selectedPerson = state.selectedPersonId ? findPersonById(state.mode, state.selectedPersonId) : null;
    const updates = loadUpdates(state.mode);

    detailPanel.appendChild(
      createPersonDetailsPanel(selectedPerson, {
        showCompletedUpdates: state.showCompletedUpdates,
        personUpdates: selectedPerson ? selectUpdatesForPerson(updates, selectedPerson.id, { includeCompleted: true }) : [],
        onToggleShowCompletedUpdates: () => {
          state.showCompletedUpdates = !state.showCompletedUpdates;
          renderPeopleModule();
        },
        onMarkUpdateStatus: ({ updateId, personId, status }) => {
          if (status === "updated") {
            markPersonUpdated(updateId, personId);
            state.feedback = `Marked update as completed for ${selectedPerson.name}.`;
          } else {
            markPersonPending(updateId, personId);
            state.feedback = `Moved update back to pending for ${selectedPerson.name}.`;
          }
          renderPeopleModule();
        },
        onScheduleOneOnOne: (personRecord) => {
          if (typeof uiContext.onScheduleOneOnOne === "function") {
            uiContext.onScheduleOneOnOne(personRecord);
          }
        },
        onEdit: () => {
          state.editingId = selectedPerson.id;
          state.isFormOpen = true;
          renderPeopleModule();
        },
        onArchiveToggle: () => {
          const nextArchivedValue = !selectedPerson.archived;
          const confirmation = window.confirm(
            nextArchivedValue
              ? `Archive ${selectedPerson.name}? You can restore this record later.`
              : `Restore ${selectedPerson.name} to active contacts?`
          );

          if (!confirmation) {
            return;
          }

          const archiveResult = archivePerson(state.mode, selectedPerson.id, nextArchivedValue);
          if (!archiveResult.ok) {
            state.feedback = archiveResult.error;
            renderPeopleModule();
            return;
          }

          state.feedback = nextArchivedValue
            ? `Archived ${selectedPerson.name}.`
            : `Restored ${selectedPerson.name}.`;
          renderPeopleModule();
        },
        onQuickUpdate: (payload) => {
          const updateResult = quickUpdateContact(state.mode, selectedPerson.id, payload);
          if (updateResult.ok) {
            state.feedback = `Logged contact update for ${selectedPerson.name}.`;
            setToast("Contact logged successfully.");
          } else {
            state.feedback = updateResult.error;
          }
          renderPeopleModule();
        }
      })
    );

    formWrap.innerHTML = "";
    if (state.isFormOpen) {
      const activePerson = state.editingId ? findPersonById(state.mode, state.editingId) : null;
      formWrap.appendChild(
        createPersonForm({
          mode: state.mode,
          person: activePerson,
          onCancel: () => {
            state.isFormOpen = false;
            state.editingId = null;
            renderPeopleModule();
          },
          onSave: (payload) => {
            const saveResult = savePerson(state.mode, payload.person, state.editingId);
            if (!saveResult.ok) {
              state.feedback = saveResult.error;
              renderPeopleModule();
              return;
            }

            applyPersonProjectLinks(state.mode, saveResult.person.id, payload.projectLinks);
            state.isFormOpen = false;
            state.editingId = null;
            state.selectedPersonId = saveResult.person.id;
            state.feedback = saveResult.wasEdit
              ? `Updated ${payload.person.name}.`
              : `Added ${payload.person.name}.`;
            setToast(saveResult.wasEdit ? "Contact updated." : "Contact added.");
            renderPeopleModule();
          }
        })
      );
    }
  }

  renderPeopleModule();
  return section;
}

/**
 * Creates form state defaults for this isolated view.
 */
function createPeopleUiState(mode) {
  return {
    mode,
    search: "",
    filter: "active",
    // Directory-style modules default to alphabetical order for fast scanning.
    sort: "name-asc",
    isFormOpen: false,
    editingId: null,
    selectedPersonId: null,
    showCompletedUpdates: false,
    feedback: "",
    toastTimer: null
  };
}

/**
 * Builds compact metric chips for quick page-level scanning.
 */
function createMetricChip(label, value) {
  const chip = document.createElement("p");
  chip.className = "metric-chip";
  chip.textContent = `${label}: ${value}`;
  return chip;
}

/**
 * Returns total, active, and archived counts for the current mode.
 */
function getPeopleCounts(mode) {
  const people = loadPeople(mode);
  const archived = people.filter((person) => person.archived).length;
  return {
    total: people.length,
    archived,
    active: people.length - archived
  };
}

/**
 * Creates a listbox option for split-view people navigation.
 */
function createPersonListItem(person, { selected, onSelect }) {
  const item = document.createElement("li");
  item.className = "people-list-item";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "people-list-button";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(selected));
  button.dataset.personId = person.id;
  button.tabIndex = selected ? 0 : -1;

  if (selected) {
    item.classList.add("selected");
  }

  button.addEventListener("click", onSelect);

  const header = document.createElement("div");
  header.className = "people-list-item-head";

  const name = document.createElement("strong");
  name.textContent = person.name;

  const status = document.createElement("span");
  status.className = person.archived ? "status-badge archived" : "status-badge active";
  status.textContent = person.archived ? "Archived" : "Active";

  const orgRole = document.createElement("p");
  orgRole.className = "person-meta";
  orgRole.textContent = `${person.organisation || "No organisation"} · ${person.role || "No role"}`;

  const relationship = document.createElement("p");
  relationship.className = "person-meta";
  relationship.textContent = `Relationship: ${person.relationship || "Not set"}`;

  const lastContact = document.createElement("p");
  lastContact.className = "person-meta";
  lastContact.textContent = `Last contact: ${person.lastContactDate || "Not logged"}`;

  header.append(name, status);
  button.append(header, orgRole, relationship, lastContact);
  item.appendChild(button);
  return item;
}

/**
 * Renders right-side details view for selected person.
 */
function createPersonDetailsPanel(
  person,
  {
    showCompletedUpdates = false,
    personUpdates = [],
    onToggleShowCompletedUpdates,
    onMarkUpdateStatus,
    onEdit,
    onArchiveToggle,
    onQuickUpdate,
    onScheduleOneOnOne
  }
) {
  if (!person) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Select a contact to review details and log interactions.";
    return empty;
  }

  const wrap = document.createElement("div");
  wrap.className = "people-details";

  const header = document.createElement("header");
  header.className = "person-detail-header";

  const identity = document.createElement("div");

  const name = document.createElement("h2");
  name.textContent = person.name;

  const meta = document.createElement("p");
  meta.className = "person-meta";
  meta.textContent = `${person.role || "No role"} · ${person.organisation || "No organisation"}`;

  const relationship = document.createElement("p");
  relationship.className = "person-meta";
  relationship.textContent = `Relationship: ${person.relationship || "Not set"}`;

  const status = document.createElement("span");
  status.className = person.archived ? "status-badge archived" : "status-badge active";
  status.textContent = person.archived ? "Archived" : "Active";

  identity.append(name, meta, relationship);
  header.append(identity, status);

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const logContact = document.createElement("button");
  logContact.type = "button";
  logContact.className = "button button-primary";
  logContact.textContent = "Log contact";
  logContact.addEventListener("click", () => {
    const dateField = wrap.querySelector(".quick-update-date");
    const noteField = wrap.querySelector(".quick-update-note");
    if (!dateField || !noteField) {
      return;
    }

    onQuickUpdate({
      date: dateField.value,
      note: noteField.value.trim()
    });
  });

  const scheduleOneOnOne = document.createElement("button");
  scheduleOneOnOne.type = "button";
  scheduleOneOnOne.className = "button button-secondary";
  scheduleOneOnOne.textContent = "Schedule 1:1";
  scheduleOneOnOne.addEventListener("click", () => onScheduleOneOnOne(person));

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "button button-secondary";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", onEdit);

  const archiveButton = document.createElement("button");
  archiveButton.type = "button";
  archiveButton.className = "button button-danger-subtle";
  archiveButton.textContent = person.archived ? "Restore" : "Archive";
  archiveButton.addEventListener("click", onArchiveToggle);

  actions.append(logContact, scheduleOneOnOne, editButton, archiveButton);

  const channels = document.createElement("p");
  channels.className = "person-meta";
  channels.textContent = `Email: ${person.email || "-"} · Phone: ${person.phone || "-"}`;

  const quickUpdate = document.createElement("div");
  quickUpdate.className = "quick-update card-muted";

  const quickTitle = document.createElement("h3");
  quickTitle.textContent = "Log interaction";

  const quickDescription = document.createElement("p");
  quickDescription.className = "person-meta";
  quickDescription.textContent = "Add the latest engagement touchpoint and note.";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "field-input quick-update-date";
  dateInput.value = isoDateToday();
  dateInput.setAttribute("aria-label", `Interaction date for ${person.name}`);

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "field-input quick-update-note";
  noteInput.placeholder = "Add a concise summary of this touchpoint";
  noteInput.setAttribute("aria-label", `Interaction note for ${person.name}`);

  quickUpdate.append(quickTitle, quickDescription, dateInput, noteInput);

  const timeline = document.createElement("section");
  timeline.className = "engagement-timeline";

  const timelineHeading = document.createElement("h3");
  timelineHeading.textContent = "Engagement timeline";

  const trailList = document.createElement("ul");
  trailList.className = "contact-trail";
  if (person.contactTrail.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No contact trail yet.";
    trailList.appendChild(empty);
  } else {
    for (const entry of person.contactTrail.slice().reverse()) {
      const line = document.createElement("li");
      const entryDate = document.createElement("strong");
      entryDate.textContent = entry.date;

      const entryNote = document.createElement("span");
      entryNote.textContent = entry.note || "No note";

      line.append(entryDate, entryNote);
      trailList.appendChild(line);
    }
  }

  timeline.append(timelineHeading, trailList);

  const updatesPanel = document.createElement("section");
  updatesPanel.className = "engagement-timeline";

  const updatesHeading = document.createElement("h3");
  updatesHeading.textContent = "Person updates";

  const updatesDescription = document.createElement("p");
  updatesDescription.className = "person-meta";
  updatesDescription.textContent = "Track pending and completed stakeholder updates linked to this person.";

  const updatesToggleLabel = document.createElement("label");
  updatesToggleLabel.className = "person-meta";

  const updatesToggle = document.createElement("input");
  updatesToggle.type = "checkbox";
  updatesToggle.checked = showCompletedUpdates;
  updatesToggle.addEventListener("change", () => {
    if (typeof onToggleShowCompletedUpdates === "function") {
      onToggleShowCompletedUpdates();
    }
  });

  const updatesToggleText = document.createElement("span");
  updatesToggleText.textContent = " Show completed updates";
  updatesToggleLabel.append(updatesToggle, updatesToggleText);

  // Panel default is action-oriented (pending only). Toggling completed items gives
  // quick historical context without changing the underlying selector contract.
  const visiblePersonUpdates = personUpdates.filter(({ entry }) => showCompletedUpdates || entry.status === "pending");
  const updatesList = document.createElement("ul");
  updatesList.className = "contact-trail";

  if (visiblePersonUpdates.length === 0) {
    const emptyUpdates = document.createElement("li");
    emptyUpdates.textContent = showCompletedUpdates
      ? "No updates linked to this person yet."
      : "No pending updates for this person.";
    updatesList.appendChild(emptyUpdates);
  } else {
    for (const { update, entry } of visiblePersonUpdates) {
      const updateRow = document.createElement("li");

      const summary = document.createElement("span");
      const completedAt = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : "";
      summary.textContent = entry.status === "updated"
        ? `${update.text} · Completed ${completedAt || "recently"}`
        : update.text;

      const rowAction = document.createElement("button");
      rowAction.type = "button";
      rowAction.className = "button button-secondary";

      if (entry.status === "pending") {
        rowAction.textContent = "Mark updated";
        rowAction.addEventListener("click", () => {
          onMarkUpdateStatus({
            updateId: update.id,
            personId: person.id,
            status: "updated"
          });
        });
      } else {
        rowAction.textContent = "Undo";
        rowAction.addEventListener("click", () => {
          onMarkUpdateStatus({
            updateId: update.id,
            personId: person.id,
            status: "pending"
          });
        });
      }

      updateRow.append(summary, rowAction);
      updatesList.appendChild(updateRow);
    }
  }

  updatesPanel.append(updatesHeading, updatesDescription, updatesToggleLabel, updatesList);
  wrap.append(header, actions, channels, quickUpdate, updatesPanel, timeline);
  return wrap;
}

/**
 * Renders empty states for no contacts and no search matches.
 */
function createEmptyPeopleState({ hasFilters, onClear, onAdd }) {
  const empty = document.createElement("div");
  empty.className = "empty-state-block";

  const title = document.createElement("h3");
  title.textContent = hasFilters ? "No matching contacts" : "No contacts yet";

  const copy = document.createElement("p");
  copy.className = "empty-state";
  copy.textContent = hasFilters
    ? "Try a different search, status filter, or reset your controls."
    : "Add your first work contact to start tracking interactions and relationships.";

  const actions = document.createElement("div");
  actions.className = "empty-state-actions";

  if (hasFilters) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "button button-secondary";
    clear.textContent = "Clear search and filters";
    clear.addEventListener("click", onClear);
    actions.appendChild(clear);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "button button-primary";
  add.textContent = "Add person";
  add.addEventListener("click", onAdd);
  actions.appendChild(add);

  empty.append(title, copy, actions);
  return empty;
}

/**
 * Creates create/edit form with required MVP fields.
 */
function createPersonForm({ mode, person, onCancel, onSave }) {
  const form = document.createElement("form");
  form.className = "people-form";

  const heading = document.createElement("h2");
  heading.textContent = person ? "Edit contact" : "New contact";
  form.appendChild(heading);

  const fields = {
    name: createField("Name", "text", person?.name || "", true),
    role: createField("Role/title", "text", person?.role || ""),
    organisation: createField("Organisation", "text", person?.organisation || ""),
    relationship: createField("Relationship to work", "text", person?.relationship || ""),
    email: createField("Email", "email", person?.email || ""),
    phone: createField("Phone", "text", person?.phone || ""),
    lastContactDate: createField(
      "Last contact date",
      "date",
      person?.lastContactDate || isoDateToday()
    ),
    notes: createField("Notes", "textarea", person?.notes || "")
  };

  for (const field of Object.values(fields)) {
    form.appendChild(field.row);
  }

  const projectLinksField = document.createElement("div");
  projectLinksField.className = "field-row";

  const projectLabel = document.createElement("span");
  projectLabel.className = "field-label";
  projectLabel.textContent = "Project links and roles";

  const projects = loadProjects(mode);
  const existingLinks = person ? loadPersonProjectLinks(mode, person.id) : [];
  const linkControls = buildPersonProjectLinkControls(projects, existingLinks);

  projectLinksField.append(projectLabel, linkControls.wrap);
  form.appendChild(projectLinksField);

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ghost-button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", onCancel);

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "enter-mode-button";
  saveButton.textContent = person ? "Save changes" : "Create contact";

  actions.append(cancelButton, saveButton);
  form.appendChild(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({
      person: {
        name: fields.name.control.value.trim(),
        role: fields.role.control.value.trim(),
        organisation: fields.organisation.control.value.trim(),
        relationship: fields.relationship.control.value.trim(),
        email: fields.email.control.value.trim(),
        phone: fields.phone.control.value.trim(),
        lastContactDate: fields.lastContactDate.control.value,
        notes: fields.notes.control.value.trim()
      },
      projectLinks: linkControls.read()
    });
  });

  return form;
}

/**
 * Creates a labeled field row and control.
 */
function createField(labelText, type, value, required = false) {
  const row = document.createElement("label");
  row.className = "field-row";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = labelText;

  let control;
  if (type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 3;
  } else {
    control = document.createElement("input");
    control.type = type;
  }

  control.className = "field-input";
  control.value = value;
  control.required = required;

  row.append(label, control);
  return { row, control };
}

function buildPersonProjectLinkControls(projects, existingLinks) {
  const wrap = document.createElement("div");
  wrap.className = "project-people-role-grid";

  const controls = projects.map((project) => {
    const row = document.createElement("div");
    row.className = "project-person-role-row";

    const name = document.createElement("strong");
    name.textContent = project.title;

    const existing = existingLinks.find((link) => link.projectId === project.id);
    const roles = document.createElement("select");
    roles.className = "field-input";
    roles.multiple = true;
    roles.size = 3;

    PROJECT_PERSON_ROLES.forEach((role) => {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      option.selected = Boolean(existing?.roles.includes(role));
      roles.appendChild(option);
    });

    row.append(name, roles);
    wrap.appendChild(row);
    return { projectId: project.id, roles };
  });

  return {
    wrap,
    read() {
      return controls
        .map((entry) => ({
          projectId: entry.projectId,
          roles: Array.from(entry.roles.selectedOptions).map((option) => option.value)
        }))
        .filter((entry) => entry.roles.length > 0);
    }
  };
}

/**
 * Reconciles project links when editing people from the People module.
 */
function applyPersonProjectLinks(mode, personId, projectLinks) {
  const allProjects = loadProjects(mode);
  const selectedProjectIds = new Set(projectLinks.map((entry) => entry.projectId));

  allProjects.forEach((project) => {
    const selected = projectLinks.find((entry) => entry.projectId === project.id);
    upsertProjectPersonLink(mode, project.id, personId, selected?.roles || []);

    if (!selectedProjectIds.has(project.id)) {
      upsertProjectPersonLink(mode, project.id, personId, []);
    }
  });
}

/**
 * Queries contacts by search/filter/sort while keeping immutable source order safe.
 */
function queryPeople(state) {
  const people = loadPeople(state.mode);

  const searched = people.filter((person) => {
    const haystack = [
      person.name,
      person.role,
      person.organisation,
      person.relationship,
      person.notes,
      person.email,
      person.phone
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(state.search.toLowerCase());
  });

  const filtered = searched.filter((person) => {
    if (state.filter === "all") {
      return true;
    }

    return state.filter === "archived" ? person.archived : !person.archived;
  });

  return filtered.sort((first, second) => sortPeople(first, second, state.sort));
}

/**
 * Stores a create/update operation while preserving contact history.
 */
function savePerson(mode, payload, editingId) {
  if (!payload.name) {
    return { ok: false, error: "Name is required." };
  }

  const loaded = loadPeopleForMutation(mode);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }

  const people = loaded.people;
  const now = new Date().toISOString();

  if (editingId) {
    const index = people.findIndex((person) => person.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Unable to find selected person." };
    }

    const existing = people[index];
    const updated = {
      ...existing,
      ...payload,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        name: now,
        role: now,
        organisation: now,
        relationship: now,
        email: now,
        phone: now,
        lastContactDate: now,
        notes: now
      }
    };

    people[index] = updated;
    if (!persistPeople(mode, people)) {
      return {
        ok: false,
        error: "Unable to save contact changes because local storage is full or unavailable."
      };
    }
    return { ok: true, wasEdit: true, person: updated };
  }

  const nextPerson = {
    id: buildId(),
    ...payload,
    archived: false,
    contactTrail: payload.lastContactDate
      ? [{ date: payload.lastContactDate, note: payload.notes || "Created record" }]
      : [],
    createdAt: now,
    updatedAt: now,
    lastUpdatedByField: {
      name: now,
      role: now,
      organisation: now,
      relationship: now,
      email: now,
      phone: now,
      lastContactDate: now,
      notes: now,
      archived: now
    }
  };

  people.push(nextPerson);
  if (!persistPeople(mode, people)) {
    return {
      ok: false,
      error: "Unable to save contact because local storage is full or unavailable."
    };
  }

  return { ok: true, wasEdit: false, person: nextPerson };
}

/**
 * Archive/restore toggle to avoid destructive data loss.
 */
function archivePerson(mode, personId, archivedValue) {
  const loaded = loadPeopleForMutation(mode);
  if (!loaded.ok) {
    return loaded;
  }

  const people = loaded.people;
  const now = new Date().toISOString();

  const updated = people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    return {
      ...person,
      archived: archivedValue,
      updatedAt: now,
      lastUpdatedByField: {
        ...person.lastUpdatedByField,
        archived: now
      }
    };
  });

  if (!persistPeople(mode, updated)) {
    return {
      ok: false,
      error: "Unable to update archive status because local storage is full or unavailable."
    };
  }

  return { ok: true };
}

/**
 * Lightweight update path for common stakeholder touchpoint logging.
 */
function quickUpdateContact(mode, personId, { date, note }) {
  if (!date) {
    return { ok: false, error: "Contact date is required for quick updates." };
  }

  const loaded = loadPeopleForMutation(mode);
  if (!loaded.ok) {
    return loaded;
  }

  const people = loaded.people;
  const now = new Date().toISOString();

  const updated = people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    return {
      ...person,
      lastContactDate: date,
      notes: note || person.notes,
      updatedAt: now,
      contactTrail: [...person.contactTrail, { date, note }],
      lastUpdatedByField: {
        ...person.lastUpdatedByField,
        lastContactDate: now,
        notes: now
      }
    };
  });

  if (!persistPeople(mode, updated)) {
    return {
      ok: false,
      error: "Unable to save contact update because local storage is full or unavailable."
    };
  }

  return { ok: true };
}

/**
 * Finds an entity by ID and returns null when missing.
 */
function findPersonById(mode, id) {
  return loadPeople(mode).find((person) => person.id === id) || null;
}

/**
 * Reads and validates localStorage-backed People records.
 */
function loadPeople(mode) {
  const storageKey = `${STORAGE_KEY_PREFIX}.${mode}.v1`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  const parsed = safeJsonParse(raw, null);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map(normalisePerson);
}

/**
 * Loads people for mutating writes and blocks destructive saves when persisted data is malformed.
 */
function loadPeopleForMutation(mode) {
  const storageKey = `${STORAGE_KEY_PREFIX}.${mode}.v1`;
  const raw = localStorage.getItem(storageKey);

  if (!raw) {
    return { ok: true, people: [] };
  }

  const parsed = safeJsonParse(raw, null);
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Unable to save contacts because stored people data is unreadable. Restore from backup before editing."
    };
  }

  return { ok: true, people: parsed.map(normalisePerson) };
}

/**
 * Persists people in a single write to reduce partial-update risk.
 *
 * Recovery behavior:
 * - If the first write fails (commonly quota pressure), we opportunistically
 *   prune the oldest sync backup snapshots and retry once.
 * - This keeps user-entered contact data prioritized over stale rollback copies.
 */
function persistPeople(mode, people) {
  const storageKey = `${STORAGE_KEY_PREFIX}.${mode}.v1`;
  if (safeJsonWrite(storageKey, people)) {
    return true;
  }

  // Best-effort quota recovery: free older backup snapshots before a single retry.
  reclaimStorageFromOldBackups();
  return safeJsonWrite(storageKey, people);
}

/**
 * Removes oldest backup snapshots first to reclaim localStorage quota pressure.
 */
function reclaimStorageFromOldBackups() {
  const backupEntries = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (typeof key !== "string" || !key.startsWith(DATASET_BACKUP_PREFIX)) {
      continue;
    }

    const timestamp = key.slice(key.lastIndexOf("/") + 1);
    backupEntries.push({
      key,
      createdAtMs: Date.parse(timestamp)
    });
  }

  backupEntries
    .sort((first, second) => {
      const firstTs = Number.isNaN(first.createdAtMs) ? Number.NEGATIVE_INFINITY : first.createdAtMs;
      const secondTs = Number.isNaN(second.createdAtMs) ? Number.NEGATIVE_INFINITY : second.createdAtMs;
      return firstTs - secondTs;
    })
    .slice(0, 5)
    .forEach((entry) => localStorage.removeItem(entry.key));
}

/**
 * Ensures records remain backwards-compatible as fields evolve.
 */
function normalisePerson(person) {
  return {
    id: person.id || buildId(),
    name: person.name || "",
    role: person.role || "",
    organisation: person.organisation || "",
    relationship: person.relationship || "",
    email: person.email || "",
    phone: person.phone || "",
    lastContactDate: person.lastContactDate || "",
    notes: person.notes || "",
    archived: Boolean(person.archived),
    contactTrail: Array.isArray(person.contactTrail) ? person.contactTrail : [],
    createdAt: person.createdAt || new Date().toISOString(),
    updatedAt: person.updatedAt || new Date().toISOString(),
    lastUpdatedByField:
      typeof person.lastUpdatedByField === "object" && person.lastUpdatedByField !== null
        ? person.lastUpdatedByField
        : {}
  };
}

/**
 * Provides stable sort behaviors from a constrained enum.
 */
function sortPeople(first, second, sortMode) {
  switch (sortMode) {
    case "name-asc":
      return first.name.localeCompare(second.name);
    case "name-desc":
      return second.name.localeCompare(first.name);
    case "contact-desc":
      return (second.lastContactDate || "").localeCompare(first.lastContactDate || "");
    case "contact-asc":
      return (first.lastContactDate || "").localeCompare(second.lastContactDate || "");
    case "updated-desc":
    default:
      return (second.updatedAt || "").localeCompare(first.updatedAt || "");
  }
}

/**
 * Adds a select option element in a terse reusable way.
 */
function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

/**
 * Generates short IDs suitable for local single-user records.
 */
function buildId() {
  return generateId("person_");
}

/**
 * Returns today's date in YYYY-MM-DD format for date inputs.
 */
function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Title-case helper for placeholder module headings.
 */
function toTitleCase(input) {
  return input
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
