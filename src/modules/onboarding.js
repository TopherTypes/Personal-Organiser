import { createGoogleAuthClient } from "./google-auth.js";
import { createGoogleDriveClient } from "./google-drive-client.js";
import { DEFAULT_SETTINGS, loadSettings, ONBOARDING_COMPLETED_STORAGE_KEY, saveSettings } from "./settings.js";

const STEP_IDS = Object.freeze({
  AUTH: "auth",
  FOLDER: "folder",
  FILES: "files",
  PREFERENCES: "preferences"
});

/**
 * Returns whether first-run onboarding has already completed on this device.
 */
export function isOnboardingComplete(localStorageRef = localStorage) {
  return localStorageRef.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "true";
}

/**
 * Persists onboarding completion marker after all steps are successful.
 */
export function markOnboardingComplete(localStorageRef = localStorage) {
  localStorageRef.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "true");
}

/**
 * Creates a deterministic onboarding state controller.
 *
 * State-transition contract:
 * - `pending`  -> step has not been executed yet in the current run.
 * - `running`  -> active in-flight async operation.
 * - `complete` -> finished successfully and safe to skip on retries.
 * - `error`    -> failed; user can retry without corrupting prior steps.
 *
 * Idempotency contract:
 * - Drive bootstrap steps call `ensureBootstrap()` checks that always discover
 *   existing resources before creating new ones.
 * - Re-running after interruption is safe because completed resources are reused.
 */
export function createOnboardingController({
  authClient,
  driveClient,
  loadSettingsRef = loadSettings,
  saveSettingsRef = saveSettings,
  localStorageRef = localStorage
} = {}) {
  const steps = [
    {
      id: STEP_IDS.AUTH,
      title: "Connect your Google account",
      description: "Authorise Drive access so your organiser can sync safely.",
      status: "pending",
      detail: ""
    },
    {
      id: STEP_IDS.FOLDER,
      title: "Validate SecondBrain/ folder",
      description: "Checks for the sync folder and creates it only if missing.",
      status: "pending",
      detail: ""
    },
    {
      id: STEP_IDS.FILES,
      title: "Validate required JSON files",
      description: "Ensures work.json, personal.json, and meta.json exist and are seeded.",
      status: "pending",
      detail: ""
    },
    {
      id: STEP_IDS.PREFERENCES,
      title: "Confirm preference defaults",
      description: "Saves your initial defaults for theme, density, and startup mode.",
      status: "pending",
      detail: ""
    }
  ];

  function getSnapshot() {
    return steps.map((step) => ({ ...step }));
  }

  function setStepStatus(stepId, status, detail = "") {
    const step = steps.find((item) => item.id === stepId);
    if (!step) {
      return;
    }

    step.status = status;
    step.detail = detail;
  }

  async function runStep(stepId, { preferences } = {}) {
    setStepStatus(stepId, "running", "");

    try {
      if (stepId === STEP_IDS.AUTH) {
        // Onboarding is user-initiated, but we still avoid background-style silent
        // refresh attempts. We first validate local session metadata and then make
        // sure an in-memory token is available for immediate Drive bootstrap calls.
        const sessionResult = await authClient.ensureValidSession({ allowSilentRefresh: false });

        if (sessionResult.status !== "signed-in") {
          await authClient.signInInteractive();
        } else if (typeof authClient.getAccessToken === "function") {
          try {
            // Reuse an already-present token when available; this avoids extra prompts
            // in the same runtime while still guaranteeing the next step can call Drive.
            await authClient.getAccessToken({ interactive: false });
          } catch {
            // Session metadata can be valid while runtime token memory is empty (for
            // example after page reload). Interactive sign-in rehydrates token state.
            await authClient.signInInteractive();
          }
        }

        setStepStatus(stepId, "complete", "Google account connected.");
        return;
      }

      if (stepId === STEP_IDS.FOLDER) {
        const bootstrap = await driveClient.ensureBootstrap({ includeFiles: false });
        setStepStatus(
          stepId,
          "complete",
          bootstrap.folder.created
            ? "Created SecondBrain/ folder in Drive."
            : "SecondBrain/ folder already existed."
        );
        return;
      }

      if (stepId === STEP_IDS.FILES) {
        const bootstrap = await driveClient.ensureBootstrap({ includeFiles: true });
        const createdCount = bootstrap.files.filter((file) => file.created).length;
        setStepStatus(
          stepId,
          "complete",
          createdCount > 0
            ? `Created ${createdCount} required file(s).`
            : "Required files already existed."
        );
        return;
      }

      if (stepId === STEP_IDS.PREFERENCES) {
        const stored = loadSettingsRef();
        const nextSettings = saveSettingsRef({
          ...DEFAULT_SETTINGS,
          ...stored,
          ...(preferences || {})
        });

        setStepStatus(
          stepId,
          "complete",
          `Preferences saved (theme: ${nextSettings.theme}, density: ${nextSettings.layoutDensity}).`
        );
        markOnboardingComplete(localStorageRef);
      }
    } catch (error) {
      setStepStatus(stepId, "error", toActionableError(stepId, error));
      throw error;
    }
  }

  async function runPending({ preferences } = {}) {
    for (const step of steps) {
      if (step.status === "complete") {
        continue;
      }

      await runStep(step.id, { preferences });
    }

    return { complete: isOnboardingComplete(localStorageRef) };
  }

  return {
    getSnapshot,
    runStep,
    runPending,
    stepIds: STEP_IDS
  };
}

/**
 * Renders first-run onboarding wizard with visible progress and retry actions.
 */
export function renderOnboardingModule({
  windowRef = window,
  localStorageRef = localStorage,
  initialSettings = loadSettings(),
  onSettingsChange,
  onComplete
} = {}) {
  const authClient = createGoogleAuthClient({ clientId: windowRef.__APP_CONFIG__?.googleClientId || "" });
  const driveClient = createGoogleDriveClient({ authClient });
  const controller = createOnboardingController({ authClient, driveClient, localStorageRef });

  const state = {
    steps: controller.getSnapshot(),
    busy: false,
    error: "",
    preferences: {
      theme: initialSettings.theme,
      layoutDensity: initialSettings.layoutDensity,
      startMode: initialSettings.startMode,
      confirmUnsavedChanges: initialSettings.confirmUnsavedChanges
    }
  };

  const section = document.createElement("section");
  section.className = "mode-dashboard onboarding-module";

  const title = document.createElement("h1");
  title.textContent = "Welcome to Personal Organiser";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Complete these one-time setup steps. If setup is interrupted, you can safely resume without duplicating Drive resources.";

  const progress = document.createElement("p");
  progress.className = "onboarding-progress";

  const list = document.createElement("ol");
  list.className = "onboarding-step-list";

  const error = document.createElement("p");
  error.className = "onboarding-error";

  const preferences = renderPreferenceCapture(state.preferences, (nextPreferences) => {
    state.preferences = nextPreferences;
  });

  const actions = document.createElement("div");
  actions.className = "onboarding-actions";

  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.className = "enter-mode-button";
  continueButton.textContent = "Continue setup";
  continueButton.addEventListener("click", () => {
    void runSetup();
  });

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "ghost-button";
  retryButton.textContent = "Retry current step";
  retryButton.addEventListener("click", () => {
    void runSetup();
  });

  actions.append(continueButton, retryButton);
  section.append(title, intro, progress, list, error, preferences, actions);

  render();
  return section;

  function render() {
    const completed = state.steps.filter((step) => step.status === "complete").length;
    progress.textContent = `Progress: ${completed}/${state.steps.length} complete`;

    list.innerHTML = "";
    for (const step of state.steps) {
      const item = document.createElement("li");
      item.className = "onboarding-step";
      item.dataset.status = step.status;

      const heading = document.createElement("strong");
      heading.textContent = step.title;

      const description = document.createElement("p");
      description.className = "module-intro";
      description.textContent = step.description;

      const detail = document.createElement("small");
      detail.textContent = step.detail || labelStatus(step.status);

      item.append(heading, description, detail);
      list.appendChild(item);
    }

    error.textContent = state.error;
    error.style.display = state.error ? "block" : "none";

    continueButton.disabled = state.busy;
    retryButton.disabled = state.busy;
  }

  async function runSetup() {
    state.busy = true;
    state.error = "";
    render();

    try {
      await controller.runPending({ preferences: state.preferences });
      state.steps = controller.getSnapshot();

      if (typeof onSettingsChange === "function") {
        onSettingsChange(state.preferences);
      }

      if (typeof onComplete === "function") {
        onComplete();
      }
    } catch {
      state.steps = controller.getSnapshot();
      const failed = state.steps.find((step) => step.status === "error");
      state.error = failed ? failed.detail : "Setup failed. Review the step details and retry.";
    } finally {
      state.busy = false;
      render();
    }
  }
}

function labelStatus(status) {
  if (status === "pending") {
    return "Pending";
  }

  if (status === "running") {
    return "Running...";
  }

  if (status === "complete") {
    return "Complete";
  }

  return "Action required";
}

function toActionableError(stepId, error) {
  const reason = error instanceof Error ? error.message : String(error);

  if (stepId === STEP_IDS.AUTH) {
    return `Google sign-in failed: ${reason}. Ensure pop-ups are allowed and Google OAuth client ID is configured.`;
  }

  if (stepId === STEP_IDS.FOLDER || stepId === STEP_IDS.FILES) {
    return `Drive bootstrap failed: ${reason}. Confirm Drive access was granted and retry this step.`;
  }

  return `Preference setup failed: ${reason}. Review selected values and retry.`;
}

function renderPreferenceCapture(preferencesState, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "settings-list onboarding-preferences";

  const updatePreference = (key, value) => {
    preferencesState[key] = value;
    onChange({ ...preferencesState });
  };

  wrap.append(
    createSelect({
      label: "Theme",
      value: preferencesState.theme,
      options: [
        ["light", "Light"],
        ["dark", "Dark"]
      ],
      onChange: (value) => updatePreference("theme", value)
    }),
    createSelect({
      label: "Layout density",
      value: preferencesState.layoutDensity,
      options: [
        ["comfortable", "Comfortable"],
        ["compact", "Compact"]
      ],
      onChange: (value) => updatePreference("layoutDensity", value)
    }),
    createSelect({
      label: "Start mode",
      value: preferencesState.startMode,
      options: [
        ["ask", "Always ask"],
        ["work", "Open Work automatically"],
        ["personal", "Open Personal automatically"]
      ],
      onChange: (value) => updatePreference("startMode", value)
    }),
    createCheckbox({
      label: "Unsaved-change warning",
      checked: preferencesState.confirmUnsavedChanges,
      onChange: (checked) => updatePreference("confirmUnsavedChanges", checked)
    })
  );

  return wrap;
}

function createSelect({ label, value, options, onChange }) {
  const row = document.createElement("label");
  row.className = "settings-item";

  const heading = document.createElement("span");
  heading.className = "settings-label";
  heading.textContent = label;

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

  row.append(heading, input);
  return row;
}

function createCheckbox({ label, checked, onChange }) {
  const row = document.createElement("label");
  row.className = "settings-item";

  const heading = document.createElement("span");
  heading.className = "settings-label";
  heading.textContent = label;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", (event) => onChange(event.target.checked));

  row.append(heading, input);
  return row;
}
