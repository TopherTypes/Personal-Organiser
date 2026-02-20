import { loadProjects, upsertProjectRaidEntry, PROJECT_RAID_STATUSES } from "./projects-store.js";
import { loadVersionedCollection, persistVersionedCollection, safeJsonParse, safeJsonWrite } from "./storage-core.js";
import {
  buildUpdateOwnerOptions,
  loadUpdates,
  markPersonPending,
  markPersonUpdated,
  saveUpdate,
  selectActivePeople,
  selectUpdatesForPerson
} from "./updates.js";
import { generateId } from "./id.js";
import {
  buildSingleSelectField,
  buildEntityTokenMultiSelectField,
  buildEntityTokenSingleSelectField,
  readEntityTokenHiddenValues
} from "./select-controls.js";
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
 * Shared status-to-class token map keeps list cards and calendar entries in sync.
 * Unknown/legacy statuses intentionally fall back to scheduled styling.
 */
const MEETING_STATUS_CLASS_BY_STATUS = {
  scheduled: "meeting-status-scheduled",
  completed: "meeting-status-completed",
  rescheduled: "meeting-status-rescheduled",
  cancelled: "meeting-status-cancelled",
  missed: "meeting-status-missed"
};

/**
 * Renders the meetings module with calendar/list split layout and modal meeting editor.
 */
export function renderWorkMeetingsModule({
  mode = "work",
  people = [],
  initialPrefill = null,
  initialMeetingId = "",
  setUnsavedChangesGuard = () => {}
} = {}) {
  const state = createMeetingsUiState(mode, initialPrefill);
  const projects = loadProjects(mode);
  const section = document.createElement("section");
  section.className = "mode-dashboard meetings-module";

  const header = document.createElement("div");
  header.className = "meetings-header module-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "module-header-copy";
  const title = document.createElement("h1");
  title.textContent = "Work Meetings";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Schedule and review meetings in one place with a weekly default calendar, searchable notes, and non-destructive archiving.";

  titleWrap.append(title, intro);

  const actions = document.createElement("div");
  actions.className = "meetings-header-actions module-header-actions";

  const newMeetingButton = document.createElement("button");
  newMeetingButton.type = "button";
  newMeetingButton.className = "enter-mode-button";
  newMeetingButton.textContent = "New meeting";
  newMeetingButton.addEventListener("click", () => {
    openEditor(buildDefaultMeeting(state.anchorDate), { source: "header-button", tab: "plan" });
  });

  actions.append(newMeetingButton);
  header.append(titleWrap, actions);

  const controls = document.createElement("div");
  controls.className = "meetings-controls module-toolbar";

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

  const typeFilter = document.createElement("select");
  typeFilter.className = "field-input";
  addOption(typeFilter, "all", "All meeting types");
  addOption(typeFilter, "standard", "Standard");
  addOption(typeFilter, "one-on-one", "1:1");
  typeFilter.value = state.typeFilter;
  typeFilter.addEventListener("change", (event) => {
    state.typeFilter = event.target.value;
    renderModule();
  });

  const showCompletedLabel = document.createElement("label");
  showCompletedLabel.className = "meeting-toggle-label module-checkbox";

  const showCompletedToggle = document.createElement("input");
  showCompletedToggle.type = "checkbox";
  showCompletedToggle.checked = state.showCompleted;
  showCompletedToggle.addEventListener("change", (event) => {
    state.showCompleted = event.target.checked;
    renderModule();
  });

  showCompletedLabel.append(showCompletedToggle, document.createTextNode("Show completed meetings"));

  // Bulk archive keeps meeting history tidy after recurring reviews while
  // avoiding accidental deletion of scheduled/in-progress meetings.
  const archiveCompletedButton = document.createElement("button");
  archiveCompletedButton.type = "button";
  archiveCompletedButton.className = "module-button-secondary";
  archiveCompletedButton.textContent = "Archive completed meetings";
  archiveCompletedButton.addEventListener("click", () => {
    const archivedCount = archiveCompletedMeetings(mode);
    state.feedback = archivedCount
      ? `${archivedCount} completed meeting${archivedCount === 1 ? "" : "s"} archived.`
      : "No completed meetings to archive.";
    renderModule();
  });

  controls.append(viewSelect, searchNotes, statusFilter, typeFilter, showCompletedLabel, archiveCompletedButton);

  const split = document.createElement("div");
  split.className = "meetings-split";

  const calendarPane = document.createElement("div");
  calendarPane.className = "meetings-calendar-pane";

  const listPane = document.createElement("div");
  listPane.className = "meetings-list-pane";

  split.append(calendarPane, listPane);

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "meeting-modal-overlay hidden";
  modalOverlay.setAttribute("aria-live", "polite");

  // Centralised close flow keeps click/Escape/button dismissals consistent.
  const requestEditorClose = () => {
    if (state.dirtyDraft && !window.confirm("Discard unsaved meeting changes?")) {
      return false;
    }
    closeEditor();
    renderModule();
    return true;
  };

  modalOverlay.addEventListener("click", (event) => {
    if (event.target !== modalOverlay) {
      return;
    }
    requestEditorClose();
  });

  section.append(header, controls, split, modalOverlay);

  function renderModule() {
    const range = state.view === "week" ? weekRange(state.anchorDate) : monthRange(state.anchorDate);
    const allMeetings = loadMeetings(mode);
    const meetings = filterAndSortMeetings(allMeetings, state, range);
    archiveCompletedButton.disabled = !allMeetings.some((meeting) => !meeting.archived && meeting.status === "completed");

    calendarPane.innerHTML = "";
    listPane.innerHTML = "";

    const isWeeklyView = state.view === "week";
    split.classList.toggle("meetings-split-weekly", isWeeklyView);

    // Weekly view now prioritises a full-width calendar. Meeting entries are
    // selected in-place first, then opened for editing from the details card.
    const onSelectCalendarMeeting = (meeting) => {
      state.selectedCalendarMeetingId = meeting.id;
      renderModule();
    };

    const selectedMeeting = meetings.find((meeting) => meeting.id === state.selectedCalendarMeetingId) || null;
    if (!selectedMeeting) {
      state.selectedCalendarMeetingId = "";
    }

    calendarPane.append(
      buildCalendarHeader(state, range, () => renderModule()),
      isWeeklyView ? renderCalendarMeetingDetails(selectedMeeting, people, projects, {
        onOpenEditor: (meeting, options = {}) => openEditor(meeting, { source: "weekly-details", ...options })
      }) : null,
      isWeeklyView
        ? renderWeeklyCalendar(state, meetings, allMeetings, range, onSelectCalendarMeeting, state.selectedCalendarMeetingId, {
            onOpenMeeting: (meeting, options = {}) => openEditor(meeting, { source: "calendar-entry", ...options })
          })
        : renderMonthlyCalendar(state, meetings, allMeetings, range, {
            onOpenEditor: (meeting) => openEditor(meeting, { source: "calendar-entry" }),
            onArchiveToggle: (meeting) => {
              archiveMeeting(mode, meeting.id, !meeting.archived);
              state.feedback = meeting.archived ? "Meeting restored." : "Meeting archived.";
              renderModule();
            },
            onSelectDate: (date) => {
              state.monthSelectedDate = date;
              renderModule();
            },
            onChangeDensity: (density) => {
              state.monthDensity = density;
              renderModule();
            }
          })
    );

    if (isWeeklyView) {
      listPane.innerHTML = "";
    } else {
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
      }
    }

    if (isWeeklyView && state.feedback) {
      const feedback = document.createElement("p");
      feedback.className = "feedback";
      feedback.textContent = state.feedback;
      calendarPane.prepend(feedback);
    }
    state.feedback = "";

    setUnsavedChangesGuard(Boolean(state.dirtyDraft));
    sessionUiStateByMode[mode] = {
      view: state.view,
      anchorDate: state.anchorDate,
      search: state.search,
      filter: state.filter,
      showCompleted: state.showCompleted,
      selectedCalendarMeetingId: state.selectedCalendarMeetingId,
      typeFilter: state.typeFilter,
      monthSelectedDate: state.monthSelectedDate,
      monthDensity: state.monthDensity
    };
  }

  function openEditor(meeting, { source, tab = "plan", noteTemplate = "" }) {
    // Preserve trigger focus so keyboard users return to their previous context
    // when the modal closes.
    state.returnFocusElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    state.draft = {
      ...meeting,
      draftLinkedUpdates: normaliseDraftLinkedUpdates(meeting.draftLinkedUpdates, meeting.chairId),
      draftRaidEntries: normaliseDraftRaidEntries(meeting.draftRaidEntries)
    };
    state.dirtyDraft = false;
    state.draftSource = source;
    state.showOneOnOneCompletedHistory = false;
    state.lastAutoSaveAt = "";
    state.workflowStep = tab;
    state.attachedUpdateEditingId = "";
    state.attachedUpdateFeedback = "";
    state.reviewComposerDraft = buildDefaultLinkedUpdateDraft(meeting.chairId || "");
    if (noteTemplate) {
      state.draft.notes = `${state.draft.notes || ""}${state.draft.notes ? "\n" : ""}${noteTemplate}`;
      state.dirtyDraft = true;
    }
    renderMeetingModal();
    setUnsavedChangesGuard(true);
  }

  function closeEditor() {
    // Closing the modal is treated as an explicit discard action for any
    // local autosave snapshot. This prevents stale drafts from re-opening
    // unexpectedly the next time the Meetings module is visited.
    clearDraft(mode);
    state.draft = null;
    state.dirtyDraft = false;
    state.draftSource = "";
    modalOverlay.classList.add("hidden");
    modalOverlay.innerHTML = "";

    // Restore focus to the element that launched the modal when it still
    // exists; fallback is the first meeting action button for resiliency.
    if (state.returnFocusElement && state.returnFocusElement.isConnected) {
      state.returnFocusElement.focus();
    } else {
      section.querySelector(".enter-mode-button, .module-button-secondary, button")?.focus();
    }
    state.returnFocusElement = null;
    setUnsavedChangesGuard(false);
  }

  function renderMeetingModal() {
    modalOverlay.innerHTML = "";
    modalOverlay.classList.remove("hidden");

    const modal = document.createElement("aside");
    modal.className = "meeting-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.tabIndex = -1;

    const heading = document.createElement("h2");
    heading.textContent = state.draft.id ? "Edit meeting" : "Create meeting";

    const form = document.createElement("form");
    form.className = "meeting-form";
    // Token-based controls can be conditionally hidden between workflow steps;
    // use explicit submit-time validation to avoid browser focus errors.
    form.noValidate = true;

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

    const peopleOptions = people
      .filter((person) => !person.archived)
      .map((person) => ({ value: person.id, label: person.name || person.id }));
    // Keep chair selection aligned with attendee chips so every person picker
    // across meeting forms uses a consistent typeahead interaction pattern.
    const chairField = buildEntityTokenSingleSelectField({
      label: "Chair",
      options: peopleOptions,
      values: state.draft.chairId ? [state.draft.chairId] : [],
      emptyMessage: "Add people first to select a meeting chair.",
      inputPlaceholder: "Search chair"
    });
    // Person-entity selection benefits from token-based autocomplete because it scales better than
    // native <select multiple> for long directories while still constraining IDs to canonical people.
    const attendeeField = buildEntityTokenMultiSelectField({
      label: "Attendees",
      options: people
        .filter((person) => !person.archived)
        .map((person) => ({ value: person.id, label: person.name || person.id })),
      values: state.draft.attendeeIds || [],
      emptyMessage: "Add people first to select meeting attendees.",
      inputPlaceholder: "Search attendees"
    });

    const projectWrap = document.createElement("label");
    projectWrap.className = "field-label";
    projectWrap.textContent = "Project";
    const projectSelect = document.createElement("select");
    projectSelect.className = "field-input";
    addOption(projectSelect, "", "Not linked to a project.");
    projects.forEach((project) => {
      addOption(projectSelect, project.id, project.title);
    });
    projectSelect.value = state.draft.projectId || "";
    projectWrap.appendChild(projectSelect);

    // Group related scheduling metadata so the modal header area stays compact.
    const scheduleRow = buildInlineFieldRow([
      dateInput.wrapper,
      startInput.wrapper,
      endInput.wrapper
    ], "meeting-inline-row-triple");

    // Keep the most frequently adjusted metadata together on one row.
    const metadataRow = buildInlineFieldRow([
      typeWrap,
      statusWrap,
      projectWrap
    ], "meeting-inline-row-triple");

    const participantsRow = buildInlineFieldRow([
      chairField.wrapper,
      attendeeField.wrapper
    ], "meeting-inline-row-double");

    const workflowNav = document.createElement("div");
    workflowNav.className = "meeting-workflow-nav";

    const planStepButton = document.createElement("button");
    planStepButton.type = "button";
    planStepButton.className = "module-button-secondary";
    planStepButton.textContent = "1. Plan";

    const attendStepButton = document.createElement("button");
    attendStepButton.type = "button";
    attendStepButton.className = "module-button-secondary";
    attendStepButton.textContent = "2. Attend";

    const reviewStepButton = document.createElement("button");
    reviewStepButton.type = "button";
    reviewStepButton.className = "module-button-secondary";
    reviewStepButton.textContent = "3. Review";

    workflowNav.append(planStepButton, attendStepButton, reviewStepButton);

    const oneOnOneUpdatesPanel = document.createElement("section");
    oneOnOneUpdatesPanel.className = "meeting-one-on-one-updates";

    const oneOnOneUpdatesHeading = document.createElement("h3");
    oneOnOneUpdatesHeading.textContent = "1:1 follow-up updates";

    const oneOnOneUpdatesDescription = document.createElement("p");
    oneOnOneUpdatesDescription.className = "module-intro";
    oneOnOneUpdatesDescription.textContent =
      "Review update follow-ups for the selected attendee without leaving the meeting modal.";

    const oneOnOneUpdatesToggleLabel = document.createElement("label");
    oneOnOneUpdatesToggleLabel.className = "field-label field-checkbox meeting-one-on-one-toggle";

    const oneOnOneUpdatesToggle = document.createElement("input");
    oneOnOneUpdatesToggle.type = "checkbox";
    oneOnOneUpdatesToggle.checked = Boolean(state.showOneOnOneCompletedHistory);

    const oneOnOneUpdatesToggleText = document.createElement("span");
    oneOnOneUpdatesToggleText.textContent = "Show completed history";
    oneOnOneUpdatesToggleLabel.append(oneOnOneUpdatesToggle, oneOnOneUpdatesToggleText);

    const oneOnOneUpdatesList = document.createElement("ul");
    oneOnOneUpdatesList.className = "contact-trail meeting-one-on-one-list";

    const renderOneOnOneUpdatesPanel = () => {
      const attendeeIds = Array.isArray(state.draft.attendeeIds) ? state.draft.attendeeIds : [];
      const isOneOnOneMeeting = state.draft.type === "one-on-one";

      // This panel intentionally only appears in 1:1 meetings because update follow-ups are
      // person-specific. Showing the same panel for standard group meetings is ambiguous and
      // would suggest one attendee's status represents the full room.
      oneOnOneUpdatesPanel.classList.toggle("hidden", !isOneOnOneMeeting);
      if (!isOneOnOneMeeting) {
        return;
      }

      oneOnOneUpdatesList.innerHTML = "";
      oneOnOneUpdatesToggle.checked = Boolean(state.showOneOnOneCompletedHistory);

      if (attendeeIds.length !== 1) {
        oneOnOneUpdatesDescription.textContent =
          "1:1 follow-up updates are person-specific, so this view requires exactly one attendee.";
        oneOnOneUpdatesToggleLabel.classList.add("hidden");
        const guidance = document.createElement("li");
        guidance.textContent = attendeeIds.length === 0
          ? "Select one attendee to view 1:1 follow-up updates."
          : "Select only one attendee to view 1:1 follow-up updates.";
        oneOnOneUpdatesList.appendChild(guidance);
        return;
      }

      const attendeeId = attendeeIds[0];
      const attendee = people.find((person) => person.id === attendeeId);
      oneOnOneUpdatesToggleLabel.classList.remove("hidden");
      oneOnOneUpdatesDescription.textContent =
        `Review pending updates for ${attendee?.name || attendeeId}. Toggle history to include completed items.`;

      const updatesSnapshot = loadUpdates(mode);
      const meetingsById = new Map(
        loadMeetings(mode)
          .filter((meeting) => !meeting.archived)
          .map((meeting) => [meeting.id, meeting])
      );
      const personUpdates = selectUpdatesForPerson(updatesSnapshot, attendeeId, { includeCompleted: true });
      const visibleUpdates = personUpdates.filter(({ entry }) => state.showOneOnOneCompletedHistory || entry.status === "pending");

      if (!visibleUpdates.length) {
        const empty = document.createElement("li");
        empty.textContent = state.showOneOnOneCompletedHistory
          ? "No updates linked to this attendee yet."
          : "No pending updates for this attendee.";
        oneOnOneUpdatesList.appendChild(empty);
        return;
      }

      visibleUpdates.forEach(({ update, entry }) => {
        const row = document.createElement("li");

        const summary = document.createElement("div");
        summary.className = "meeting-one-on-one-summary";
        const topLine = document.createElement("div");
        topLine.className = "meeting-one-on-one-summary-top";
        topLine.append(buildUpdateTypePill(update.entityType));

        const text = document.createElement("span");
        text.textContent = update.text;
        topLine.appendChild(text);

        const metaLine = document.createElement("small");
        metaLine.className = "module-intro";
        const linkedMeeting = update.meetingId ? meetingsById.get(update.meetingId) : null;
        const metaParts = [];

        if (update.ownerId) {
          metaParts.push(`Owner: ${resolveUpdateOwnerLabel(update.ownerId, people)}`);
        }
        if (update.dueDate) {
          metaParts.push(`Due: ${formatDate(update.dueDate)}`);
        }
        if (linkedMeeting) {
          metaParts.push(`Meeting: ${linkedMeeting.name} (${formatDate(linkedMeeting.date)})`);
        }

        if (entry.status === "updated") {
          const completedDate = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : "recently";
          metaParts.push(`Completed: ${completedDate}`);
        }

        metaLine.textContent = metaParts.length ? metaParts.join(" · ") : "No additional details.";
        summary.append(topLine, metaLine);

        const quickActions = document.createElement("div");
        quickActions.className = "meeting-one-on-one-actions";

        const markUpdatedButton = document.createElement("button");
        markUpdatedButton.type = "button";
        markUpdatedButton.className = "button button-secondary";
        markUpdatedButton.textContent = "Mark updated";
        markUpdatedButton.disabled = entry.status === "updated";
        markUpdatedButton.addEventListener("click", () => {
          markPersonUpdated(update.id, attendeeId);
          renderOneOnOneUpdatesPanel();
        });

        const markPendingButton = document.createElement("button");
        markPendingButton.type = "button";
        markPendingButton.className = "button button-secondary";
        markPendingButton.textContent = "Mark pending";
        markPendingButton.disabled = entry.status === "pending";
        markPendingButton.addEventListener("click", () => {
          markPersonPending(update.id, attendeeId);
          renderOneOnOneUpdatesPanel();
        });

        quickActions.append(markUpdatedButton, markPendingButton);
        row.append(summary, quickActions);
        oneOnOneUpdatesList.appendChild(row);
      });
    };

    oneOnOneUpdatesToggle.addEventListener("change", () => {
      state.showOneOnOneCompletedHistory = oneOnOneUpdatesToggle.checked;
      renderOneOnOneUpdatesPanel();
    });

    oneOnOneUpdatesPanel.append(
      oneOnOneUpdatesHeading,
      oneOnOneUpdatesDescription,
      oneOnOneUpdatesToggleLabel,
      oneOnOneUpdatesList
    );

    const notesWrap = document.createElement("label");
    notesWrap.className = "field-label";
    notesWrap.textContent = "Meeting notes (Markdown supported)";
    const notesInput = document.createElement("textarea");
    notesInput.className = "field-input field-textarea meeting-notes-input";
    notesInput.value = state.draft.notes || "";

    const notesQuickActions = document.createElement("div");
    notesQuickActions.className = "meeting-notes-quick-actions";

    const addTemplateButton = (label, template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "module-button-secondary";
      button.textContent = label;
      button.addEventListener("click", () => {
        const nextValue = `${notesInput.value}${notesInput.value ? "\n" : ""}${template}`;
        notesInput.value = nextValue;
        state.draft.notes = nextValue;
        notesPreview.textContent = nextValue || "No notes added.";
        syncRenderedReviewNotes();
      });
      notesQuickActions.appendChild(button);
    };
    addTemplateButton("Action", "- [Action] owner: @person due: YYYY-MM-DD");
    addTemplateButton("Decision", "- [Decision] outcome: ...");
    addTemplateButton("Update", "- [Update] recipients: @person");

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
    notesPreview.textContent = state.draft.notes || "No notes added.";

    notesWrap.append(notesQuickActions, notesInput, lockInfo, toggleLabel, notesPreview);

    // Review-step reference panel keeps notes visible while converting raw notes
    // into structured update/action rows.
    const reviewNotesPanel = document.createElement("section");
    reviewNotesPanel.className = "meeting-review-notes";

    const reviewNotesHeading = document.createElement("h3");
    reviewNotesHeading.textContent = "Rendered meeting notes";

    const reviewNotesRendered = document.createElement("div");
    reviewNotesRendered.className = "meeting-review-notes-rendered";

    const syncRenderedReviewNotes = () => {
      reviewNotesRendered.innerHTML = "";
      reviewNotesRendered.appendChild(renderSimpleMarkdown(state.draft.notes || "No notes added."));
    };
    syncRenderedReviewNotes();

    reviewNotesPanel.append(reviewNotesHeading, reviewNotesRendered);

    const autoSaveText = document.createElement("small");
    autoSaveText.className = "module-intro";
    autoSaveText.textContent = state.lastAutoSaveAt
      ? `Auto-saved at ${state.lastAutoSaveAt}`
      : "Auto-save runs while typing notes.";

    // Embedded update composer is opt-in so meeting-only edits remain quick.
    const updateComposerWrap = document.createElement("section");
    updateComposerWrap.className = "meeting-update-composer";

    const updateTitle = document.createElement("h3");
    updateTitle.textContent = "Meeting review items";

    const updateFields = document.createElement("div");
    updateFields.className = "meeting-update-fields";

    const updateComposerForm = document.createElement("div");
    updateComposerForm.className = "meeting-update-row";

    const updateRows = document.createElement("div");
    updateRows.className = "meeting-update-rows";

    const updateActions = document.createElement("div");
    updateActions.className = "meeting-update-actions";

    const addUpdateRowButton = document.createElement("button");
    addUpdateRowButton.type = "button";
    addUpdateRowButton.className = "enter-mode-button";
    addUpdateRowButton.textContent = "Add to meeting outputs";

    updateActions.appendChild(addUpdateRowButton);

    const updateHint = document.createElement("small");
    updateHint.className = "module-intro";
    updateHint.textContent =
      "You can add multiple linked updates. Meeting is always saved first so each update links to a durable meeting id.";

    const activePeople = selectActivePeople(people);
    const updateOwnerOptions = buildUpdateOwnerOptions(activePeople);
    const activeOwnerIds = new Set(activePeople.map((person) => person.id));
    const updateRecipientOptions = activePeople.map((person) => ({ value: person.id, label: person.name || person.id }));

    const linkedUpdateValidationMessage = document.createElement("p");
    linkedUpdateValidationMessage.className = "module-intro";

    // Single-form workflow state: one composer at a time, confirmed rows below.
    state.reviewComposerDraft = normaliseDraftLinkedUpdates([state.reviewComposerDraft], state.draft.chairId)[0];

    const composeTextWrap = document.createElement("label");
    composeTextWrap.className = "field-label";
    composeTextWrap.textContent = "Update text";
    const composeTextInput = document.createElement("textarea");
    composeTextInput.className = "field-input field-textarea";
    composeTextInput.placeholder = "Summarise the meeting update";
    composeTextInput.value = state.reviewComposerDraft.text || "";
    composeTextInput.addEventListener("input", () => {
      state.reviewComposerDraft.text = composeTextInput.value;
    });
    composeTextWrap.appendChild(composeTextInput);

    const composeTypeField = buildSingleSelectField({
      label: "Type",
      options: [
        { value: "update", label: "Update" },
        { value: "action", label: "Action" },
        { value: "decision", label: "Decision" }
      ],
      value: state.reviewComposerDraft.entityType || "update"
    });

    const composeOwnerField = buildSingleSelectField({
      label: "Update owner",
      options: updateOwnerOptions,
      value: state.reviewComposerDraft.ownerId,
      emptyMessage: "Add people first to select an owner."
    });

    const composeDueDateField = buildLabeledInput("Due date", "date", state.reviewComposerDraft.dueDate || "");

    const composeRecipientsField = buildEntityTokenMultiSelectField({
      label: "People to update",
      options: updateRecipientOptions,
      values: state.reviewComposerDraft.recipientIds,
      emptyMessage: "Add people first to select recipients.",
      inputPlaceholder: "Search people to update"
    });

    const composerMetadataRow = document.createElement("div");
    composerMetadataRow.className = "meeting-update-row-metadata";
    composerMetadataRow.append(composeTypeField.wrapper, composeDueDateField.wrapper, composeOwnerField.wrapper);

    updateComposerForm.append(composeTextWrap, composerMetadataRow, composeRecipientsField.wrapper);

    const syncComposerRequirements = () => {
      const selectedType = composeTypeField.select.value;
      const isAction = selectedType === "action";
      const isDecision = selectedType === "decision";
      composeDueDateField.input.required = isAction;
      composeOwnerField.select.required = isAction;
      composeRecipientsField.wrapper.classList.toggle("hidden", isDecision);
    };

    const syncComposerDraft = () => {
      state.reviewComposerDraft = {
        text: composeTextInput.value,
        entityType: composeTypeField.select.value,
        ownerId: composeOwnerField.select.value,
        dueDate: composeDueDateField.input.value,
        recipientIds: readEntityTokenHiddenValues(composeRecipientsField.hiddenInput)
      };
      syncComposerRequirements();
      state.dirtyDraft = true;
    };

    composeTypeField.select.addEventListener("change", syncComposerDraft);
    composeOwnerField.select.addEventListener("change", syncComposerDraft);
    composeDueDateField.input.addEventListener("input", syncComposerDraft);
    composeRecipientsField.hiddenInput.addEventListener("input", syncComposerDraft);
    syncComposerRequirements();

    const renderLinkedUpdateRows = () => {
      updateRows.innerHTML = "";
      const linkedUpdates = normaliseDraftLinkedUpdates(state.draft.draftLinkedUpdates, state.draft.chairId);
      state.draft.draftLinkedUpdates = linkedUpdates;

      if (!linkedUpdates.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No queued review items yet. Use the form above to add one.";
        updateRows.appendChild(empty);
        return;
      }

      linkedUpdates.forEach((linkedUpdate, index) => {
        const rowWrap = document.createElement("article");
        rowWrap.className = "meeting-update-row";

        const rowTitle = document.createElement("p");
        rowTitle.className = "module-intro";
        rowTitle.textContent = `Linked update ${index + 1}`;

        const updateSummary = document.createElement("p");
        updateSummary.className = "module-intro";
        updateSummary.textContent = linkedUpdate.text || "(blank)";

        const updateMeta = document.createElement("p");
        updateMeta.className = "module-intro";
        updateMeta.textContent = [
          `Type: ${toTitleCase(linkedUpdate.entityType || "update")}`,
          `Owner: ${resolveUpdateOwnerLabel(linkedUpdate.ownerId, people)}`,
          `Due: ${linkedUpdate.dueDate || "Not set"}`,
          `Recipients: ${linkedUpdate.recipientIds.length}`
        ].join(" · ");

        const removeUpdateRowButton = document.createElement("button");
        removeUpdateRowButton.type = "button";
        removeUpdateRowButton.className = "module-button-secondary";
        removeUpdateRowButton.textContent = "Remove";
        removeUpdateRowButton.addEventListener("click", () => {
          state.draft.draftLinkedUpdates.splice(index, 1);
          state.dirtyDraft = true;
          renderLinkedUpdateRows();
        });

        const rowActions = document.createElement("div");
        rowActions.className = "tasks-row-actions";
        rowActions.append(removeUpdateRowButton);

        rowWrap.append(
          rowTitle,
          updateSummary,
          updateMeta,
          rowActions
        );
        updateRows.appendChild(rowWrap);
      });
    };

    addUpdateRowButton.addEventListener("click", () => {
      syncComposerDraft();
      const row = normaliseDraftLinkedUpdates([state.reviewComposerDraft], state.draft.chairId)[0];
      if (!row.text.trim()) {
        linkedUpdateValidationMessage.textContent = "Add text to confirm this output item.";
        return;
      }
      if (row.entityType === "action" && !row.ownerId) {
        linkedUpdateValidationMessage.textContent = "Actions require an owner.";
        return;
      }
      if (row.entityType === "action" && !row.dueDate) {
        linkedUpdateValidationMessage.textContent = "Actions require a due date.";
        return;
      }
      if (row.entityType !== "decision" && !row.recipientIds.length) {
        linkedUpdateValidationMessage.textContent = "Updates and actions require at least one recipient.";
        return;
      }

      linkedUpdateValidationMessage.textContent = "";
      state.draft.draftLinkedUpdates.push(row);
      state.dirtyDraft = true;
      state.reviewComposerDraft = buildDefaultLinkedUpdateDraft(state.draft.chairId);
      renderMeetingModal();
    });

    updateFields.append(updateComposerForm, linkedUpdateValidationMessage, updateActions, updateRows, updateHint);
    updateComposerWrap.append(updateTitle, updateFields);

    const planScreen = document.createElement("section");
    const attendScreen = document.createElement("section");
    // Attend step now uses a split-pane layout so notes stay visible while
    // 1:1 pending updates remain actionable in the same viewport.
    attendScreen.className = "meeting-attend-layout";
    const reviewScreen = document.createElement("section");

    const optionalPlanFields = document.createElement("details");
    optionalPlanFields.className = "meeting-plan-optional";
    const optionalSummary = document.createElement("summary");
    optionalSummary.textContent = "Optional meeting details";
    optionalPlanFields.append(optionalSummary, metadataRow, participantsRow);

    const oneOnOneHint = document.createElement("p");
    oneOnOneHint.className = "module-intro";
    oneOnOneHint.textContent = "1:1 meetings support a simplified attendee flow: choose one person in attendees.";

    planScreen.append(nameInput.wrapper, scheduleRow, oneOnOneHint, optionalPlanFields);
    // 1:1 pending update context is most useful while taking notes in-meeting,
    // so we place this panel in Attend rather than Review.
    attendScreen.append(notesWrap, oneOnOneUpdatesPanel);
    const reviewLayout = document.createElement("div");
    reviewLayout.className = "meeting-review-layout";
    reviewLayout.append(updateComposerWrap, reviewNotesPanel);

    const attachedUpdatesSection = document.createElement("section");
    attachedUpdatesSection.className = "meeting-attached-updates";

    const attachedUpdatesHeading = document.createElement("h3");
    attachedUpdatesHeading.textContent = "Attached updates/actions";

    const attachedUpdatesDescription = document.createElement("p");
    attachedUpdatesDescription.className = "module-intro";
    attachedUpdatesDescription.textContent =
      "Review and edit updates already linked to this meeting without leaving the modal.";

    const attachedUpdatesList = document.createElement("div");
    attachedUpdatesList.className = "meeting-attached-updates-list";

    const attachedUpdatesFeedback = document.createElement("p");
    attachedUpdatesFeedback.className = "module-intro";

    const renderAttachedUpdatesSection = () => {
      attachedUpdatesList.innerHTML = "";
      attachedUpdatesFeedback.textContent = state.attachedUpdateFeedback || "";

      // Existing meeting-linked follow-ups are discoverable here so users can
      // confirm and adjust previous review output while editing meeting details.
      const attachedUpdates = state.draft.id
        ? loadUpdates(mode)
            .filter((update) => !update.archived)
            .filter((update) => update.meetingId === state.draft.id)
        : [];

      if (!state.draft.id) {
        const guidance = document.createElement("p");
        guidance.className = "empty-state";
        guidance.textContent = "Save this meeting first to view and edit attached updates/actions.";
        attachedUpdatesList.appendChild(guidance);
        return;
      }

      if (!attachedUpdates.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No updates/actions are attached to this meeting yet.";
        attachedUpdatesList.appendChild(empty);
        return;
      }

      attachedUpdates.forEach((attachedUpdate) => {
        const card = document.createElement("article");
        card.className = "meeting-attached-update-card";

        const title = document.createElement("p");
        title.className = "module-intro";
        title.append(buildUpdateTypePill(attachedUpdate.entityType), document.createTextNode(` ${attachedUpdate.text}`));

        const meta = document.createElement("p");
        meta.className = "module-intro";
        meta.textContent = [
          `Owner: ${resolveUpdateOwnerLabel(attachedUpdate.ownerId, people)}`,
          `Due: ${attachedUpdate.dueDate || "Not set"}`,
          `Recipients: ${normaliseToUpdateList(attachedUpdate.toUpdate).length}`
        ].join(" · ");

        card.append(title, meta);

        const isEditing = state.attachedUpdateEditingId === attachedUpdate.id;
        if (!isEditing) {
          const editButton = document.createElement("button");
          editButton.type = "button";
          editButton.className = "module-button-secondary";
          editButton.textContent = "Edit attached update";
          editButton.addEventListener("click", () => {
            state.attachedUpdateEditingId = attachedUpdate.id;
            state.attachedUpdateFeedback = "";
            renderAttachedUpdatesSection();
          });
          card.appendChild(editButton);
          attachedUpdatesList.appendChild(card);
          return;
        }

        const editForm = document.createElement("form");
        editForm.className = "meeting-attached-update-form";

        const typeField = buildSingleSelectField({
          label: "Type",
          options: [
            { value: "update", label: "Update" },
            { value: "action", label: "Action" }
          ],
          value: attachedUpdate.entityType || "update"
        });

        const textField = document.createElement("label");
        textField.className = "field-label";
        textField.textContent = "Text";
        const textInput = document.createElement("textarea");
        textInput.className = "field-input field-textarea";
        // Clearing text in attached-update edit mode triggers quiet deletion.
        textInput.required = false;
        textInput.value = attachedUpdate.text;
        textField.appendChild(textInput);

        const ownerField = buildSingleSelectField({
          label: "Owner",
          options: updateOwnerOptions,
          value: attachedUpdate.ownerId,
          emptyMessage: "Add people first to select an owner."
        });

        const dueDateField = buildLabeledInput("Due date", "date", attachedUpdate.dueDate || "");

        const metadataFields = document.createElement("div");
        metadataFields.className = "meeting-update-row-metadata";
        metadataFields.append(typeField.wrapper, dueDateField.wrapper, ownerField.wrapper);

        const formActions = document.createElement("div");
        formActions.className = "tasks-row-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "module-button-secondary";
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", () => {
          state.attachedUpdateEditingId = "";
          state.attachedUpdateFeedback = "";
          renderAttachedUpdatesSection();
        });

        const saveButton = document.createElement("button");
        saveButton.type = "submit";
        saveButton.className = "enter-mode-button";
        saveButton.textContent = "Save attached update";

        formActions.append(cancelButton, saveButton);
        editForm.append(textField, metadataFields, formActions);

        editForm.addEventListener("submit", (event) => {
          event.preventDefault();

          const result = saveUpdate(
            mode,
            {
              ...attachedUpdate,
              text: textInput.value,
              entityType: typeField.select.value,
              ownerId: ownerField.select.value,
              dueDate: dueDateField.input.value
            },
            attachedUpdate.id,
            activePeople
          );

          if (!result.ok) {
            state.attachedUpdateFeedback = result.error || "Unable to save attached update.";
            renderAttachedUpdatesSection();
            return;
          }

          state.attachedUpdateEditingId = "";
          state.attachedUpdateFeedback = result.message || "Attached update saved.";
          renderAttachedUpdatesSection();
        });

        card.appendChild(editForm);
        attachedUpdatesList.appendChild(card);
      });
    };

    attachedUpdatesSection.append(
      attachedUpdatesHeading,
      attachedUpdatesDescription,
      attachedUpdatesFeedback,
      attachedUpdatesList
    );

    const raidSection = document.createElement("section");
    raidSection.className = "meeting-raid-section";
    const raidHeading = document.createElement("h3");
    raidHeading.textContent = "Project RAID capture";
    const raidInfo = document.createElement("p");
    raidInfo.className = "module-intro";
    raidInfo.textContent = "Add RAID items inline. Items are created against the linked project when this meeting is saved.";
    const raidList = document.createElement("div");
    raidList.className = "meeting-raid-draft-list";

    const raidTypeField = buildSingleSelectField({
      label: "Type",
      options: [
        { value: "risk", label: "Risk" },
        { value: "action", label: "Action" },
        { value: "issue", label: "Issue" },
        { value: "decision", label: "Decision" }
      ],
      value: "risk"
    });
    const raidTitle = buildLabeledInput("Title", "text", "", true);
    const raidDate = buildLabeledInput("Date", "date", state.draft.date || isoDateToday(), true);
    const raidDescription = document.createElement("label");
    raidDescription.className = "field-label";
    raidDescription.textContent = "Description";
    const raidDescriptionInput = document.createElement("textarea");
    raidDescriptionInput.className = "field-input";
    raidDescriptionInput.rows = 3;
    raidDescription.appendChild(raidDescriptionInput);
    const raidDetails = document.createElement("label");
    raidDetails.className = "field-label";
    raidDetails.textContent = "Type details";
    const raidDetailsInput = document.createElement("textarea");
    raidDetailsInput.className = "field-input";
    raidDetailsInput.rows = 3;
    raidDetailsInput.placeholder = "Mitigating actions or notes (one per line).";
    raidDetails.appendChild(raidDetailsInput);
    const riskLikelihood = buildLabeledInput("Likelihood (1-5)", "number", "3");
    riskLikelihood.input.min = "1";
    riskLikelihood.input.max = "5";
    const riskImpact = buildLabeledInput("Impact (1-5)", "number", "3");
    riskImpact.input.min = "1";
    riskImpact.input.max = "5";
    const raidStatusField = buildSingleSelectField({ label: "Status", options: [], value: "" });

    const refreshRaidFormByType = () => {
      const selectedType = raidTypeField.select.value;
      raidStatusField.select.innerHTML = "";
      (PROJECT_RAID_STATUSES[selectedType] || ["Open"]).forEach((status) => addOption(raidStatusField.select, status, status));
      riskLikelihood.wrapper.hidden = selectedType !== "risk";
      riskImpact.wrapper.hidden = selectedType !== "risk";
      raidDetailsInput.placeholder = selectedType === "decision"
        ? "Line 1: options considered\nLine 2: decision made"
        : selectedType === "action"
          ? "Progress log entries, one per line"
          : "Mitigating actions, one per line";
    };

    const renderRaidDraftRows = () => {
      raidList.innerHTML = "";
      const rows = normaliseDraftRaidEntries(state.draft.draftRaidEntries);
      state.draft.draftRaidEntries = rows;
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No RAID items staged from this meeting yet.";
        raidList.appendChild(empty);
        return;
      }
      rows.forEach((row, index) => {
        const card = document.createElement("article");
        card.className = "meeting-linked-update-row";
        const heading = document.createElement("strong");
        heading.textContent = `${row.type.toUpperCase()} · ${row.title}`;
        const meta = document.createElement("p");
        meta.className = "module-intro";
        meta.textContent = `${row.date} · ${row.status}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "module-button-secondary";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          state.draft.draftRaidEntries.splice(index, 1);
          state.dirtyDraft = true;
          renderRaidDraftRows();
        });
        card.append(heading, meta, remove);
        raidList.appendChild(card);
      });
    };

    const addRaidRowButton = document.createElement("button");
    addRaidRowButton.type = "button";
    addRaidRowButton.className = "module-button-secondary";
    addRaidRowButton.textContent = "Stage RAID item";
    addRaidRowButton.addEventListener("click", () => {
      const type = raidTypeField.select.value;
      const lines = raidDetailsInput.value.split("\n").map((line) => line.trim()).filter(Boolean);
      const row = {
        type,
        title: raidTitle.input.value.trim(),
        description: raidDescriptionInput.value.trim(),
        date: raidDate.input.value,
        status: raidStatusField.select.value,
        likelihood: Number(riskLikelihood.input.value || 1),
        impact: Number(riskImpact.input.value || 1),
        details: lines
      };
      const validated = validateDraftRaidEntry(row);
      if (validated.error) {
        alert(validated.error);
        return;
      }
      state.draft.draftRaidEntries.push(validated.value);
      state.dirtyDraft = true;
      raidTitle.input.value = "";
      raidDescriptionInput.value = "";
      raidDetailsInput.value = "";
      renderRaidDraftRows();
    });

    raidTypeField.select.addEventListener("change", refreshRaidFormByType);
    refreshRaidFormByType();
    renderRaidDraftRows();

    const raidForm = document.createElement("div");
    raidForm.className = "meeting-linked-update-composer";
    raidForm.append(
      raidTypeField.wrapper,
      raidStatusField.wrapper,
      raidTitle.wrapper,
      raidDate.wrapper,
      raidDescription,
      raidDetails,
      riskLikelihood.wrapper,
      riskImpact.wrapper,
      addRaidRowButton,
      raidList
    );

    raidSection.hidden = !state.draft.projectId;
    raidSection.append(raidHeading, raidInfo, raidForm);

    reviewScreen.append(reviewLayout, attachedUpdatesSection, raidSection);

    const syncWorkflowScreen = () => {
      const activeStep = state.workflowStep || "plan";
      planScreen.classList.toggle("hidden", activeStep !== "plan");
      attendScreen.classList.toggle("hidden", activeStep !== "attend");
      reviewScreen.classList.toggle("hidden", activeStep !== "review");
      planStepButton.disabled = activeStep === "plan";
      attendStepButton.disabled = activeStep === "attend";
      reviewStepButton.disabled = activeStep === "review";
    };

    planStepButton.addEventListener("click", () => {
      state.workflowStep = "plan";
      syncWorkflowScreen();
    });
    attendStepButton.addEventListener("click", () => {
      state.workflowStep = "attend";
      syncWorkflowScreen();
    });
    reviewStepButton.addEventListener("click", () => {
      state.workflowStep = "review";
      syncWorkflowScreen();
    });

    syncWorkflowScreen();
    fields.append(planScreen, attendScreen, reviewScreen);
    renderAttachedUpdatesSection();

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
      requestEditorClose();
    });

    if (state.draft.id) {
      // Destructive delete is intentionally gated behind explicit confirmation
      // to prevent accidental loss during in-meeting editing.
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "module-button-secondary";
      deleteButton.textContent = "Delete meeting";
      deleteButton.addEventListener("click", () => {
        const meetingName = state.draft?.name || "this meeting";
        const shouldDelete = window.confirm(`Delete ${meetingName}? This cannot be undone.`);
        if (!shouldDelete) {
          return;
        }

        const didDelete = deleteMeeting(mode, state.draft.id);
        if (!didDelete) {
          alert("Meeting could not be deleted because it no longer exists.");
          return;
        }

        state.feedback = "Meeting deleted.";
        state.selectedCalendarMeetingId = "";
        clearDraft(mode);
        closeEditor();
        renderModule();
      });

      actions.append(deleteButton);
    }

    actions.append(saveButton, closeButton);
    const modalHeader = document.createElement("div");
    modalHeader.className = "meeting-modal-header";
    modalHeader.append(heading, workflowNav);

    const modalBody = document.createElement("div");
    modalBody.className = "meeting-modal-body";
    modalBody.append(fields);

    const saveValidationMessage = document.createElement("p");
    saveValidationMessage.className = "field-help";
    saveValidationMessage.setAttribute("role", "alert");
    saveValidationMessage.setAttribute("aria-live", "assertive");

    const modalFooter = document.createElement("div");
    modalFooter.className = "meeting-modal-footer";
    modalFooter.append(autoSaveText, saveValidationMessage, actions);

    form.append(modalHeader, modalBody, modalFooter);
    modal.appendChild(form);
    modalOverlay.appendChild(modal);

    const handleModalKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestEditorClose();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        form.requestSubmit();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableSelectors = [
        "button:not([disabled])",
        "[href]",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])"
      ].join(",");
      const focusableElements = Array.from(modal.querySelectorAll(focusableSelectors)).filter(
        (element) => !element.hasAttribute("disabled")
      );

      if (!focusableElements.length) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    modal.addEventListener("keydown", handleModalKeydown);

    // Explicit initial focus supports predictable screen-reader and keyboard
    // entry points each time the meeting dialog opens.
    nameInput.input.focus();

    const syncDraft = () => {
      state.draft.name = nameInput.input.value.trim();
      state.draft.date = dateInput.input.value;
      state.draft.startTime = startInput.input.value;
      state.draft.endTime = endInput.input.value;
      state.draft.type = typeSelect.value;
      state.draft.status = statusSelect.value;
      // UX intentionally constrains selection to canonical entities so free-typed IDs cannot silently
      // create broken references; this improves both data integrity and in-form discoverability.
      const previousChairId = state.draft.chairId;
      state.draft.chairId = readEntityTokenHiddenValues(chairField.hiddenInput)[0] || "";
      const selectedAttendeeIds = readEntityTokenHiddenValues(attendeeField.hiddenInput);
      // Persist attendees in stable insertion order with deduplication so autosave and submit payloads
      // remain deterministic even after repeated add/remove cycles inside the token control.
      state.draft.attendeeIds = [...new Set(selectedAttendeeIds)];
      // Keep linked update owner defaults aligned with chair changes when rows are still unassigned.
      if (previousChairId !== state.draft.chairId) {
        state.draft.draftLinkedUpdates = normaliseDraftLinkedUpdates(state.draft.draftLinkedUpdates, previousChairId).map((row) => {
          if (row.ownerId && row.ownerId !== previousChairId) {
            return row;
          }
          return {
            ...row,
            ownerId: state.draft.chairId
          };
        });

        // Keep the single review composer aligned with chair-owner defaults.
        if (!state.reviewComposerDraft.ownerId || state.reviewComposerDraft.ownerId === previousChairId) {
          state.reviewComposerDraft = {
            ...state.reviewComposerDraft,
            ownerId: state.draft.chairId
          };
        }
        renderLinkedUpdateRows();
      }
      state.draft.projectId = projectSelect.value;
      raidSection.hidden = !state.draft.projectId;
      state.draft.allowPostStatusEdits = toggle.checked;
      if (!notesInput.disabled) {
        state.draft.notes = notesInput.value;
      }
      notesPreview.textContent = state.draft.notes || "No notes added.";
      syncRenderedReviewNotes();
      renderOneOnOneUpdatesPanel();
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
      chairField.hiddenInput,
      attendeeField.hiddenInput,
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
      saveValidationMessage.textContent = "";

      const meetingValidationErrors = [];
      if (!state.draft.name) {
        meetingValidationErrors.push("Meeting name is required.");
      }
      if (!state.draft.date) {
        meetingValidationErrors.push("Meeting date is required.");
      }
      if (state.draft.type === "one-on-one" && (!Array.isArray(state.draft.attendeeIds) || state.draft.attendeeIds.length !== 1)) {
        meetingValidationErrors.push("1:1 meetings require exactly one attendee.");
      }

      if (meetingValidationErrors.length) {
        saveValidationMessage.textContent = meetingValidationErrors.join(" ");
        alert(meetingValidationErrors.join("\n"));
        return;
      }

      const linkedUpdateRows = normaliseDraftLinkedUpdates(state.draft.draftLinkedUpdates, state.draft.chairId);

      const validationErrors = [];
      const rowsToPersist = [];
      linkedUpdateRows.forEach((row, index) => {
        const hasRowInput = Boolean(row.text || row.ownerId || row.recipientIds.length || row.dueDate);
        if (!hasRowInput) {
          return;
        }

        // Quiet-delete / quiet-skip behavior for blank row text:
        // if a row is otherwise partially populated but text is blank, we treat
        // it as intentionally removed and do not surface validation errors.
        if (!row.text) {
          return;
        }
        if (row.entityType !== "decision" && !row.recipientIds.length) {
          validationErrors.push(`Linked update ${index + 1}: select at least one recipient for updates/actions.`);
        }
        if (row.ownerId && row.ownerId !== "me" && !activeOwnerIds.has(row.ownerId)) {
          validationErrors.push(`Linked update ${index + 1}: choose an owner from active people, Me, or No owner.`);
        }
        if (row.entityType === "action" && !row.ownerId) {
          validationErrors.push(`Linked update ${index + 1}: actions require an owner.`);
        }
        if (row.entityType === "action" && !row.dueDate) {
          validationErrors.push(`Linked update ${index + 1}: actions require a due date.`);
        }

        rowsToPersist.push({ rowIndex: index, row });
      });

      if (validationErrors.length) {
        const errorText = validationErrors.join(" ");
        linkedUpdateValidationMessage.textContent = errorText;
        saveValidationMessage.textContent = errorText;
        alert(validationErrors.join("\n"));
        return;
      }

      linkedUpdateValidationMessage.textContent = "";

      // Data integrity ordering:
      // 1) Persist the meeting first so newly created meetings receive a stable id.
      // 2) Create linked updates second so each update can reference `meetingId` safely.
      const result = saveMeeting(mode, state.draft, state.draftSource);
      if (!result.ok) {
        saveValidationMessage.textContent = result.error;
        alert(result.error);
        return;
      }

      let message = result.message;
      if (rowsToPersist.length) {
        const updateErrors = [];
        let createdCount = 0;
        const decisionRows = [];

        rowsToPersist.forEach(({ rowIndex, row }) => {
          if (row.entityType === "decision") {
            decisionRows.push({
              id: buildId(),
              text: row.text,
              ownerId: row.ownerId || "",
              date: state.draft.date,
              projectId: state.draft.projectId || ""
            });
            return;
          }

          const updateResult = saveUpdate(
            mode,
            {
              text: row.text,
              entityType: row.entityType || "update",
              ownerId: row.ownerId,
              dueDate: row.dueDate || "",
              toUpdate: row.recipientIds.map((personId) => ({ personId, status: "pending", required: true, updatedAt: "" })),
              meetingId: result.meetingId
            },
            "",
            activePeople
          );

          if (!updateResult.ok) {
            updateErrors.push(`Linked output ${rowIndex + 1}: ${updateResult.error || "Failed to create linked update."}`);
            return;
          }

          createdCount += 1;
        });

        if (decisionRows.length) {
          appendMeetingDecisions(mode, result.meetingId, decisionRows);
        }

        if (updateErrors.length) {
          alert([
            "Meeting saved, but some linked outputs could not be created:",
            ...updateErrors
          ].join("\n"));
          return;
        }

        const decisionCount = decisionRows.length;
        message = `${message} ${createdCount} linked update${createdCount === 1 ? "" : "s"} created. ${decisionCount} decision${decisionCount === 1 ? "" : "s"} captured.`;
      }

      const raidErrors = [];
      let raidCreatedCount = 0;
      const raidRows = normaliseDraftRaidEntries(state.draft.draftRaidEntries);
      if (state.draft.projectId && raidRows.length) {
        raidRows.forEach((raidRow, index) => {
          const payload = {
            title: raidRow.title,
            description: raidRow.description,
            date: raidRow.date,
            status: raidRow.status,
            meetingIds: [result.meetingId]
          };
          if (raidRow.type === "risk") {
            payload.likelihood = raidRow.likelihood;
            payload.impact = raidRow.impact;
            payload.mitigatingActions = raidRow.details;
          } else if (raidRow.type === "issue") {
            payload.mitigatingActions = raidRow.details;
          } else if (raidRow.type === "action") {
            payload.detailsLog = raidRow.details.map((text) => ({ text, date: raidRow.date }));
          } else {
            payload.optionsConsidered = raidRow.details[0] || "";
            payload.decisionMade = raidRow.details.slice(1).join(" ");
          }

          const raidResult = upsertProjectRaidEntry(mode, state.draft.projectId, raidRow.type, payload);
          if (!raidResult.ok) {
            raidErrors.push(`RAID item ${index + 1}: ${raidResult.error}`);
            return;
          }
          raidCreatedCount += 1;
        });
      }

      if (raidErrors.length) {
        alert(["Meeting saved, but some RAID items failed:", ...raidErrors].join("\n"));
      }
      if (raidCreatedCount > 0) {
        message = `${message} ${raidCreatedCount} RAID item${raidCreatedCount === 1 ? "" : "s"} captured.`;
      }

      state.feedback = message;
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

    renderLinkedUpdateRows();
    renderOneOnOneUpdatesPanel();
  }

  renderModule();

  // Dashboard deep-links can request opening a specific meeting editor on mount.
  if (!state.draft && initialMeetingId) {
    const focusedMeeting = loadMeetings(mode).find((meeting) => meeting.id === initialMeetingId && !meeting.archived);
    if (focusedMeeting) {
      openEditor(focusedMeeting, { source: "dashboard" });
    }
  }

  if (state.draft) {
    renderMeetingModal();
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
    typeFilter: session?.typeFilter || "all",
    showCompleted: Boolean(session?.showCompleted),
    monthSelectedDate: session?.monthSelectedDate || isoDateToday(),
    monthDensity: session?.monthDensity || "compact",
    // Weekly calendar keeps an explicit selection so users can inspect details
    // before deciding to open the editor modal.
    selectedCalendarMeetingId: session?.selectedCalendarMeetingId || "",
    draft: null,
    dirtyDraft: false,
    draftSource: "",
    feedback: "",
    lastAutoSaveAt: "",
    showOneOnOneCompletedHistory: false,
    workflowStep: "attend",
    attachedUpdateEditingId: "",
    attachedUpdateFeedback: "",
    reviewComposerDraft: buildDefaultLinkedUpdateDraft(""),
    returnFocusElement: null
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

function renderWeeklyCalendar(state, meetingsInRange, allMeetings, range, onSelectMeeting, selectedMeetingId = "", { onOpenMeeting } = {}) {
  const grid = document.createElement("div");
  grid.className = "calendar-grid week-grid";

  const dates = eachDate(range.start, range.end);
  const cardIdsByDate = new Map();

  for (const [index, date] of dates.entries()) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "calendar-day";
    card.addEventListener("click", () => {
      state.selectedCalendarMeetingId = "";
      onOpenMeeting?.(buildDefaultMeeting(date), { tab: "plan" });
    });

    const heading = document.createElement("strong");
    heading.textContent = `${weekdayLabel(date)} ${date}`;

    const meetingsForDate = meetingsVisibleInCalendarDate(allMeetings, date, state);
    const count = document.createElement("span");
    count.textContent = `${meetingsForDate.length} meeting(s)`;

    const entries = buildCalendarMeetingEntries(meetingsForDate, onSelectMeeting, {
      compact: false,
      showAll: true,
      selectedMeetingId
    });

    // Keyboard shortcuts support fast in-meeting navigation without touching a mouse.
    card.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
        return;
      }
      if (event.key === "Escape") {
        state.selectedCalendarMeetingId = "";
        return;
      }
      const selectedMeeting = meetingsInRange.find((meeting) => meeting.id === state.selectedCalendarMeetingId);
      const selectedIndex = meetingsForDate.findIndex((meeting) => meeting.id === selectedMeeting?.id);
      if (event.key === "Enter" && selectedMeeting) {
        event.preventDefault();
        onOpenMeeting?.(selectedMeeting);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = meetingsForDate[Math.min(selectedIndex + 1, meetingsForDate.length - 1)] || meetingsForDate[0];
        if (next) {
          onSelectMeeting(next);
        }
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const previous = meetingsForDate[Math.max(selectedIndex - 1, 0)] || meetingsForDate[meetingsForDate.length - 1];
        if (previous) {
          onSelectMeeting(previous);
        }
      }
    });

    card.append(heading, count, entries);
    grid.appendChild(card);
    cardIdsByDate.set(index, card);
  }

  return grid;
}

function renderMonthlyCalendar(state, meetingsInRange, allMeetings, range, { onOpenEditor, onArchiveToggle, onSelectDate, onChangeDensity }) {
  const layout = document.createElement("div");
  layout.className = "meeting-month-layout";

  const grid = document.createElement("div");
  grid.className = "calendar-grid month-grid";

  for (const date of eachDate(range.start, range.end)) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `calendar-day${state.monthSelectedDate === date ? " selected" : ""}`;
    cell.addEventListener("click", () => {
      onSelectDate?.(date);
    });

    const short = document.createElement("strong");
    short.textContent = date.slice(-2);

    const meetingsForDate = meetingsVisibleInCalendarDate(allMeetings, date, state);
    const count = document.createElement("span");
    count.textContent = meetingsForDate.length ? `${meetingsForDate.length} item(s)` : "—";

    const entries = buildCalendarMeetingEntries(meetingsForDate, onOpenEditor, {
      compact: state.monthDensity === "compact",
      showAll: false,
      selectedMeetingId: ""
    });

    cell.append(short, count, entries);
    grid.appendChild(cell);
  }

  const dayPanel = document.createElement("aside");
  dayPanel.className = "meeting-day-focus-panel";
  const selectedDate = state.monthSelectedDate;
  const meetingsForSelectedDay = meetingsVisibleInCalendarDate(allMeetings, selectedDate, state);

  const panelHeader = document.createElement("div");
  panelHeader.className = "meeting-day-focus-header";
  const panelTitle = document.createElement("h3");
  panelTitle.textContent = `${formatDate(selectedDate)} · ${meetingsForSelectedDay.length} meeting(s)`;

  const densityToggle = document.createElement("div");
  densityToggle.className = "meeting-density-toggle";
  const compactButton = document.createElement("button");
  compactButton.type = "button";
  compactButton.className = "module-button-secondary";
  compactButton.textContent = "Compact";
  compactButton.disabled = state.monthDensity === "compact";
  compactButton.addEventListener("click", () => onChangeDensity?.("compact"));
  const detailedButton = document.createElement("button");
  detailedButton.type = "button";
  detailedButton.className = "module-button-secondary";
  detailedButton.textContent = "Detailed";
  detailedButton.disabled = state.monthDensity === "detailed";
  detailedButton.addEventListener("click", () => onChangeDensity?.("detailed"));
  densityToggle.append(compactButton, detailedButton);
  panelHeader.append(panelTitle, densityToggle);

  const panelList = document.createElement("div");
  panelList.className = "meeting-day-focus-list";
  if (!meetingsForSelectedDay.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No meetings for this day.";
    panelList.appendChild(empty);
  }

  meetingsForSelectedDay.forEach((meeting) => {
    const row = document.createElement("article");
    row.className = "meeting-day-focus-item";

    const title = document.createElement("strong");
    const meetingTime = formatNonNullText(meeting.startTime, "Time TBC");
    title.textContent = `${meetingTime} · ${formatNonNullText(meeting.name, "Untitled meeting")}`;

    const meta = document.createElement("p");
    meta.className = "module-intro";
    const detailParts = [toTitleCase(meeting.status || "scheduled")];
    if (state.monthDensity === "detailed") {
      detailParts.push(meeting.type === "one-on-one" ? "1:1" : "Standard");
    }
    meta.textContent = detailParts.join(" · ");

    const outputs = document.createElement("p");
    outputs.className = "meeting-output-badges";
    const summary = buildMeetingOutputsSummary(meeting, loadUpdates("work"));
    outputs.textContent = `A:${summary.actions} U:${summary.updates} D:${summary.decisions}`;

    const controls = document.createElement("div");
    controls.className = "meeting-controls";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "module-button-secondary";
    openButton.textContent = "Open";
    openButton.addEventListener("click", () => onOpenEditor(meeting));

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "module-button-secondary";
    archiveButton.textContent = meeting.archived ? "Restore" : "Archive";
    archiveButton.addEventListener("click", () => onArchiveToggle(meeting));

    controls.append(openButton, archiveButton);
    row.append(title, meta, outputs, controls);
    panelList.appendChild(row);
  });

  dayPanel.append(panelHeader, panelList);
  layout.append(grid, dayPanel);
  return layout;
}

function buildInlineFieldRow(fieldElements, layoutClass) {
  const row = document.createElement("div");
  row.className = `meeting-inline-row ${layoutClass}`;
  fieldElements.forEach((element) => row.appendChild(element));
  return row;
}

function buildCalendarMeetingEntries(
  meetingsForDate,
  onMeetingClick,
  { compact = false, showAll = false, selectedMeetingId = "" } = {}
) {
  const wrap = document.createElement("div");
  wrap.className = `calendar-meeting-entries${compact ? " compact" : ""}`;

  const visibleMeetings = showAll ? meetingsForDate : meetingsForDate.slice(0, compact ? 2 : 3);
  for (const meeting of visibleMeetings) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = `calendar-meeting-entry ${resolveMeetingStatusClass(meeting.status)}${selectedMeetingId === meeting.id ? " selected" : ""}`;
    entry.addEventListener("click", (event) => {
      event.stopPropagation();
      onMeetingClick(meeting, { source: "calendar-entry" });
    });

    const primaryLine = document.createElement("span");
    primaryLine.className = "calendar-meeting-entry-primary";
    primaryLine.textContent = compact
      ? `${formatNonNullText(meeting.startTime, "Time TBC")} · ${formatNonNullText(meeting.name, "Untitled meeting")}`
      : `${formatNonNullText(meeting.startTime, "Time TBC")}${meeting.endTime ? `–${meeting.endTime}` : ""} · ${formatNonNullText(meeting.name, "Untitled meeting")}`;

    const secondaryLine = document.createElement("span");
    secondaryLine.className = "calendar-meeting-entry-meta";
    const outputSummary = buildMeetingOutputsSummary(meeting, loadUpdates("work"));
    secondaryLine.textContent = [
      toTitleCase(meeting.status),
      meeting.type === "one-on-one" ? "1:1" : "Standard",
      meeting.projectId ? `Project linked` : "No project",
      `A:${outputSummary.actions} U:${outputSummary.updates} D:${outputSummary.decisions}`
    ].join(" · ");

    entry.append(primaryLine, secondaryLine);
    wrap.appendChild(entry);
  }

  if (meetingsForDate.length > visibleMeetings.length) {
    const more = document.createElement("small");
    more.className = "module-intro";
    more.textContent = `+${meetingsForDate.length - visibleMeetings.length} more`;
    wrap.appendChild(more);
  }

  return wrap;
}

/**
 * Renders the weekly-view details panel shown after selecting a calendar entry.
 * Clicking the card opens the full editor modal for the selected meeting.
 */
function renderCalendarMeetingDetails(selectedMeeting, people, projects, { onOpenEditor }) {
  const detailsPanel = document.createElement("section");
  detailsPanel.className = "meeting-calendar-details";

  if (!selectedMeeting) {
    const title = document.createElement("strong");
    title.textContent = "Select a meeting in the calendar";
    const hint = document.createElement("span");
    hint.className = "module-intro";
    hint.textContent = "Use arrows to move selection. Enter opens the meeting editor. Esc clears selection.";
    detailsPanel.append(title, hint);
    return detailsPanel;
  }

  const title = document.createElement("strong");
  title.textContent = `${formatNonNullText(selectedMeeting.name, "Untitled meeting")} · ${formatDate(selectedMeeting.date)}`;

  const metadata = document.createElement("span");
  metadata.className = `meeting-calendar-details-meta ${resolveMeetingStatusClass(selectedMeeting.status)}`;
  const projectName = projects.find((project) => project.id === selectedMeeting.projectId)?.title || "Not linked to a project.";
  const outputSummary = buildMeetingOutputsSummary(selectedMeeting, loadUpdates("work"));
  metadata.textContent = [
    `${formatNonNullText(selectedMeeting.startTime, "Time TBC")}${selectedMeeting.endTime ? `–${selectedMeeting.endTime}` : ""}`,
    toTitleCase(selectedMeeting.status),
    selectedMeeting.type === "one-on-one" ? "1:1" : "Standard",
    projectName,
    `A:${outputSummary.actions} U:${outputSummary.updates} D:${outputSummary.decisions}`
  ].join(" · ");

  const actionRow = document.createElement("div");
  actionRow.className = "meeting-controls";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "enter-mode-button";
  openButton.textContent = "Open meeting";
  openButton.addEventListener("click", () => onOpenEditor(selectedMeeting, { tab: "attend" }));

  const quickNote = document.createElement("button");
  quickNote.type = "button";
  quickNote.className = "module-button-secondary";
  quickNote.textContent = "Add note";
  quickNote.addEventListener("click", () => onOpenEditor(selectedMeeting, { tab: "attend" }));

  const quickAction = document.createElement("button");
  quickAction.type = "button";
  quickAction.className = "module-button-secondary";
  quickAction.textContent = "Add action";
  quickAction.addEventListener("click", () => onOpenEditor(selectedMeeting, { tab: "review" }));

  const quickDecision = document.createElement("button");
  quickDecision.type = "button";
  quickDecision.className = "module-button-secondary";
  quickDecision.textContent = "Add decision";
  quickDecision.addEventListener("click", () => onOpenEditor(selectedMeeting, { tab: "review" }));

  actionRow.append(openButton, quickNote, quickAction, quickDecision);
  detailsPanel.append(title, metadata, actionRow);
  return detailsPanel;
}

function renderMeetingRow(meeting, people, projects, { onOpen, onArchiveToggle }) {
  const row = document.createElement("article");
  row.className = `meeting-row ${resolveMeetingStatusClass(meeting.status)}`;

  const heading = document.createElement("button");
  heading.type = "button";
  heading.className = "meeting-open-button";
  heading.textContent = `${formatNonNullText(meeting.name, "Untitled meeting")} · ${formatDate(meeting.date)} · ${toTitleCase(meeting.status || "scheduled")}`;
  heading.addEventListener("click", onOpen);

  const meta = document.createElement("p");
  meta.className = "meeting-meta";

  const attendeeNames = meeting.attendeeIds
    .map((id) => people.find((person) => person.id === id)?.name || formatNonNullText(id, "Unknown"))
    .join(", ");

  meta.textContent = [
    meeting.type === "one-on-one" ? "1:1" : "Standard",
    meeting.chairId ? `Chair: ${formatNonNullText(meeting.chairId, "No chair")}` : "No chair",
    attendeeNames ? `Attendees: ${attendeeNames}` : "No attendees",
    meeting.projectId
      ? `Project: ${projects.find((project) => project.id === meeting.projectId)?.title || meeting.projectId}`
      : "Not linked to a project."
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
    notes: prefill?.notes || "",
    allowPostStatusEdits: false,
    archived: false,
    draftLinkedUpdates: [],
    decisions: [],
    draftRaidEntries: []
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
      // Completed meetings are hidden by default so upcoming work is easier to scan.
      if (!state.showCompleted && meeting.status === "completed") {
        return false;
      }
      if (state.typeFilter !== "all" && meeting.type !== state.typeFilter) {
        return false;
      }
      if (!search) {
        return true;
      }
      return `${meeting.name} ${meeting.notes}`.toLowerCase().includes(search);
    })
    .sort((left, right) => `${left.date}${left.startTime}`.localeCompare(`${right.date}${right.startTime}`));
}

/**
 * Calendar day cards share the same completed visibility rule as the list pane.
 */
function meetingsVisibleInCalendarDate(allMeetings, date, state) {
  return allMeetings
    .filter((meeting) => {
      if (meeting.date !== date || meeting.archived) {
        return false;
      }
      if (!state.showCompleted && meeting.status === "completed") {
        return false;
      }
      return true;
    })
    .sort((first, second) => {
      // Calendar cards are ordered by start time so day columns remain
      // chronologically scannable as meeting volume grows.
      const firstStart = normaliseMeetingTimeForSort(first.startTime);
      const secondStart = normaliseMeetingTimeForSort(second.startTime);
      if (firstStart !== secondStart) {
        return firstStart.localeCompare(secondStart);
      }

      const firstEnd = normaliseMeetingTimeForSort(first.endTime);
      const secondEnd = normaliseMeetingTimeForSort(second.endTime);
      if (firstEnd !== secondEnd) {
        return firstEnd.localeCompare(secondEnd);
      }

      return (first.name || "").localeCompare(second.name || "");
    });
}

/**
 * Converts a potentially-empty time string into a stable sort token.
 * Empty/invalid values are intentionally moved to the end of the day.
 */
function normaliseMeetingTimeForSort(value) {
  const raw = String(value || "").trim();
  if (!raw || !/^\d{2}:\d{2}$/.test(raw)) {
    return "99:99";
  }
  return raw;
}

function resolveMeetingStatusClass(status) {
  return MEETING_STATUS_CLASS_BY_STATUS[status] || MEETING_STATUS_CLASS_BY_STATUS.scheduled;
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
  const normalisedDraft = normaliseMeeting(draft);

  if (draft.id) {
    const index = meetings.findIndex((meeting) => meeting.id === draft.id);
    if (index < 0) {
      return { ok: false, error: "Meeting no longer exists." };
    }
    const existing = meetings[index];
    const statusChanged = existing.status !== normalisedDraft.status;

    meetings[index] = {
      ...existing,
      ...normalisedDraft,
      updatedAt: now,
      statusHistory: statusChanged
        ? [...existing.statusHistory, { status: normalisedDraft.status, at: now }]
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
    return { ok: true, message: "Meeting updated.", meetingId: draft.id };
  }

  const meetingId = buildId();
  meetings.push({
    ...normalisedDraft,
    id: meetingId,
    createdAt: now,
    updatedAt: now,
    statusHistory: [{ status: normalisedDraft.status || "scheduled", at: now }],
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
  return { ok: true, message: "Meeting created.", meetingId };
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

/**
 * Permanently removes a meeting record by id.
 *
 * UI callers must confirm intent before invoking this helper because deletion
 * is destructive and cannot be rolled back from within the app.
 */
function deleteMeeting(mode, meetingId) {
  const meetings = loadMeetings(mode);
  const beforeCount = meetings.length;
  const remaining = meetings.filter((meeting) => meeting.id !== meetingId);
  if (remaining.length === beforeCount) {
    return false;
  }

  persistMeetings(mode, remaining);
  return true;
}

/**
 * Archives every non-archived completed meeting in a single operation.
 *
 * This supports a lightweight post-meeting hygiene workflow where completed
 * meetings can be hidden without affecting upcoming/scheduled records.
 */
function archiveCompletedMeetings(mode) {
  const meetings = loadMeetings(mode);
  const now = new Date().toISOString();
  let archivedCount = 0;

  const updated = meetings.map((meeting) => {
    if (meeting.archived || meeting.status !== "completed") {
      return meeting;
    }

    archivedCount += 1;
    return {
      ...meeting,
      archived: true,
      updatedAt: now,
      auditTrail: [...meeting.auditTrail, { at: now, action: "archived", source: "bulk-completed-archive" }],
      lastUpdatedByField: {
        ...meeting.lastUpdatedByField,
        archived: now
      }
    };
  });

  if (archivedCount > 0) {
    persistMeetings(mode, updated);
  }
  return archivedCount;
}

export function loadMeetings(mode) {
  if (mode !== "work") {
    return [];
  }

  return loadVersionedCollection({
    storageKey: MEETINGS_STORAGE_KEY,
    collectionKey: "meetings",
    schemaVersion: MEETINGS_SCHEMA_VERSION,
    normaliseItem: normaliseMeeting,
    fallback: []
  });
}

function persistMeetings(mode, meetings) {
  if (mode !== "work") {
    return;
  }

  persistVersionedCollection({
    storageKey: MEETINGS_STORAGE_KEY,
    collectionKey: "meetings",
    schemaVersion: MEETINGS_SCHEMA_VERSION,
    records: meetings
  });
}


export function normaliseMeeting(meeting) {
  return {
    id: meeting.id || "",
    name: meeting.name || "",
    date: meeting.date || isoDateToday(),
    startTime: meeting.startTime || "",
    endTime: meeting.endTime || "",
    status: meeting.status || "scheduled",
    type: meeting.type || "standard",
    // Migration-safe fallback: legacy drafts persisted attendees as comma-separated strings.
    attendeeIds: parseEntityIdList(meeting.attendeeIds),
    // Some older records stored chair as free text; preserve the raw string for backward compatibility.
    chairId: String(meeting.chairId || "").trim(),
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
        : {},
    decisions: normaliseMeetingDecisions(meeting.decisions),
    draftRaidEntries: normaliseDraftRaidEntries(meeting.draftRaidEntries)
  };
}


function buildDefaultLinkedUpdateDraft(ownerId = "") {
  return {
    text: "",
    entityType: "update",
    ownerId,
    dueDate: "",
    recipientIds: []
  };
}

function normaliseDraftLinkedUpdates(value, fallbackOwnerId = "") {
  if (!Array.isArray(value) || !value.length) {
    return [];
  }

  const rows = value
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      return {
        text: typeof row.text === "string" ? row.text.trim() : "",
        entityType: ["action", "update", "decision"].includes(row.entityType) ? row.entityType : "update",
        ownerId: typeof row.ownerId === "string" ? row.ownerId : fallbackOwnerId,
        dueDate: typeof row.dueDate === "string" ? row.dueDate : "",
        recipientIds: parseEntityIdList(row.recipientIds)
      };
    })
    .filter(Boolean);

  return rows;
}


function normaliseDraftRaidEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => validateDraftRaidEntry(entry).value)
    .filter(Boolean);
}

function validateDraftRaidEntry(value) {
  if (!value || typeof value !== "object") {
    return { value: null, error: "Invalid RAID entry." };
  }

  const type = ["risk", "action", "issue", "decision"].includes(value.type) ? value.type : "risk";
  const title = String(value.title || "").trim();
  const description = String(value.description || "").trim();
  const date = String(value.date || "").trim();
  const details = Array.isArray(value.details) ? value.details.map((line) => String(line || "").trim()).filter(Boolean) : [];
  const statuses = PROJECT_RAID_STATUSES[type] || ["Open"];
  const status = statuses.includes(value.status) ? value.status : statuses[0];

  if (!title || !description || !date) {
    return { value: null, error: "RAID entries require title, description, and date." };
  }
  if ((type === "risk" || type === "issue") && !details.length) {
    return { value: null, error: `${toTitleCase(type)} entries require mitigating actions.` };
  }
  if (type === "decision" && details.length < 2) {
    return { value: null, error: "Decisions require options considered and decision made." };
  }

  const normalised = {
    type,
    title,
    description,
    date,
    status,
    likelihood: Number.parseInt(String(value.likelihood || 1), 10),
    impact: Number.parseInt(String(value.impact || 1), 10),
    details
  };

  return { value: normalised, error: "" };
}

function normaliseMeetingDecisions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((decision) => {
      if (!decision || typeof decision !== "object") {
        return null;
      }
      const text = typeof decision.text === "string" ? decision.text.trim() : "";
      if (!text) {
        return null;
      }
      return {
        id: typeof decision.id === "string" ? decision.id : buildId(),
        text,
        ownerId: typeof decision.ownerId === "string" ? decision.ownerId : "",
        date: typeof decision.date === "string" ? decision.date : "",
        projectId: typeof decision.projectId === "string" ? decision.projectId : ""
      };
    })
    .filter(Boolean);
}

function appendMeetingDecisions(mode, meetingId, decisions) {
  const meetings = loadMeetings(mode);
  const now = new Date().toISOString();
  const updated = meetings.map((meeting) => {
    if (meeting.id !== meetingId) {
      return meeting;
    }
    return {
      ...meeting,
      decisions: [...normaliseMeetingDecisions(meeting.decisions), ...normaliseMeetingDecisions(decisions)],
      updatedAt: now
    };
  });
  persistMeetings(mode, updated);
}

function buildMeetingOutputsSummary(meeting, updatesSnapshot = []) {
  const safeMeetingId = meeting?.id || "";
  const linkedUpdates = updatesSnapshot.filter((update) => update.meetingId === safeMeetingId && !update.archived);
  return {
    actions: linkedUpdates.filter((update) => update.entityType === "action").length,
    updates: linkedUpdates.filter((update) => update.entityType === "update").length,
    decisions: normaliseMeetingDecisions(meeting?.decisions).length
  };
}

function formatNonNullText(value, fallback = "—") {
  const trimmed = String(value ?? "").trim();
  return trimmed && trimmed !== "null" && trimmed !== "undefined" ? trimmed : fallback;
}

function parseEntityIdList(value) {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(rawValues.map((item) => String(item).trim()).filter(Boolean))];
}

function autoSaveDraft(mode, draft) {
  safeJsonWrite(`second-brain.work.meetings.${mode}.draft`, draft);
}

function loadDraft(mode) {
  const raw = localStorage.getItem(`second-brain.work.meetings.${mode}.draft`);
  if (!raw) {
    return null;
  }
  const parsed = safeJsonParse(raw, null);
  if (!parsed) {
    return null;
  }

  const meetingDraft = normaliseMeeting(parsed);
  return {
    ...meetingDraft,
    draftLinkedUpdates: normaliseDraftLinkedUpdates(parsed.draftLinkedUpdates, meetingDraft.chairId),
    draftRaidEntries: normaliseDraftRaidEntries(parsed.draftRaidEntries)
  };
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

/**
 * Lightweight markdown renderer for meeting-note side-by-side review.
 *
 * Scope intentionally stays small (headers, bullets, emphasis, code, links)
 * so we avoid new dependencies while still making notes readable in review mode.
 */
function renderSimpleMarkdown(markdownText) {
  const container = document.createElement("div");
  const source = String(markdownText || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");

  let currentList = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      currentList = null;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      currentList = null;
      const level = Math.min(headingMatch[1].length, 6);
      const heading = document.createElement(`h${level}`);
      heading.innerHTML = renderInlineMarkdown(headingMatch[2]);
      container.appendChild(heading);
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      if (!currentList) {
        currentList = document.createElement("ul");
        container.appendChild(currentList);
      }
      const item = document.createElement("li");
      item.innerHTML = renderInlineMarkdown(listMatch[1]);
      currentList.appendChild(item);
      continue;
    }

    currentList = null;
    const paragraph = document.createElement("p");
    paragraph.innerHTML = renderInlineMarkdown(line);
    container.appendChild(paragraph);
  }

  return container;
}

function renderInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Mirrors the update-recipient cardinality logic used in updates module so
 * meeting-attached review cards can display stable recipient counts.
 */
function normaliseToUpdateList(toUpdate) {
  if (!Array.isArray(toUpdate)) {
    return [];
  }

  return toUpdate
    .map((entry) => {
      if (typeof entry === "string") {
        const personId = entry.trim();
        return personId ? { personId } : null;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const personId = typeof entry.personId === "string" ? entry.personId.trim() : "";
      const note = typeof entry.note === "string" ? entry.note.trim() : "";
      if (!personId && !note) {
        return null;
      }

      return { personId, note };
    })
    .filter(Boolean);
}

function resolveUpdateOwnerLabel(ownerId, people = []) {
  if (!ownerId) {
    return "No owner";
  }
  if (ownerId === "me") {
    return "Me";
  }

  const owner = people.find((person) => person.id === ownerId && !person.archived);
  return owner?.name || ownerId;
}

/**
 * Shared visual token for update/action type labels.
 */
function buildUpdateTypePill(entityType) {
  const pill = document.createElement("span");
  const type = entityType === "decision" ? "decision" : entityType === "action" ? "action" : "update";
  pill.className = `update-type-pill is-${type}`;
  pill.textContent = toTitleCase(type);
  return pill;
}

function buildId() {
  return generateId("meeting_");
}

export { filterAndSortMeetings, resolveMeetingStatusClass, archiveCompletedMeetings, deleteMeeting };
