import { loadMeetings } from "./meetings.js";
import { loadTasks, markTaskCompleted, saveTask } from "./tasks.js";
import { loadUpdates, markPersonUpdated, saveUpdate, selectPendingPeopleCount } from "./updates.js";
import { loadPersonalCalendarEvents } from "./personal-calendar.js";
import { loadProjects } from "./projects-store.js";
import { safeJsonParse, safeJsonWrite } from "./storage-core.js";

const TOP_PRIORITIES_STORAGE_KEY = "second-brain.today-focus.priorities.v1";
const WORK_PEOPLE_STORAGE_KEY = "second-brain.work.people.work.v1";

const FOCUS_SCOPES = {
  TODAY: "today",
  OVERDUE: "overdue",
  NEXT_7: "next7",
  ALL: "all"
};

/**
 * Renders the Today Focus triage cockpit.
 *
 * UX goals:
 * - Keep "Do / Attend / Know" flows visually separate.
 * - Apply one date+scope model across all sections.
 * - Keep row actions consistent so users can execute quickly.
 */
export function renderTodayFocusModule({ mode = "work", uiContext = {} } = {}) {
  const state = {
    mode,
    selectedDate: localDateKey(new Date()),
    scope: FOCUS_SCOPES.TODAY,
    quickCaptureOpen: false
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard today-focus-module";

  const titleRow = document.createElement("div");
  titleRow.className = "today-focus-title-row";
  const title = document.createElement("h1");
  title.textContent = "Today Focus";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "enter-mode-button";
  addButton.textContent = "+ Add";
  addButton.addEventListener("click", () => {
    state.quickCaptureOpen = true;
    render();
  });
  titleRow.append(title, addButton);

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent = "One-stop triage cockpit for what to do, attend, and communicate.";

  const scopeHost = document.createElement("div");
  const prioritiesHost = document.createElement("div");
  const contentGrid = document.createElement("div");
  contentGrid.className = "today-focus-grid";

  section.append(titleRow, intro, scopeHost, prioritiesHost, contentGrid);

  render();
  return section;

  function render() {
    renderScopeBar(scopeHost, state, () => render());
    prioritiesHost.innerHTML = "";
    prioritiesHost.appendChild(renderPrioritiesWidget(state));

    const actionData = collectActionRows(state, uiContext.onNavigate, () => render());
    const meetingData = collectMeetingRows(state, uiContext.onNavigate);
    const updateData = collectUpdateRows(state, uiContext.onNavigate, () => render());

    contentGrid.innerHTML = "";
    contentGrid.append(
      renderSectionCard({
        key: "do",
        title: `DO (${actionData.rows.length})`,
        subtitle: "Actions",
        variant: "actions",
        groups: actionData.groups,
        emptyText: "No actions in this scope. Beautiful.",
        bulkActions: actionData.bulkActions
      }),
      renderSectionCard({
        key: "attend",
        title: `ATTEND (${meetingData.rows.length})`,
        subtitle: "Meetings / Events",
        variant: "meetings",
        groups: meetingData.groups,
        emptyText: state.scope === FOCUS_SCOPES.TODAY ? "No meetings today." : "No meetings in this scope.",
        bulkActions: []
      }),
      renderSectionCard({
        key: "know",
        title: `KNOW (${updateData.rows.length})`,
        subtitle: "Updates",
        variant: "updates",
        groups: updateData.groups,
        emptyText: "No updates need action.",
        bulkActions: []
      })
    );

    if (state.quickCaptureOpen) {
      section.appendChild(renderQuickCaptureModal({ state, onClose: () => {
        state.quickCaptureOpen = false;
        render();
      }, onSaved: () => render() }));
    }
  }
}

/**
 * Shared inclusion rule: determines whether a dated item belongs to a scope.
 * This is intentionally centralised so Actions/Meetings/Updates stay consistent.
 */
export function evaluateTodayFocusInclusion({ itemDate = "", selectedDate, scope, includeUndatedInAll = false }) {
  if (!itemDate) {
    return {
      included: Boolean(includeUndatedInAll && scope === FOCUS_SCOPES.ALL),
      reason: includeUndatedInAll && scope === FOCUS_SCOPES.ALL ? "no due date" : "",
      relation: "undated"
    };
  }

  const deltaDays = dayDiff(itemDate, selectedDate);
  if (deltaDays < 0) {
    return {
      included: [FOCUS_SCOPES.OVERDUE, FOCUS_SCOPES.ALL].includes(scope),
      reason: `overdue by ${Math.abs(deltaDays)}d`,
      relation: "overdue"
    };
  }

  if (deltaDays === 0) {
    return {
      included: [FOCUS_SCOPES.TODAY, FOCUS_SCOPES.NEXT_7, FOCUS_SCOPES.ALL].includes(scope),
      reason: "due today",
      relation: "today"
    };
  }

  if (deltaDays <= 6) {
    return {
      included: [FOCUS_SCOPES.NEXT_7, FOCUS_SCOPES.ALL].includes(scope),
      reason: `due ${itemDate}`,
      relation: "upcoming"
    };
  }

  return {
    included: scope === FOCUS_SCOPES.ALL,
    reason: `due ${itemDate}`,
    relation: "future"
  };
}

function renderScopeBar(host, state, onChange) {
  host.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "today-focus-scope-bar card";

  const dateControls = document.createElement("div");
  dateControls.className = "today-focus-date-controls";

  const prev = smallIconButton("←", "Previous day", () => {
    state.selectedDate = shiftLocalDateKey(state.selectedDate, -1);
    onChange();
  });

  const next = smallIconButton("→", "Next day", () => {
    state.selectedDate = shiftLocalDateKey(state.selectedDate, 1);
    onChange();
  });

  const label = document.createElement("strong");
  label.className = "today-focus-date-label";
  label.textContent = formatSelectedDateLabel(state.selectedDate);

  const picker = document.createElement("input");
  picker.type = "date";
  picker.className = "field-input";
  picker.value = state.selectedDate;
  picker.addEventListener("change", () => {
    state.selectedDate = picker.value || state.selectedDate;
    onChange();
  });

  dateControls.append(prev, label, next, picker);

  const segmented = document.createElement("div");
  segmented.className = "today-focus-segmented";
  [
    { key: FOCUS_SCOPES.TODAY, label: "Today" },
    { key: FOCUS_SCOPES.OVERDUE, label: "Overdue" },
    { key: FOCUS_SCOPES.NEXT_7, label: "Next 7 days" },
    { key: FOCUS_SCOPES.ALL, label: "All" }
  ].forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `secondary-button ${state.scope === entry.key ? "is-active" : ""}`;
    button.textContent = entry.label;
    button.addEventListener("click", () => {
      state.scope = entry.key;
      onChange();
    });
    segmented.appendChild(button);
  });

  bar.append(dateControls, segmented);
  host.appendChild(bar);
}

function renderSectionCard({ title, subtitle, variant, groups, emptyText, bulkActions }) {
  const card = document.createElement("article");
  card.className = `card today-focus-section today-focus-section-${variant}`;

  const header = document.createElement("div");
  header.className = "today-focus-section-header";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const sub = document.createElement("p");
  sub.className = "module-intro";
  sub.textContent = subtitle;
  header.append(heading, sub);

  const bulk = document.createElement("div");
  bulk.className = "tasks-row-actions";
  bulkActions.forEach((entry) => bulk.appendChild(entry));

  const body = document.createElement("div");
  body.className = "today-focus-section-body";
  if (!groups.some((group) => group.rows.length)) {
    const empty = document.createElement("p");
    empty.className = "empty-state module-empty-state";
    empty.textContent = emptyText;
    body.appendChild(empty);
  } else {
    groups.forEach((group) => {
      if (!group.rows.length) {
        return;
      }
      const groupTitle = document.createElement("h3");
      groupTitle.className = "today-focus-group-heading";
      groupTitle.textContent = `${group.label} (${group.rows.length})`;
      body.append(groupTitle, ...group.rows);
    });
  }

  card.append(header);
  if (bulk.childElementCount) {
    card.appendChild(bulk);
  }
  card.appendChild(body);
  return card;
}

/**
 * Action aggregation/scoring:
 * - Action rows come from Tasks only.
 * - Inclusion uses evaluateTodayFocusInclusion(selectedDate, scope).
 * - Grouping by relation gives explicit overdue vs today vs upcoming cues.
 * - Overdue ordering is oldest due date first so stale commitments are surfaced first.
 */
function collectActionRows(state, onNavigate, onRefresh) {
  const projectsById = new Map(loadProjects(state.mode).map((project) => [project.id, project]));
  const allTasks = loadTasks(state.mode)
    .filter((task) => !task.archived)
    .filter((task) => !["Done", "Cancelled"].includes(task.status));

  const scoped = allTasks
    .map((task) => ({
      task,
      inclusion: evaluateTodayFocusInclusion({
        itemDate: task.dueDate,
        selectedDate: state.selectedDate,
        scope: state.scope,
        includeUndatedInAll: true
      })
    }))
    .filter((entry) => entry.inclusion.included)
    .sort((left, right) => {
      const leftDate = left.task.dueDate || "9999-12-31";
      const rightDate = right.task.dueDate || "9999-12-31";
      return leftDate.localeCompare(rightDate);
    });

  const rows = scoped.map(({ task, inclusion }) => renderTriageRow({
    variant: "action",
    type: "TASK",
    title: task.title || "Untitled task",
    timeLabel: inclusion.reason || "No due date",
    origin: projectsById.get(task.projectId)?.title || "Tasks module",
    reason: inclusion.reason || "no due date",
    primaryAction: {
      label: "Start",
      onClick: () => onNavigate?.({ moduleKey: "tasks" })
    },
    secondaryActions: [
      {
        label: "Snooze",
        onClick: () => {
          saveTask(state.mode, { ...task, dueDate: shiftLocalDateKey(state.selectedDate, 1) }, task.id);
          onRefresh();
        }
      },
      {
        label: "Reschedule",
        onClick: () => onNavigate?.({ moduleKey: "tasks" })
      },
      {
        label: "Mark done",
        onClick: () => {
          markTaskCompleted(state.mode, task.id);
          onRefresh();
        }
      },
      {
        label: "Open source",
        onClick: () => onNavigate?.({ moduleKey: "tasks" })
      }
    ]
  }));

  const overdue = scoped.filter((entry) => entry.inclusion.relation === "overdue").map((entry) => entry.task);
  const dueToday = scoped.filter((entry) => entry.inclusion.relation === "today").map((entry) => entry.task);

  const bulkActions = [];
  if (dueToday.length) {
    bulkActions.push(buildActionButton("Snooze all due-today", () => {
      if (!window.confirm("Snooze all due-today actions to tomorrow?")) return;
      dueToday.forEach((task) => saveTask(state.mode, { ...task, dueDate: shiftLocalDateKey(state.selectedDate, 1) }, task.id));
      onRefresh();
    }));
  }
  if (overdue.length) {
    bulkActions.push(buildActionButton("Mark all overdue done", () => {
      if (!window.confirm("Mark all overdue actions as done?")) return;
      overdue.forEach((task) => markTaskCompleted(state.mode, task.id));
      onRefresh();
    }));
  }

  return {
    rows,
    groups: [
      { label: "Overdue", rows: rowsFor(scoped, rows, "overdue") },
      { label: "Due today", rows: rowsFor(scoped, rows, "today") },
      { label: "Upcoming", rows: rowsFor(scoped, rows, "upcoming", "future") }
    ],
    bulkActions
  };
}

function collectMeetingRows(state, onNavigate) {
  const events = state.mode === "work"
    ? loadMeetings("work").filter((meeting) => !meeting.archived).map((meeting) => ({
      id: meeting.id,
      date: meeting.date,
      title: meeting.name || "Untitled meeting",
      startTime: meeting.startTime || "",
      endTime: meeting.endTime || "",
      origin: "Meetings module",
      notes: meeting.notes || ""
    }))
    : loadPersonalCalendarEvents().map((entry) => ({
      id: entry.id,
      date: entry.date,
      title: entry.title || "Untitled event",
      startTime: "",
      endTime: "",
      origin: "Personal Calendar",
      notes: entry.notes || ""
    }));

  const scoped = events
    .map((entry) => ({
      entry,
      inclusion: evaluateTodayFocusInclusion({ itemDate: entry.date, selectedDate: state.selectedDate, scope: state.scope })
    }))
    .filter((record) => record.inclusion.included)
    .sort((left, right) => `${left.entry.date}${left.entry.startTime || ""}`.localeCompare(`${right.entry.date}${right.entry.startTime || ""}`));

  const rows = scoped.map(({ entry, inclusion }) => renderTriageRow({
    variant: "meeting",
    type: "MEETING",
    title: entry.title,
    timeLabel: resolveMeetingTimeLabel(entry, state.selectedDate),
    origin: entry.origin,
    reason: state.scope === FOCUS_SCOPES.NEXT_7 ? `meeting on ${entry.date}` : inclusion.reason || `meeting on ${entry.date}`,
    primaryAction: {
      label: "Open meeting",
      onClick: () => onNavigate?.({ moduleKey: state.mode === "work" ? "meetings" : "calendar", focus: { meetingId: entry.id } })
    },
    secondaryActions: [
      {
        label: "Open notes",
        onClick: () => onNavigate?.({ moduleKey: state.mode === "work" ? "meetings" : "calendar", focus: { meetingId: entry.id } })
      }
    ]
  }));

  if (state.scope === FOCUS_SCOPES.NEXT_7) {
    const grouped = groupRowsByDate(scoped, rows);
    return { rows, groups: grouped };
  }

  return { rows, groups: [{ label: "Selected scope", rows }] };
}

function collectUpdateRows(state, onNavigate, onRefresh) {
  if (state.mode !== "work") {
    return { rows: [], groups: [{ label: "Needs action", rows: [] }, { label: "Waiting on others", rows: [] }] };
  }

  const scoped = loadUpdates("work")
    .filter((update) => update.lifecycle === "active")
    .map((update) => ({
      update,
      inclusion: evaluateTodayFocusInclusion({
        itemDate: update.dueDate,
        selectedDate: state.selectedDate,
        scope: state.scope,
        includeUndatedInAll: true
      })
    }))
    .filter((entry) => entry.inclusion.included)
    .filter((entry) => selectPendingPeopleCount(entry.update) > 0);

  const rows = scoped.map(({ update, inclusion }) => {
    const pendingCount = selectPendingPeopleCount(update);
    return renderTriageRow({
      variant: "update",
      type: "UPDATE",
      title: update.summary || "Untitled update",
      timeLabel: `${pendingCount} pending recipient${pendingCount === 1 ? "" : "s"}`,
      origin: "Updates module",
      reason: inclusion.reason || "pending recipient",
      primaryAction: {
        label: "Open",
        onClick: () => onNavigate?.({ moduleKey: "updates" })
      },
      secondaryActions: [
        {
          label: "Mark done",
          onClick: () => {
            const pendingRecipient = update.recipients.find((recipient) => recipient.status === "pending");
            if (pendingRecipient) {
              markPersonUpdated(update.id, pendingRecipient.personId);
              onRefresh();
            }
          }
        },
        {
          label: "Open source",
          onClick: () => onNavigate?.({ moduleKey: "updates" })
        }
      ]
    });
  });

  return {
    rows,
    groups: [
      { label: "Needs action", rows },
      { label: "Waiting on others", rows: [] }
    ]
  };
}

function renderPrioritiesWidget(state) {
  const tasks = loadTasks(state.mode).filter((task) => !task.archived && !["Done", "Cancelled"].includes(task.status));
  const priorities = loadTopPriorities(state.mode, state.selectedDate);

  const card = document.createElement("article");
  card.className = "card today-focus-priorities";

  const heading = document.createElement("h2");
  heading.textContent = "Top 3 priorities";
  const subtitle = document.createElement("p");
  subtitle.className = "module-intro";
  subtitle.textContent = "Pin text or link each slot to an existing task for this selected date.";

  const suggestButton = buildActionButton("Suggest from overdue", () => {
    const suggested = suggestPrioritiesFromOverdue({ priorities, tasks, selectedDate: state.selectedDate });
    saveTopPriorities(state.mode, state.selectedDate, suggested);
    card.replaceWith(renderPrioritiesWidget(state));
  });

  const list = document.createElement("div");
  list.className = "today-focus-priority-list";

  priorities.forEach((slot, index) => {
    const row = document.createElement("div");
    row.className = "today-focus-priority-row";

    const modeSelect = document.createElement("select");
    modeSelect.className = "field-input";
    addOption(modeSelect, "text", "Free text");
    addOption(modeSelect, "task", "Link task");
    modeSelect.value = slot.kind;

    const input = document.createElement("input");
    input.className = "field-input";

    const datalistId = `today-focus-task-options-${index}`;
    const options = document.createElement("datalist");
    options.id = datalistId;
    tasks.forEach((task) => {
      const option = document.createElement("option");
      option.value = task.title || "Untitled task";
      options.appendChild(option);
    });

    const statusPill = document.createElement("span");
    statusPill.className = "today-focus-priority-status";

    const persistSlot = () => {
      if (modeSelect.value === "task") {
        const selectedTask = tasks.find((task) => task.title === input.value.trim());
        priorities[index] = selectedTask
          ? { kind: "task", taskId: selectedTask.id, text: selectedTask.title }
          : { kind: "task", taskId: "", text: input.value.trim() };
      } else {
        priorities[index] = { kind: "text", text: input.value.trim(), taskId: "" };
      }
      saveTopPriorities(state.mode, state.selectedDate, priorities);
      card.replaceWith(renderPrioritiesWidget(state));
    };

    modeSelect.addEventListener("change", persistSlot);
    input.addEventListener("change", persistSlot);

    if (slot.kind === "task") {
      input.placeholder = `Link task ${index + 1}`;
      input.value = slot.text || "";
      input.setAttribute("list", datalistId);
      const linkedTask = tasks.find((task) => task.id === slot.taskId || task.title === slot.text);
      statusPill.textContent = linkedTask ? resolvePriorityDuePill(linkedTask, state.selectedDate) : "Task not found";
      statusPill.classList.add("is-linked");
      row.append(modeSelect, input, statusPill, options);
    } else {
      input.placeholder = `Priority ${index + 1}`;
      input.value = slot.text || "";
      row.append(modeSelect, input);
    }

    list.appendChild(row);
  });

  card.append(heading, subtitle, suggestButton, list);
  return card;
}

/**
 * Suggestion strategy: fill only empty slots using oldest overdue tasks first.
 * This keeps explicit user-entered priorities untouched.
 */
export function suggestPrioritiesFromOverdue({ priorities, tasks, selectedDate }) {
  const next = priorities.map((slot) => ({ ...slot }));
  const overdueTasks = tasks
    .filter((task) => task.dueDate && task.dueDate < selectedDate)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));

  let overdueIndex = 0;
  for (let i = 0; i < next.length && overdueIndex < overdueTasks.length; i += 1) {
    const slot = next[i];
    const isEmpty = !slot.text?.trim() && !slot.taskId;
    if (!isEmpty) {
      continue;
    }
    const task = overdueTasks[overdueIndex];
    next[i] = { kind: "task", taskId: task.id, text: task.title || "Untitled task" };
    overdueIndex += 1;
  }

  return next;
}

function renderQuickCaptureModal({ state, onClose, onSaved }) {
  const overlay = document.createElement("div");
  overlay.className = "task-drawer-overlay";

  const form = document.createElement("form");
  form.className = "task-drawer";

  const header = document.createElement("header");
  header.className = "task-drawer-header";
  const heading = document.createElement("h2");
  heading.textContent = "Quick capture";
  const close = smallIconButton("✕", "Close quick capture", onClose);
  header.append(heading, close);

  const body = document.createElement("div");
  body.className = "task-drawer-body";

  const kind = document.createElement("select");
  kind.className = "field-input";
  addOption(kind, "task", "Task");
  if (state.mode === "work") {
    addOption(kind, "update", "Update");
  }
  addOption(kind, "priority", "Priority");

  const title = createField("Title / summary", "text", "", true);
  const due = createField("Date", "date", state.selectedDate, false);

  const people = loadWorkPeople();
  const recipient = document.createElement("select");
  recipient.className = "field-input";
  addOption(recipient, "", "Select recipient");
  people.forEach((person) => addOption(recipient, person.id, person.name || person.id));

  const recipientWrap = document.createElement("label");
  recipientWrap.className = "field-label";
  recipientWrap.textContent = "Recipient (for update)";
  recipientWrap.appendChild(recipient);

  const hint = document.createElement("p");
  hint.className = "module-intro";

  const refreshVisibility = () => {
    recipientWrap.hidden = kind.value !== "update";
    due.wrap.hidden = kind.value === "priority";
    hint.textContent = kind.value === "priority"
      ? "Adds free-text priority in the first empty slot for the selected date."
      : "";
  };
  kind.addEventListener("change", refreshVisibility);
  refreshVisibility();

  const kindWrap = document.createElement("label");
  kindWrap.className = "field-label";
  kindWrap.textContent = "What to add";
  kindWrap.appendChild(kind);

  body.append(kindWrap, title.wrap, due.wrap, recipientWrap, hint);

  const footer = document.createElement("footer");
  footer.className = "task-drawer-footer";
  const cancel = buildActionButton("Cancel", onClose);
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "enter-mode-button";
  save.textContent = "Create";
  footer.append(cancel, save);

  form.append(header, body, footer);
  overlay.appendChild(form);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      onClose();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = title.input.value.trim();

    if (!text) {
      window.alert("Title is required.");
      return;
    }

    if (kind.value === "task") {
      const result = saveTask(state.mode, {
        title: text,
        dueDate: due.input.value || state.selectedDate,
        effort: 5,
        impact: 5,
        status: "Backlog",
        archived: false
      });
      if (!result.ok) {
        window.alert(result.error || "Unable to create task.");
        return;
      }
    } else if (kind.value === "update") {
      if (!recipient.value) {
        window.alert("Select a recipient for the update.");
        return;
      }
      const result = saveUpdate("work", {
        summary: text,
        dueDate: due.input.value || state.selectedDate,
        recipients: [{ personId: recipient.value, status: "pending", updatedAt: "" }],
        type: "update",
        lifecycle: "active"
      });
      if (!result.ok) {
        window.alert(result.error || "Unable to create update.");
        return;
      }
    } else {
      const slots = loadTopPriorities(state.mode, state.selectedDate);
      const emptyIndex = slots.findIndex((slot) => !slot.text?.trim() && !slot.taskId);
      if (emptyIndex === -1) {
        window.alert("All three priority slots are already filled.");
        return;
      }
      slots[emptyIndex] = { kind: "text", text, taskId: "" };
      saveTopPriorities(state.mode, state.selectedDate, slots);
    }

    onSaved();
    onClose();
  });

  return overlay;
}

function renderTriageRow({ variant, type, title, timeLabel, origin, reason, primaryAction, secondaryActions = [] }) {
  const row = document.createElement("article");
  row.className = `today-focus-row today-focus-row-${variant}`;

  const top = document.createElement("div");
  top.className = "today-focus-row-top";

  const typeChip = document.createElement("span");
  typeChip.className = `today-focus-chip today-focus-chip-${variant}`;
  typeChip.textContent = type;

  const heading = document.createElement("h4");
  heading.className = "today-focus-row-title";
  heading.textContent = title;

  const time = document.createElement("span");
  time.className = "today-focus-row-time";
  time.textContent = timeLabel;

  top.append(typeChip, heading, time);

  const meta = document.createElement("div");
  meta.className = "today-focus-row-meta";
  const originLine = document.createElement("span");
  originLine.textContent = `Origin: ${origin}`;
  const reasonLine = document.createElement("span");
  reasonLine.className = "today-focus-row-reason";
  reasonLine.textContent = `Included because: ${reason}`;
  meta.append(originLine, reasonLine);

  const actions = document.createElement("div");
  actions.className = "tasks-row-actions";
  actions.appendChild(buildActionButton(primaryAction.label, primaryAction.onClick));
  secondaryActions.forEach((entry) => actions.appendChild(buildActionButton(entry.label, entry.onClick)));

  row.append(top, meta, actions);
  return row;
}

function rowsFor(scopedRows, renderedRows, ...relations) {
  const picks = [];
  scopedRows.forEach((entry, index) => {
    if (relations.includes(entry.inclusion.relation)) {
      picks.push(renderedRows[index]);
    }
  });
  return picks;
}

function groupRowsByDate(scopedRows, renderedRows) {
  const groups = new Map();
  scopedRows.forEach((entry, index) => {
    const label = entry.entry.date || "No date";
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(renderedRows[index]);
  });

  return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }));
}

function resolveMeetingTimeLabel(entry, selectedDate) {
  const range = [entry.startTime, entry.endTime].filter(Boolean).join("-") || "Time TBC";
  if (entry.date !== localDateKey(new Date()) || entry.date !== selectedDate || !entry.startTime) {
    return `${entry.date} · ${range}`;
  }
  const minutes = minutesUntil(entry.date, entry.startTime);
  if (minutes <= 0) {
    return `${entry.date} · ${range}`;
  }
  if (minutes < 60) {
    return `${range} · starts in ${minutes}m`;
  }
  return `${range} · starts in ${Math.floor(minutes / 60)}h`;
}

function resolvePriorityDuePill(task, selectedDate) {
  if (!task.dueDate) return "No due date";
  if (task.dueDate < selectedDate) return "Overdue";
  if (task.dueDate === selectedDate) return "Due today";
  return `Due ${task.dueDate}`;
}

function loadTopPriorities(mode, date) {
  const parsed = safeJsonParse(localStorage.getItem(TOP_PRIORITIES_STORAGE_KEY), {});
  const dayValue = parsed?.[mode]?.[date];

  if (!Array.isArray(dayValue)) {
    return [createEmptyPrioritySlot(), createEmptyPrioritySlot(), createEmptyPrioritySlot()];
  }

  return [0, 1, 2].map((index) => normalisePrioritySlot(dayValue[index]));
}

function saveTopPriorities(mode, date, slots) {
  const parsed = safeJsonParse(localStorage.getItem(TOP_PRIORITIES_STORAGE_KEY), {});
  const next = {
    ...parsed,
    [mode]: {
      ...(parsed?.[mode] || {}),
      [date]: slots.slice(0, 3).map(normalisePrioritySlot)
    }
  };
  safeJsonWrite(TOP_PRIORITIES_STORAGE_KEY, next);
}

function normalisePrioritySlot(slot) {
  if (typeof slot === "string") {
    return { kind: "text", text: slot, taskId: "" };
  }
  if (!slot || typeof slot !== "object") {
    return createEmptyPrioritySlot();
  }
  return {
    kind: slot.kind === "task" ? "task" : "text",
    text: typeof slot.text === "string" ? slot.text : "",
    taskId: typeof slot.taskId === "string" ? slot.taskId : ""
  };
}

function createEmptyPrioritySlot() {
  return { kind: "text", text: "", taskId: "" };
}

function loadWorkPeople() {
  const parsed = safeJsonParse(localStorage.getItem(WORK_PEOPLE_STORAGE_KEY), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((person) => person && typeof person === "object" && !person.archived);
}

function buildActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function smallIconButton(label, ariaLabel, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", onClick);
  return button;
}

function createField(labelText, type, value, required = false) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
  input.required = required;
  input.value = value;

  wrap.appendChild(input);
  return { wrap, input };
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(key) {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  return new Date(year, month - 1, day);
}

function shiftLocalDateKey(key, amount) {
  const next = parseLocalDateKey(key);
  next.setDate(next.getDate() + amount);
  return localDateKey(next);
}

function dayDiff(firstKey, secondKey) {
  const first = parseLocalDateKey(firstKey);
  const second = parseLocalDateKey(secondKey);
  return Math.round((first.getTime() - second.getTime()) / 86_400_000);
}

function minutesUntil(dateKey, timeValue) {
  const [hours, minutes] = String(timeValue).split(":").map((value) => Number(value));
  const target = parseLocalDateKey(dateKey);
  target.setHours(hours || 0, minutes || 0, 0, 0);
  const now = new Date();
  return Math.round((target.getTime() - now.getTime()) / 60_000);
}

function formatSelectedDateLabel(dateKey) {
  const selected = parseLocalDateKey(dateKey);
  const today = localDateKey(new Date());
  const weekday = selected.toLocaleDateString(undefined, { weekday: "short" });
  const day = String(selected.getDate()).padStart(2, "0");
  const month = selected.toLocaleDateString(undefined, { month: "short" });
  return dateKey === today ? `Today (${weekday} ${day} ${month})` : `${weekday} ${day} ${month}`;
}
