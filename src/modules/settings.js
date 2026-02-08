import {
  downloadDatasetExport,
  getMergeRulesSummary,
  parseAndValidateImportPayload,
  restoreFromImportPayload
} from "./storage-export.js";

const SETTINGS_STORAGE_KEY = "second-brain.ui.settings.v1";


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
export function renderSettingsModule({ mode, settings, onSettingsChange, onDataRestore }) {
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

  section.append(title, intro, list, dataManagement);
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
