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
export function renderSettingsModule({ mode, settings, onSettingsChange }) {
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

  section.append(title, intro, list);
  return section;
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
