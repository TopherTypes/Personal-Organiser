/**
 * Renders the top bar that remains visible across all app states.
 * Includes mode switch plus live sync status indicators.
 */
export function renderTopBar({ activeMode, isModeSwitchDisabled, onModeChange, syncState, onSyncAction }) {
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

  const syncStatus = renderSyncStatus(syncState, onSyncAction);

  header.append(brand, modeSwitch, syncStatus);
  return header;
}

/**
 * Creates the sync status segment with state, pending queue count, and conflict badge.
 */
function renderSyncStatus(syncState, onSyncAction) {
  const wrap = document.createElement("div");
  wrap.className = "sync-status";
  wrap.setAttribute("aria-live", "polite");

  const state = syncState?.syncStatus || "idle";
  const pending = Number(syncState?.pendingChanges || 0);
  const conflicts = Number(syncState?.conflictCount || 0);
  const retries = Number(syncState?.retries || 0);

  const statusLine = document.createElement("div");
  statusLine.className = `sync-status-line state-${state}`;
  statusLine.textContent = `Sync: ${stateLabel(state)}`;

  const detailLine = document.createElement("small");
  detailLine.className = "sync-status-detail";

  const lastSyncLabel = syncState?.lastSuccessfulSyncAt
    ? formatRelativeSyncTime(syncState.lastSuccessfulSyncAt)
    : "never";

  detailLine.textContent = `Pending ${pending} · Last ${lastSyncLabel}${retries > 0 ? ` · Retrying (${retries})` : ""}`;

  wrap.append(statusLine, detailLine);

  if (conflicts > 0) {
    const conflict = document.createElement("span");
    conflict.className = "sync-conflict-count";
    conflict.textContent = `${conflicts} conflict${conflicts === 1 ? "" : "s"}`;
    wrap.appendChild(conflict);
  }

  if (syncState?.syncStatus === "error" && syncState.errorMessage) {
    const error = document.createElement("small");
    error.className = "sync-status-error";
    error.textContent = syncState.errorMessage;
    wrap.appendChild(error);
  }

  const action = document.createElement("button");
  action.type = "button";
  action.className = "sync-action-button";
  if (syncState?.authStatus === "signed-in") {
    action.textContent = "Sync now";
    action.disabled = syncState?.syncStatus === "syncing";
    action.addEventListener("click", () => onSyncAction("sync"));
  } else {
    action.textContent = "Connect Drive";
    action.addEventListener("click", () => onSyncAction("sign-in"));
  }

  wrap.appendChild(action);
  return wrap;
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

function stateLabel(state) {
  switch (state) {
    case "syncing":
      return "Syncing";
    case "offline":
      return "Offline";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function formatRelativeSyncTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "never";
  }

  const elapsedMs = Date.now() - date.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
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

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}
