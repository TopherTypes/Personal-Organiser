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
  }
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
        activeModule: state.activeModuleByMode[state.activeMode]
      })
    );
  } else {
    content.append(renderLandingDashboard({ onEnterMode: handleEnterMode }));
  }

  const footer = renderFooter();

  shell.append(topBar, content, footer);
  appRoot.appendChild(shell);
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

  state.activeMode = mode;
  renderApp();
}

/**
 * Handles module selection from the sidebar.
 */
function handleModuleSelect(moduleKey) {
  state.activeModuleByMode[state.activeMode] = moduleKey;
  renderApp();
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
