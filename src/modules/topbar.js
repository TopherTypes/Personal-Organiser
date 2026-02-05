/**
 * Renders the top bar that remains visible across all app states.
 * Includes mode switch and sync status placeholder.
 */
export function renderTopBar({ activeMode, isModeSwitchDisabled, onModeChange }) {
  const header = document.createElement("header");
  header.className = "top-bar";

  const brand = document.createElement("div");
  brand.className = "brand";
  brand.textContent = "The Second Brain";

  const modeSwitch = document.createElement("div");
  modeSwitch.className = "mode-switch";

  const workButton = createModeButton("Work", "work", activeMode, isModeSwitchDisabled, onModeChange);
  const personalButton = createModeButton(
    "Personal",
    "personal",
    activeMode,
    isModeSwitchDisabled,
    onModeChange
  );

  modeSwitch.append(workButton, personalButton);

  const syncStatus = document.createElement("div");
  syncStatus.className = "sync-status";
  syncStatus.setAttribute("aria-live", "polite");
  syncStatus.textContent = "Sync: Offline / Not configured";

  header.append(brand, modeSwitch, syncStatus);
  return header;
}

/**
 * Creates an individual mode toggle button.
 */
function createModeButton(label, mode, activeMode, isDisabled, onModeChange) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mode-button";
  button.textContent = label;
  button.disabled = isDisabled;
  button.setAttribute("aria-pressed", String(activeMode === mode));

  if (activeMode === mode) {
    button.classList.add("active");
  }

  button.addEventListener("click", () => onModeChange(mode));
  return button;
}
