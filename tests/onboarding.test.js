import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createOnboardingController,
  isOnboardingComplete,
  markOnboardingComplete
} from "../src/modules/onboarding.js";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../src/modules/settings.js";

function createDriveBootstrapStub({ failFirstFileBootstrap = false } = {}) {
  const created = {
    folder: false,
    files: new Set()
  };

  let includeFileCalls = 0;

  return {
    async ensureBootstrap({ includeFiles = true } = {}) {
      if (!created.folder) {
        created.folder = true;
      }

      if (!includeFiles) {
        return {
          folder: { id: "folder-1", created: true },
          files: []
        };
      }

      includeFileCalls += 1;
      if (failFirstFileBootstrap && includeFileCalls === 1) {
        throw new Error("temporary Drive outage");
      }

      const files = ["work.json", "personal.json", "meta.json"].map((name) => {
        const isNew = !created.files.has(name);
        created.files.add(name);
        return { id: name, name, created: isNew };
      });

      return {
        folder: { id: "folder-1", created: false },
        files
      };
    }
  };
}

test("first-run marker is false by default and true after completion", () => {
  localStorage.clear();

  assert.equal(isOnboardingComplete(), false);
  markOnboardingComplete();

  assert.equal(localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY), "true");
  assert.equal(isOnboardingComplete(), true);
});

test("resume behavior retries failed Drive bootstrap and keeps setup idempotent", async () => {
  localStorage.clear();

  let signInCalls = 0;
  const authClient = {
    ensureValidSession: async () => ({ status: "signed-out", session: null }),
    signInInteractive: async () => {
      signInCalls += 1;
      return { status: "signed-in", session: { email: "dev@example.com" } };
    }
  };

  const driveClient = createDriveBootstrapStub({ failFirstFileBootstrap: true });
  const saveCalls = [];

  const controller = createOnboardingController({
    authClient,
    driveClient,
    loadSettingsRef: () => ({ theme: "light", layoutDensity: "comfortable", startMode: "ask", confirmUnsavedChanges: true }),
    saveSettingsRef: (settings) => {
      saveCalls.push(settings);
      return settings;
    }
  });

  await assert.rejects(
    controller.runPending({ preferences: { startMode: "work" } }),
    /temporary Drive outage/
  );

  let steps = controller.getSnapshot();
  assert.equal(steps.find((step) => step.id === "auth")?.status, "complete");
  assert.equal(steps.find((step) => step.id === "folder")?.status, "complete");
  assert.equal(steps.find((step) => step.id === "files")?.status, "error");
  assert.equal(isOnboardingComplete(), false);

  await controller.runPending({ preferences: { startMode: "work" } });

  steps = controller.getSnapshot();
  assert.equal(steps.every((step) => step.status === "complete"), true);
  assert.equal(isOnboardingComplete(), true);
  assert.equal(signInCalls, 1);
  assert.equal(saveCalls.at(-1)?.startMode, "work");
});
