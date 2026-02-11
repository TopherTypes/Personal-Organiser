import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createSyncSubsystem } from "../src/modules/sync.js";

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
    navigatorRef: { onLine: true }
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
    navigatorRef: { onLine: true }
  });

  sync.start();
  await flushTasks();

  const state = sync.getState();
  assert.equal(state.authStatus, "signed-out");
  assert.equal(state.authSession, null);
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
    navigatorRef: { onLine: true }
  });

  sync.start();
  await flushTasks();
  await sync.syncNow({ reason: "manual" });

  const state = sync.getState();
  assert.equal(state.authStatus, "signed-out");
  assert.equal(state.authSession, null);
});
