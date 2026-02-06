import { APP_VERSION, VERSION_BUMP_NOTE } from "./version.js";
import { renderTopBar } from "./modules/topbar.js";
import { renderSidebar } from "./modules/sidebar.js";
import { renderLandingDashboard, renderModeDashboard } from "./modules/dashboard.js";

/**
 * In-memory app state for the baseline shell.
 * No persistence or sync is performed in this stage.
 */
const state = {
  activeMode: "work",
  hasEnteredMode: false,
  activeModuleByMode: {
    work: "dashboard",
    personal: "dashboard"
  },
  meetingPrefillByMode: {
    work: null,
    personal: null
  },
  hasUnsavedChanges: false
};

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
    onModeChange: handleModeChange
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
 * Prompts before module/mode changes when form edits are unsaved.
 */
function confirmNavigation() {
  if (!state.hasUnsavedChanges) {
    return true;
  }

  return window.confirm("You have unsaved changes. Leave this screen anyway?");
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

renderApp();
