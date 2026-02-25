import {
  downloadDatasetExport,
  getMergeRulesSummary,
  parseAndValidateImportPayload,
  restoreFromImportPayload
} from "./storage-export.js";
import { listDatasetBackups } from "./dataset-backups.js";
import { SYNCABLE_DOCUMENTS } from "./sync.js";
import {
  METRIC_TYPES,
  deactivateMetricDefinition,
  getMetricTypeLabel,
  listMetricGroups,
  loadPersonalMetricDefinitions,
  savePersonalMetricDefinitions,
  upsertMetricDefinition
} from "./personal-metrics.js";

export const SETTINGS_STORAGE_KEY = "second-brain.ui.settings.v1";
export const ONBOARDING_COMPLETED_STORAGE_KEY = "second-brain.ui.onboarding.completed.v1";


/**
 * Default user preferences for app appearance and interaction behaviour.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: "light",
  layoutDensity: "comfortable",
  confirmUnsavedChanges: true,
  startMode: "ask"
});

/**
 * Loads user settings from localStorage using safe fallbacks.
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }

    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...sanitizeSettings(parsed)
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persists validated user settings to localStorage.
 */
export function saveSettings(nextSettings) {
  const safeSettings = sanitizeSettings(nextSettings);
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(safeSettings));
  return safeSettings;
}

/**
 * Renders Settings UI for user customisation.
 */
export function renderSettingsModule({
  mode,
  settings,
  onSettingsChange,
  onDataRestore,
  onBackupRestore,
  onFullDataReset,
  syncState,
  onResolveSyncConflicts
}) {
  const section = document.createElement("section");
  section.className = "mode-dashboard settings-module";

  const title = document.createElement("h1");
  title.textContent = `${toTitleCase(mode)} Settings`;

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Personalise theme, layout, and workflow behaviour. Changes save instantly on this device.";

  const list = document.createElement("div");
  list.className = "settings-list";
  list.appendChild(renderGeneralSettingsPanel({ settings, onSettingsChange }));

  const dataManagement = createDataManagementSection({ onDataRestore });
  const syncConflictSection = createSyncConflictSection({ syncState, onResolveSyncConflicts });
  const backupsSection = createBackupsSection({ onBackupRestore, onDataRestore });
  const destructiveSection = createDestructiveResetSection({ onFullDataReset });

  section.append(title, intro, list, dataManagement, syncConflictSection, backupsSection, destructiveSection);
  return section;
}

/**
 * Reusable block for general app preferences used by both legacy page settings
 * and the new settings modal dialog.
 */
export function renderGeneralSettingsPanel({ settings, onSettingsChange }) {
  const panel = document.createElement("div");
  panel.className = "settings-list";

  panel.append(
    createSelectSetting({
      label: "Theme",
      hint: "Choose the app appearance that is easiest on your eyes.",
      value: settings.theme,
      options: [
        ["light", "Light"],
        ["dark", "Dark"]
      ],
      onChange: (value) => onSettingsChange({ ...settings, theme: value })
    }),
    createSelectSetting({
      label: "Layout density",
      hint: "Compact mode fits more content. Comfortable mode increases spacing.",
      value: settings.layoutDensity,
      options: [
        ["comfortable", "Comfortable"],
        ["compact", "Compact"]
      ],
      onChange: (value) => onSettingsChange({ ...settings, layoutDensity: value })
    }),
    createSelectSetting({
      label: "Start mode",
      hint: "Pick your default mode on app load, or continue choosing each time.",
      value: settings.startMode,
      options: [
        ["ask", "Always ask"],
        ["work", "Open Work automatically"],
        ["personal", "Open Personal automatically"]
      ],
      onChange: (value) => onSettingsChange({ ...settings, startMode: value })
    }),
    createToggleSetting({
      label: "Unsaved-change warning",
      hint: "Show a confirmation before leaving a screen with unsaved edits.",
      checked: settings.confirmUnsavedChanges,
      onChange: (checked) => onSettingsChange({ ...settings, confirmUnsavedChanges: checked })
    })
  );

  return panel;
}

/**
 * Metric-settings editor with version-aware edits so only current/future dates
 * are affected by create/edit/remove actions.
 */
export function renderMetricSettingsPanel() {
  const wrap = document.createElement("section");
  wrap.className = "settings-data-management metric-settings-panel";

  const title = document.createElement("h2");
  title.textContent = "Metric settings";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent =
    "Create and version daily-log metrics. Edits and removals apply from the chosen active-from date onward and never rewrite historic records.";

  const feedback = document.createElement("p");
  feedback.className = "feedback";
  feedback.hidden = true;

  const table = document.createElement("table");
  table.className = "updates-table";
  table.innerHTML = "<thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Group</th><th>Active from</th><th>Active until</th><th>Actions</th></tr></thead>";
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  const form = document.createElement("form");
  form.className = "meeting-form settings-metric-form";

  const idField = buildField("Metric ID", "text", true);
  const nameField = buildField("Name", "text", true);
  const typeField = document.createElement("label");
  typeField.className = "field-label";
  typeField.textContent = "Type of metric";
  const typeInput = document.createElement("select");
  typeInput.className = "field-input";
  typeInput.append(
    buildOption(METRIC_TYPES.TEXT, "Text"),
    buildOption(METRIC_TYPES.NUMBER, "Number"),
    buildOption(METRIC_TYPES.BOOLEAN, "Yes / No")
  );
  typeField.appendChild(typeInput);

  const groupingField = buildField("Grouping", "text", true);
  const groupListId = `metric-group-list-${Date.now()}`;
  groupingField.input.setAttribute("list", groupListId);
  const groupList = document.createElement("datalist");
  groupList.id = groupListId;

  const activeFromField = buildField("Active from", "date", true);
  activeFromField.input.value = new Date().toISOString().slice(0, 10);

  const actions = document.createElement("div");
  actions.className = "task-inline-editor-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "primary-button";
  saveButton.textContent = "Save metric";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "secondary-button";
  resetButton.textContent = "Clear form";
  actions.append(saveButton, resetButton);

  form.append(idField.wrap, nameField.wrap, typeField, groupingField.wrap, activeFromField.wrap, groupList, actions);

  const state = {
    editingMetricId: ""
  };

  function setFeedback(message) {
    feedback.hidden = !message;
    feedback.textContent = message;
  }

  function updateGroupingOptions(definitions) {
    groupList.innerHTML = "";
    listMetricGroups(definitions).forEach((group) => {
      const option = document.createElement("option");
      option.value = group;
      groupList.appendChild(option);
    });
  }

  function populateForm(definition) {
    state.editingMetricId = definition.id;
    idField.input.value = definition.id;
    nameField.input.value = definition.name;
    typeInput.value = definition.type;
    groupingField.input.value = definition.grouping;
    activeFromField.input.value = new Date().toISOString().slice(0, 10);
  }

  function clearForm() {
    state.editingMetricId = "";
    form.reset();
    activeFromField.input.value = new Date().toISOString().slice(0, 10);
  }

  function renderTable() {
    const definitions = loadPersonalMetricDefinitions().sort((first, second) => {
      if (first.id !== second.id) {
        return first.id.localeCompare(second.id);
      }
      return first.activeFrom.localeCompare(second.activeFrom);
    });
    updateGroupingOptions(definitions);
    tbody.innerHTML = "";

    definitions.forEach((definition) => {
      const row = document.createElement("tr");
      row.append(
        buildCell(definition.id),
        buildCell(definition.name),
        buildCell(getMetricTypeLabel(definition.type)),
        buildCell(definition.grouping),
        buildCell(definition.activeFrom),
        buildCell(definition.activeUntil || "Current"),
        buildActionsCell([
          smallButton("Edit", () => populateForm(definition)),
          smallButton("Remove", () => {
            const today = new Date().toISOString().slice(0, 10);
            const nextDefinitions = deactivateMetricDefinition(loadPersonalMetricDefinitions(), definition.id, { today });
            savePersonalMetricDefinitions(nextDefinitions);
            setFeedback(`Metric \"${definition.name}\" removed for today/future dates.`);
            renderTable();
          })
        ])
      );
      tbody.appendChild(row);
    });

    if (!definitions.length) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 7;
      emptyCell.className = "empty-state";
      emptyCell.textContent = "No metric definitions available.";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = upsertMetricDefinition(loadPersonalMetricDefinitions(), {
      id: idField.input.value.trim(),
      name: nameField.input.value.trim(),
      type: typeInput.value,
      grouping: groupingField.input.value.trim(),
      activeFrom: activeFromField.input.value
    }, {
      previousId: state.editingMetricId,
      today: new Date().toISOString().slice(0, 10)
    });

    if (!result.ok) {
      setFeedback(result.error || "Unable to save metric definition.");
      return;
    }

    savePersonalMetricDefinitions(result.definitions);
    setFeedback("Metric definition saved.");
    clearForm();
    renderTable();
  });

  resetButton.addEventListener("click", () => {
    clearForm();
    setFeedback("");
  });

  wrap.append(title, hint, feedback, form, table);
  renderTable();
  return wrap;
}

/**
 * Builds an explicit conflict-resolution workflow instead of passive conflict badges.
 */
function createSyncConflictSection({ syncState, onResolveSyncConflicts }) {
  const wrap = document.createElement("section");
  wrap.className = "settings-data-management";

  const title = document.createElement("h2");
  title.textContent = "Sync conflict resolution";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent =
    "When local and remote edits collide, review each conflict and choose which value to keep before the next sync.";

  const conflicts = Array.isArray(syncState?.conflicts) ? syncState.conflicts : [];
  if (conflicts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No unresolved sync conflicts.";
    wrap.append(title, hint, empty);
    return wrap;
  }

  const list = document.createElement("div");
  list.className = "settings-list";
  const selectsByConflictId = new Map();

  for (const conflict of conflicts) {
    const item = document.createElement("article");
    item.className = "settings-item";

    const heading = document.createElement("span");
    heading.className = "settings-label";
    heading.textContent = `${conflict.documentId} → ${conflict.entityId} → ${conflict.field}`;

    const values = document.createElement("div");
    values.className = "settings-hint";

    // Presenting values on separate lines keeps long JSON payloads readable and makes
    // manual conflict choices significantly less error-prone.
    const localPreview = document.createElement("pre");
    localPreview.className = "settings-code-block";
    localPreview.textContent = `Local\n${stringifyConflictValue(conflict.localValue)}`;

    const remotePreview = document.createElement("pre");
    remotePreview.className = "settings-code-block";
    remotePreview.textContent = `Remote\n${stringifyConflictValue(conflict.remoteValue)}`;

    values.append(localPreview, remotePreview);

    const choice = document.createElement("select");
    choice.className = "field-input";
    choice.append(
      buildOption("suggested", "Use suggested merge value"),
      buildOption("local", "Keep local value"),
      buildOption("remote", "Keep remote value")
    );

    const suggestedPreview = document.createElement("pre");
    suggestedPreview.className = "settings-code-block";
    suggestedPreview.textContent = `Suggested\n${stringifyConflictValue(conflict.suggestedValue)}`;

    selectsByConflictId.set(conflict.conflictId, choice);
    item.append(heading, values, suggestedPreview, choice);
    list.appendChild(item);
  }

  const applyButton = createActionButton("Apply conflict resolutions", async () => {
    if (typeof onResolveSyncConflicts !== "function") {
      window.alert("Conflict resolution handler is unavailable.");
      return;
    }

    const resolutions = {};
    for (const [conflictId, select] of selectsByConflictId.entries()) {
      resolutions[conflictId] = select.value;
    }

    await onResolveSyncConflicts(resolutions);
  });

  wrap.append(title, hint, list, applyButton);
  return wrap;
}

/**
 * Builds export/import controls with explicit confirmation and clear restore feedback.
 */
function createDataManagementSection({ onDataRestore }) {
  const wrap = document.createElement("section");
  wrap.className = "settings-data-management";

  const title = document.createElement("h2");
  title.textContent = "Data export & restore";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent =
    "Export Work/Personal JSON backups or restore from a validated file. Every restore writes a timestamped rollback snapshot first.";

  const exportButton = createActionButton("Export data", () => {
    document.body.appendChild(createExportModal());
  });

  const importForm = document.createElement("div");
  importForm.className = "settings-import-actions";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.className = "field-input";
  fileInput.accept = "application/json,.json";

  const strategySelect = document.createElement("select");
  strategySelect.className = "field-input";
  strategySelect.append(
    buildOption("merge", "Merge import into existing data (default)"),
    buildOption("replace", "Replace imported keys entirely")
  );

  const importButton = createActionButton("Import JSON", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      window.alert("Select a JSON file before importing.");
      return;
    }

    const strategy = strategySelect.value === "replace" ? "replace" : "merge";
    const confirmation = window.confirm(
      `Import will ${strategy} data from \"${file.name}\". A rollback snapshot is created first. Continue?`
    );

    if (!confirmation) {
      return;
    }

    try {
      const text = await file.text();
      const payload = parseAndValidateImportPayload(text);
      const result = restoreFromImportPayload(payload, strategy);
      window.alert(
        `Import complete. Updated ${result.updatedKeys.length} storage key(s). Backup snapshot: ${result.backupKey}`
      );
      fileInput.value = "";
      if (typeof onDataRestore === "function") {
        onDataRestore();
      }
    } catch (error) {
      window.alert(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  importForm.append(fileInput, strategySelect, importButton);

  const mergeRules = document.createElement("ul");
  mergeRules.className = "settings-merge-rules";
  getMergeRulesSummary().forEach((rule) => {
    const item = document.createElement("li");
    item.textContent = rule;
    mergeRules.appendChild(item);
  });

  wrap.append(title, hint, exportButton, importForm, mergeRules);
  return wrap;
}

/**
 * Modal wrapper for export options so settings stay uncluttered by one-off controls.
 */
function createExportModal() {
  const overlay = document.createElement("div");
  overlay.className = "meeting-modal-overlay settings-action-modal-overlay";

  const modal = document.createElement("section");
  modal.className = "meeting-modal settings-action-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Export data");

  const title = document.createElement("h3");
  title.textContent = "Export data";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent = "Choose the scope you want to export as JSON.";

  const buttonRow = document.createElement("div");
  buttonRow.className = "settings-export-actions";
  buttonRow.append(
    createActionButton("Export Work JSON", () => downloadDatasetExport("work")),
    createActionButton("Export Personal JSON", () => downloadDatasetExport("personal")),
    createActionButton("Export Combined JSON", () => downloadDatasetExport("combined"))
  );

  const closeButton = createActionButton("Close", () => overlay.remove());

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  modal.append(title, hint, buttonRow, closeButton);
  overlay.appendChild(modal);
  return overlay;
}

/**
 * Buried destructive reset path with repeated confirmations to avoid accidental loss.
 */
function createDestructiveResetSection({ onFullDataReset }) {
  const wrap = document.createElement("section");
  wrap.className = "settings-data-management settings-danger-zone";

  const details = document.createElement("details");
  details.className = "settings-danger-details";

  const summary = document.createElement("summary");
  summary.textContent = "Advanced reset options (danger zone)";

  const warning = document.createElement("p");
  warning.className = "settings-danger-warning";
  warning.textContent =
    "WARNING: This permanently erases all local data, backups, settings, and deletes the SecondBrain folder/files from Google Drive. This cannot be undone.";

  const resetButton = createActionButton("Erase everything and start from scratch", async () => {
    if (typeof onFullDataReset !== "function") {
      window.alert("Reset handler is unavailable.");
      return;
    }

    const firstConfirmation = window.confirm(
      "This will permanently delete all local app data AND remove synced data from Google Drive. Continue?"
    );
    if (!firstConfirmation) {
      return;
    }

    const secondConfirmation = window.confirm(
      "Final confirmation: erase all data from this device and Google Drive now?"
    );
    if (!secondConfirmation) {
      return;
    }

    try {
      await onFullDataReset();
      window.alert("Reset complete. All data has been erased locally and from Google Drive.");
    } catch (error) {
      window.alert(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  resetButton.classList.add("settings-danger-button", "settings-danger-button-emphasis");

  details.append(summary, warning, resetButton);
  wrap.appendChild(details);
  return wrap;
}

/**
 * Backup management entry point that keeps version selectors tucked into a modal.
 */
function createBackupsSection({ onBackupRestore, onDataRestore }) {
  const wrap = document.createElement("section");
  wrap.className = "settings-data-management";

  const title = document.createElement("h2");
  title.textContent = "Dataset backups";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent =
    "Backups are timestamped snapshots created before sync/import overwrites. Open the backup manager to inspect versions and restore safely.";

  const openButton = createActionButton("Open backup manager", () => {
    document.body.appendChild(createBackupRestoreModal({ onBackupRestore, onDataRestore }));
  });

  wrap.append(title, hint, openButton);
  return wrap;
}

/**
 * Builds the backup restore modal so destructive restore controls are not always visible.
 */
function createBackupRestoreModal({ onBackupRestore, onDataRestore }) {
  const overlay = document.createElement("div");
  overlay.className = "meeting-modal-overlay settings-action-modal-overlay";

  const modal = document.createElement("section");
  modal.className = "meeting-modal settings-action-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Backup manager");

  const title = document.createElement("h3");
  title.textContent = "Backup manager";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent = "Pick a dataset, select a backup version, and restore only after confirming the replacement.";

  const list = document.createElement("div");
  list.className = "settings-list";

  for (const descriptor of SYNCABLE_DOCUMENTS) {
    const versions = listDatasetBackups(descriptor.id);
    const row = document.createElement("article");
    row.className = "settings-item";

    const heading = document.createElement("span");
    heading.className = "settings-label";
    heading.textContent = `${descriptor.id} (${versions.length} version${versions.length === 1 ? "" : "s"})`;

    const select = document.createElement("select");
    select.className = "field-input";
    select.appendChild(buildOption("", versions.length ? "Select backup version" : "No backups yet"));

    for (const version of versions) {
      const relative = formatBackupTime(version.createdAt);
      select.appendChild(buildOption(version.backupKey, `${version.createdAt} (${relative}) · ${version.reason}`));
    }

    const restoreButton = createActionButton("Restore selected backup", () => {
      const backupKey = select.value;
      if (!backupKey) {
        window.alert("Select a backup version first.");
        return;
      }

      const confirmation = window.confirm(
        `Restore ${descriptor.id} from backup ${backupKey}? This will replace the current dataset payload.`
      );

      if (!confirmation) {
        return;
      }

      if (typeof onBackupRestore !== "function") {
        window.alert("Backup restore handler is unavailable.");
        return;
      }

      const result = onBackupRestore({ documentId: descriptor.id, backupKey, localKey: descriptor.localKey });
      if (!result?.ok) {
        window.alert(`Restore failed: ${result?.message || "unknown error"}`);
        return;
      }

      window.alert(result.message || "Restore completed.");
      onDataRestore?.();
    });

    restoreButton.disabled = versions.length === 0;
    row.append(heading, select, restoreButton);
    list.appendChild(row);
  }

  const closeButton = createActionButton("Close", () => overlay.remove());

  // Clicking the shaded backdrop closes the modal while clicks inside content keep focus in place.
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  modal.append(title, hint, list, closeButton);
  overlay.appendChild(modal);
  return overlay;
}

function formatBackupTime(timestamp) {
  const millis = Date.parse(timestamp || "");
  if (Number.isNaN(millis)) {
    return "unknown time";
  }

  const elapsedMinutes = Math.floor((Date.now() - millis) / 60000);
  if (elapsedMinutes <= 0) {
    return "just now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function buildField(label, type, required = false) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = label;

  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
  input.required = required;

  wrap.appendChild(input);
  return { wrap, input };
}

function buildCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function buildActionsCell(buttons) {
  const cell = document.createElement("td");
  cell.className = "tasks-row-actions";
  buttons.forEach((button) => cell.appendChild(button));
  return cell;
}

function smallButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "enter-mode-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function buildOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function createSelectSetting({ label, hint, value, options, onChange }) {
  const row = document.createElement("label");
  row.className = "settings-item";

  const heading = document.createElement("span");
  heading.className = "settings-label";
  heading.textContent = label;

  const help = document.createElement("small");
  help.className = "settings-hint";
  help.textContent = hint;

  const input = document.createElement("select");
  input.className = "field-input";
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    input.appendChild(option);
  }
  input.value = options.some(([optionValue]) => optionValue === value) ? value : options[0]?.[0] || "";
  input.addEventListener("change", (event) => onChange(event.target.value));

  row.append(heading, help, input);
  return row;
}

function stringifyConflictValue(value) {
  if (typeof value === "string") {
    return value;
  }

  // Pretty formatting improves legibility for nested arrays/objects such as update recipient states.
  return JSON.stringify(value, null, 2);
}

function createToggleSetting({ label, hint, checked, onChange }) {
  const row = document.createElement("div");
  row.className = "settings-item";

  const heading = document.createElement("span");
  heading.className = "settings-label";
  heading.textContent = label;

  const help = document.createElement("small");
  help.className = "settings-hint";
  help.textContent = hint;

  const wrap = document.createElement("label");
  wrap.className = "field-checkbox";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", (event) => onChange(event.target.checked));

  const text = document.createElement("span");
  text.textContent = checked ? "Enabled" : "Disabled";
  input.addEventListener("change", (event) => {
    text.textContent = event.target.checked ? "Enabled" : "Disabled";
  });

  wrap.append(input, text);
  row.append(heading, help, wrap);
  return row;
}

function sanitizeSettings(settings) {
  return {
    theme: ["light", "dark"].includes(settings?.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    layoutDensity: ["comfortable", "compact"].includes(settings?.layoutDensity)
      ? settings.layoutDensity
      : DEFAULT_SETTINGS.layoutDensity,
    confirmUnsavedChanges:
      typeof settings?.confirmUnsavedChanges === "boolean"
        ? settings.confirmUnsavedChanges
        : DEFAULT_SETTINGS.confirmUnsavedChanges,
    startMode: ["ask", "work", "personal"].includes(settings?.startMode)
      ? settings.startMode
      : DEFAULT_SETTINGS.startMode
  };
}

function toTitleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
