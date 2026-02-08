import { APP_VERSION, VERSION_BUMP_NOTE } from "./version.js";
import { renderTopBar } from "./modules/topbar.js";
import { renderSidebar } from "./modules/sidebar.js";
import { renderLandingDashboard, renderModeDashboard } from "./modules/dashboard.js";
import { loadSettings, saveSettings } from "./modules/settings.js";
import { createSyncSubsystem } from "./modules/sync.js";

/**
 * In-memory app state for the shell.
 * Sync state is hydrated from the sync subsystem and reflected in the top bar.
 */
const initialSettings = loadSettings();

const state = {
  activeMode: initialSettings.startMode === "personal" ? "personal" : "work",
  hasEnteredMode: initialSettings.startMode !== "ask",
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
    errorMessage: "",
    retries: 0
  }
};

const syncSubsystem = createSyncSubsystem({
  onStateChange: (syncState) => {
    state.sync = syncState;
    renderApp();
  }
});

const appRoot = document.querySelector("#app");

if (!appRoot) {
  throw new Error("Expected #app root element to exist.");
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

  if (state.hasEnteredMode) {
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
  state.activeMode = mode;
  state.hasEnteredMode = true;
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

  state.activeModuleByMode[state.activeMode] = "meetings";
  state.meetingPrefillByMode[state.activeMode] = {
    name: `1:1 with ${person.name}`,
    type: "one-on-one",
    attendeeIds: [person.id]
  };
  renderApp();
}

/**
 * Handles sync-related topbar actions.
 */
function handleSyncAction(action) {
  if (action === "sign-in") {
    syncSubsystem.signIn();
    return;
  }

  if (action === "sync") {
    void syncSubsystem.syncNow({ reason: "manual" });
  }
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
