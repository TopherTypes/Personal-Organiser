import { loadProjects } from "./projects-store.js";
const MEETINGS_STORAGE_KEY = "second-brain.work.meetings.work";
const MEETINGS_SCHEMA_VERSION = 1;

/**
 * In-memory UI cache survives module switches during a single app session.
 * It intentionally does not persist between page reloads.
 */
const sessionUiStateByMode = {
  work: null,
  personal: null
};

/**
 * Renders the meetings module with calendar/list split layout and slide-over details.
 */
export function renderWorkMeetingsModule({
  mode = "work",
  people = [],
  initialPrefill = null,
  setUnsavedChangesGuard = () => {}
} = {}) {
  const state = createMeetingsUiState(mode, initialPrefill);
  const projects = loadProjects(mode);
  const section = document.createElement("section");
  section.className = "mode-dashboard meetings-module";

  const header = document.createElement("div");
  header.className = "meetings-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "Work Meetings";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Schedule and review meetings in one place with a weekly default calendar, searchable notes, and non-destructive archiving.";

  titleWrap.append(title, intro);

  const actions = document.createElement("div");
  actions.className = "meetings-header-actions";

  const newMeetingButton = document.createElement("button");
  newMeetingButton.type = "button";
  newMeetingButton.className = "enter-mode-button";
  newMeetingButton.textContent = "New meeting";
  newMeetingButton.addEventListener("click", () => {
    openEditor(buildDefaultMeeting(state.anchorDate), { source: "header-button" });
  });

  actions.append(newMeetingButton);
  header.append(titleWrap, actions);

  const controls = document.createElement("div");
  controls.className = "meetings-controls";

  const viewSelect = document.createElement("select");
  viewSelect.className = "field-input";
  addOption(viewSelect, "week", "Weekly view");
  addOption(viewSelect, "month", "Monthly view");
  viewSelect.value = state.view;
  viewSelect.addEventListener("change", (event) => {
    state.view = event.target.value;
    renderModule();
  });

  const searchNotes = document.createElement("input");
  searchNotes.type = "search";
  searchNotes.className = "field-input";
  searchNotes.placeholder = "Filter by meeting name or notes";
  searchNotes.value = state.search;
  searchNotes.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderModule();
  });

  const statusFilter = document.createElement("select");
  statusFilter.className = "field-input";
  addOption(statusFilter, "active", "Active only");
  addOption(statusFilter, "archived", "Archived only");
  addOption(statusFilter, "all", "All");
  statusFilter.value = state.filter;
  statusFilter.addEventListener("change", (event) => {
    state.filter = event.target.value;
    renderModule();
  });

  controls.append(viewSelect, searchNotes, statusFilter);

  const split = document.createElement("div");
  split.className = "meetings-split";

  const calendarPane = document.createElement("div");
  calendarPane.className = "meetings-calendar-pane";

  const listPane = document.createElement("div");
  listPane.className = "meetings-list-pane";

  split.append(calendarPane, listPane);

  const slideOver = document.createElement("aside");
  slideOver.className = "meeting-slideover hidden";
  slideOver.setAttribute("aria-live", "polite");

  section.append(header, controls, split, slideOver);

  function renderModule() {
    const range = state.view === "week" ? weekRange(state.anchorDate) : monthRange(state.anchorDate);
    const allMeetings = loadMeetings(mode);
    const meetings = filterAndSortMeetings(allMeetings, state, range);

    calendarPane.innerHTML = "";
    listPane.innerHTML = "";

    calendarPane.append(
      buildCalendarHeader(state, range, () => renderModule()),
      state.view === "week"
        ? renderWeeklyCalendar(state, meetings, allMeetings, range, openEditor)
        : renderMonthlyCalendar(state, meetings, allMeetings, range, openEditor)
    );

    const listHeading = document.createElement("h2");
    listHeading.textContent = `Meetings in ${state.view} view (${meetings.length})`;

    const list = document.createElement("div");
    list.className = "meetings-list";

    if (meetings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        "No meetings match this range yet. Click on a calendar day or use New meeting to add one.";
      list.appendChild(empty);
    }

    for (const meeting of meetings) {
      list.appendChild(renderMeetingRow(meeting, people, projects, {
        onOpen: () => openEditor(meeting, { source: "list" }),
        onArchiveToggle: () => {
          archiveMeeting(mode, meeting.id, !meeting.archived);
          state.feedback = meeting.archived ? "Meeting restored." : "Meeting archived.";
          renderModule();
        }
      }));
    }

    listPane.append(listHeading, list);

    if (state.feedback) {
      const feedback = document.createElement("p");
      feedback.className = "feedback";
      feedback.textContent = state.feedback;
      listPane.prepend(feedback);
      state.feedback = "";
    }

    setUnsavedChangesGuard(Boolean(state.dirtyDraft));
    sessionUiStateByMode[mode] = {
      view: state.view,
      anchorDate: state.anchorDate,
      search: state.search,
      filter: state.filter
    };
  }

  function openEditor(meeting, { source }) {
    state.draft = { ...meeting };
    state.dirtyDraft = false;
    state.draftSource = source;
    state.lastAutoSaveAt = "";
    renderSlideOver();
    setUnsavedChangesGuard(true);
  }

  function closeEditor() {
    state.draft = null;
    state.dirtyDraft = false;
    state.draftSource = "";
    slideOver.classList.add("hidden");
    slideOver.innerHTML = "";
    setUnsavedChangesGuard(false);
  }

  function renderSlideOver() {
    slideOver.innerHTML = "";
    slideOver.classList.remove("hidden");

    const heading = document.createElement("h2");
    heading.textContent = state.draft.id ? "Edit meeting" : "Create meeting";

    const form = document.createElement("form");
    form.className = "meeting-form";

    const fields = document.createElement("div");
    fields.className = "meeting-fields";

    const nameInput = buildLabeledInput("Meeting name", "text", state.draft.name || "", true);
    const dateInput = buildLabeledInput("Date", "date", state.draft.date || isoDateToday(), true);
    const startInput = buildLabeledInput("Start time", "time", state.draft.startTime || "");
    const endInput = buildLabeledInput("End time", "time", state.draft.endTime || "");

    const typeWrap = document.createElement("label");
    typeWrap.className = "field-label";
    typeWrap.textContent = "Meeting type";
    const typeSelect = document.createElement("select");
    typeSelect.className = "field-input";
    addOption(typeSelect, "standard", "Standard");
    addOption(typeSelect, "one-on-one", "1:1");
    typeSelect.value = state.draft.type || "standard";
    typeWrap.appendChild(typeSelect);

    const statusWrap = document.createElement("label");
    statusWrap.className = "field-label";
    statusWrap.textContent = "Status";
    const statusSelect = document.createElement("select");
    statusSelect.className = "field-input";
    ["scheduled", "completed", "rescheduled", "cancelled", "missed"].forEach((status) =>
      addOption(statusSelect, status, toTitleCase(status))
    );
    statusSelect.value = state.draft.status || "scheduled";
    statusWrap.appendChild(statusSelect);

    const chairInput = buildLabeledInput("Chair (free-text or person id)", "text", state.draft.chairId || "");
    const attendeesWrap = document.createElement("label");
    attendeesWrap.className = "field-label";
    attendeesWrap.textContent = "Attendees (person IDs comma-separated)";
    const attendeesInput = document.createElement("input");
    attendeesInput.className = "field-input";
    attendeesInput.value = (state.draft.attendeeIds || []).join(", ");
    attendeesWrap.appendChild(attendeesInput);

    const projectWrap = document.createElement("label");
    projectWrap.className = "field-label";
    projectWrap.textContent = "Project";
    const projectSelect = document.createElement("select");
    projectSelect.className = "field-input";
    addOption(projectSelect, "", "No project link");
    projects.forEach((project) => {
      addOption(projectSelect, project.id, project.title);
    });
    projectSelect.value = state.draft.projectId || "";
    projectWrap.appendChild(projectSelect);

    const notesWrap = document.createElement("label");
    notesWrap.className = "field-label";
    notesWrap.textContent = "Meeting notes (Markdown supported)";
    const notesInput = document.createElement("textarea");
    notesInput.className = "field-input field-textarea";
    notesInput.value = state.draft.notes || "";

    const lockInfo = document.createElement("p");
    lockInfo.className = "archive-note";
    const isLockedByStatus = ["completed", "cancelled"].includes(state.draft.status);
    lockInfo.textContent = isLockedByStatus
      ? "Notes are read-only for completed/cancelled meetings unless override is enabled."
      : "Notes can be edited normally.";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "field-label field-checkbox";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(state.draft.allowPostStatusEdits);
    toggleLabel.append(toggle, document.createTextNode("Allow edits after completed/cancelled"));

    notesInput.disabled = isLockedByStatus && !toggle.checked;

    const notesPreview = document.createElement("pre");
    notesPreview.className = "notes-preview";
    notesPreview.textContent = state.draft.notes || "No notes yet.";

    notesWrap.append(notesInput, lockInfo, toggleLabel, notesPreview);

    const autoSaveText = document.createElement("small");
    autoSaveText.className = "module-intro";
    autoSaveText.textContent = state.lastAutoSaveAt
      ? `Auto-saved at ${state.lastAutoSaveAt}`
      : "Auto-save runs while typing notes.";

    fields.append(
      nameInput.wrapper,
      dateInput.wrapper,
      startInput.wrapper,
      endInput.wrapper,
      typeWrap,
      statusWrap,
      chairInput.wrapper,
      attendeesWrap,
      projectWrap,
      notesWrap
    );

    const actions = document.createElement("div");
    actions.className = "meeting-actions";

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "enter-mode-button";
    saveButton.textContent = "Save meeting";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "module-button-secondary";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => {
      if (state.dirtyDraft && !window.confirm("Discard unsaved meeting changes?")) {
        return;
      }
      closeEditor();
      renderModule();
    });

    actions.append(saveButton, closeButton);
    form.append(heading, fields, autoSaveText, actions);
    slideOver.appendChild(form);

    const syncDraft = () => {
      state.draft.name = nameInput.input.value.trim();
      state.draft.date = dateInput.input.value;
      state.draft.startTime = startInput.input.value;
      state.draft.endTime = endInput.input.value;
      state.draft.type = typeSelect.value;
      state.draft.status = statusSelect.value;
      state.draft.chairId = chairInput.input.value.trim();
      state.draft.attendeeIds = attendeesInput.value
        .split(",")
        .map((personId) => personId.trim())
        .filter(Boolean);
      state.draft.projectId = projectSelect.value;
      state.draft.allowPostStatusEdits = toggle.checked;
      if (!notesInput.disabled) {
        state.draft.notes = notesInput.value;
      }
      notesPreview.textContent = state.draft.notes || "No notes yet.";
      state.dirtyDraft = true;
      setUnsavedChangesGuard(true);
    };

    [
      nameInput.input,
      dateInput.input,
      startInput.input,
      endInput.input,
      typeSelect,
      statusSelect,
      chairInput.input,
      attendeesInput,
      projectSelect,
      toggle
    ].forEach((field) => field.addEventListener("input", syncDraft));

    notesInput.addEventListener("input", () => {
      syncDraft();
      autoSaveDraft(mode, state.draft);
      state.lastAutoSaveAt = new Date().toLocaleTimeString();
      autoSaveText.textContent = `Auto-saved at ${state.lastAutoSaveAt}`;
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      syncDraft();
      const result = saveMeeting(mode, state.draft, state.draftSource);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      state.feedback = result.message;
      state.draft = null;
      state.dirtyDraft = false;
      clearDraft(mode);
      closeEditor();
      renderModule();
    });

    statusSelect.addEventListener("change", () => {
      const shouldLock = ["completed", "cancelled"].includes(statusSelect.value);
      notesInput.disabled = shouldLock && !toggle.checked;
      lockInfo.textContent = shouldLock
        ? "Notes are read-only for completed/cancelled meetings unless override is enabled."
        : "Notes can be edited normally.";
    });

    toggle.addEventListener("change", () => {
      const shouldLock = ["completed", "cancelled"].includes(statusSelect.value);
      notesInput.disabled = shouldLock && !toggle.checked;
      syncDraft();
    });
  }

  renderModule();
  if (state.draft) {
    renderSlideOver();
  }
  return section;
}

function createMeetingsUiState(mode, initialPrefill) {
  const session = sessionUiStateByMode[mode];
  const base = {
    view: session?.view || "week",
    anchorDate: session?.anchorDate || isoDateToday(),
    search: session?.search || "",
    filter: session?.filter || "active",
    draft: null,
    dirtyDraft: false,
    draftSource: "",
    feedback: "",
    lastAutoSaveAt: ""
  };

  const autosavedDraft = loadDraft(mode);
  if (autosavedDraft) {
    base.draft = autosavedDraft;
    base.dirtyDraft = true;
  }

  if (initialPrefill) {
    base.draft = buildDefaultMeeting(base.anchorDate, initialPrefill);
    base.dirtyDraft = true;
  }

  return base;
}

function buildCalendarHeader(state, range, rerender) {
  const wrap = document.createElement("div");
  wrap.className = "calendar-header";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "module-button-secondary";
  prev.textContent = "← Prev";
  prev.addEventListener("click", () => {
    state.anchorDate = shiftDate(state.anchorDate, state.view === "week" ? -7 : -30);
    rerender();
  });

  const next = document.createElement("button");
  next.type = "button";
  next.className = "module-button-secondary";
  next.textContent = "Next →";
  next.addEventListener("click", () => {
    state.anchorDate = shiftDate(state.anchorDate, state.view === "week" ? 7 : 30);
    rerender();
  });

  const title = document.createElement("strong");
  title.textContent = `${formatDate(range.start)} to ${formatDate(range.end)}`;

  const today = document.createElement("button");
  today.type = "button";
  today.className = "module-button-secondary";
  today.textContent = "Today";
  today.addEventListener("click", () => {
    state.anchorDate = isoDateToday();
    rerender();
  });

  wrap.append(prev, title, next, today);
  return wrap;
}

function renderWeeklyCalendar(state, meetingsInRange, allMeetings, range, openEditor) {
  const grid = document.createElement("div");
  grid.className = "calendar-grid week-grid";

  for (const date of eachDate(range.start, range.end)) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "calendar-day";
    card.addEventListener("click", () => openEditor(buildDefaultMeeting(date), { source: "calendar-day" }));

    const heading = document.createElement("strong");
    heading.textContent = `${weekdayLabel(date)} ${date}`;

    const meetingsForDate = allMeetings.filter((meeting) => meeting.date === date && !meeting.archived);
    const count = document.createElement("span");
    count.textContent = `${meetingsForDate.length} meeting(s)`;

    card.append(heading, count);
    grid.appendChild(card);
  }

  return grid;
}

function renderMonthlyCalendar(state, meetingsInRange, allMeetings, range, openEditor) {
  const grid = document.createElement("div");
  grid.className = "calendar-grid month-grid";

  for (const date of eachDate(range.start, range.end)) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.addEventListener("click", () => openEditor(buildDefaultMeeting(date), { source: "calendar-day" }));

    const short = document.createElement("strong");
    short.textContent = date.slice(-2);

    const meetingsForDate = allMeetings.filter((meeting) => meeting.date === date && !meeting.archived);
    const count = document.createElement("span");
    count.textContent = meetingsForDate.length ? `${meetingsForDate.length} items` : "—";

    cell.append(short, count);
    grid.appendChild(cell);
  }

  return grid;
}

function renderMeetingRow(meeting, people, projects, { onOpen, onArchiveToggle }) {
  const row = document.createElement("article");
  row.className = "meeting-row";

  const heading = document.createElement("button");
  heading.type = "button";
  heading.className = "meeting-open-button";
  heading.textContent = `${meeting.name} · ${formatDate(meeting.date)} · ${toTitleCase(meeting.status)}`;
  heading.addEventListener("click", onOpen);

  const meta = document.createElement("p");
  meta.className = "meeting-meta";

  const attendeeNames = meeting.attendeeIds
    .map((id) => people.find((person) => person.id === id)?.name || `Unknown (${id})`)
    .join(", ");

  meta.textContent = [
    meeting.type === "one-on-one" ? "1:1" : "Standard",
    meeting.chairId ? `Chair: ${meeting.chairId}` : "No chair",
    attendeeNames ? `Attendees: ${attendeeNames}` : "No attendees",
    meeting.projectId
      ? `Project: ${projects.find((project) => project.id === meeting.projectId)?.title || meeting.projectId}`
      : "No project link"
  ].join(" · ");

  const trail = document.createElement("small");
  trail.className = "module-intro";
  trail.textContent = `Status events: ${meeting.statusHistory.length} · Last updated ${new Date(
    meeting.updatedAt
  ).toLocaleString()}`;

  const controls = document.createElement("div");
  controls.className = "meeting-controls";

  const archiveButton = document.createElement("button");
  archiveButton.type = "button";
  archiveButton.className = "module-button-secondary";
  archiveButton.textContent = meeting.archived ? "Restore" : "Archive";
  archiveButton.addEventListener("click", onArchiveToggle);

  controls.appendChild(archiveButton);
  row.append(heading, meta, trail, controls);
  return row;
}

function buildDefaultMeeting(date, prefill = null) {
  return {
    id: "",
    name: prefill?.name || "",
    date: date || isoDateToday(),
    startTime: "",
    endTime: "",
    status: "scheduled",
    type: prefill?.type || "standard",
    attendeeIds: prefill?.attendeeIds || [],
    chairId: "",
    projectId: "",
    notes: "",
    allowPostStatusEdits: false,
    archived: false
  };
}

function filterAndSortMeetings(allMeetings, state, range) {
  const search = state.search.trim().toLowerCase();

  return allMeetings
    .filter((meeting) => {
      if (state.filter === "active" && meeting.archived) {
        return false;
      }
      if (state.filter === "archived" && !meeting.archived) {
        return false;
      }
      if (meeting.date < range.start || meeting.date > range.end) {
        return false;
      }
      if (!search) {
        return true;
      }
      return `${meeting.name} ${meeting.notes}`.toLowerCase().includes(search);
    })
    .sort((left, right) => `${left.date}${left.startTime}`.localeCompare(`${right.date}${right.startTime}`));
}

function saveMeeting(mode, draft, source) {
  if (!draft.name) {
    return { ok: false, error: "Meeting name is required." };
  }
  if (!draft.date) {
    return { ok: false, error: "Meeting date is required." };
  }

  const validProjectIds = new Set(loadProjects(mode).map((project) => project.id));
  if (draft.projectId && !validProjectIds.has(draft.projectId)) {
    return { ok: false, error: "Selected project no longer exists." };
  }

  const now = new Date().toISOString();
  const meetings = loadMeetings(mode);

  if (draft.id) {
    const index = meetings.findIndex((meeting) => meeting.id === draft.id);
    if (index < 0) {
      return { ok: false, error: "Meeting no longer exists." };
    }
    const existing = meetings[index];
    const statusChanged = existing.status !== draft.status;

    meetings[index] = {
      ...existing,
      ...draft,
      updatedAt: now,
      statusHistory: statusChanged
        ? [...existing.statusHistory, { status: draft.status, at: now }]
        : existing.statusHistory,
      auditTrail: [
        ...existing.auditTrail,
        { at: now, action: "updated", source: source || "edit-panel" }
      ],
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        name: now,
        date: now,
        startTime: now,
        endTime: now,
        status: now,
        type: now,
        attendeeIds: now,
        chairId: now,
        projectId: now,
        notes: now,
        allowPostStatusEdits: now
      }
    };

    persistMeetings(mode, meetings);
    return { ok: true, message: "Meeting updated." };
  }

  meetings.push({
    ...normaliseMeeting(draft),
    id: buildId(),
    createdAt: now,
    updatedAt: now,
    statusHistory: [{ status: draft.status || "scheduled", at: now }],
    auditTrail: [{ at: now, action: "created", source: source || "editor" }],
    lastUpdatedByField: {
      name: now,
      date: now,
      startTime: now,
      endTime: now,
      status: now,
      type: now,
      attendeeIds: now,
      chairId: now,
      projectId: now,
      notes: now,
      allowPostStatusEdits: now,
      archived: now
    }
  });

  persistMeetings(mode, meetings);
  return { ok: true, message: "Meeting created." };
}

function archiveMeeting(mode, meetingId, shouldArchive) {
  const meetings = loadMeetings(mode);
  const now = new Date().toISOString();

  const updated = meetings.map((meeting) => {
    if (meeting.id !== meetingId) {
      return meeting;
    }
    return {
      ...meeting,
      archived: shouldArchive,
      updatedAt: now,
      auditTrail: [...meeting.auditTrail, { at: now, action: shouldArchive ? "archived" : "restored" }],
      lastUpdatedByField: {
        ...meeting.lastUpdatedByField,
        archived: now
      }
    };
  });

  persistMeetings(mode, updated);
}

export function loadMeetings(mode) {
  if (mode !== "work") {
    return [];
  }

  const raw = localStorage.getItem(MEETINGS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    /**
     * Migration path: legacy arrays are upgraded to the versioned envelope.
     * A backup copy is retained for rollback safety.
     */
    if (Array.isArray(parsed)) {
      localStorage.setItem(`${MEETINGS_STORAGE_KEY}.backup`, raw);
      persistMeetings(mode, parsed.map(normaliseMeeting));
      return parsed.map(normaliseMeeting);
    }

    if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.meetings)) {
      return parsed.meetings.map(normaliseMeeting);
    }

    return [];
  } catch {
    return [];
  }
}

function persistMeetings(mode, meetings) {
  if (mode !== "work") {
    return;
  }

  const payload = {
    schemaVersion: MEETINGS_SCHEMA_VERSION,
    meetings
  };
  localStorage.setItem(MEETINGS_STORAGE_KEY, JSON.stringify(payload));
}


function normaliseMeeting(meeting) {
  return {
    id: meeting.id || "",
    name: meeting.name || "",
    date: meeting.date || isoDateToday(),
    startTime: meeting.startTime || "",
    endTime: meeting.endTime || "",
    status: meeting.status || "scheduled",
    type: meeting.type || "standard",
    attendeeIds: Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds : [],
    chairId: meeting.chairId || "",
    projectId: meeting.projectId || "",
    notes: meeting.notes || "",
    allowPostStatusEdits: Boolean(meeting.allowPostStatusEdits),
    archived: Boolean(meeting.archived),
    createdAt: meeting.createdAt || new Date().toISOString(),
    updatedAt: meeting.updatedAt || new Date().toISOString(),
    statusHistory: Array.isArray(meeting.statusHistory) ? meeting.statusHistory : [],
    auditTrail: Array.isArray(meeting.auditTrail) ? meeting.auditTrail : [],
    lastUpdatedByField:
      typeof meeting.lastUpdatedByField === "object" && meeting.lastUpdatedByField !== null
        ? meeting.lastUpdatedByField
        : {}
  };
}

function autoSaveDraft(mode, draft) {
  localStorage.setItem(`second-brain.work.meetings.${mode}.draft`, JSON.stringify(draft));
}

function loadDraft(mode) {
  const raw = localStorage.getItem(`second-brain.work.meetings.${mode}.draft`);
  if (!raw) {
    return null;
  }
  try {
    return normaliseMeeting(JSON.parse(raw));
  } catch {
    return null;
  }
}

function clearDraft(mode) {
  localStorage.removeItem(`second-brain.work.meetings.${mode}.draft`);
}

function buildLabeledInput(label, type, value, required = false) {
  const wrapper = document.createElement("label");
  wrapper.className = "field-label";
  wrapper.textContent = label;

  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
  input.value = value;
  input.required = required;

  wrapper.appendChild(input);
  return { wrapper, input };
}

function weekRange(anchorDate) {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  const day = anchor.getDay();
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() + mondayDelta);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function monthRange(anchorDate) {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function eachDate(startIso, endIso) {
  const dates = [];
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function shiftDate(isoDate, deltaDays) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toIsoDate(date);
}

function weekdayLabel(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}

function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString();
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function toTitleCase(input) {
  return input
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildId() {
  return `meeting_${Math.random().toString(36).slice(2, 10)}`;
}
