const GOOGLE_AUTH_STORAGE_KEY = "second-brain.sync.auth-session.v1";
const GOOGLE_AUTH_RUNTIME_TOKEN_KEY = "second-brain.sync.auth-runtime-token.v1";
const EXPIRY_SAFETY_WINDOW_MS = 30_000;

/**
 * Creates a thin Google Identity Services auth client wrapper used by sync.
 *
 * The client persists non-sensitive session metadata in localStorage and keeps
 * short-lived access tokens in sessionStorage to survive same-tab reloads.
 * This avoids interactive re-auth loops while still preventing long-lived token
 * persistence across browser restarts.
 */
export function createGoogleAuthClient({
  clientId,
  scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
  storageKey = GOOGLE_AUTH_STORAGE_KEY,
  localStorageRef = localStorage,
  sessionStorageRef = globalThis.sessionStorage,
  now = () => Date.now(),
  googleRef = globalThis.google
} = {}) {
  const hasConfig = typeof clientId === "string" && clientId.trim().length > 0;
  let currentAccessToken = "";

  function loadRuntimeToken() {
    if (!sessionStorageRef || typeof sessionStorageRef.getItem !== "function") {
      return null;
    }

    const raw = sessionStorageRef.getItem(GOOGLE_AUTH_RUNTIME_TOKEN_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const accessToken = typeof parsed.accessToken === "string" ? parsed.accessToken : "";
      const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
      if (!accessToken || expiresAt - now() <= EXPIRY_SAFETY_WINDOW_MS) {
        return null;
      }

      return { accessToken, expiresAt };
    } catch {
      return null;
    }
  }

  function saveRuntimeToken({ accessToken, expiresAt }) {
    if (!sessionStorageRef || typeof sessionStorageRef.setItem !== "function") {
      return;
    }

    sessionStorageRef.setItem(
      GOOGLE_AUTH_RUNTIME_TOKEN_KEY,
      JSON.stringify({
        accessToken: accessToken || "",
        expiresAt: expiresAt || 0
      })
    );
  }

  function clearRuntimeToken() {
    if (!sessionStorageRef || typeof sessionStorageRef.removeItem !== "function") {
      return;
    }

    sessionStorageRef.removeItem(GOOGLE_AUTH_RUNTIME_TOKEN_KEY);
  }

  function loadSession() {
    const raw = localStorageRef.getItem(storageKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return {
        email: typeof parsed.email === "string" ? parsed.email : "",
        expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
        lastAuthCheckAt: typeof parsed.lastAuthCheckAt === "number" ? parsed.lastAuthCheckAt : 0
      };
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    localStorageRef.setItem(
      storageKey,
      JSON.stringify({
        email: session.email || "",
        expiresAt: session.expiresAt || 0,
        lastAuthCheckAt: session.lastAuthCheckAt || now()
      })
    );
  }

  function clearSession() {
    currentAccessToken = "";
    clearRuntimeToken();
    localStorageRef.removeItem(storageKey);
  }

  function hasValidSession() {
    const session = loadSession();
    return !!session && session.expiresAt - now() > EXPIRY_SAFETY_WINDOW_MS;
  }

  async function acquireToken({ interactive }) {
    if (!hasConfig || !googleRef?.accounts?.oauth2?.initTokenClient) {
      throw new Error("Google Identity Services is not configured.");
    }

    const tokenResponse = await new Promise((resolve, reject) => {
      const tokenClient = googleRef.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (response) => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }

          resolve(response);
        },
        error_callback: (response) => reject(new Error(response?.message || "Google auth request failed."))
      });

      // prompt:'none' attempts cookie-based session restore with no UI. If the user has no Google session,
      // GIS returns an error and the caller can fall back to interactive consent.
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "none" });
    });

    return tokenResponse;
  }

  async function resolveAccountEmail(accessToken) {
    try {
      const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        return "";
      }

      const payload = await response.json();
      return typeof payload?.email === "string" ? payload.email : "";
    } catch {
      // Email is decorative metadata in UI; auth can still succeed if profile lookup fails.
      return "";
    }
  }

  async function persistFromTokenResponse(tokenResponse) {
    const expiresInSeconds = Number(tokenResponse?.expires_in || 0);
    const existingSession = loadSession();
    const fallbackExpiresAt = existingSession?.expiresAt || now() + 55 * 60 * 1000;
    const expiresAt =
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? now() + expiresInSeconds * 1000
        : fallbackExpiresAt;
    currentAccessToken = typeof tokenResponse?.access_token === "string" ? tokenResponse.access_token : "";
    if (currentAccessToken) {
      saveRuntimeToken({ accessToken: currentAccessToken, expiresAt });
    }
    const email = tokenResponse?.email || (await resolveAccountEmail(tokenResponse?.access_token || ""));

    const session = {
      email,
      expiresAt,
      lastAuthCheckAt: now()
    };

    saveSession(session);
    return session;
  }

  async function checkSessionSilently() {
    try {
      const tokenResponse = await acquireToken({ interactive: false });
      const session = await persistFromTokenResponse(tokenResponse);
      return { status: "signed-in", session };
    } catch {
      // Silent auth failures are expected when no Google cookie/session exists.
      clearSession();
      return { status: "signed-out", session: null };
    }
  }

  async function signInInteractive() {
    const tokenResponse = await acquireToken({ interactive: true });
    const session = await persistFromTokenResponse(tokenResponse);
    return { status: "signed-in", session };
  }

  async function ensureValidSession({ allowInteractiveFallback = false, allowSilentRefresh = true } = {}) {
    const existingSession = loadSession();
    if (existingSession && existingSession.expiresAt - now() > EXPIRY_SAFETY_WINDOW_MS) {
      const refreshedSession = { ...existingSession, lastAuthCheckAt: now() };
      saveSession(refreshedSession);
      return { status: "signed-in", session: refreshedSession };
    }

    // Browser privacy and popup policies can block GIS silent token refresh attempts
    // (`prompt=none`) in background tasks. Callers can disable silent refresh for
    // non-user-initiated flows to prevent noisy popup/COOP console errors.
    if (!allowSilentRefresh) {
      clearSession();
      return { status: "signed-out", session: null };
    }

    const silentResult = await checkSessionSilently();
    if (silentResult.status === "signed-in") {
      return silentResult;
    }

    if (!allowInteractiveFallback) {
      return silentResult;
    }

    try {
      return await signInInteractive();
    } catch {
      clearSession();
      return { status: "signed-out", session: null };
    }
  }

  async function getAccessToken({ interactive = false, allowSilentRefresh = false } = {}) {
    // Reuse a token already acquired during the current runtime (for example
    // after user-initiated sign-in) to avoid unnecessary auth round-trips.
    if (currentAccessToken) {
      return currentAccessToken;
    }

    // Restore short-lived runtime token cache persisted in session storage so page
    // reloads do not force the user through interactive re-authentication loops.
    const cachedRuntimeToken = loadRuntimeToken();
    if (cachedRuntimeToken) {
      currentAccessToken = cachedRuntimeToken.accessToken;
      return currentAccessToken;
    }

    // Non-interactive API calls should still be able to recover token memory when a
    // valid auth session is already persisted (for example after a page reload).
    // We keep the default guard for truly unauthenticated sessions to avoid surprise
    // GIS flows in unrelated background operations.
    if (!interactive && !allowSilentRefresh) {
      const existingSession = loadSession();
      const hasPersistedSession = !!existingSession && existingSession.expiresAt - now() > EXPIRY_SAFETY_WINDOW_MS;
      if (!hasPersistedSession) {
        throw new Error("Google access token is unavailable without interactive sign-in.");
      }
    }

    const tokenResponse = await acquireToken({ interactive });
    await persistFromTokenResponse(tokenResponse);
    return currentAccessToken;
  }

  function signOut() {
    clearSession();
    return { status: "signed-out", session: null };
  }

  return {
    hasConfig,
    loadSession,
    hasValidSession,
    ensureValidSession,
    getAccessToken,
    signInInteractive,
    signOut
  };
}

export { GOOGLE_AUTH_STORAGE_KEY };
