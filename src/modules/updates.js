import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";
import { buildEntityTokenMultiSelectField, readEntityTokenHiddenValues } from "./select-controls.js";
import { generateId } from "./id.js";

const UPDATES_SCHEMA_VERSION = 1;
const UPDATES_COLLECTION_KEY = "updates";
const WORK_UPDATES_STORAGE_KEY = "second-brain.work.updates.work.v1";
const UPDATE_ENTITY_TYPES = {
  UPDATE: "update",
  ACTION: "action"
};
const UPDATE_LIFECYCLE = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted"
};

/**
 * Manual verification checklist for this module overhaul:
 * 1) Create standalone update with 2 recipients; mark one complete and confirm pending count decrements live.
 * 2) Create an update from Meetings and verify it appears here with the same recipients/type structure.
 * 3) Edit summary/recipients/due date/owner/type and confirm persistence after refresh.
 * 4) Archive and unarchive from table actions; confirm default view hides archived unless the Archived signal is selected.
 * 5) Delete from table actions with confirmation; confirm item is removed from active/archived views without breaking linked refs.
 */

export function renderWorkUpdatesModule({ mode = "work", people = [], meetings = [], projects = [], focusCreateForm = false } = {}) {
  const state = {
    editorId: focusCreateForm ? "__new__" : "",
    expandedId: "",
    feedback: "",
    filters: {
      search: "",
      type: "all",
      ownerId: "all",
      recipientId: "all",
      sort: "updated",
      groupBy: "none",
      lifecycle: "active",
      overdueOnly: false,
      dueSoonOnly: false,
      needsAttentionOnly: false,
      meetingLinkedOnly: false,
      unlinkedOnly: false
    }
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard updates-module";

  const header = document.createElement("div");
  header.className = "meetings-header";
  const title = document.createElement("h1");
  title.textContent = "Work Updates";
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "enter-mode-button";
  createButton.textContent = "New update";
  createButton.addEventListener("click", () => {
    state.editorId = "__new__";
    render();
  });

  // Explicit archive toggle in the header improves discoverability beyond the signal chips.
  const archivedToggleButton = document.createElement("button");
  archivedToggleButton.type = "button";
  archivedToggleButton.className = "secondary-button";

  header.append(title, archivedToggleButton, createButton);

  const feedback = document.createElement("p");
  feedback.className = "feedback";

  const signalBar = document.createElement("div");
  signalBar.className = "updates-signal-bar";

  const filters = document.createElement("div");
  filters.className = "updates-filter-row card";

  const tableWrap = document.createElement("div");
  tableWrap.className = "updates-table-wrap card";
  const table = document.createElement("table");
  table.className = "updates-table";
  table.innerHTML = `
    <thead><tr>
      <th>Type</th><th>Summary</th><th>Owner</th><th>Recipients</th><th>Meeting</th><th>Due</th><th>Pending</th><th>Updated</th><th>Actions</th>
    </tr></thead>
  `;
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tableWrap.appendChild(table);

  section.append(header, signalBar, filters, feedback, tableWrap);

  const controls = buildFilterControls(filters, people, state.filters, () => render());

  function render() {
    // Re-render is state-driven, so remove stale drawer instances before appending a fresh one.
    section.querySelectorAll(".task-drawer-overlay").forEach((node) => node.remove());
    const updates = loadUpdates(mode);
    const visible = selectVisibleUpdates({ updates, meetings, people, filters: state.filters });

    renderSignalBar(signalBar, updates, state.filters, () => render());
    controls.sync(people);

    feedback.hidden = !state.feedback;
    feedback.textContent = state.feedback;

    archivedToggleButton.textContent = state.filters.lifecycle === "archived" ? "View active" : "View archived";
    archivedToggleButton.onclick = () => {
      state.filters.lifecycle = state.filters.lifecycle === "archived" ? "active" : "archived";
      render();
    };

    tbody.innerHTML = "";

    if (!visible.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.className = "empty-state";
      td.textContent = "No updates match the current filters.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (state.editorId === "__new__") {
        section.appendChild(
          buildUpdatesCreateDrawer({
            people,
            meetings,
            projects,
            onSave: (draft) => {
              const result = saveUpdate(mode, draft, "", people);
              if (!result.ok) {
                state.feedback = result.error || "Unable to create update.";
                render();
                return;
              }
              state.feedback = "Update created.";
              state.editorId = "";
              render();
            },
            onCancel: () => {
              state.editorId = "";
              render();
            }
          })
        );
      }
      return;
    }

    for (const update of visible) {
      const tr = document.createElement("tr");
      tr.className = "updates-row";

      const type = document.createElement("td");
      type.appendChild(buildUpdateTypePill(update.type));

      const summary = document.createElement("td");
      summary.className = "updates-text-cell";
      summary.textContent = update.summary || "(untitled update)";

      const owner = document.createElement("td");
      owner.textContent = resolvePersonName(update.ownerId, people, "No owner");

      const recipientCell = document.createElement("td");
      const pending = selectPendingPeopleCount(update);
      recipientCell.textContent = `${update.recipients.length} recipients · ${pending} pending`;

      const meetingCell = document.createElement("td");
      const meeting = meetings.find((item) => item.id === update.meetingId);
      if (meeting) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "linkish-button";
        link.textContent = meeting.name || meeting.id;
        meetingCell.appendChild(link);
      } else {
        meetingCell.textContent = "—";
      }

      const dueCell = document.createElement("td");
      dueCell.textContent = update.dueDate || "—";

      const pendingCell = document.createElement("td");
      pendingCell.textContent = String(pending);

      const updatedCell = document.createElement("td");
      updatedCell.textContent = formatUpdatedAt(update.updatedAt);

      const actions = document.createElement("td");
      actions.className = "tasks-row-actions";
      const detailsButton = smallButton("Details", () => {
        state.expandedId = state.expandedId === update.id ? "" : update.id;
        render();
      });
      detailsButton.setAttribute("aria-expanded", String(state.expandedId === update.id));
      const editButton = smallButton("Edit", () => {
        state.editorId = update.id;
        render();
      });
      const archiveButton = smallButton(update.lifecycle === UPDATE_LIFECYCLE.ARCHIVED ? "Unarchive" : "Archive", () => {
        archiveUpdate(mode, update.id, update.lifecycle !== UPDATE_LIFECYCLE.ARCHIVED);
        state.feedback = update.lifecycle === UPDATE_LIFECYCLE.ARCHIVED ? "Update restored." : "Update archived.";
        render();
      });
      const deleteButton = smallButton("Delete", () => {
        if (!window.confirm("Delete this update? This can be recovered only from backup/sync history.")) {
          return;
        }
        const result = deleteUpdate(mode, update.id);
        state.feedback = result.ok ? "Update deleted." : result.error;
        render();
      });
      actions.append(detailsButton, editButton, archiveButton, deleteButton);

      tr.append(type, summary, owner, recipientCell, meetingCell, dueCell, pendingCell, updatedCell, actions);
      tbody.appendChild(tr);

      if (state.expandedId === update.id) {
        tbody.appendChild(
          buildRecipientDetailsRow({
            update,
            people,
            onToggle: (personId, shouldComplete) => {
              if (shouldComplete) {
                markPersonUpdated(update.id, personId);
              } else {
                markPersonPending(update.id, personId);
              }
              render();
            }
          })
        );
      }

      if (state.editorId === update.id) {
        tbody.appendChild(
          buildEditorRow({
            people,
            meetings,
            projects,
            update,
            onSave: (draft) => {
              const result = saveUpdate(mode, draft, update.id, people);
              if (!result.ok) {
                state.feedback = result.error || "Unable to save update.";
                render();
                return;
              }
              state.feedback = "Update saved.";
              state.editorId = "";
              render();
            },
            onCancel: () => {
              state.editorId = "";
              render();
            }
          })
        );
      }
    }

    if (state.editorId === "__new__") {
      section.appendChild(
        buildUpdatesCreateDrawer({
          people,
          meetings,
          projects,
          onSave: (draft) => {
            const result = saveUpdate(mode, draft, "", people);
            if (!result.ok) {
              state.feedback = result.error || "Unable to create update.";
              render();
              return;
            }
            state.feedback = "Update created.";
            state.editorId = "";
            render();
          },
          onCancel: () => {
            state.editorId = "";
            render();
          }
        })
      );
    }
  }

  render();
  return section;
}

function buildFilterControls(container, people, state, onChange) {
  container.innerHTML = "";
  const activePeople = selectActivePeople(people);

  const search = document.createElement("input");
  search.type = "search";
  search.className = "field-input";
  search.placeholder = "Search summary, notes, owner, recipients";
  search.value = state.search;
  search.addEventListener("input", () => {
    state.search = search.value;
    onChange();
  });

  const type = buildSelect([
    ["all", "All types"],
    [UPDATE_ENTITY_TYPES.ACTION, "Action"],
    [UPDATE_ENTITY_TYPES.UPDATE, "Update"]
  ], state.type, (value) => {
    state.type = value;
    onChange();
  });

  const owner = buildSelect(
    [["all", "All owners"], ...activePeople.map((person) => [person.id, person.name || person.id])],
    state.ownerId,
    (value) => {
      state.ownerId = value;
      onChange();
    }
  );

  const recipient = buildSelect(
    [["all", "All recipients"], ...activePeople.map((person) => [person.id, person.name || person.id])],
    state.recipientId,
    (value) => {
      state.recipientId = value;
      onChange();
    }
  );

  const sort = buildSelect([
    ["updated", "Sort: recently updated"],
    ["due", "Sort: due date"],
    ["pending", "Sort: pending count"]
  ], state.sort, (value) => {
    state.sort = value;
    onChange();
  });

  // Lifecycle filter is duplicated in controls to keep archived navigation visible in dense tables.
  const lifecycle = buildSelect([
    ["active", "Lifecycle: active"],
    ["archived", "Lifecycle: archived"]
  ], state.lifecycle, (value) => {
    state.lifecycle = value;
    onChange();
  });

  const groupBy = buildSelect([
    ["none", "Group: none"],
    ["owner", "Group: owner"],
    ["project", "Group: project"]
  ], state.groupBy, (value) => {
    state.groupBy = value;
    onChange();
  });

  container.append(search, type, owner, recipient, sort, lifecycle, groupBy);

  return {
    sync(nextPeople) {
      const owners = selectActivePeople(nextPeople);
      syncSelectOptions(owner, [["all", "All owners"], ...owners.map((person) => [person.id, person.name || person.id])], state.ownerId);
      syncSelectOptions(recipient, [["all", "All recipients"], ...owners.map((person) => [person.id, person.name || person.id])], state.recipientId);
    }
  };
}

function buildSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "field-input";
  syncSelectOptions(select, options, value);
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function syncSelectOptions(select, options, selectedValue) {
  select.innerHTML = "";
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = options.some(([optionValue]) => optionValue === selectedValue) ? selectedValue : options[0]?.[0] || "";
}

function renderSignalBar(container, updates, filters, onChange) {
  container.innerHTML = "";
  const activeUpdates = updates.filter((item) => item.lifecycle === UPDATE_LIFECYCLE.ACTIVE);
  const active = activeUpdates.length;
  const archived = updates.filter((item) => item.lifecycle === UPDATE_LIFECYCLE.ARCHIVED).length;
  const overdue = activeUpdates.filter((item) => isOverdue(item) && selectPendingPeopleCount(item) > 0).length;
  const dueSoon = activeUpdates.filter((item) => isDueSoon(item) && selectPendingPeopleCount(item) > 0).length;
  const needsAttention = activeUpdates.filter((item) => selectPendingPeopleCount(item) > 0).length;
  const meetingLinked = activeUpdates.filter((item) => item.meetingId).length;
  const unlinked = activeUpdates.filter((item) => !item.meetingId).length;

  const chips = [
    [filters.lifecycle === "archived" ? "Archived" : "Active", filters.lifecycle === "archived" ? archived : active, () => {
      filters.lifecycle = filters.lifecycle === "archived" ? "active" : "archived";
      onChange();
    }, filters.lifecycle === "archived"],
    ["Overdue", overdue, () => {
      filters.overdueOnly = !filters.overdueOnly;
      onChange();
    }, filters.overdueOnly],
    ["Due soon", dueSoon, () => {
      filters.dueSoonOnly = !filters.dueSoonOnly;
      onChange();
    }, filters.dueSoonOnly],
    ["Needs attention", needsAttention, () => {
      filters.needsAttentionOnly = !filters.needsAttentionOnly;
      onChange();
    }, filters.needsAttentionOnly],
    ["Meeting-linked", meetingLinked, () => {
      filters.meetingLinkedOnly = !filters.meetingLinkedOnly;
      if (filters.meetingLinkedOnly) {
        filters.unlinkedOnly = false;
      }
      onChange();
    }, filters.meetingLinkedOnly],
    ["Unlinked", unlinked, () => {
      filters.unlinkedOnly = !filters.unlinkedOnly;
      if (filters.unlinkedOnly) {
        filters.meetingLinkedOnly = false;
      }
      onChange();
    }, filters.unlinkedOnly]
  ];

  for (const [label, count, onClick, isActive = false] of chips) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `metric-chip ${isActive ? "is-active" : ""}`;
    chip.textContent = `${label}: ${count}`;
    chip.addEventListener("click", onClick);
    container.appendChild(chip);
  }
}

function buildEditorRow({ people, meetings, projects, update = null, onSave, onCancel }) {
  const tr = document.createElement("tr");
  tr.className = "tasks-editor-row";
  const td = document.createElement("td");
  td.colSpan = 9;
  const form = buildUpdateEditorForm({ people, meetings, projects, update, onSave, onCancel, inline: true });

  td.appendChild(form);
  tr.appendChild(td);
  return tr;
}

/**
 * Uses the same form fields across inline edit rows and drawer-based creation
 * so validation, defaults, and save payload shape stay fully consistent.
 */
function buildUpdateEditorForm({ people, meetings, projects, update = null, onSave, onCancel, inline = false }) {
  const form = document.createElement("form");
  form.className = inline ? "task-inline-editor" : "task-drawer task-editor-drawer";

  const seed = update || normaliseUpdate({});

  const type = buildSelect([
    [UPDATE_ENTITY_TYPES.UPDATE, "Update"],
    [UPDATE_ENTITY_TYPES.ACTION, "Action"]
  ], seed.type, () => {});

  const summary = document.createElement("input");
  summary.className = "field-input";
  summary.required = true;
  summary.placeholder = "Summary";
  summary.value = seed.summary;

  const notes = document.createElement("textarea");
  notes.className = "field-input field-textarea";
  notes.placeholder = "Notes (optional)";
  notes.value = seed.description;

  const owner = buildSelect([["", "No owner"], ...selectActivePeople(people).map((person) => [person.id, person.name || person.id])], seed.ownerId, () => {});

  const due = document.createElement("input");
  due.type = "date";
  due.className = "field-input";
  due.value = seed.dueDate;

  const meeting = buildSelect([["", "No meeting"], ...meetings.filter((item) => !item.archived).map((item) => [item.id, item.name || item.id])], seed.meetingId, () => {});
  const project = buildSelect([["", "No project"], ...projects.filter((item) => !item.archived).map((item) => [item.id, item.name || item.id])], seed.projectId, () => {});

  const recipientField = buildEntityTokenMultiSelectField({
    label: "Recipients",
    options: selectActivePeople(people).map((person) => ({ value: person.id, label: person.name || person.id })),
    values: seed.recipients.map((item) => item.personId),
    emptyMessage: "Create people records first.",
    inputPlaceholder: "Search recipients"
  });

  const actions = document.createElement("div");
  actions.className = "task-inline-editor-actions";
  const cancel = smallButton("Cancel", onCancel);
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "primary-button";
  save.textContent = update ? "Save" : "Create";
  actions.append(cancel, save);

  form.append(labelWrap("Type", type), labelWrap("Summary", summary), labelWrap("Notes", notes), recipientField.wrapper, labelWrap("Owner", owner), labelWrap("Due", due), labelWrap("Meeting", meeting), labelWrap("Project", project), actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selectedRecipientIds = readEntityTokenHiddenValues(recipientField.hiddenInput);
    if (!selectedRecipientIds.length) {
      window.alert("At least one recipient is required.");
      return;
    }

    const statusByPersonId = new Map(seed.recipients.map((entry) => [entry.personId, entry]));
    const recipients = selectedRecipientIds.map((personId) => {
      const existing = statusByPersonId.get(personId);
      return {
        personId,
        status: existing?.status === "complete" ? "complete" : "pending",
        updatedAt: existing?.status === "complete" ? existing.updatedAt : ""
      };
    });

    onSave({
      type: type.value,
      summary: summary.value,
      description: notes.value,
      ownerId: owner.value,
      dueDate: due.value,
      meetingId: meeting.value,
      projectId: project.value,
      recipients
    });
  });

  return form;
}

function buildUpdatesCreateDrawer({ people, meetings, projects, onSave, onCancel }) {
  const overlay = document.createElement("div");
  overlay.className = "task-drawer-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      onCancel();
    }
  });

  const form = buildUpdateEditorForm({ people, meetings, projects, onSave, onCancel, inline: false });
  const header = document.createElement("header");
  header.className = "task-drawer-header";
  const title = document.createElement("h2");
  title.textContent = "New update";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghost-button project-icon-button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close create update panel");
  close.addEventListener("click", onCancel);
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "task-drawer-body";
  const children = Array.from(form.children);
  body.append(...children);
  form.append(header, body);

  overlay.appendChild(form);
  return overlay;
}

function labelWrap(label, control) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = label;
  wrap.appendChild(control);
  return wrap;
}

function buildRecipientDetailsRow({ update, people, onToggle }) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 9;
  const list = document.createElement("div");
  list.className = "updates-recipient-checklist";

  for (const recipient of update.recipients) {
    const row = document.createElement("div");
    row.className = "updates-recipient-row";
    const name = document.createElement("span");
    name.textContent = resolvePersonName(recipient.personId, people, recipient.personId || "Unknown person");
    const status = document.createElement("span");
    status.className = `update-type-pill ${recipient.status === "complete" ? "is-action" : "is-update"}`;
    status.textContent = recipient.status === "complete" ? "Complete" : "Pending";
    const toggle = smallButton(recipient.status === "complete" ? "Mark pending" : "Mark updated", () => {
      onToggle(recipient.personId, recipient.status !== "complete");
    });
    row.append(name, status, toggle);
    list.appendChild(row);
  }

  td.appendChild(list);
  tr.appendChild(td);
  return tr;
}

function selectVisibleUpdates({ updates, meetings, people, filters }) {
  const today = new Date();
  return updates
    .filter((item) => item.lifecycle !== UPDATE_LIFECYCLE.DELETED)
    .filter((item) => (filters.lifecycle === "archived" ? item.lifecycle === UPDATE_LIFECYCLE.ARCHIVED : item.lifecycle === UPDATE_LIFECYCLE.ACTIVE))
    .filter((item) => (filters.type === "all" ? true : item.type === filters.type))
    .filter((item) => (filters.ownerId === "all" ? true : item.ownerId === filters.ownerId))
    .filter((item) => (filters.recipientId === "all" ? true : item.recipients.some((recipient) => recipient.personId === filters.recipientId)))
    .filter((item) => (filters.overdueOnly ? isOverdue(item, today) && selectPendingPeopleCount(item) > 0 : true))
    .filter((item) => (filters.dueSoonOnly ? isDueSoon(item, today) && selectPendingPeopleCount(item) > 0 : true))
    .filter((item) => (filters.needsAttentionOnly ? selectPendingPeopleCount(item) > 0 : true))
    .filter((item) => (filters.meetingLinkedOnly ? Boolean(item.meetingId) : true))
    .filter((item) => (filters.unlinkedOnly ? !item.meetingId : true))
    .filter((item) => {
      const q = filters.search.trim().toLowerCase();
      if (!q) {
        return true;
      }
      const ownerName = resolvePersonName(item.ownerId, people, "").toLowerCase();
      const recipientNames = item.recipients.map((recipient) => resolvePersonName(recipient.personId, people, recipient.personId)).join(" ").toLowerCase();
      const meetingName = meetings.find((meeting) => meeting.id === item.meetingId)?.name?.toLowerCase() || "";
      return [item.summary, item.description, ownerName, recipientNames, meetingName].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (filters.sort === "due") {
        const ad = a.dueDate || "9999-12-31";
        const bd = b.dueDate || "9999-12-31";
        return ad.localeCompare(bd);
      }
      if (filters.sort === "pending") {
        return selectPendingPeopleCount(b) - selectPendingPeopleCount(a);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function loadUpdates(mode) {
  if (mode !== "work") {
    return [];
  }
  return loadVersionedCollection({
    storageKey: resolveUpdatesStorageKey(mode),
    collectionKey: UPDATES_COLLECTION_KEY,
    schemaVersion: UPDATES_SCHEMA_VERSION,
    normaliseItem: normaliseUpdate,
    fallback: []
  });
}

export function saveUpdate(mode, draft, editingId = "", people = null) {
  if (mode !== "work") {
    return { ok: false, error: "Updates are currently supported only in work mode." };
  }
  const normalisedDraft = normaliseUpdate(draft);
  if (!normalisedDraft.summary) {
    return { ok: false, error: "Summary is required." };
  }
  if (!normalisedDraft.recipients.length) {
    return { ok: false, error: "At least one recipient is required." };
  }
  if (Array.isArray(people) && normalisedDraft.ownerId) {
    const validIds = new Set(selectActivePeople(people).map((person) => person.id));
    if (!validIds.has(normalisedDraft.ownerId)) {
      return { ok: false, error: "Selected owner no longer exists in active people." };
    }
  }

  const now = new Date().toISOString();
  const updates = loadUpdates(mode);
  if (editingId) {
    const index = updates.findIndex((item) => item.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Update no longer exists." };
    }
    const current = updates[index];
    updates[index] = {
      ...current,
      ...normalisedDraft,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now
    };
    persistUpdates(mode, updates);
    return { ok: true };
  }

  updates.push({
    ...normalisedDraft,
    id: buildId(),
    createdAt: now,
    updatedAt: now
  });
  persistUpdates(mode, updates);
  return { ok: true };
}

export function archiveUpdate(mode, updateId, shouldArchive) {
  if (mode !== "work") {
    return { ok: false, error: "Updates are currently supported only in work mode." };
  }

  const now = new Date().toISOString();
  const updates = loadUpdates(mode).map((update) => {
    if (update.id !== updateId) {
      return update;
    }
    return {
      ...update,
      lifecycle: shouldArchive ? UPDATE_LIFECYCLE.ARCHIVED : UPDATE_LIFECYCLE.ACTIVE,
      archived: Boolean(shouldArchive),
      updatedAt: now
    };
  });

  persistUpdates(mode, updates);
  return { ok: true };
}

export function deleteUpdate(mode, updateId) {
  if (mode !== "work") {
    return { ok: false, error: "Updates are currently supported only in work mode." };
  }
  const now = new Date().toISOString();
  let found = false;
  const updates = loadUpdates(mode).map((update) => {
    if (update.id !== updateId) {
      return update;
    }
    found = true;
    return {
      ...update,
      lifecycle: UPDATE_LIFECYCLE.DELETED,
      deletedAt: now,
      updatedAt: now
    };
  });
  if (!found) {
    return { ok: false, error: "Update no longer exists." };
  }
  persistUpdates(mode, updates);
  return { ok: true };
}

export function markPersonUpdated(updateId, personId, at = new Date().toISOString()) {
  updatePersonStatus("work", updateId, personId, "complete", at);
}

export function markPersonPending(updateId, personId) {
  updatePersonStatus("work", updateId, personId, "pending", "");
}

export function selectPendingPeopleCount(update) {
  return normaliseRecipients(update?.recipients || update?.toUpdate).filter((entry) => entry.status === "pending").length;
}

export function selectCompletedPeopleCount(update) {
  return normaliseRecipients(update?.recipients || update?.toUpdate).filter((entry) => entry.status === "complete").length;
}

export function selectUpdatesForPerson(updates, personId, { includeCompleted = false, includeArchived = false } = {}) {
  if (!personId || !Array.isArray(updates)) {
    return [];
  }

  return updates.flatMap((update) => {
    if (!includeArchived && update?.lifecycle === UPDATE_LIFECYCLE.ARCHIVED) {
      return [];
    }
    if (update?.lifecycle === UPDATE_LIFECYCLE.DELETED) {
      return [];
    }

    const matchingEntries = normaliseRecipients(update?.recipients || update?.toUpdate)
      .filter((entry) => entry.personId === personId)
      .filter((entry) => (includeCompleted ? true : entry.status === "pending"));

    return matchingEntries.map((entry) => ({ update, entry }));
  });
}

export function selectActivePeople(people = []) {
  if (!Array.isArray(people)) {
    return [];
  }
  return people.filter((person) => person && !person.archived && typeof person.id === "string" && person.id.trim());
}

export function buildUpdateOwnerOptions(people = []) {
  return [{ value: "", label: "No owner" }, ...selectActivePeople(people).map((person) => ({ value: person.id, label: person.name || person.id }))];
}

export function normaliseUpdate(update) {
  const now = new Date().toISOString();
  const source = update && typeof update === "object" ? update : {};
  const type = source.type === UPDATE_ENTITY_TYPES.ACTION || source.entityType === UPDATE_ENTITY_TYPES.ACTION
    ? UPDATE_ENTITY_TYPES.ACTION
    : UPDATE_ENTITY_TYPES.UPDATE;
  const recipients = normaliseRecipients(source.recipients || source.toUpdate);
  const lifecycle = normaliseLifecycle(source.lifecycle, source.archived);

  return {
    id: typeof source.id === "string" ? source.id : "",
    type,
    entityType: type,
    summary: typeof source.summary === "string" ? source.summary.trim() : typeof source.text === "string" ? source.text.trim() : "",
    text: typeof source.summary === "string" ? source.summary.trim() : typeof source.text === "string" ? source.text.trim() : "",
    description: typeof source.description === "string" ? source.description.trim() : typeof source.notes === "string" ? source.notes.trim() : "",
    notes: typeof source.description === "string" ? source.description.trim() : typeof source.notes === "string" ? source.notes.trim() : "",
    ownerId: typeof source.ownerId === "string" ? source.ownerId : "",
    dueDate: typeof source.dueDate === "string" ? source.dueDate : "",
    meetingId: typeof source.meetingId === "string" ? source.meetingId : "",
    projectId: typeof source.projectId === "string" ? source.projectId : "",
    recipients,
    toUpdate: recipients.map((entry) => ({
      personId: entry.personId,
      required: true,
      status: entry.status === "complete" ? "updated" : "pending",
      updatedAt: entry.updatedAt || "",
      note: ""
    })),
    lifecycle,
    archived: lifecycle === UPDATE_LIFECYCLE.ARCHIVED,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : now,
    deletedAt: typeof source.deletedAt === "string" ? source.deletedAt : ""
  };
}

function normaliseRecipients(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => {
      if (typeof entry === "string") {
        const personId = entry.trim();
        if (!personId) {
          return null;
        }
        return { personId, status: "pending", updatedAt: "" };
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const personId = typeof entry.personId === "string" ? entry.personId.trim() : "";
      if (!personId) {
        return null;
      }
      const status = entry.status === "complete" || entry.status === "updated" ? "complete" : "pending";
      return {
        personId,
        status,
        updatedAt: status === "complete" ? ensureIsoTimestamp(entry.updatedAt, "") : ""
      };
    })
    .filter(Boolean);
}

function normaliseLifecycle(lifecycle, archived) {
  if (lifecycle === UPDATE_LIFECYCLE.ARCHIVED || lifecycle === UPDATE_LIFECYCLE.DELETED) {
    return lifecycle;
  }
  return archived ? UPDATE_LIFECYCLE.ARCHIVED : UPDATE_LIFECYCLE.ACTIVE;
}

function updatePersonStatus(mode, updateId, personId, status, at) {
  if (mode !== "work") {
    return;
  }
  const now = new Date().toISOString();
  const updates = loadUpdates(mode).map((update) => {
    if (update.id !== updateId) {
      return update;
    }
    const recipients = normaliseRecipients(update.recipients || update.toUpdate);
    const index = recipients.findIndex((entry) => entry.personId === personId);
    if (index >= 0) {
      recipients[index] = {
        personId,
        status,
        updatedAt: status === "complete" ? ensureIsoTimestamp(at, now) : ""
      };
    }

    return normaliseUpdate({
      ...update,
      recipients,
      updatedAt: now
    });
  });
  persistUpdates(mode, updates);
}

function resolveUpdatesStorageKey(mode) {
  return mode === "work" ? WORK_UPDATES_STORAGE_KEY : `second-brain.work.updates.${mode}.v${UPDATES_SCHEMA_VERSION}`;
}

function persistUpdates(mode, updates) {
  if (mode !== "work") {
    return;
  }
  persistVersionedCollection({
    storageKey: resolveUpdatesStorageKey(mode),
    collectionKey: UPDATES_COLLECTION_KEY,
    schemaVersion: UPDATES_SCHEMA_VERSION,
    records: updates
  });
}

function resolvePersonName(personId, people, fallback = "") {
  if (!personId) {
    return fallback;
  }
  return people.find((person) => person.id === personId)?.name || fallback || personId;
}

function smallButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function buildUpdateTypePill(type) {
  const pill = document.createElement("span");
  pill.className = `update-type-pill ${type === UPDATE_ENTITY_TYPES.ACTION ? "is-action" : "is-update"}`;
  pill.textContent = type === UPDATE_ENTITY_TYPES.ACTION ? "Action" : "Update";
  return pill;
}

function formatUpdatedAt(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

export function isOverdue(update, now = new Date()) {
  if (!update?.dueDate) {
    return false;
  }
  const due = new Date(`${update.dueDate}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

export function isDueSoon(update, now = new Date()) {
  if (!update?.dueDate) {
    return false;
  }
  const due = new Date(`${update.dueDate}T00:00:00`);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return due.getTime() >= start.getTime() && due.getTime() <= end.getTime();
}

function ensureIsoTimestamp(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function buildId() {
  return generateId("upd-");
}
