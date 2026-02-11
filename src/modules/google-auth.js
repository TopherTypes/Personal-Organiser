const GOOGLE_AUTH_STORAGE_KEY = "second-brain.sync.auth-session.v1";
const EXPIRY_SAFETY_WINDOW_MS = 30_000;

/**
 * Creates a thin Google Identity Services auth client wrapper used by sync.
 *
 * The client intentionally persists only non-sensitive session metadata.
 * Access tokens are kept in memory only long enough to validate auth and fetch
 * profile context, then discarded so we do not store long-lived credentials.
 */
export function createGoogleAuthClient({
  clientId,
  scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
  storageKey = GOOGLE_AUTH_STORAGE_KEY,
  localStorageRef = localStorage,
  now = () => Date.now(),
  googleRef = globalThis.google
} = {}) {
  const hasConfig = typeof clientId === "string" && clientId.trim().length > 0;
  let currentAccessToken = "";

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
    const expiresAt = now() + Math.max(0, expiresInSeconds) * 1000;
    currentAccessToken = typeof tokenResponse?.access_token === "string" ? tokenResponse.access_token : "";
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

  async function getAccessToken({ interactive = false } = {}) {
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
