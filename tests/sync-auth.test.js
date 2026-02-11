import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createSyncSubsystem } from "../src/modules/sync.js";
import { listDatasetBackups } from "../src/modules/dataset-backups.js";

function createWindowStub() {
  return {
    __APP_CONFIG__: { googleClientId: "client-id" },
    addEventListener() {},
    removeEventListener() {},
    setInterval() {
      return 1;
    },
    clearInterval() {}
  };
}

function flushTasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDriveClientStub() {
  return {
    async pullDocument() {
      return null;
    },
    async pushDocument() {}
  };
}

test("startup transitions signed-out to signed-in when silent auth succeeds", async () => {
  localStorage.clear();

  const fakeAuthClient = {
    ensureValidSession: async () => ({
      status: "signed-in",
      session: {
        email: "dev@example.com",
        expiresAt: Date.now() + 60_000,
        lastAuthCheckAt: Date.now()
      }
    }),
    signInInteractive: async () => ({ status: "signed-in", session: null }),
    signOut: () => ({ status: "signed-out", session: null })
  };

  const sync = createSyncSubsystem({
    authClientFactory: () => fakeAuthClient,
    windowRef: createWindowStub(),
    navigatorRef: { onLine: true },
    driveClientFactory: () => createDriveClientStub()
  });

  sync.start();
  await flushTasks();

  const state = sync.getState();
  assert.equal(state.authStatus, "signed-in");
  assert.equal(state.authSession?.email, "dev@example.com");
});

test("startup keeps signed-out when silent auth fails", async () => {
  localStorage.clear();

  const fakeAuthClient = {
    ensureValidSession: async () => ({ status: "signed-out", session: null }),
    signInInteractive: async () => ({ status: "signed-in", session: null }),
    signOut: () => ({ status: "signed-out", session: null })
  };

  const sync = createSyncSubsystem({
    authClientFactory: () => fakeAuthClient,
    windowRef: createWindowStub(),
    navigatorRef: { onLine: true },
    driveClientFactory: () => createDriveClientStub()
  });

  sync.start();
  await flushTasks();

  const state = sync.getState();
  assert.equal(state.authStatus, "signed-out");
  assert.equal(state.authSession, null);
});



test("startup auth check disables silent GIS refresh in background flow", async () => {
  localStorage.clear();

  const ensureCalls = [];
  const fakeAuthClient = {
    ensureValidSession: async (options = {}) => {
      ensureCalls.push(options);
      return { status: "signed-out", session: null };
    },
    signInInteractive: async () => ({ status: "signed-in", session: null }),
    signOut: () => ({ status: "signed-out", session: null })
  };

  const sync = createSyncSubsystem({
    authClientFactory: () => fakeAuthClient,
    windowRef: createWindowStub(),
    navigatorRef: { onLine: true },
    driveClientFactory: () => createDriveClientStub()
  });

  sync.start();
  await flushTasks();

  assert.deepEqual(ensureCalls[0], { allowSilentRefresh: false });
});

test("expired token path falls back to signed-out before sync", async () => {
  localStorage.clear();

  let ensureCount = 0;
  const fakeAuthClient = {
    ensureValidSession: async () => {
      ensureCount += 1;
      if (ensureCount === 1) {
        return {
          status: "signed-in",
          session: {
            email: "dev@example.com",
            expiresAt: Date.now() + 60_000,
            lastAuthCheckAt: Date.now()
          }
        };
      }

      return { status: "signed-out", session: null };
    },
    signInInteractive: async () => ({ status: "signed-in", session: null }),
    signOut: () => ({ status: "signed-out", session: null })
  };

  const sync = createSyncSubsystem({
    authClientFactory: () => fakeAuthClient,
    windowRef: createWindowStub(),
    navigatorRef: { onLine: true },
    driveClientFactory: () => createDriveClientStub()
  });

  sync.start();
  await flushTasks();
  await sync.syncNow({ reason: "manual" });

  const state = sync.getState();
  assert.equal(state.authStatus, "signed-out");
  assert.equal(state.authSession, null);
});


test("syncNow short-circuits when auth is required", async () => {
  localStorage.clear();

  let ensureCalls = 0;
  let pullCalls = 0;

  const fakeAuthClient = {
    ensureValidSession: async () => {
      ensureCalls += 1;
      return { status: "signed-out", session: null };
    },
    signInInteractive: async () => ({ status: "signed-in", session: null }),
    signOut: () => ({ status: "signed-out", session: null })
  };

  const sync = createSyncSubsystem({
    authClientFactory: () => fakeAuthClient,
    windowRef: createWindowStub(),
    navigatorRef: { onLine: true },
    driveClientFactory: () => ({
      async pullDocument() {
        pullCalls += 1;
        return null;
      },
      async pushDocument() {}
    })
  });

  await sync.syncNow({ reason: "manual" });

  const state = sync.getState();
  assert.equal(state.syncStatus, "idle");
  assert.equal(ensureCalls, 0);
  assert.equal(pullCalls, 0);
});
test("sync writes timestamped rollback backup before overwriting local dataset", async () => {
  localStorage.clear();
  localStorage.setItem(
    "second-brain.work.tasks.work.v1",
    JSON.stringify({ items: [{ id: "task-1", title: "Old", updatedAt: "2026-01-01T00:00:00.000Z" }] })
  );

  const fakeAuthClient = {
    ensureValidSession: async () => ({ status: "signed-in", session: { email: "dev@example.com" } }),
    signInInteractive: async () => ({ status: "signed-in", session: null }),
    signOut: () => ({ status: "signed-out", session: null })
  };

  const driveClient = {
    async pullDocument(documentId) {
      if (documentId === "work.tasks") {
        return { items: [{ id: "task-1", title: "Remote", updatedAt: "2026-01-01T00:01:00.000Z" }] };
      }
      return null;
    },
    async pushDocument() {}
  };

  const sync = createSyncSubsystem({
    authClientFactory: () => fakeAuthClient,
    windowRef: createWindowStub(),
    navigatorRef: { onLine: true },
    driveClientFactory: () => driveClient
  });

  sync.start();
  await flushTasks();
  await sync.syncNow({ reason: "manual" });

  const backups = listDatasetBackups("work.tasks");
  assert.equal(backups.length, 1);
  assert.match(backups[0].backupKey, /^backups\/work\.tasks\//);
  assert.match(sync.getState().infoMessage, /Sync complete/);
});
