import { loadMeetings, renderWorkMeetingsModule } from "./meetings.js";
import { renderWorkProjectsModule } from "./projects.js";
// Cache-busted tasks module import avoids stale browser module caches after syntax hotfixes.
import { getTaskTimelineSortDate, loadTasks, markTaskCompleted, renderWorkTasksModule } from "./tasks.js?v=2026-02-18-2";
import { loadSprints, renderWorkSprintsModule } from "./sprints.js";
import {
  PROJECT_PERSON_ROLES,
  deriveNextExpectedUpdateDate,
  loadPersonProjectLinks,
  loadProjects,
  upsertProjectPersonLink
} from "./projects-store.js";
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
    return renderWorkTasksModule({
      mode,
      openComposer: uiContext.quickAction?.moduleKey === "tasks" && uiContext.quickAction?.createIntent === "task",
      draftProjectId: uiContext.taskPrefillProjectId || ""
    });
  }

  if (mode === "work" && activeModule === "projects") {
    return renderWorkProjectsModule({
      mode,
      people: loadPeople("work"),
      meetings: loadMeetings("work"),
      openComposer: uiContext.quickAction?.moduleKey === "projects" && uiContext.quickAction?.createIntent === "project",
      onNavigate: uiContext.onNavigate
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
      meetings: loadMeetings("work"),
      focusCreateForm: uiContext.quickAction?.moduleKey === "updates" && uiContext.quickAction?.createIntent === "update"
    });
  }

  if (mode === "personal" && activeModule === "tasks") {
    return renderPersonalTasksModule({
      focusCreateForm: uiContext.quickAction?.moduleKey === "tasks" && uiContext.quickAction?.createIntent === "task"
    });
  }

  if (mode === "personal" && activeModule === "projects") {
    return renderPersonalProjectsModule({
      focusCreateForm: uiContext.quickAction?.moduleKey === "projects" && uiContext.quickAction?.createIntent === "project"
    });
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
    return renderPersonalCalendarModule({
      focusCreateForm:
        uiContext.quickAction?.moduleKey === "calendar" && uiContext.quickAction?.createIntent === "calendar-event"
    });
  }


  if (["work", "personal"].includes(mode) && activeModule === "notes") {
    return renderNotesModule({
      mode,
      openComposer: uiContext.quickAction?.moduleKey === "notes" && uiContext.quickAction?.createIntent === "note"
    });
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
  const renderContent = () => {
    section.innerHTML = "";

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
        const firstTimelineDate = getTaskTimelineSortDate(first);
        const secondTimelineDate = getTaskTimelineSortDate(second);
        if (firstTimelineDate !== secondTimelineDate) {
          return firstTimelineDate.localeCompare(secondTimelineDate);
        }
        return (second.impact - second.effort) - (first.impact - first.effort);
      })
      .slice(0, 5);

    const activeProjects = projects.filter((project) => !["completed", "cancelled", "archived"].includes(String(project.status).toLowerCase()));
    const atRiskProjects = selectProjectsNeedingAttention(activeProjects, today).slice(0, 4);
    const pendingUpdates = updates
      .filter((update) => update.lifecycle === "active")
      .reduce((count, update) => count + update.toUpdate.filter((item) => item.status === "pending").length, 0);
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
      renderRow: (meeting) => createOverviewInlineRow(meeting.name || "Untitled meeting", [
        createOverviewChip(meeting.startTime || "Any time", "neutral"),
        createOverviewChip(toTitleCase(meeting.status || "scheduled"), resolveStatusChipTone(meeting.status))
      ]),
      onItemClick: (meeting) =>
        navigateFromDashboard(uiContext, {
          moduleKey: "meetings",
          focus: { meetingId: meeting.id }
        }),
      footerAction: createFooterAction("View all meetings", () => navigateFromDashboard(uiContext, { moduleKey: "meetings" }))
    }),
    createOverviewListCard({
      title: "Priority tasks",
      description: "Sorted by scheduled date first, then due date and impact.",
      emptyText: "No active tasks to triage.",
      items: focusTasks,
      renderRow: (task) => createOverviewInlineRow(task.title || "Untitled task", [
        createOverviewChip(resolveTaskDateChipLabel(task), resolveTaskDateChipTone(task, today)),
        createOverviewChip(toTitleCase(task.status || "to do"), resolveStatusChipTone(task.status))
      ]),
      getRowActions: (task) => [
        createOverviewItemAction("✓ Done", () => {
          markTaskCompleted("work", task.id);
          renderContent();
        }, `Mark \"${task.title || "Untitled task"}\" complete`)
      ],
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }),
      footerAction: createFooterAction("Open task board", () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }))
    }),
    createOverviewListCard({
      title: "Projects needing attention",
      description: "Overdue cadence check-ins, with target-date fallback for legacy records.",
      emptyText: "No active projects currently overdue.",
      items: atRiskProjects,
      renderRow: (project) => {
        const nextExpectedDate = deriveNextExpectedUpdateDate(project);
        return createOverviewInlineRow(project.title || "Untitled project", [
          createOverviewChip(nextExpectedDate ? `Update overdue ${nextExpectedDate}` : `Target ${project.targetDate || "n/a"}`, "danger"),
          createOverviewChip(toTitleCase(project.status || "active"), resolveStatusChipTone(project.status))
        ]);
      },
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
      renderRow: (person) => {
        const pendingCount = selectUpdatesForPerson(updates, person.id).length;
        return createOverviewInlineRow(person.name || "Unnamed person", [
          createOverviewChip(`${pendingCount} pending`, "warning"),
          createOverviewChip(`${(person.projectIds || []).length} projects`, "info")
        ]);
      },
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "updates" }),
      footerAction: createFooterAction("Open updates", () => navigateFromDashboard(uiContext, { moduleKey: "updates" }))
    })
  );

    section.append(title, intro, metrics, trends, grid);
  };

  renderContent();
  return section;
}


/**
 * Selects active projects that are overdue for a progress update cadence.
 */
export function selectProjectsNeedingAttention(projects, todayIsoDate = isoDateToday()) {
  return projects.filter((project) => {
    const nextExpectedDate = deriveNextExpectedUpdateDate(project);
    if (nextExpectedDate) {
      return nextExpectedDate < todayIsoDate;
    }

    // Fallback for migration-era records with no cadence baseline:
    // target date still acts as an attention signal until cadence is captured.
    return Boolean(project.targetDate) && project.targetDate < todayIsoDate;
  });
}

/**
 * Builds a compact dashboard label that explains why a project is at risk.
 */
export function formatProjectAttentionLabel(project) {
  const nextExpectedDate = deriveNextExpectedUpdateDate(project);
  if (nextExpectedDate) {
    return `${project.title || "Untitled project"} · update overdue since ${nextExpectedDate}`;
  }
  return `${project.title || "Untitled project"} · target ${project.targetDate || "n/a"}`;
}

/**
 * Builds a personal-mode dashboard that keeps key routines visible in one view.
 */
function renderPersonalOverviewDashboard(uiContext = {}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard overview-dashboard";
  const renderContent = () => {
    section.innerHTML = "";

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
      renderRow: (task) => createOverviewInlineRow(task.title || "Untitled task", [
        createOverviewChip(toTitleCase(task.status || "to do"), resolveStatusChipTone(task.status)),
        createOverviewChip(task.recurrenceMeta ? `Repeats ${task.recurrenceMeta.frequency}/${task.recurrenceMeta.interval}` : "One-off", "neutral")
      ]),
      getRowActions: (task) => [
        createOverviewItemAction("✓ Done", () => {
          markTaskCompleted("personal", task.id);
          renderContent();
        }, `Mark \"${task.title || "Untitled task"}\" complete`)
      ],
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }),
      footerAction: createFooterAction("Open tasks", () => navigateFromDashboard(uiContext, { moduleKey: "tasks" }))
    }),
    createOverviewListCard({
      title: "Upcoming calendar",
      description: "Next personal events.",
      emptyText: "No upcoming calendar entries.",
      items: upcomingEvents,
      renderRow: (event) => createOverviewInlineRow(event.title || "Untitled event", [
        createOverviewChip(event.date || "No date", "info"),
        createOverviewChip(event.recurrenceMeta ? `Repeats ${event.recurrenceMeta.frequency}/${event.recurrenceMeta.interval}` : "One-off", "neutral")
      ]),
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "calendar" }),
      footerAction: createFooterAction("Open calendar", () => navigateFromDashboard(uiContext, { moduleKey: "calendar" }))
    }),
    createOverviewListCard({
      title: "Projects in motion",
      description: "Current personal projects/timeboxes.",
      emptyText: "No active personal projects.",
      items: activeProjects,
      renderRow: (project) => createOverviewInlineRow(project.name || "Untitled project", [
        createOverviewChip(`Target ${project.targetDate || "not set"}`, project.targetDate && project.targetDate < today ? "danger" : "info"),
        createOverviewChip(`${(project.tasks || []).length} linked`, "neutral")
      ]),
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "projects" }),
      footerAction: createFooterAction("Open projects", () => navigateFromDashboard(uiContext, { moduleKey: "projects" }))
    }),
    createOverviewListCard({
      title: "Health check",
      description: "Recent daily logs and exercise momentum.",
      emptyText: "No daily logs available yet.",
      items: dailyLogs.slice(0, 4),
      renderRow: (entry) => createOverviewInlineRow(entry.date || "No date", [
        createOverviewChip(`Mood ${entry.mood || "-"}`, resolveMoodChipTone(entry.mood)),
        createOverviewChip(entry.sleepHours ? `${entry.sleepHours}h sleep` : "No sleep log", "neutral")
      ]),
      onItemClick: () => navigateFromDashboard(uiContext, { moduleKey: "daily-log" }),
      footerAction: createFooterAction("Open daily log", () => navigateFromDashboard(uiContext, { moduleKey: "daily-log" }))
    })
  );

    section.append(title, intro, metrics, trends, grid);
  };

  renderContent();
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

  // Animate numeric values to improve first-load legibility without changing
  // any metric semantics or introducing asynchronous data dependencies.
  const numericValue = Number.parseInt(value, 10);
  if (!Number.isNaN(numericValue)) {
    animateMetricValue(metricValue, numericValue);
  }

  button.append(heading, metricValue);
  return button;
}

/**
 * Performs a lightweight count-up animation for dashboard KPI values.
 */
function animateMetricValue(element, targetValue) {
  const durationMs = 520;
  const start = performance.now();

  const tick = (now) => {
    const progress = Math.min((now - start) / durationMs, 1);
    // Ease-out cubic keeps movement snappy up-front while settling smoothly.
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = String(Math.round(targetValue * eased));

    if (progress < 1) {
      window.requestAnimationFrame(tick);
    }
  };

  window.requestAnimationFrame(tick);
}

/**
 * Builds a reusable list card pattern for overview dashboards.
 */
function createOverviewListCard({
  title,
  description,
  emptyText,
  items,
  getLabel,
  renderRow,
  onItemClick,
  footerAction,
  getRowActions
}) {
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
    const rowWrap = document.createElement("div");
    rowWrap.className = "overview-list-row";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "overview-list-item";
    // Preserve legacy text rendering for cards that only provide `getLabel`,
    // while enabling richer structured rows through `renderRow`.
    const renderedRowContent = typeof renderRow === "function" ? renderRow(item) : null;
    if (renderedRowContent) {
      row.appendChild(renderedRowContent);
    } else {
      row.textContent = typeof getLabel === "function" ? getLabel(item) : "";
    }
    row.addEventListener("click", () => onItemClick(item));
    rowWrap.appendChild(row);

    const rowActions = typeof getRowActions === "function" ? getRowActions(item) : [];
    if (rowActions.length) {
      const actions = document.createElement("div");
      actions.className = "overview-list-item-actions";
      rowActions.forEach((action) => actions.appendChild(action));
      rowWrap.appendChild(actions);
    }

    list.appendChild(rowWrap);
  }

  card.append(heading, copy, list);
  if (footerAction) {
    card.appendChild(footerAction);
  }

  return card;
}

/**
 * Builds a row label + chip stack for overview buttons without changing button semantics.
 */
function createOverviewInlineRow(label, chipNodes = []) {
  const wrapper = document.createElement("span");
  wrapper.className = "overview-inline-row";

  const title = document.createElement("span");
  title.className = "overview-inline-row-title";
  title.textContent = label;

  const chips = document.createElement("span");
  chips.className = "overview-inline-chips";
  chipNodes.forEach((chip) => chips.appendChild(chip));

  wrapper.append(title, chips);
  return wrapper;
}

/**
 * Creates a compact semantic chip used in overview list rows.
 */
function createOverviewChip(label, tone = "neutral") {
  const chip = document.createElement("span");
  chip.className = `overview-chip overview-chip-${tone}`;
  chip.textContent = label;
  return chip;
}

/**
 * Maps free-form status values into consistent chip tones.
 */
function resolveStatusChipTone(status) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (["done", "completed", "updated", "on-track", "active"].includes(normalizedStatus)) {
    return "success";
  }
  if (["blocked", "cancelled", "missed", "overdue"].includes(normalizedStatus)) {
    return "danger";
  }
  if (["pending", "at-risk", "rescheduled"].includes(normalizedStatus)) {
    return "warning";
  }
  return "info";
}

/**
 * Encodes due/schedule information for priority task chips.
 */
function resolveTaskDateChipLabel(task) {
  if (task.scheduleDate && task.dueDate) {
    return `Sched ${task.scheduleDate} • Due ${task.dueDate}`;
  }
  if (task.scheduleDate) {
    return `Sched ${task.scheduleDate}`;
  }
  if (task.dueDate) {
    return `Due ${task.dueDate}`;
  }
  return "No dates";
}

/**
 * Uses today + task timeline fields to assign urgency chip tone.
 */
function resolveTaskDateChipTone(task, today) {
  if (task.dueDate && task.dueDate < today) {
    return "danger";
  }
  if (task.dueDate === today || task.scheduleDate === today) {
    return "warning";
  }
  if (task.dueDate || task.scheduleDate) {
    return "info";
  }
  return "neutral";
}

/**
 * Normalizes mood entries to a simple positive/neutral/negative chip palette.
 */
function resolveMoodChipTone(moodValue) {
  const numericMood = Number(moodValue);
  if (Number.isFinite(numericMood)) {
    if (numericMood >= 7) {
      return "success";
    }
    if (numericMood <= 4) {
      return "danger";
    }
    return "warning";
  }
  return "neutral";
}

/**
 * Creates an inline action button for overview list rows while preserving row click navigation.
 */
function createOverviewItemAction(label, onClick, ariaLabel = label) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "overview-list-item-action";
  action.textContent = label;
  action.setAttribute("aria-label", ariaLabel);
  action.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return action;
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
  addOption(sort, "needs-attention", "Needs attention");
  addOption(sort, "name-asc", "Name A → Z");
  addOption(sort, "contact-desc", "Recently contacted");
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
    state.sort = "needs-attention";
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
      createMetricChip("Archived", counts.archived),
      createMetricChip("Overdue", counts.overdue),
      createMetricChip("Due soon", counts.due)
    );

    message.textContent = state.feedback || `Showing ${result.length} contact(s).`;

    search.value = state.search;
    filter.value = state.filter;
    sort.value = state.sort;

    const hasActiveFilters = state.search.trim() || state.filter !== "active" || state.sort !== "needs-attention";
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
          state.sort = "needs-attention";
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
              state.selectedTab = "overview";
              state.interactionFormOpen = false;
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

    const personProjectLinks = selectedPerson
      ? loadPersonProjectLinks(state.mode, selectedPerson.id).map((link) => {
          const project = loadProjects(state.mode).find((entry) => entry.id === link.projectId);
          return { ...link, projectTitle: project?.title || link.projectId };
        })
      : [];
    const personMeetings = selectedPerson
      ? loadMeetings(state.mode).filter((meeting) => (meeting.attendeeIds || []).includes(selectedPerson.id))
      : [];

    detailPanel.appendChild(
      createPersonDetailsPanel(selectedPerson, {
        selectedTab: state.selectedTab,
        interactionFormOpen: state.interactionFormOpen,
        showCompletedUpdates: state.showCompletedUpdates,
        personUpdates: selectedPerson ? selectUpdatesForPerson(updates, selectedPerson.id, { includeCompleted: true }) : [],
        meetings: personMeetings,
        projectLinks: personProjectLinks,
        onSelectTab: (tab) => {
          state.selectedTab = tab;
          renderPeopleModule();
        },
        onToggleInteractionForm: () => {
          state.interactionFormOpen = !state.interactionFormOpen;
          renderPeopleModule();
        },
        onSaveInteraction: (payload) => {
          const updateResult = logPersonInteraction(state.mode, selectedPerson.id, payload);
          if (updateResult.ok) {
            state.feedback = `Logged interaction for ${selectedPerson.name}.`;
            state.interactionFormOpen = false;
            setToast("Interaction logged successfully.");
          } else {
            state.feedback = updateResult.error;
          }
          renderPeopleModule();
        },
        onUpdateInteraction: ({ interactionId, payload }) => {
          const updateResult = updatePersonInteraction(state.mode, selectedPerson.id, interactionId, payload);
          state.feedback = updateResult.ok ? `Updated interaction for ${selectedPerson.name}.` : updateResult.error;
          renderPeopleModule();
        },
        onArchiveInteraction: (interactionId) => {
          const updateResult = archivePersonInteraction(state.mode, selectedPerson.id, interactionId);
          state.feedback = updateResult.ok ? `Archived interaction for ${selectedPerson.name}.` : updateResult.error;
          renderPeopleModule();
        },
        onSaveCadence: ({ cadenceInterval, cadenceUnit }) => {
          const saveResult = savePersonCadence(state.mode, selectedPerson.id, cadenceInterval, cadenceUnit);
          state.feedback = saveResult.ok ? `Updated cadence for ${selectedPerson.name}.` : saveResult.error;
          renderPeopleModule();
        },
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
    // People now default to action-oriented sorting so overdue stakeholders surface first.
    sort: "needs-attention",
    isFormOpen: false,
    editingId: null,
    selectedPersonId: null,
    selectedTab: "overview",
    interactionFormOpen: false,
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
  const attentionCounts = people.reduce(
    (acc, person) => {
      if (person.relationshipHealth === "overdue") {
        acc.overdue += 1;
      } else if (person.relationshipHealth === "due") {
        acc.due += 1;
      }
      return acc;
    },
    { overdue: 0, due: 0 }
  );
  return {
    total: people.length,
    archived,
    active: people.length - archived,
    overdue: attentionCounts.overdue,
    due: attentionCounts.due
  };
}

/**
 * Human-readable relationship health copy used in both list cards and detail panes.
 */
function describeRelationshipHealth(person) {
  if (!person.cadenceInterval || !person.cadenceUnit || !person.lastContactAt || !person.nextContactDueAt) {
    return { tone: "unknown", text: "Cadence not set" };
  }

  const now = Date.now();
  const dueMs = Date.parse(person.nextContactDueAt);
  const deltaDays = Math.ceil(Math.abs(dueMs - now) / 86400000);

  if (person.relationshipHealth === "overdue") {
    return { tone: "overdue", text: `Overdue ${deltaDays}d` };
  }

  if (person.relationshipHealth === "due") {
    return { tone: "due", text: `Due in ${deltaDays}d` };
  }

  return { tone: "on-track", text: "On track" };
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

  const type = document.createElement("span");
  type.className = "status-badge";
  type.textContent = person.personType || (person.archived ? "Archived" : "Unclassified");

  const orgRole = document.createElement("p");
  orgRole.className = "person-meta";
  orgRole.textContent = `${person.organisation || "No organisation"} · ${person.role || "No role"}`;

  const health = describeRelationshipHealth(person);
  const healthMeta = document.createElement("p");
  healthMeta.className = `person-meta health-${health.tone}`;
  healthMeta.textContent = health.text;

  const badges = document.createElement("p");
  badges.className = "person-meta";
  badges.textContent = `Pending updates: ${person.pendingUpdatesCount || 0} · Active projects: ${person.activeProjectsCount || 0}`;

  header.append(name, type);
  button.append(header, orgRole, healthMeta, badges);
  item.appendChild(button);
  return item;
}


/**
 * Renders right-side details view for selected person.
 */
function createPersonDetailsPanel(
  person,
  {
    selectedTab = "overview",
    interactionFormOpen = false,
    showCompletedUpdates = false,
    personUpdates = [],
    meetings = [],
    projectLinks = [],
    onSelectTab,
    onToggleInteractionForm,
    onSaveInteraction,
    onUpdateInteraction,
    onArchiveInteraction,
    onSaveCadence,
    onToggleShowCompletedUpdates,
    onMarkUpdateStatus,
    onEdit,
    onArchiveToggle,
    onScheduleOneOnOne
  }
) {
  if (!person) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Select a contact to review details and log interactions.";
    return empty;
  }

  const healthSummary = describeRelationshipHealth(person);
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
  identity.append(name, meta, relationship);

  const healthCard = document.createElement("div");
  healthCard.className = "card-muted person-health-widget";
  const healthPill = document.createElement("span");
  healthPill.className = `status-badge ${healthSummary.tone}`;
  healthPill.textContent = healthSummary.text;
  const healthMeta = document.createElement("p");
  healthMeta.className = "person-meta";
  healthMeta.textContent = `Last: ${formatDateTime(person.lastContactAt)} · Next due: ${formatDateTime(person.nextContactDueAt)}`;

  const cadenceForm = document.createElement("div");
  cadenceForm.className = "person-cadence-inline";
  const cadenceInterval = document.createElement("input");
  cadenceInterval.type = "number";
  cadenceInterval.min = "1";
  cadenceInterval.className = "field-input";
  cadenceInterval.placeholder = "Interval";
  cadenceInterval.value = person.cadenceInterval || "";
  const cadenceUnit = document.createElement("select");
  cadenceUnit.className = "field-input";
  addOption(cadenceUnit, "", "Unit");
  addOption(cadenceUnit, "weeks", "Weeks");
  addOption(cadenceUnit, "months", "Months");
  cadenceUnit.value = person.cadenceUnit || "";
  const cadenceSave = document.createElement("button");
  cadenceSave.type = "button";
  cadenceSave.className = "button button-secondary";
  cadenceSave.textContent = "Save cadence";
  cadenceSave.addEventListener("click", () => onSaveCadence({
    cadenceInterval: cadenceInterval.value,
    cadenceUnit: cadenceUnit.value
  }));
  cadenceForm.append(cadenceInterval, cadenceUnit, cadenceSave);
  healthCard.append(healthPill, healthMeta, cadenceForm);

  const actions = document.createElement("div");
  actions.className = "person-actions";
  [["Schedule 1:1", "button-secondary", () => onScheduleOneOnOne(person)], ["Edit", "button-secondary", onEdit], [person.archived ? "Restore" : "Archive", "button-danger-subtle", onArchiveToggle]].forEach(([label, klass, handler]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${klass}`;
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.appendChild(button);
  });

  header.append(identity, healthCard, actions);

  const tabs = document.createElement("div");
  tabs.className = "people-tabs";
  const tabItems = [
    ["overview", "Overview"],
    ["interactions", "Interactions"],
    ["updates", "Updates"],
    ["projects", "Projects & roles"],
    ["meetings", "Meetings"]
  ];
  tabItems.forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${selectedTab === value ? "button-primary" : "button-secondary"}`;
    button.textContent = label;
    button.addEventListener("click", () => onSelectTab(value));
    tabs.appendChild(button);
  });

  const content = document.createElement("section");
  content.className = "card-muted";

  if (selectedTab === "overview") {
    const summary = document.createElement("p");
    summary.className = "person-meta";
    summary.textContent = `Type: ${person.personType || "Not set"} · Email: ${person.email || "-"} · Phone: ${person.phone || "-"}`;
    const notes = document.createElement("p");
    notes.className = "person-note";
    notes.textContent = person.notes || "No notes added.";
    content.append(summary, notes);
  }

  if (selectedTab === "interactions") {
    const cardHeader = document.createElement("div");
    cardHeader.className = "people-list-item-head";
    const title = document.createElement("h3");
    title.textContent = "Interactions";
    const summary = document.createElement("p");
    summary.className = "person-meta";
    summary.textContent = `Last contact ${formatDistanceFromNow(person.lastContactAt)} • ${healthSummary.text}`;
    const logButton = document.createElement("button");
    logButton.type = "button";
    logButton.className = "button button-primary";
    logButton.textContent = interactionFormOpen ? "Cancel" : "Log interaction";
    logButton.addEventListener("click", onToggleInteractionForm);
    cardHeader.append(title, logButton);
    content.append(cardHeader, summary);

    if (interactionFormOpen) {
      const form = document.createElement("form");
      form.className = "quick-update interactions-composer";
      const occurredAt = createField("Occurred at", "datetime-local", toDateTimeLocalValue(new Date().toISOString()));
      const typeField = document.createElement("label");
      typeField.className = "field-row";
      const typeLabel = document.createElement("span");
      typeLabel.className = "field-label";
      typeLabel.textContent = "Type";
      const typeControl = document.createElement("select");
      typeControl.className = "field-input";
      ["chat", "call", "email", "meeting", "teams", "other"].forEach((value) => addOption(typeControl, value, value));
      const note = createField("Notes", "textarea", "");
      note.control.rows = 4;
      const duration = createField("Duration (minutes)", "number", "", false);
      duration.control.min = "0";
      const tags = createField("Tags (comma separated)", "text", "");
      const linkedMeeting = createField("Linked meeting", "text", "", false);
      const meetingsList = document.createElement("datalist");
      meetingsList.id = `interaction-linked-meeting-${person.id}`;
      meetings
        .slice()
        .sort((first, second) => (second.date || "").localeCompare(first.date || ""))
        .forEach((meeting) => {
          const option = document.createElement("option");
          option.value = meeting.id;
          option.label = `${meeting.title || "Untitled meeting"} • ${meeting.date || "No date"}`;
          meetingsList.appendChild(option);
        });
      linkedMeeting.control.setAttribute("list", meetingsList.id);
      linkedMeeting.control.placeholder = meetings.length
        ? "Search by linked meeting ID"
        : "No meetings available to link";

      const rowGroup = document.createElement("div");
      rowGroup.className = "interactions-composer-grid";
      rowGroup.append(occurredAt.row, typeField, duration.row, tags.row, linkedMeeting.row);

      const formActions = document.createElement("div");
      formActions.className = "interactions-composer-actions";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "button button-primary";
      submit.textContent = "Save interaction";
      const clear = document.createElement("button");
      clear.type = "reset";
      clear.className = "button button-secondary";
      clear.textContent = "Clear";
      formActions.append(submit, clear);

      form.append(note.row, rowGroup, formActions, meetingsList);
      typeField.append(typeLabel, typeControl);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        onSaveInteraction({
          occurredAt: occurredAt.control.value,
          type: typeControl.value,
          note: note.control.value.trim(),
          durationMinutes: duration.control.value,
          tags: tags.control.value,
          linkedMeetingId: linkedMeeting.control.value.trim()
        });
      });
      content.appendChild(form);
    }

    const timeline = document.createElement("ul");
    timeline.className = "contact-trail interaction-timeline";
    const visibleInteractions = person.interactions.filter((entry) => !entry.archivedAt);
    if (!visibleInteractions.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "No interactions yet.";
      const hint = document.createElement("small");
      hint.className = "person-meta";
      hint.textContent = "Log a quick interaction to start the timeline.";
      empty.appendChild(hint);
      timeline.appendChild(empty);
    } else {
      visibleInteractions
        .slice()
        .sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || ""))
        .forEach((entry) => {
        const row = document.createElement("li");
        row.className = "interaction-timeline-entry";
        const top = document.createElement("div");
        top.className = "interaction-timeline-head";

        const badge = document.createElement("span");
        badge.className = "status-badge";
        badge.textContent = entry.type;

        const timestamp = document.createElement("span");
        timestamp.className = "person-meta";
        timestamp.textContent = formatDateTime(entry.occurredAt);

        const actionsMenu = document.createElement("details");
        actionsMenu.className = "task-row-menu interaction-row-menu";
        const summaryMenu = document.createElement("summary");
        summaryMenu.setAttribute("aria-label", "Interaction actions");
        summaryMenu.textContent = "⋯";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "secondary-button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => {
          actionsMenu.open = false;
          onUpdateInteraction({
            interactionId: entry.id,
            payload: {
              occurredAt: entry.occurredAt,
              type: entry.type,
              note: window.prompt("Edit interaction note", entry.note || "") ?? entry.note,
              durationMinutes: entry.durationMinutes,
              tags: entry.tags,
              linkedMeetingId: entry.linkedMeetingId
            }
          });
        });
        const archive = document.createElement("button");
        archive.type = "button";
        archive.className = "secondary-button";
        archive.textContent = "Archive";
        archive.addEventListener("click", () => {
          actionsMenu.open = false;
          onArchiveInteraction(entry.id);
        });
        actionsMenu.append(summaryMenu, edit, archive);
        top.append(badge, timestamp, actionsMenu);

        const notePreview = document.createElement("span");
        notePreview.className = "interaction-timeline-note";
        notePreview.textContent = entry.note || "No note added.";

        const meta = document.createElement("span");
        meta.className = "person-meta";
        meta.textContent = [
          entry.durationMinutes ? `${entry.durationMinutes} min` : "",
          Array.isArray(entry.tags) && entry.tags.length ? `Tags: ${entry.tags.join(", ")}` : "",
          entry.linkedMeetingId ? `Meeting: ${entry.linkedMeetingId}` : ""
        ]
          .filter(Boolean)
          .join(" · ");

        row.append(top, notePreview);
        if (meta.textContent) {
          row.appendChild(meta);
        }
        timeline.appendChild(row);
      });
    }
    content.appendChild(timeline);
  }

  if (selectedTab === "updates") {
    const link = document.createElement("a");
    link.href = "#";
    link.className = "person-meta";
    link.textContent = "View in Updates module";
    const updatesToggleLabel = document.createElement("label");
    updatesToggleLabel.className = "person-meta";
    const updatesToggle = document.createElement("input");
    updatesToggle.type = "checkbox";
    updatesToggle.checked = showCompletedUpdates;
    updatesToggle.addEventListener("change", onToggleShowCompletedUpdates);
    updatesToggleLabel.append(updatesToggle, document.createTextNode(" Show completed"));
    const updatesList = document.createElement("ul");
    updatesList.className = "contact-trail";
    const visible = personUpdates.filter(({ entry }) => showCompletedUpdates || entry.status === "pending");
    if (!visible.length) {
      const empty = document.createElement("li");
      empty.textContent = "No updates for this person.";
      updatesList.appendChild(empty);
    } else {
      visible.forEach(({ update, entry }) => {
        const row = document.createElement("li");
        const dueText = update.dueDate ? ` · Due ${update.dueDate}` : "";
        const summary = document.createElement("span");
        summary.textContent = `${update.type || "update"}: ${update.text}${dueText}`;
        const action = document.createElement("button");
        action.type = "button";
        action.className = "button button-secondary";
        action.textContent = entry.status === "pending" ? "Mark complete" : "Undo";
        action.addEventListener("click", () => onMarkUpdateStatus({ updateId: update.id, personId: person.id, status: entry.status === "pending" ? "updated" : "pending" }));
        row.append(summary, action);
        updatesList.appendChild(row);
      });
    }
    content.append(link, updatesToggleLabel, updatesList);
  }

  if (selectedTab === "projects") {
    const list = document.createElement("ul");
    list.className = "contact-trail";
    if (!projectLinks.length) {
      const empty = document.createElement("li");
      empty.textContent = "No project roles linked yet.";
      list.appendChild(empty);
    } else {
      projectLinks.forEach((link) => {
        const row = document.createElement("li");
        row.textContent = `${link.projectTitle} · ${link.roles.join(", ") || "No role"}`;
        list.appendChild(row);
      });
    }
    content.appendChild(list);
  }

  if (selectedTab === "meetings") {
    const list = document.createElement("ul");
    list.className = "contact-trail";
    if (!meetings.length) {
      const empty = document.createElement("li");
      empty.textContent = "No meetings linked to this person.";
      list.appendChild(empty);
    } else {
      meetings.forEach((meeting) => {
        const row = document.createElement("li");
        row.textContent = `${meeting.date || "No date"} · ${meeting.title || "Untitled meeting"}`;
        list.appendChild(row);
      });
    }
    content.appendChild(list);
  }

  wrap.append(header, tabs, content);
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
  const overlay = document.createElement("div");
  overlay.className = "task-drawer-overlay people-form-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      onCancel();
    }
  });

  const form = document.createElement("form");
  form.className = "people-form task-drawer project-editor-drawer";

  const header = document.createElement("header");
  header.className = "task-drawer-header";

  const heading = document.createElement("h2");
  heading.textContent = person ? "Edit contact" : "New contact";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "ghost-button project-icon-button";
  closeButton.textContent = "✕";
  closeButton.setAttribute("aria-label", "Close contact form");
  closeButton.addEventListener("click", onCancel);
  header.append(heading, closeButton);
  form.appendChild(header);

  const body = document.createElement("div");
  body.className = "task-drawer-body";

  const fields = {
    name: createField("Name", "text", person?.name || "", true),
    organisation: createField("Organisation", "text", person?.organisation || ""),
    role: createField("Job role", "text", person?.role || ""),
    relationship: createField("Relationship", "text", person?.relationship || "")
  };

  const personTypeRow = document.createElement("label");
  personTypeRow.className = "field-row";
  const personTypeLabel = document.createElement("span");
  personTypeLabel.className = "field-label";
  personTypeLabel.textContent = "Person type";
  const personTypeControl = document.createElement("select");
  personTypeControl.className = "field-input";
  addOption(personTypeControl, "", "Not set");
  addOption(personTypeControl, "internal", "Internal");
  addOption(personTypeControl, "external", "External");
  personTypeControl.value = person?.personType || "";
  personTypeRow.append(personTypeLabel, personTypeControl);

  for (const field of Object.values(fields)) {
    body.appendChild(field.row);
  }
  body.appendChild(personTypeRow);

  const governance = document.createElement("details");
  const governanceSummary = document.createElement("summary");
  governanceSummary.textContent = "Governance";
  governance.appendChild(governanceSummary);
  const cadenceInterval = createField("Cadence interval", "number", person?.cadenceInterval || "");
  cadenceInterval.control.min = "1";
  const cadenceUnitRow = document.createElement("label");
  cadenceUnitRow.className = "field-row";
  const cadenceUnitLabel = document.createElement("span");
  cadenceUnitLabel.className = "field-label";
  cadenceUnitLabel.textContent = "Cadence unit";
  const cadenceUnit = document.createElement("select");
  cadenceUnit.className = "field-input";
  addOption(cadenceUnit, "", "Not set");
  addOption(cadenceUnit, "weeks", "Weeks");
  addOption(cadenceUnit, "months", "Months");
  cadenceUnit.value = person?.cadenceUnit || "";
  cadenceUnitRow.append(cadenceUnitLabel, cadenceUnit);
  governance.append(cadenceInterval.row, cadenceUnitRow);
  body.appendChild(governance);

  const projectsSection = document.createElement("details");
  const projectsSummary = document.createElement("summary");
  projectsSummary.textContent = "Projects & roles";
  projectsSection.appendChild(projectsSummary);
  const projects = loadProjects(mode);
  const existingLinks = person ? loadPersonProjectLinks(mode, person.id) : [];
  const linkControls = buildPersonProjectLinkControls(projects, existingLinks);
  projectsSection.appendChild(linkControls.wrap);
  body.appendChild(projectsSection);

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
  body.appendChild(actions);
  form.appendChild(body);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave({
      person: {
        name: fields.name.control.value.trim(),
        organisation: fields.organisation.control.value.trim(),
        role: fields.role.control.value.trim(),
        relationship: fields.relationship.control.value.trim(),
        personType: personTypeControl.value || null,
        cadenceInterval: cadenceInterval.control.value ? Number(cadenceInterval.control.value) : null,
        cadenceUnit: cadenceUnit.value || null
      },
      projectLinks: linkControls.read()
    });
  });

  overlay.appendChild(form);
  return overlay;
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
  const projects = loadProjects(state.mode);
  const updates = loadUpdates(state.mode);

  const searched = people.filter((person) => {
    const haystack = [
      person.name,
      person.role,
      person.organisation,
      person.relationship,
      person.notes,
      person.email,
      person.phone,
      person.personType
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

  return filtered
    .map((person) => ({
      ...person,
      pendingUpdatesCount: selectUpdatesForPerson(updates, person.id).length,
      activeProjectsCount: projects.filter(
        (project) => !project.archived && Array.isArray(project.people) && project.people.some((entry) => entry.personId === person.id)
      ).length
    }))
    .sort((first, second) => sortPeople(first, second, state.sort));
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
    const updated = computePersonCadence({
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
        cadenceInterval: now,
        cadenceUnit: now,
        personType: now,
        notes: now
      }
    });

    people[index] = updated;
    if (!persistPeople(mode, people)) {
      return {
        ok: false,
        error: "Unable to save contact changes because local storage is full or unavailable."
      };
    }
    return { ok: true, wasEdit: true, person: updated };
  }

  const nextPerson = computePersonCadence({
    id: buildId(),
    ...payload,
    archived: false,
    contactTrail: [],
    interactions: [],
    createdAt: now,
    updatedAt: now,
    lastUpdatedByField: {
      name: now,
      role: now,
      organisation: now,
      relationship: now,
      email: now,
      phone: now,
      cadenceInterval: now,
      cadenceUnit: now,
      personType: now,
      notes: now,
      archived: now
    }
  });

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
function savePersonCadence(mode, personId, cadenceInterval, cadenceUnit) {
  const loaded = loadPeopleForMutation(mode);
  if (!loaded.ok) {
    return loaded;
  }

  const intervalValue = cadenceInterval ? Number(cadenceInterval) : null;
  if (intervalValue !== null && (!Number.isFinite(intervalValue) || intervalValue <= 0)) {
    return { ok: false, error: "Cadence interval must be a positive number." };
  }

  const now = new Date().toISOString();
  const updated = loaded.people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    return computePersonCadence({
      ...person,
      cadenceInterval: intervalValue,
      cadenceUnit: cadenceUnit || null,
      updatedAt: now,
      lastUpdatedByField: {
        ...person.lastUpdatedByField,
        cadenceInterval: now,
        cadenceUnit: now
      }
    });
  });

  if (!persistPeople(mode, updated)) {
    return { ok: false, error: "Unable to save cadence." };
  }
  return { ok: true };
}

/**
 * Unified interaction logger updates timeline entries and cadence-derived fields.
 */
function logPersonInteraction(mode, personId, payload) {
  if (!payload.occurredAt || !payload.type) {
    return { ok: false, error: "Occurred date/time and interaction type are required." };
  }

  const loaded = loadPeopleForMutation(mode);
  if (!loaded.ok) {
    return loaded;
  }

  const now = new Date().toISOString();
  const updated = loaded.people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    const interaction = {
      id: buildId(),
      personId,
      occurredAt: new Date(payload.occurredAt).toISOString(),
      type: payload.type,
      durationMinutes: payload.durationMinutes ? Number(payload.durationMinutes) : null,
      note: payload.note || "",
      tags: payload.tags ? payload.tags.split(",").map((entry) => entry.trim()).filter(Boolean) : [],
      linkedMeetingId: payload.linkedMeetingId || ""
    };

    return computePersonCadence({
      ...person,
      interactions: [...person.interactions, interaction],
      lastContactAt: interaction.occurredAt,
      updatedAt: now,
      contactTrail: [...person.contactTrail, { date: interaction.occurredAt.slice(0, 10), note: interaction.note }]
    });
  });

  if (!persistPeople(mode, updated)) {
    return { ok: false, error: "Unable to save interaction update because local storage is full or unavailable." };
  }

  return { ok: true };
}


/**
 * Updates an existing interaction entry while preserving cadence metadata.
 */
function updatePersonInteraction(mode, personId, interactionId, payload) {
  const loaded = loadPeopleForMutation(mode);
  if (!loaded.ok) {
    return loaded;
  }

  let updatedInteraction = false;
  const now = new Date().toISOString();
  const updated = loaded.people.map((person) => {
    if (person.id !== personId) {
      return person;
    }

    const interactions = person.interactions.map((entry) => {
      if (entry.id !== interactionId) {
        return entry;
      }

      updatedInteraction = true;
      return {
        ...entry,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : entry.occurredAt,
        type: payload.type || entry.type,
        note: typeof payload.note === "string" ? payload.note : entry.note,
        durationMinutes: payload.durationMinutes ? Number(payload.durationMinutes) : entry.durationMinutes,
        tags: Array.isArray(payload.tags)
          ? payload.tags
          : typeof payload.tags === "string"
            ? payload.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
            : entry.tags,
        linkedMeetingId: payload.linkedMeetingId || entry.linkedMeetingId || "",
        archivedAt: payload.archivedAt || entry.archivedAt || "",
        updatedAt: now
      };
    });

    return computePersonCadence({
      ...person,
      interactions,
      updatedAt: now
    });
  });

  if (!updatedInteraction) {
    return { ok: false, error: "Unable to find the selected interaction." };
  }

  if (!persistPeople(mode, updated)) {
    return { ok: false, error: "Unable to save interaction changes." };
  }

  return { ok: true };
}

/**
 * Soft archives an interaction so timeline history remains recoverable for audit trails.
 */
function archivePersonInteraction(mode, personId, interactionId) {
  return updatePersonInteraction(mode, personId, interactionId, { archivedAt: new Date().toISOString() });
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
  const base = {
    id: person.id || buildId(),
    name: person.name || "",
    role: person.role || "",
    organisation: person.organisation || "",
    relationship: person.relationship || "",
    email: person.email || "",
    phone: person.phone || "",
    personType: person.personType === "internal" || person.personType === "external" ? person.personType : null,
    cadenceInterval: Number.isFinite(Number(person.cadenceInterval)) && Number(person.cadenceInterval) > 0 ? Number(person.cadenceInterval) : null,
    cadenceUnit: person.cadenceUnit === "weeks" || person.cadenceUnit === "months" ? person.cadenceUnit : null,
    lastContactAt: person.lastContactAt || person.lastContactDate || "",
    nextContactDueAt: person.nextContactDueAt || "",
    relationshipHealth: person.relationshipHealth || "unknown",
    notes: person.notes || "",
    archived: Boolean(person.archived),
    contactTrail: Array.isArray(person.contactTrail) ? person.contactTrail : [],
    interactions: Array.isArray(person.interactions)
      ? person.interactions.map((entry) => ({
          id: entry?.id || buildId(),
          personId: entry?.personId || person.id || "",
          occurredAt: entry?.occurredAt || "",
          type: entry?.type || "other",
          durationMinutes: Number.isFinite(Number(entry?.durationMinutes)) ? Number(entry.durationMinutes) : null,
          note: entry?.note || "",
          tags: Array.isArray(entry?.tags) ? entry.tags : [],
          linkedMeetingId: entry?.linkedMeetingId || "",
          archivedAt: entry?.archivedAt || ""
        }))
      : [],
    createdAt: person.createdAt || new Date().toISOString(),
    updatedAt: person.updatedAt || new Date().toISOString(),
    lastUpdatedByField:
      typeof person.lastUpdatedByField === "object" && person.lastUpdatedByField !== null
        ? person.lastUpdatedByField
        : {}
  };

  return computePersonCadence(base);
}

/**
 * Computes cadence-derived fields while preserving compatibility for records without cadence.
 */
function computePersonCadence(person) {
  const interval = Number(person.cadenceInterval);
  const hasCadence = Number.isFinite(interval) && interval > 0 && (person.cadenceUnit === "weeks" || person.cadenceUnit === "months");

  if (!hasCadence || !person.lastContactAt) {
    return {
      ...person,
      nextContactDueAt: "",
      relationshipHealth: "unknown"
    };
  }

  const last = new Date(person.lastContactAt);
  const due = new Date(last);
  if (person.cadenceUnit === "weeks") {
    due.setDate(due.getDate() + interval * 7);
  } else {
    due.setMonth(due.getMonth() + interval);
  }

  const cadenceMs = due.getTime() - last.getTime();
  const elapsed = Date.now() - last.getTime();
  let health = "on_track";
  if (elapsed >= cadenceMs) {
    health = "overdue";
  } else if (elapsed >= cadenceMs * 0.8) {
    health = "due";
  }

  return {
    ...person,
    nextContactDueAt: due.toISOString(),
    relationshipHealth: health
  };
}

function getHealthSortWeight(person) {
  switch (person.relationshipHealth) {
    case "overdue":
      return 0;
    case "due":
      return 1;
    case "on_track":
      return 2;
    default:
      return 3;
  }
}

function formatDateTime(value) {
  if (!value) {
    return "Not set";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not set";
  }
  return parsed.toLocaleString();
}

function formatDistanceFromNow(value) {
  if (!value) {
    return "not logged";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "not logged";
  }
  const days = Math.floor((Date.now() - parsed.getTime()) / 86400000);
  return days <= 0 ? "today" : `${days}d ago`;
}

function toDateTimeLocalValue(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offsetMs = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * Provides stable sort behaviors from a constrained enum.
 */
function sortPeople(first, second, sortMode) {
  switch (sortMode) {
    case "needs-attention":
      return getHealthSortWeight(first) - getHealthSortWeight(second)
        || (second.pendingUpdatesCount || 0) - (first.pendingUpdatesCount || 0)
        || first.name.localeCompare(second.name);
    case "name-asc":
      return first.name.localeCompare(second.name);
    case "contact-desc":
      return (second.lastContactAt || "").localeCompare(first.lastContactAt || "");
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
