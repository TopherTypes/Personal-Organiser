/**
 * Renders the app-level top bar with branding, mode switch, and account/sync cluster.
 */
export function renderTopBar({ activeMode, isModeSwitchDisabled, onModeChange, syncState, onSyncAction }) {
  const header = document.createElement("header");
  header.className = "top-bar";

  const brand = document.createElement("div");
  brand.className = "brand";
  brand.textContent = "The Second Brain";

  const accountCluster = document.createElement("div");
  accountCluster.className = "account-sync-cluster";

  const modeSwitch = document.createElement("div");
  modeSwitch.className = "mode-switch";
  modeSwitch.setAttribute("aria-label", "Mode switch");

  const workButton = createModeButton("Work", "work", activeMode, isModeSwitchDisabled, onModeChange);
  const personalButton = createModeButton(
    "Personal",
    "personal",
    activeMode,
    isModeSwitchDisabled,
    onModeChange
  );

  modeSwitch.append(workButton, personalButton);
  accountCluster.append(modeSwitch, renderSyncStatus(syncState, onSyncAction));

  header.append(brand, accountCluster);
  return header;
}

/**
 * Creates the sync status segment with state, pending queue count, and conflict badge.
 */
function renderSyncStatus(syncState, onSyncAction) {
  const wrap = document.createElement("section");
  wrap.className = "sync-status";
  wrap.setAttribute("aria-live", "polite");
  wrap.setAttribute("aria-label", "Account and sync");

  const state = syncState?.syncStatus || "idle";
  const pending = Number(syncState?.pendingChanges || 0);
  const conflicts = Number(syncState?.conflictCount || 0);
  const retries = Number(syncState?.retries || 0);

  const statusLine = document.createElement("p");
  statusLine.className = `sync-status-line state-${state}`;
  statusLine.textContent = stateLabel(state);

  const detailLine = document.createElement("p");
  detailLine.className = "sync-status-detail";

  const lastSyncLabel = syncState?.lastSuccessfulSyncAt
    ? formatRelativeSyncTime(syncState.lastSuccessfulSyncAt)
    : "Never synced";

  const failureDetail = syncState?.syncStatus === "error" ? errorReasonLabel(syncState?.errorReason) : "";
  detailLine.textContent = `Pending ${pending} · Last ${lastSyncLabel}${failureDetail ? ` · ${failureDetail}` : ""}`;

  const accountLabel = document.createElement("p");
  accountLabel.className = "sync-account-label";
  accountLabel.textContent =
    syncState?.authStatus === "signed-in"
      ? syncState?.authSession?.email || "Connected to Drive"
      : "Drive not connected";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "button button-secondary sync-action-button";

  if (syncState?.authStatus === "signed-in") {
    action.textContent = "Sync now";
    action.disabled = isBusySyncState(syncState?.syncStatus);
    action.addEventListener("click", () => onSyncAction("sync"));
  } else if (syncState?.authStatus === "checking") {
    action.textContent = "Checking Drive…";
    action.disabled = true;
  } else {
    action.textContent = "Connect Drive";
    action.addEventListener("click", () => onSyncAction("sign-in"));
  }

  wrap.append(statusLine, detailLine, accountLabel);

  if (retries > 0) {
    const retry = document.createElement("span");
    retry.className = "sync-retry-indicator";
    retry.textContent = `Retrying (${retries})`;
    wrap.appendChild(retry);
  }

  if (conflicts > 0) {
    const conflict = document.createElement("span");
    conflict.className = "sync-conflict-count";
    conflict.textContent = `${conflicts} conflict${conflicts === 1 ? "" : "s"}`;
    wrap.appendChild(conflict);
  }

  if (syncState?.infoMessage) {
    const info = document.createElement("small");
    info.className = "sync-status-info";
    info.textContent = syncState.infoMessage;
    wrap.appendChild(info);
  }

  if (syncState?.syncStatus === "error" && syncState.errorMessage) {
    const error = document.createElement("small");
    error.className = "sync-status-error";
    error.textContent = syncState.errorMessage;
    wrap.appendChild(error);
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
    case "auth-check":
      return "Checking authentication";
    case "pulling":
      return "Syncing: pulling";
    case "merging":
      return "Syncing: merging";
    case "pushing":
      return "Syncing: pushing";
    case "offline":
      return "Offline";
    case "error":
      return "Sync issue";
    default:
      return "Ready to sync";
  }
}

function errorReasonLabel(reason) {
  switch (reason) {
    case "auth-expired":
      return "Session expired";
    case "quota":
      return "Quota or rate limit";
    case "network-timeout":
      return "Network timeout";
    case "schema-mismatch":
      return "Schema mismatch";
    default:
      return "";
  }
}

function isBusySyncState(state) {
  return ["auth-check", "pulling", "merging", "pushing"].includes(state);
}

function formatRelativeSyncTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Never synced";
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
