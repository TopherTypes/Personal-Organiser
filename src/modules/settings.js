import {
  downloadDatasetExport,
  getMergeRulesSummary,
  parseAndValidateImportPayload,
  restoreFromImportPayload
} from "./storage-export.js";
import { listDatasetBackups } from "./dataset-backups.js";
import { SYNCABLE_DOCUMENTS } from "./sync.js";

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

  list.append(
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

  const dataManagement = createDataManagementSection({ onDataRestore });
  const syncConflictSection = createSyncConflictSection({ syncState, onResolveSyncConflicts });
  const backupsSection = createBackupsSection({ onBackupRestore, onDataRestore });
  const destructiveSection = createDestructiveResetSection({ onFullDataReset });

  section.append(title, intro, list, dataManagement, syncConflictSection, backupsSection, destructiveSection);
  return section;
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

    const values = document.createElement("small");
    values.className = "settings-hint";
    values.textContent = `Local: ${stringifyConflictValue(conflict.localValue)} | Remote: ${stringifyConflictValue(conflict.remoteValue)}`;

    const choice = document.createElement("select");
    choice.className = "field-input";
    choice.append(
      buildOption("suggested", `Suggested (${stringifyConflictValue(conflict.suggestedValue)})`),
      buildOption("local", "Keep local value"),
      buildOption("remote", "Keep remote value")
    );

    selectsByConflictId.set(conflict.conflictId, choice);
    item.append(heading, values, choice);
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
  resetButton.classList.add("button-danger-subtle", "settings-danger-button");

  details.append(summary, warning, resetButton);
  wrap.appendChild(details);
  return wrap;
}

/**
 * Backup management UI to inspect rollback points and trigger explicit restore confirmations.
 */
function createBackupsSection({ onBackupRestore, onDataRestore }) {
  const wrap = document.createElement("section");
  wrap.className = "settings-data-management";

  const title = document.createElement("h2");
  title.textContent = "Dataset backups";

  const hint = document.createElement("p");
  hint.className = "module-intro";
  hint.textContent =
    "Backups are timestamped snapshots created before sync/import overwrites. Select a version and confirm to restore safely.";

  const list = document.createElement("div");
  list.className = "settings-list";

  for (const descriptor of SYNCABLE_DOCUMENTS) {
    const versions = listDatasetBackups(descriptor.id);
    const row = document.createElement("div");
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

    const button = createActionButton("Restore selected backup", () => {
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

    button.disabled = versions.length === 0;

    row.append(heading, select, button);
    list.appendChild(row);
  }

  wrap.append(title, hint, list);
  return wrap;
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

  return JSON.stringify(value);
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
