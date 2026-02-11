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
export function renderSettingsModule({ mode, settings, onSettingsChange, onDataRestore, onBackupRestore }) {
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
  const backupsSection = createBackupsSection({ onBackupRestore, onDataRestore });

  section.append(title, intro, list, dataManagement, backupsSection);
  return section;
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

  const buttonRow = document.createElement("div");
  buttonRow.className = "settings-export-actions";

  buttonRow.append(
    createActionButton("Export Work JSON", () => downloadDatasetExport("work")),
    createActionButton("Export Personal JSON", () => downloadDatasetExport("personal")),
    createActionButton("Export Combined JSON", () => downloadDatasetExport("combined"))
  );

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

  wrap.append(title, hint, buttonRow, importForm, mergeRules);
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
  input.value = value;
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    input.appendChild(option);
  }
  input.addEventListener("change", (event) => onChange(event.target.value));

  row.append(heading, help, input);
  return row;
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
