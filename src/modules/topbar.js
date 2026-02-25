/**
 * Renders the app-level top bar with branding, mode switch, and account/sync cluster.
 */
export function renderTopBar({
  activeMode,
  isModeSwitchDisabled,
  onModeChange,
  syncState,
  onSyncAction,
  onOpenCommandPalette,
  onOpenSettings
}) {
  const header = document.createElement("header");
  header.className = "top-bar";

  const brand = document.createElement("div");
  brand.className = "brand";
  brand.textContent = "The Second Brain";

  const accountCluster = document.createElement("div");
  accountCluster.className = "account-sync-cluster";

  const modeSwitch = document.createElement("div");
  modeSwitch.className = "mode-switch";
  modeSwitch.setAttribute("role", "radiogroup");
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
  wireModeSwitchKeyboard(modeSwitch, onModeChange);
  const commandPaletteButton = document.createElement("button");
  commandPaletteButton.type = "button";
  commandPaletteButton.className = "button button-secondary command-palette-button";
  commandPaletteButton.textContent = "Search (Ctrl/Cmd+K)";
  commandPaletteButton.setAttribute("aria-label", "Open command palette");
  commandPaletteButton.addEventListener("click", () => onOpenCommandPalette());

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "button button-secondary";
  settingsButton.textContent = "Settings";
  settingsButton.setAttribute("aria-label", "Open settings");
  settingsButton.addEventListener("click", () => onOpenSettings?.());

  accountCluster.append(modeSwitch, commandPaletteButton, settingsButton, renderSyncStatus(syncState, onSyncAction));

  header.append(brand, accountCluster);
  return header;
}

/**
 * Creates the sync status segment with state, pending queue count, and conflict badge.
 *
 * The compact summary row keeps top-bar height small while preserving all
 * previously exposed state details and action behavior.
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

  const accountSummary =
    syncState?.authStatus === "signed-in"
      ? syncState?.authSession?.email || "Connected to Drive"
      : "Drive not connected";

  const summaryRow = document.createElement("div");
  summaryRow.className = "sync-status-summary-row";

  const summaryText = document.createElement("div");
  summaryText.className = "sync-status-summary-text";

  const tags = document.createElement("div");
  tags.className = "sync-status-tags";

  if (retries > 0) {
    const retry = document.createElement("span");
    retry.className = "sync-retry-indicator";
    retry.textContent = `Retrying (${retries})`;
    tags.appendChild(retry);
  }

  if (conflicts > 0) {
    const conflict = document.createElement("span");
    conflict.className = "sync-conflict-count";
    conflict.textContent = `${conflicts} conflict${conflicts === 1 ? "" : "s"}`;
    tags.appendChild(conflict);

    const resolveButton = document.createElement("button");
    resolveButton.type = "button";
    resolveButton.className = "button button-secondary sync-conflict-action";
    resolveButton.textContent = "Resolve";
    resolveButton.addEventListener("click", () => onSyncAction("resolve-conflicts"));
    tags.appendChild(resolveButton);
  }

  // Keep action controls on the same row as status copy so the box does not
  // reserve a large empty footer strip in the common non-conflict state.
  if (!tags.childElementCount) {
    tags.classList.add("hidden");
  }

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

  const actionCluster = document.createElement("div");
  actionCluster.className = "sync-status-actions";
  actionCluster.append(tags, action);

  // Merge account identity into the detail line to keep key sync diagnostics
  // visible without adding another dedicated text row.
  detailLine.textContent = `${detailLine.textContent} · ${accountSummary}`;
  summaryText.append(statusLine, detailLine);
  summaryRow.append(summaryText, actionCluster);
  wrap.append(summaryRow);

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
  button.dataset.mode = mode;
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(activeMode === mode));
  // Roving tabindex keeps keyboard focus on the active mode while preserving
  // full tab-order discoverability for the mode switch as a whole.
  button.tabIndex = activeMode === mode ? 0 : -1;

  if (activeMode === mode) {
    button.classList.add("active");
  }

  button.addEventListener("click", () => onModeChange(mode));
  return button;
}

/**
 * Adds radio-group keyboard behavior so left/right arrows cycle modes and
 * Enter/Space activate the focused option.
 */
function wireModeSwitchKeyboard(modeSwitch, onModeChange) {
  const buttons = Array.from(modeSwitch.querySelectorAll(".mode-button"));
  if (!buttons.length) {
    return;
  }

  const focusButtonAt = (index) => {
    buttons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === index ? 0 : -1;
    });
    buttons[index].focus();
  };

  modeSwitch.addEventListener("keydown", (event) => {
    const currentIndex = buttons.indexOf(document.activeElement);
    if (currentIndex < 0) {
      return;
    }

    if (["ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % buttons.length;
      focusButtonAt(nextIndex);
      onModeChange(buttons[nextIndex].dataset.mode);
      return;
    }

    if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const previousIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      focusButtonAt(previousIndex);
      onModeChange(buttons[previousIndex].dataset.mode);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusButtonAt(0);
      onModeChange(buttons[0].dataset.mode);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusButtonAt(buttons.length - 1);
      onModeChange(buttons[buttons.length - 1].dataset.mode);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onModeChange(buttons[currentIndex].dataset.mode);
    }
  });
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
