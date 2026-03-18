import { APP_VERSION, VERSION_BUMP_NOTE } from "./version.js";
import { renderTopBar } from "./modules/topbar.js";
import { renderSidebar } from "./modules/sidebar.js";
// Cache-bust dashboard module import so clients always fetch the latest navigation/module wiring.
import { renderLandingDashboard, renderModeDashboard } from "./modules/dashboard.js?v=2026-02-18-3";
import { loadSettings, saveSettings } from "./modules/settings.js";
import { createSyncSubsystem } from "./modules/sync.js";
import { isOnboardingComplete, renderOnboardingModule } from "./modules/onboarding.js";
import { restoreDatasetBackup } from "./modules/dataset-backups.js";
import { loadUpdates, selectUpdatesForPerson } from "./modules/updates.js";
import { renderCommandPalette, searchCommandPalette } from "./modules/command-palette.js";
import { renderQuickActions } from "./modules/quick-actions.js";

/**
 * In-memory app state for the shell.
 * Sync state is hydrated from the sync subsystem and reflected in the top bar.
 */
const initialSettings = loadSettings();
const onboardingComplete = isOnboardingComplete();

const state = {
  activeMode: initialSettings.startMode === "personal" ? "personal" : "work",
  hasEnteredMode: onboardingComplete && initialSettings.startMode !== "ask",
  needsOnboarding: !onboardingComplete,
  activeModuleByMode: {
    work: "dashboard",
    personal: "dashboard"
  },
  meetingPrefillByMode: {
    work: null,
    personal: null
  },
  meetingFocusByMode: {
    work: "",
    personal: ""
  },
  taskPrefillByMode: {
    work: "",
    personal: ""
  },
  quickActionByMode: {
    work: null,
    personal: null
  },
  hasUnsavedChanges: false,
  settings: initialSettings,
  sync: {
    syncStatus: navigator.onLine ? "idle" : "offline",
    authStatus: "signed-out",
    pendingChanges: 0,
    conflictCount: 0,
    lastSuccessfulSyncAt: "",
    infoMessage: "",
    errorMessage: "",
    retries: 0
  },
  // Tracks whether we are still in the very first app-level sync experience.
  isInitialSyncPending: true,
  // Prevents repeated GIS popup loops if automatic re-auth fails during the
  // first-sync blocking experience.
  hasAttemptedInitialReauth: false,
  // Keeps the progress bar monotonic during the initial sync so repeated
  // pull/merge passes never appear to jump backwards in the UI.
  initialSyncProgressPeak: 0,
  commandPalette: {
    isOpen: false,
    query: "",
    selectedIndex: 0
  }
};

/**
 * Resolve and validate the app root before wiring subsystems that can trigger
 * immediate render callbacks during their own initialization.
 */
const appRoot = document.querySelector("#app");

if (!appRoot) {
  throw new Error("Expected #app root element to exist.");
}

const syncSubsystem = createSyncSubsystem({
  onStateChange: (syncState) => {
    state.sync = syncState;
    maybeAutoOpenInitialSyncReauth();
    syncInitialSyncExperienceState();
    syncInitialSyncProgressTracker();

    // Sync updates change only top-bar information. Patching the header in place
    // avoids remounting module content, which would otherwise close transient UI
    // like open slide-over editors while a user is typing.
    const patchedTopBar = renderTopBarInPlace();
    const patchedInitialSyncModal = renderInitialSyncModalInPlace();

    if (!patchedTopBar && !patchedInitialSyncModal) {
      renderApp();
    }
  }
});

/**
 * Automatically launches the Google account picker when first-sync is blocked
 * by an expired Drive session.
 *
 * Rationale:
 * - The initial-sync modal intentionally blocks UI interaction until the first
 *   successful sync to avoid edits against stale data.
 * - If auth expires during that flow, users cannot click the reconnect button
 *   behind the modal, so we proactively trigger the same interactive sign-in.
 */
function maybeAutoOpenInitialSyncReauth() {
  if (!state.isInitialSyncPending) {
    return;
  }

  if (state.sync.authStatus === "signed-in") {
    state.hasAttemptedInitialReauth = false;
    return;
  }

  if (state.hasAttemptedInitialReauth || state.sync.authStatus === "checking") {
    return;
  }

  if (state.sync.errorReason !== "auth-expired") {
    return;
  }

  state.hasAttemptedInitialReauth = true;
  syncSubsystem.signIn().catch((err) => console.error("[app] Auto reauth failed:", err));
}


/**
 * Replaces only the top bar in the current shell.
 *
 * Returns true when an in-place patch was applied, false when the shell has not
 * been mounted yet (for example during first boot), in which case full render is required.
 */
function renderTopBarInPlace() {
  const shell = appRoot.querySelector(".app-shell");
  const existingTopBar = shell?.querySelector(".top-bar");
  if (!shell || !existingTopBar) {
    return false;
  }

  const nextTopBar = renderTopBar({
    activeMode: state.activeMode,
    isModeSwitchDisabled: !state.hasEnteredMode,
    onModeChange: handleModeChange,
    syncState: state.sync,
    onSyncAction: handleSyncAction,
    onOpenCommandPalette: openCommandPalette
  });

  existingTopBar.replaceWith(nextTopBar);
  return true;
}

/**
 * Main render loop for this small SPA shell.
 */
function renderApp() {
  appRoot.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "app-shell";

  const topBar = renderTopBar({
    activeMode: state.activeMode,
    isModeSwitchDisabled: !state.hasEnteredMode,
    onModeChange: handleModeChange,
    syncState: state.sync,
    onSyncAction: handleSyncAction,
    onOpenCommandPalette: openCommandPalette
  });

  const content = document.createElement("div");
  content.className = "content";

  if (state.needsOnboarding) {
    content.classList.add("content-onboarding");
    content.append(
      renderOnboardingModule({
        initialSettings: state.settings,
        onSettingsChange: handleSettingsChange,
        onComplete: handleOnboardingComplete
      })
    );
  } else if (state.hasEnteredMode) {
    content.append(
      renderSidebar({
        mode: state.activeMode,
        activeModule: state.activeModuleByMode[state.activeMode],
        onModuleSelect: handleModuleSelect
      }),
      renderModeDashboard(state.activeMode, {
        activeModule: state.activeModuleByMode[state.activeMode],
        uiContext: {
          meetingPrefill: state.meetingPrefillByMode[state.activeMode],
          meetingFocusId: state.meetingFocusByMode[state.activeMode],
          onScheduleOneOnOne: handleScheduleOneOnOne,
          onNavigate: handleDashboardNavigate,
          taskPrefillProjectId: state.taskPrefillByMode[state.activeMode],
          quickAction: state.quickActionByMode[state.activeMode],
          onSettingsChange: handleSettingsChange,
          onDataRestore: handleDataRestore,
          onBackupRestore: handleBackupRestore,
          onFullDataReset: handleFullDataReset,
          onResolveSyncConflicts: handleResolveSyncConflicts,
          syncState: state.sync,
          settings: state.settings,
          setUnsavedChangesGuard: (value) => {
            state.hasUnsavedChanges = value;
          }
        }
      })
    );
  } else {
    content.append(renderLandingDashboard({ onEnterMode: handleEnterMode }));
  }

  const footer = renderFooter();
  const initialSyncModal = renderInitialSyncModal();
  const commandPalette = renderCommandPaletteLayer();
  const quickActions = renderQuickActions({
    activeMode: state.activeMode,
    enabled: state.hasEnteredMode && !state.needsOnboarding,
    onTriggerAction: handleQuickAction
  });

  shell.append(topBar, content, footer, initialSyncModal, commandPalette, quickActions);
  appRoot.appendChild(shell);

  state.meetingPrefillByMode[state.activeMode] = null;
  state.meetingFocusByMode[state.activeMode] = "";
  state.taskPrefillByMode[state.activeMode] = "";
  state.quickActionByMode[state.activeMode] = null;
}

/**
 * Builds command palette with up-to-date index snapshots from local datasets.
 */
function renderCommandPaletteLayer() {
  const results = searchCommandPalette(state.commandPalette.query);
  const boundedSelectedIndex = Math.max(0, Math.min(state.commandPalette.selectedIndex, Math.max(results.length - 1, 0)));
  state.commandPalette.selectedIndex = boundedSelectedIndex;

  return renderCommandPalette({
    isOpen: state.commandPalette.isOpen,
    query: state.commandPalette.query,
    results,
    selectedIndex: boundedSelectedIndex,
    onClose: closeCommandPalette,
    onQueryChange: updateCommandPaletteQuery,
    onSelect: handleCommandPaletteSelect,
    onMoveSelection: moveCommandPaletteSelection
  });
}

/**
 * Marks first-sync UX as complete after the first successful sync cycle.
 */
function syncInitialSyncExperienceState() {
  if (!state.isInitialSyncPending) {
    return;
  }

  if (state.sync.lastSuccessfulSyncAt) {
    state.isInitialSyncPending = false;
  }
}


/**
 * Maintains a non-decreasing progress baseline while the initial sync is active.
 *
 * Why this exists:
 * - Sync can run more than one pull/merge/push pass during startup (for example
 *   a startup trigger followed by an auth-boot trigger).
 * - Without a peak tracker the progress UI can move backwards (e.g. 90% -> 45%),
 *   which looks like a regression to users even though sync is still healthy.
 */
function syncInitialSyncProgressTracker() {
  if (!state.isInitialSyncPending || !state.sync.isSyncing) {
    state.initialSyncProgressPeak = 0;
    return;
  }

  const stageProgress = baseInitialSyncProgressValue(state.sync.syncStatus, state.sync.isSyncing);
  state.initialSyncProgressPeak = Math.max(state.initialSyncProgressPeak, stageProgress);
}

/**
 * Builds a blocking modal for the first automatic sync so users avoid editing
 * data while initial reconciliation is in progress.
 */
function renderInitialSyncModal() {
  const modal = document.createElement("div");
  modal.className = "initial-sync-modal-overlay";
  modal.dataset.initialSyncModal = "true";

  if (!shouldShowInitialSyncModal()) {
    modal.classList.add("hidden");
    return modal;
  }

  const dialog = document.createElement("section");
  dialog.className = "initial-sync-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-live", "polite");

  const title = document.createElement("h2");
  title.textContent = "Finishing first sync";

  const detail = document.createElement("p");
  detail.className = "sync-status-detail";
  detail.textContent = describeInitialSyncStage(state.sync.syncStatus);

  const progressWrap = document.createElement("div");
  progressWrap.className = "initial-sync-progress-wrap";

  const progress = document.createElement("progress");
  progress.className = "initial-sync-progress";
  progress.max = 100;
  progress.value = initialSyncProgressValue(state.sync.syncStatus, state.sync.isSyncing);

  const percent = document.createElement("span");
  percent.className = "initial-sync-progress-label";
  percent.textContent = `${progress.value}%`;

  progressWrap.append(progress, percent);
  dialog.append(title, detail, progressWrap);
  modal.appendChild(dialog);
  return modal;
}

/**
 * Re-renders only the first-sync modal after sync-state changes.
 */
function renderInitialSyncModalInPlace() {
  const shell = appRoot.querySelector(".app-shell");
  const existingModal = shell?.querySelector("[data-initial-sync-modal='true']");
  if (!shell || !existingModal) {
    return false;
  }

  existingModal.replaceWith(renderInitialSyncModal());
  return true;
}

function shouldShowInitialSyncModal() {
  // The blocking first-sync overlay is only useful while a user is actively
  // authenticated. If Drive auth has dropped to signed-out, keeping the overlay
  // visible prevents access to the top-bar reconnect control and can trap users
  // in a greyed-out screen with no recovery path.
  const isActivelyAuthenticated = state.sync.authStatus === "signed-in";
  return state.isInitialSyncPending && state.sync.isSyncing && isActivelyAuthenticated;
}

/**
 * Maps sync-engine stages into coarse progress percentages for the first-sync UX.
 */
function initialSyncProgressValue(syncStatus, isSyncing) {
  if (!isSyncing) {
    return 100;
  }

  const baseProgress = baseInitialSyncProgressValue(syncStatus, isSyncing);
  return Math.max(baseProgress, state.initialSyncProgressPeak);
}

/**
 * Returns stage-level baseline progress percentages for first-sync UX.
 */
function baseInitialSyncProgressValue(syncStatus, isSyncing) {
  if (!isSyncing) {
    return 100;
  }

  switch (syncStatus) {
    case "auth-check":
      return 15;
    case "pulling":
      // If we've already reached push, a later pull represents verification,
      // not a restart, so keep progress near completion.
      return state.initialSyncProgressPeak >= 90 ? 95 : 45;
    case "merging":
      return 70;
    case "pushing":
      return 90;
    default:
      return 25;
  }
}

function describeInitialSyncStage(syncStatus) {
  switch (syncStatus) {
    case "auth-check":
      return "Checking account access…";
    case "pulling":
      return state.initialSyncProgressPeak >= 90
        ? "Verifying cloud state after upload…"
        : "Pulling cloud data…";
    case "merging":
      return "Reconciling records…";
    case "pushing":
      return "Saving merged updates…";
    default:
      return "Sync in progress…";
  }
}

/**
 * Handles mode entry from the landing dashboard.
 */
function handleEnterMode(mode) {
  if (state.needsOnboarding) {
    return;
  }

  state.activeMode = mode;
  state.hasEnteredMode = true;
  renderApp();
}

/**
 * Unlocks the standard app shell once onboarding completion marker is persisted.
 */
function handleOnboardingComplete() {
  state.needsOnboarding = false;
  state.hasEnteredMode = state.settings.startMode !== "ask";
  state.activeMode = state.settings.startMode === "personal" ? "personal" : "work";
  renderApp();
}

/**
 * Handles mode switching after a mode is entered.
 */
function handleModeChange(mode) {
  if (!state.hasEnteredMode) {
    return;
  }

  if (!confirmNavigation()) {
    return;
  }

  state.activeMode = mode;
  renderApp();
}

/**
 * Handles module selection from the sidebar.
 */
function handleModuleSelect(moduleKey) {
  if (!confirmNavigation()) {
    return;
  }

  state.activeModuleByMode[state.activeMode] = moduleKey;
  state.meetingFocusByMode[state.activeMode] = "";
  renderApp();
}

/**
 * Handles deep-link navigation requests emitted from dashboard cards.
 *
 * The dashboard can optionally request a specific entity focus (for example,
 * open a meeting editor directly) while still delegating route ownership to
 * the application shell.
 */
function handleDashboardNavigate({ moduleKey, focus = {}, quickAction = null } = {}) {
  if (!moduleKey || typeof moduleKey !== "string") {
    return;
  }

  if (!confirmNavigation()) {
    return;
  }

  state.activeModuleByMode[state.activeMode] = moduleKey;
  state.meetingPrefillByMode[state.activeMode] = null;
  state.meetingFocusByMode[state.activeMode] = focus.meetingId || "";
  state.taskPrefillByMode[state.activeMode] = moduleKey === "tasks" ? focus.projectId || "" : "";
  state.quickActionByMode[state.activeMode] = quickAction && quickAction.moduleKey
    ? {
      moduleKey: quickAction.moduleKey,
      createIntent: quickAction.createIntent,
      requestedAt: new Date().toISOString()
    }
    : null;
  renderApp();
}

/**
 * Navigates to a module and injects one-shot create intent consumed during module mount.
 */
function handleQuickAction(action) {
  if (!action?.moduleKey || !confirmNavigation()) {
    return;
  }

  const mode = state.activeMode;
  state.activeModuleByMode[mode] = action.moduleKey;
  state.meetingFocusByMode[mode] = "";
  state.taskPrefillByMode[mode] = "";
  state.meetingPrefillByMode[mode] = action.createIntent === "meeting" ? {} : null;
  state.quickActionByMode[mode] = {
    moduleKey: action.moduleKey,
    createIntent: action.createIntent,
    requestedAt: new Date().toISOString()
  };
  renderApp();
}

/**
 * Opens the command palette and resets selection to the first result.
 */
function openCommandPalette() {
  state.commandPalette.isOpen = true;
  state.commandPalette.selectedIndex = 0;
  renderApp();
}

/**
 * Closes the command palette while preserving the current query string.
 */
function closeCommandPalette() {
  if (!state.commandPalette.isOpen) {
    return;
  }

  state.commandPalette.isOpen = false;
  renderApp();
}

/**
 * Keeps query state in app memory so top-level re-renders stay deterministic.
 */
function updateCommandPaletteQuery(query) {
  state.commandPalette.query = query;
  state.commandPalette.selectedIndex = 0;
  renderApp();
}

/**
 * Moves highlighted command palette result by an offset while staying in bounds.
 */
function moveCommandPaletteSelection(offset) {
  const results = searchCommandPalette(state.commandPalette.query);
  if (!results.length) {
    state.commandPalette.selectedIndex = 0;
    renderApp();
    return;
  }

  const maxIndex = results.length - 1;
  const nextIndex = Math.max(0, Math.min(maxIndex, state.commandPalette.selectedIndex + offset));
  if (nextIndex === state.commandPalette.selectedIndex) {
    return;
  }

  state.commandPalette.selectedIndex = nextIndex;
  renderApp();
}

/**
 * Applies selection by switching mode (if needed) and reusing dashboard-style deep-link hooks.
 */
function handleCommandPaletteSelect(result) {
  if (!result || !confirmNavigation()) {
    return;
  }

  state.activeMode = result.mode;
  state.hasEnteredMode = true;
  state.activeModuleByMode[result.mode] = result.moduleKey;
  state.meetingPrefillByMode[result.mode] = null;
  state.meetingFocusByMode[result.mode] = result.focus?.meetingId || "";
  state.commandPalette.isOpen = false;
  state.commandPalette.selectedIndex = 0;

  renderApp();
}

/**
 * Receives a person record and pre-fills a new 1:1 meeting draft.
 */
function handleScheduleOneOnOne(person) {
  if (!confirmNavigation()) {
    return;
  }

  // Keep the prefill context intentionally compact so meeting notes remain scannable
  // while still surfacing the most important open follow-ups for prep.
  const pendingUpdates = selectUpdatesForPerson(loadUpdates(state.activeMode), person.id)
    .map(({ update }) => `• ${update.text}`)
    .slice(0, 3);

  const pendingUpdatesContext = pendingUpdates.length
    ? ["Pending updates for prep:", ...pendingUpdates].join("\n")
    : "";

  state.activeModuleByMode[state.activeMode] = "meetings";
  state.meetingFocusByMode[state.activeMode] = "";
  state.meetingPrefillByMode[state.activeMode] = {
    name: `1:1 with ${person.name}`,
    type: "one-on-one",
    attendeeIds: [person.id],
    notes: pendingUpdatesContext
  };
  renderApp();
}

/**
 * Handles sync-related topbar actions.
 */
function handleSyncAction(action) {
  if (action === "sign-in") {
    syncSubsystem.signIn().catch((err) => console.error("[app] Sign-in failed:", err));
    return;
  }

  if (action === "sync") {
    syncSubsystem.syncNow({ reason: "manual" }).catch((err) => console.error("[app] Manual sync failed:", err));
    return;
  }

  if (action === "resolve-conflicts") {
    state.activeModuleByMode[state.activeMode] = "settings";
    renderApp();
  }
}

/**
 * Applies conflict resolution choices selected in Settings and refreshes UI state.
 */
async function handleResolveSyncConflicts(resolutions) {
  const result = await syncSubsystem.applyConflictResolutions(resolutions);
  state.sync = {
    ...state.sync,
    infoMessage: result.appliedCount > 0 ? `Applied ${result.appliedCount} conflict resolution(s).` : "No conflicts to resolve.",
    errorMessage: ""
  };
  renderApp();
}

/**
 * Prompts before module/mode changes when form edits are unsaved.
 */
function confirmNavigation() {
  if (!state.hasUnsavedChanges || !state.settings.confirmUnsavedChanges) {
    return true;
  }

  return window.confirm("You have unsaved changes. Leave this screen anyway?");
}


/**
 * Re-renders app after data restore so modules reflect imported state immediately.
 */
function handleDataRestore() {
  state.hasUnsavedChanges = false;
  renderApp();
}

/**
 * Runs a destructive reset that clears both local and Google Drive data.
 */
async function handleFullDataReset() {
  await syncSubsystem.eraseAllDataAndReset();
  state.settings = loadSettings();
  state.needsOnboarding = !isOnboardingComplete();
  state.hasEnteredMode = false;
  state.activeMode = "work";
  state.activeModuleByMode = {
    work: "dashboard",
    personal: "dashboard"
  };
  state.meetingPrefillByMode = {
    work: null,
    personal: null
  };
  state.meetingFocusByMode = {
    work: "",
    personal: ""
  };
  state.hasUnsavedChanges = false;
  applyUserSettings(state.settings);
  renderApp();
}

/**
 * Handles restore requests from Settings backup controls.
 *
 * This path validates backup schema/version before mutation, then forces UI refresh via
 * handleDataRestore() so all modules rehydrate from restored localStorage values.
 */
function handleBackupRestore({ documentId, backupKey, localKey }) {
  try {
    const restored = restoreDatasetBackup({
      documentId,
      backupKey,
      expectedLocalStorageKey: localKey
    });

    state.sync = {
      ...state.sync,
      infoMessage: `Restored ${documentId} from ${restored.backupCreatedAt}.`,
      errorMessage: ""
    };

    handleDataRestore();
    return { ok: true, message: `Restore complete for ${documentId}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.sync = {
      ...state.sync,
      errorMessage: `Restore failed: ${message}`,
      infoMessage: ""
    };

    renderApp();
    return { ok: false, message };
  }
}

/**
 * Applies user settings and triggers a re-render.
 */
function handleSettingsChange(nextSettings) {
  state.settings = saveSettings(nextSettings);
  applyUserSettings(state.settings);
  renderApp();
}

/**
 * Applies theme and layout preferences at document level.
 */
function applyUserSettings(settings) {
  document.documentElement.dataset.theme = settings.theme;
  document.body.dataset.density = settings.layoutDensity;
}

/**
 * Footer includes visible versioning information.
 */
function renderFooter() {
  const footer = document.createElement("footer");
  footer.className = "footer";

  const version = document.createElement("span");
  version.textContent = `Version ${APP_VERSION}`;

  const note = document.createElement("small");
  note.textContent = VERSION_BUMP_NOTE;

  footer.append(version, note);
  return footer;
}


/**
 * Supports global keyboard shortcut access to the command palette (Ctrl/Cmd+K).
 */
function handleGlobalKeydown(event) {
  const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
  if (isPaletteShortcut) {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (event.key === "Escape" && state.commandPalette.isOpen) {
    event.preventDefault();
    closeCommandPalette();
  }
}

window.addEventListener("keydown", handleGlobalKeydown);
window.addEventListener("beforeunload", () => syncSubsystem.stop());

applyUserSettings(state.settings);
syncSubsystem.start();
renderApp();
