/**
 * Google Drive transport for sync orchestration.
 *
 * Mapping rationale:
 * - The sync engine operates on logical document IDs (for example `work.tasks`).
 * - Drive persistence is spec-constrained to three files under `SecondBrain/`:
 *   `work.json`, `personal.json`, and `meta.json`.
 * - Each file stores a `documents` object keyed by logical ID so we can preserve
 *   current merge behavior without widening the sync orchestration surface area.
 *
 * Failure-handling rationale:
 * - Drive + network failures are normalized into `DriveTransportError` with an
 *   explicit `transient` flag.
 * - Existing `withRetry()` logic depends on this flag (and message matching),
 *   so transient conditions (timeouts, 429s, 5xxs, and backend throttling) are
 *   marked retryable while validation/auth failures are non-retryable.
 */

const DRIVE_API_ROOT = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_ROOT = "https://www.googleapis.com/upload/drive/v3";
const SECOND_BRAIN_FOLDER_NAME = "SecondBrain";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const JSON_MIME_TYPE = "application/json";

const FILE_NAMES = {
  work: "work.json",
  personal: "personal.json",
  meta: "meta.json"
};

const LOGICAL_TO_FILE = Object.freeze({
  "work.tasks": FILE_NAMES.work,
  "work.projects": FILE_NAMES.work,
  "work.people": FILE_NAMES.work,
  "work.sprints": FILE_NAMES.work,
  "work.meetings": FILE_NAMES.work,
  "personal.tasks": FILE_NAMES.personal,
  "personal.projects": FILE_NAMES.personal,
  "personal.people": FILE_NAMES.personal,
  "personal.daily-log": FILE_NAMES.personal,
  "personal.exercise-log": FILE_NAMES.personal,
  "personal.calendar": FILE_NAMES.personal
});

class DriveTransportError extends Error {
  constructor(message, { transient = false, status = 0, code = "unknown", operation = "unknown", cause = null } = {}) {
    super(message);
    this.name = "DriveTransportError";
    this.transient = transient;
    this.status = status;
    this.code = code;
    this.operation = operation;
    this.cause = cause;
  }
}

export function createGoogleDriveClient({ authClient, fetchImpl = fetch } = {}) {
  if (!authClient || typeof authClient.getAccessToken !== "function") {
    throw new Error("Google Drive client requires an auth client with getAccessToken().");
  }

  const state = {
    discovered: false,
    folderId: "",
    fileIdsByName: new Map()
  };

  async function pullDocument(documentId) {
    const fileName = resolveFileName(documentId);
    await ensureLayout();

    const fileId = state.fileIdsByName.get(fileName);
    const payload = await requestJson({
      fetchImpl,
      authClient,
      operation: "pull",
      url: `${DRIVE_API_ROOT}/files/${encodeURIComponent(fileId)}?alt=media`,
      fallback: { documents: {} }
    });

    const normalized = normalizeContainer(payload);
    return normalized.documents[documentId] ?? null;
  }

  async function pushDocument(documentId, value) {
    const fileName = resolveFileName(documentId);
    await ensureLayout();

    const fileId = state.fileIdsByName.get(fileName);
    const currentPayload = await requestJson({
      fetchImpl,
      authClient,
      operation: "pull-before-push",
      url: `${DRIVE_API_ROOT}/files/${encodeURIComponent(fileId)}?alt=media`,
      fallback: { documents: {} }
    });

    const normalized = normalizeContainer(currentPayload);
    normalized.documents[documentId] = normalizePayload(value);

    await requestNoContent({
      fetchImpl,
      authClient,
      operation: "push",
      method: "PATCH",
      url: `${DRIVE_UPLOAD_ROOT}/files/${encodeURIComponent(fileId)}?uploadType=media`,
      headers: { "Content-Type": JSON_MIME_TYPE },
      body: stableStringify(normalized)
    });
  }

  async function ensureLayout() {
    if (state.discovered) {
      return;
    }

    const folder = await findOrCreateSecondBrainFolder();
    state.folderId = folder.id;

    for (const fileName of Object.values(FILE_NAMES)) {
      const file = await findOrCreateFile(fileName, state.folderId);
      state.fileIdsByName.set(fileName, file.id);
    }

    state.discovered = true;
  }

  /**
   * Permanently removes the app-managed Drive folder and all known data files.
   *
   * We delete child files first, then the folder, so users can start from a
   * guaranteed clean remote state and avoid accidental re-sync of stale content.
   */
  async function purgeSecondBrainData() {
    const folder = await findSecondBrainFolder();
    if (!folder?.id) {
      state.discovered = false;
      state.folderId = "";
      state.fileIdsByName.clear();
      return { deletedFolder: false, deletedFileCount: 0 };
    }

    const files = await listFilesInFolder(folder.id);
    for (const file of files) {
      await deleteDriveFile(file.id);
    }

    await deleteDriveFile(folder.id);
    state.discovered = false;
    state.folderId = "";
    state.fileIdsByName.clear();
    return { deletedFolder: true, deletedFileCount: files.length };
  }

  /**
   * Validates/creates the required Drive layout in an idempotent way.
   *
   * This method is safe to call repeatedly during interrupted onboarding because
   * every resource is discovered before any create call is attempted.
   */
  async function ensureBootstrap({ includeFiles = true } = {}) {
    const folder = await findOrCreateSecondBrainFolder();
    state.folderId = folder.id;

    const files = [];
    if (includeFiles) {
      for (const fileName of Object.values(FILE_NAMES)) {
        const file = await findOrCreateFile(fileName, state.folderId);
        state.fileIdsByName.set(fileName, file.id);
        files.push(file);
      }

      state.discovered = true;
    }

    return { folder, files };
  }

  async function findOrCreateSecondBrainFolder() {
    const existing = await findSecondBrainFolder();
    if (existing?.id) {
      return { ...existing, created: false };
    }

    const created = await requestJson({
      fetchImpl,
      authClient,
      operation: "create-folder",
      method: "POST",
      url: `${DRIVE_API_ROOT}/files`,
      headers: { "Content-Type": JSON_MIME_TYPE },
      body: JSON.stringify({ name: SECOND_BRAIN_FOLDER_NAME, mimeType: FOLDER_MIME_TYPE })
    });

    return { ...created, created: true };
  }

  async function findSecondBrainFolder() {
    const q = encodeDriveQuery(
      `name = '${escapeDriveLiteral(SECOND_BRAIN_FOLDER_NAME)}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`
    );

    const listing = await requestJson({
      fetchImpl,
      authClient,
      operation: "discover-folder",
      url: `${DRIVE_API_ROOT}/files?q=${q}&fields=files(id,name,mimeType)`
    });

    return Array.isArray(listing?.files) ? listing.files[0] ?? null : null;
  }

  async function listFilesInFolder(folderId) {
    const q = encodeDriveQuery(`'${escapeDriveLiteral(folderId)}' in parents and trashed = false`);
    const listing = await requestJson({
      fetchImpl,
      authClient,
      operation: "list-folder-files",
      url: `${DRIVE_API_ROOT}/files?q=${q}&fields=files(id,name,mimeType)`
    });

    return Array.isArray(listing?.files) ? listing.files.filter((file) => Boolean(file?.id)) : [];
  }

  async function deleteDriveFile(fileId) {
    await requestNoContent({
      fetchImpl,
      authClient,
      operation: "delete",
      method: "DELETE",
      url: `${DRIVE_API_ROOT}/files/${encodeURIComponent(fileId)}`
    });
  }

  async function findOrCreateFile(fileName, folderId) {
    const q = encodeDriveQuery(
      `name = '${escapeDriveLiteral(fileName)}' and '${escapeDriveLiteral(folderId)}' in parents and trashed = false`
    );

    const listing = await requestJson({
      fetchImpl,
      authClient,
      operation: "discover-file",
      url: `${DRIVE_API_ROOT}/files?q=${q}&fields=files(id,name,mimeType)`
    });

    const existing = Array.isArray(listing?.files) ? listing.files[0] : null;
    if (existing?.id) {
      return { ...existing, created: false };
    }

    const created = await requestJson({
      fetchImpl,
      authClient,
      operation: "create-file",
      method: "POST",
      url: `${DRIVE_API_ROOT}/files`,
      headers: { "Content-Type": JSON_MIME_TYPE },
      body: JSON.stringify({
        name: fileName,
        mimeType: JSON_MIME_TYPE,
        parents: [folderId]
      })
    });

    await requestNoContent({
      fetchImpl,
      authClient,
      operation: "seed-file",
      method: "PATCH",
      url: `${DRIVE_UPLOAD_ROOT}/files/${encodeURIComponent(created.id)}?uploadType=media`,
      headers: { "Content-Type": JSON_MIME_TYPE },
      body: stableStringify({ documents: {} })
    });

    return { ...created, created: true };
  }

  return {
    ensureBootstrap,
    purgeSecondBrainData,
    pullDocument,
    pushDocument
  };
}

function resolveFileName(documentId) {
  const fileName = LOGICAL_TO_FILE[documentId];
  if (!fileName) {
    return FILE_NAMES.meta;
  }

  return fileName;
}

function normalizeContainer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { documents: {} };
  }

  const documents = value.documents;
  if (!documents || typeof documents !== "object" || Array.isArray(documents)) {
    return { documents: {} };
  }

  const normalizedDocuments = {};
  for (const [key, payload] of Object.entries(documents)) {
    normalizedDocuments[key] = normalizePayload(payload);
  }

  return { documents: normalizedDocuments };
}

function normalizePayload(value) {
  return JSON.parse(stableStringify(value ?? null));
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortValue(value[key]);
  }

  return sorted;
}

async function requestJson({ fetchImpl, authClient, operation, url, method = "GET", headers = {}, body, fallback } = {}) {
  const response = await requestWithAuth({ fetchImpl, authClient, operation, url, method, headers, body });

  if (response.status === 404 && fallback !== undefined) {
    return fallback;
  }

  const text = await response.text();
  if (!text) {
    return fallback !== undefined ? fallback : {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DriveTransportError(`Drive ${operation} returned invalid JSON.`, {
      transient: false,
      status: response.status,
      code: "invalid-json",
      operation,
      cause: error
    });
  }
}

async function requestNoContent({ fetchImpl, authClient, operation, url, method = "POST", headers = {}, body } = {}) {
  await requestWithAuth({ fetchImpl, authClient, operation, url, method, headers, body });
}

async function requestWithAuth({ fetchImpl, authClient, operation, url, method, headers, body } = {}) {
  let accessToken = "";

  try {
    accessToken = await authClient.getAccessToken({ interactive: false });
  } catch (error) {
    throw new DriveTransportError(`Unable to acquire Drive access token for ${operation}.`, {
      transient: true,
      code: "token-unavailable",
      operation,
      cause: error
    });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...headers
      },
      body
    });
  } catch (error) {
    throw new DriveTransportError(`Drive ${operation} network failure: ${error instanceof Error ? error.message : String(error)}`, {
      transient: true,
      code: "network",
      operation,
      cause: error
    });
  }

  if (response.ok) {
    return response;
  }

  const errorText = await safeReadText(response);
  throw mapDriveApiError({ operation, status: response.status, errorText });
}

function mapDriveApiError({ operation, status, errorText }) {
  const retryableStatus = new Set([408, 425, 429, 500, 502, 503, 504]);
  const lowerText = String(errorText || "").toLowerCase();
  const isRetryableReason = /rate.?limit|backend.?error|quota|timeout|temporar/.test(lowerText);
  const transient = retryableStatus.has(status) || isRetryableReason;

  return new DriveTransportError(`Drive ${operation} failed (${status}): ${errorText || "Unknown Drive API error"}`, {
    transient,
    status,
    code: `http-${status}`,
    operation
  });
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function encodeDriveQuery(query) {
  return encodeURIComponent(query);
}

function escapeDriveLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export { DriveTransportError, mapDriveApiError, stableStringify, normalizeContainer, FILE_NAMES, SECOND_BRAIN_FOLDER_NAME };
