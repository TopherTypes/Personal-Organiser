import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleAuthClient } from "../src/modules/google-auth.js";

test("getAccessToken does not attempt silent GIS refresh by default", async () => {
  localStorage.clear();

  let initTokenClientCalls = 0;
  const googleRef = {
    accounts: {
      oauth2: {
        initTokenClient() {
          initTokenClientCalls += 1;
          return {
            requestAccessToken() {
              throw new Error("requestAccessToken should not be called without explicit opt-in");
            }
          };
        }
      }
    }
  };

  const authClient = createGoogleAuthClient({
    clientId: "client-id",
    googleRef
  });

  await assert.rejects(
    authClient.getAccessToken({ interactive: false }),
    /unavailable without interactive sign-in/
  );
  assert.equal(initTokenClientCalls, 0);
});

test("getAccessToken silently rehydrates token when a valid session exists", async () => {
  localStorage.clear();

  const tokenRequestPrompts = [];
  const googleRef = {
    accounts: {
      oauth2: {
        initTokenClient({ callback }) {
          return {
            requestAccessToken({ prompt }) {
              tokenRequestPrompts.push(prompt);
              callback({ access_token: "restored-token", expires_in: 3600 });
            }
          };
        }
      }
    }
  };

  const authClient = createGoogleAuthClient({
    clientId: "client-id",
    googleRef,
    now: () => 1_000
  });

  localStorage.setItem(
    "second-brain.sync.auth-session.v1",
    JSON.stringify({ email: "user@example.com", expiresAt: 120_000, lastAuthCheckAt: 500 })
  );

  const token = await authClient.getAccessToken({ interactive: false });
  assert.equal(token, "restored-token");
  assert.deepEqual(tokenRequestPrompts, ["none"]);
});


test("getAccessToken restores runtime token cache from session storage after reload", async () => {
  localStorage.clear();
  sessionStorage.clear();

  const firstClientGoogleRef = {
    accounts: {
      oauth2: {
        initTokenClient({ callback }) {
          return {
            requestAccessToken() {
              callback({ access_token: "session-cached-token", expires_in: 3600 });
            }
          };
        }
      }
    }
  };

  const firstClient = createGoogleAuthClient({
    clientId: "client-id",
    googleRef: firstClientGoogleRef
  });

  await firstClient.signInInteractive();

  let subsequentInitCalls = 0;
  const secondClientGoogleRef = {
    accounts: {
      oauth2: {
        initTokenClient() {
          subsequentInitCalls += 1;
          return {
            requestAccessToken() {
              throw new Error("GIS should not be invoked when session token cache is still valid");
            }
          };
        }
      }
    }
  };

  const secondClient = createGoogleAuthClient({
    clientId: "client-id",
    googleRef: secondClientGoogleRef
  });

  const token = await secondClient.getAccessToken({ interactive: false });
  assert.equal(token, "session-cached-token");
  assert.equal(subsequentInitCalls, 0);
});
