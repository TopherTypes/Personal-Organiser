import { loadProjects } from "./projects-store.js";
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

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "meeting-modal-overlay hidden";
  modalOverlay.setAttribute("aria-live", "polite");
  modalOverlay.addEventListener("click", (event) => {
    if (event.target !== modalOverlay) {
      return;
    }
    if (state.dirtyDraft && !window.confirm("Discard unsaved meeting changes?")) {
      return;
    }
    closeEditor();
    renderModule();
  });

  section.append(header, controls, split, modalOverlay);

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
    state.draft = {
      ...meeting,
      draftLinkedUpdates: normaliseDraftLinkedUpdates(meeting.draftLinkedUpdates, meeting.chairId)
    };
    state.dirtyDraft = false;
    state.draftSource = source;
    state.showOneOnOneCompletedHistory = false;
    state.lastAutoSaveAt = "";
    state.workflowStep = "plan";
    renderMeetingModal();
    setUnsavedChangesGuard(true);
  }

  function closeEditor() {
    state.draft = null;
    state.dirtyDraft = false;
    state.draftSource = "";
    modalOverlay.classList.add("hidden");
    modalOverlay.innerHTML = "";
    setUnsavedChangesGuard(false);
  }

  function renderMeetingModal() {
    modalOverlay.innerHTML = "";
    modalOverlay.classList.remove("hidden");

    const modal = document.createElement("aside");
    modal.className = "meeting-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

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
    addOption(projectSelect, "", "No project link");
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

      const personUpdates = selectUpdatesForPerson(loadUpdates(mode), attendeeId, { includeCompleted: true });
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

        const summary = document.createElement("span");
        if (entry.status === "updated") {
          const completedDate = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : "recently";
          summary.textContent = `${update.text} · Completed ${completedDate}`;
        } else {
          summary.textContent = update.text;
        }

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

    // Embedded update composer is opt-in so meeting-only edits remain quick.
    const updateComposerWrap = document.createElement("section");
    updateComposerWrap.className = "meeting-update-composer";

    const updateTitle = document.createElement("h3");
    updateTitle.textContent = "Meeting review items";

    const updateFields = document.createElement("div");
    updateFields.className = "meeting-update-fields";

    const updateRows = document.createElement("div");
    updateRows.className = "meeting-update-rows";

    const updateActions = document.createElement("div");
    updateActions.className = "meeting-update-actions";

    const addUpdateRowButton = document.createElement("button");
    addUpdateRowButton.type = "button";
    addUpdateRowButton.className = "module-button-secondary";
    addUpdateRowButton.textContent = "Add another update/action";

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

    const renderLinkedUpdateRows = () => {
      updateRows.innerHTML = "";
      const linkedUpdates = normaliseDraftLinkedUpdates(state.draft.draftLinkedUpdates, state.draft.chairId);
      state.draft.draftLinkedUpdates = linkedUpdates;

      linkedUpdates.forEach((linkedUpdate, index) => {
        const rowWrap = document.createElement("article");
        rowWrap.className = "meeting-update-row";

        const rowTitle = document.createElement("p");
        rowTitle.className = "module-intro";
        rowTitle.textContent = `Linked update ${index + 1}`;

        const updateTextWrap = document.createElement("label");
        updateTextWrap.className = "field-label";
        updateTextWrap.textContent = "Update text";
        const updateTextInput = document.createElement("textarea");
        updateTextInput.className = "field-input field-textarea";
        updateTextInput.placeholder = "Summarise the meeting update";
        updateTextInput.value = linkedUpdate.text;
        updateTextInput.addEventListener("input", () => {
          state.draft.draftLinkedUpdates[index].text = updateTextInput.value;
          state.dirtyDraft = true;
        });
        updateTextWrap.appendChild(updateTextInput);

        const entityTypeField = buildSingleSelectField({
          label: "Type",
          options: [
            { value: "update", label: "Update" },
            { value: "action", label: "Action" }
          ],
          value: linkedUpdate.entityType || "update"
        });
        entityTypeField.select.addEventListener("change", () => {
          state.draft.draftLinkedUpdates[index].entityType = entityTypeField.select.value;
          state.dirtyDraft = true;
          renderLinkedUpdateRows();
        });

        const updateOwnerField = buildSingleSelectField({
          label: "Update owner",
          options: updateOwnerOptions,
          value: linkedUpdate.ownerId,
          emptyMessage: "Add people first to select an owner."
        });
        if (linkedUpdate.ownerId && linkedUpdate.ownerId !== "me" && !activeOwnerIds.has(linkedUpdate.ownerId)) {
          const invalidOwnerHint = document.createElement("small");
          invalidOwnerHint.className = "module-intro";
          // This explicit inline guidance makes stale IDs visible instead of silently
          // propagating them into save payloads where referential checks would fail later.
          invalidOwnerHint.textContent = "Previous owner is no longer active. Choose an active person, Me, or No owner.";
          updateOwnerField.wrapper.appendChild(invalidOwnerHint);
        }
        updateOwnerField.select.addEventListener("change", () => {
          state.draft.draftLinkedUpdates[index].ownerId = updateOwnerField.select.value;
          linkedUpdateValidationMessage.textContent = "";
          state.dirtyDraft = true;
        });

        const dueDateField = buildLabeledInput("Due date", "date", linkedUpdate.dueDate || "");
        const isAction = (linkedUpdate.entityType || "update") === "action";
        dueDateField.input.required = isAction;
        dueDateField.wrapper.querySelector("input").addEventListener("input", () => {
          state.draft.draftLinkedUpdates[index].dueDate = dueDateField.input.value;
          state.dirtyDraft = true;
        });

        const updateRecipientField = buildEntityTokenMultiSelectField({
          label: "People to update",
          options: updateRecipientOptions,
          values: linkedUpdate.recipientIds,
          emptyMessage: "Add people first to select recipients.",
          inputPlaceholder: "Search people to update"
        });
        updateRecipientField.hiddenInput.addEventListener("input", () => {
          state.draft.draftLinkedUpdates[index].recipientIds = readEntityTokenHiddenValues(updateRecipientField.hiddenInput);
          state.dirtyDraft = true;
        });

        const removeUpdateRowButton = document.createElement("button");
        removeUpdateRowButton.type = "button";
        removeUpdateRowButton.className = "module-button-secondary";
        removeUpdateRowButton.textContent = "Remove update";
        removeUpdateRowButton.disabled = state.draft.draftLinkedUpdates.length <= 1;
        removeUpdateRowButton.addEventListener("click", () => {
          state.draft.draftLinkedUpdates.splice(index, 1);
          if (!state.draft.draftLinkedUpdates.length) {
            state.draft.draftLinkedUpdates.push(buildDefaultLinkedUpdateDraft(state.draft.chairId));
          }
          state.dirtyDraft = true;
          renderLinkedUpdateRows();
        });

        rowWrap.append(
          rowTitle,
          entityTypeField.wrapper,
          updateTextWrap,
          updateOwnerField.wrapper,
          dueDateField.wrapper,
          updateRecipientField.wrapper,
          removeUpdateRowButton
        );
        updateRows.appendChild(rowWrap);
      });
    };

    addUpdateRowButton.addEventListener("click", () => {
      state.draft.draftLinkedUpdates.push(buildDefaultLinkedUpdateDraft(state.draft.chairId));
      state.dirtyDraft = true;
      renderLinkedUpdateRows();
    });

    updateFields.append(updateRows, linkedUpdateValidationMessage, updateActions, updateHint);
    updateComposerWrap.append(updateTitle, updateFields);

    const planScreen = document.createElement("section");
    const attendScreen = document.createElement("section");
    const reviewScreen = document.createElement("section");

    planScreen.append(nameInput.wrapper, scheduleRow, metadataRow, participantsRow);
    attendScreen.append(notesWrap);
    reviewScreen.append(oneOnOneUpdatesPanel, updateComposerWrap);

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
    fields.append(workflowNav, planScreen, attendScreen, reviewScreen);

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
    modal.appendChild(form);
    modalOverlay.appendChild(modal);

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
        renderLinkedUpdateRows();
      }
      state.draft.projectId = projectSelect.value;
      state.draft.allowPostStatusEdits = toggle.checked;
      if (!notesInput.disabled) {
        state.draft.notes = notesInput.value;
      }
      notesPreview.textContent = state.draft.notes || "No notes yet.";
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

      const linkedUpdateRows = normaliseDraftLinkedUpdates(state.draft.draftLinkedUpdates, state.draft.chairId);

      const validationErrors = [];
      const rowsToPersist = [];
      linkedUpdateRows.forEach((row, index) => {
        const hasRowInput = Boolean(row.text || row.ownerId || row.recipientIds.length);
        if (!hasRowInput) {
          return;
        }

        if (!row.text) {
          validationErrors.push(`Linked update ${index + 1}: update text is required.`);
        }
        if (!row.recipientIds.length) {
          validationErrors.push(`Linked update ${index + 1}: select at least one recipient.`);
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
        linkedUpdateValidationMessage.textContent = validationErrors.join(" ");
        alert(validationErrors.join("\n"));
        return;
      }

      linkedUpdateValidationMessage.textContent = "";

      // Data integrity ordering:
      // 1) Persist the meeting first so newly created meetings receive a stable id.
      // 2) Create linked updates second so each update can reference `meetingId` safely.
      const result = saveMeeting(mode, state.draft, state.draftSource);
      if (!result.ok) {
        alert(result.error);
        return;
      }

      let message = result.message;
      if (rowsToPersist.length) {
        const updateErrors = [];
        let createdCount = 0;

        rowsToPersist.forEach(({ rowIndex, row }) => {
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
            updateErrors.push(`Linked update ${rowIndex + 1}: ${updateResult.error || "Failed to create linked update."}`);
            return;
          }

          createdCount += 1;
        });

        if (updateErrors.length) {
          alert([
            "Meeting saved, but some linked updates could not be created:",
            ...updateErrors
          ].join("\n"));
          return;
        }

        message = `${message} ${createdCount} linked update${createdCount === 1 ? "" : "s"} created.`;
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
    draft: null,
    dirtyDraft: false,
    draftSource: "",
    feedback: "",
    lastAutoSaveAt: "",
    showOneOnOneCompletedHistory: false,
    workflowStep: "plan"
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

    const entries = buildCalendarMeetingEntries(meetingsForDate, openEditor);

    card.append(heading, count, entries);
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

    const entries = buildCalendarMeetingEntries(meetingsForDate, openEditor, { compact: true });

    cell.append(short, count, entries);
    grid.appendChild(cell);
  }

  return grid;
}

function buildInlineFieldRow(fieldElements, layoutClass) {
  const row = document.createElement("div");
  row.className = `meeting-inline-row ${layoutClass}`;
  fieldElements.forEach((element) => row.appendChild(element));
  return row;
}

function buildCalendarMeetingEntries(meetingsForDate, openEditor, { compact = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = `calendar-meeting-entries${compact ? " compact" : ""}`;

  const visibleMeetings = meetingsForDate.slice(0, compact ? 2 : 3);
  for (const meeting of visibleMeetings) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "calendar-meeting-entry";
    // Prevent the day-card click handler from creating a new draft when editing an existing meeting.
    entry.addEventListener("click", (event) => {
      event.stopPropagation();
      openEditor(meeting, { source: "calendar-entry" });
    });
    entry.textContent = compact
      ? `${meeting.startTime || "Time TBC"} · ${meeting.name}`
      : `${meeting.startTime || "Time TBC"} — ${meeting.name}`;
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
    notes: prefill?.notes || "",
    allowPostStatusEdits: false,
    archived: false,
    draftLinkedUpdates: [buildDefaultLinkedUpdateDraft(prefill?.chairId || "")]
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
        : {}
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
    return [buildDefaultLinkedUpdateDraft(fallbackOwnerId)];
  }

  const rows = value
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      return {
        text: typeof row.text === "string" ? row.text.trim() : "",
        entityType: row.entityType === "action" ? "action" : "update",
        ownerId: typeof row.ownerId === "string" ? row.ownerId : fallbackOwnerId,
        dueDate: typeof row.dueDate === "string" ? row.dueDate : "",
        recipientIds: parseEntityIdList(row.recipientIds)
      };
    })
    .filter(Boolean);

  return rows.length ? rows : [buildDefaultLinkedUpdateDraft(fallbackOwnerId)];
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
    draftLinkedUpdates: normaliseDraftLinkedUpdates(parsed.draftLinkedUpdates, meetingDraft.chairId)
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

function buildId() {
  return `meeting_${Math.random().toString(36).slice(2, 10)}`;
}
