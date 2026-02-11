import { APP_VERSION, VERSION_BUMP_NOTE } from "./version.js";
import { renderTopBar } from "./modules/topbar.js";
import { renderSidebar } from "./modules/sidebar.js";
import { renderLandingDashboard, renderModeDashboard } from "./modules/dashboard.js";
import { loadSettings, saveSettings } from "./modules/settings.js";
import { createSyncSubsystem } from "./modules/sync.js";
import { isOnboardingComplete, renderOnboardingModule } from "./modules/onboarding.js";
import { restoreDatasetBackup } from "./modules/dataset-backups.js";
import { loadUpdates, selectUpdatesForPerson } from "./modules/updates.js";

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

    // Sync updates change only top-bar information. Patching the header in place
    // avoids remounting module content, which would otherwise close transient UI
    // like open slide-over editors while a user is typing.
    if (!renderTopBarInPlace()) {
      renderApp();
    }
  }
});


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
    onSyncAction: handleSyncAction
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
    onSyncAction: handleSyncAction
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
          onScheduleOneOnOne: handleScheduleOneOnOne,
          onSettingsChange: handleSettingsChange,
          onDataRestore: handleDataRestore,
          onBackupRestore: handleBackupRestore,
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

  shell.append(topBar, content, footer);
  appRoot.appendChild(shell);

  state.meetingPrefillByMode[state.activeMode] = null;
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
    void syncSubsystem.signIn();
    return;
  }

  if (action === "sync") {
    void syncSubsystem.syncNow({ reason: "manual" });
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

applyUserSettings(state.settings);
syncSubsystem.start();
renderApp();
