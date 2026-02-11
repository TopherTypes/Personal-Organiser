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
