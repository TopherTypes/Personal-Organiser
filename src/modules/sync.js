import { createGoogleAuthClient } from "./google-auth.js";
import { createGoogleDriveClient } from "./google-drive-client.js";
import { writeDatasetBackup } from "./dataset-backups.js";

/**
 * Sync subsystem coordinating local queue detection, remote pull/push, and deterministic conflict resolution.
 *
 * The implementation intentionally keeps the transport layer pluggable so the same orchestration can
 * later work with the Google Drive API once OAuth and Drive wiring are available.
 */

const SYNC_SHADOW_STORAGE_KEY = "second-brain.sync.shadow.v1";
const SYNC_CONFLICT_QUEUE_KEY = "second-brain.sync.conflicts.v1";
export const SYNCABLE_DOCUMENTS = [
  { id: "work.tasks", localKey: "second-brain.work.tasks.work.v1" },
  { id: "work.projects", localKey: "second-brain.work.projects.work" },
  { id: "work.people", localKey: "second-brain.work.people.work.v1" },
  { id: "work.sprints", localKey: "second-brain.work.sprints.work" },
  { id: "work.meetings", localKey: "second-brain.work.meetings.work" },
  { id: "personal.tasks", localKey: "second-brain.personal.tasks.v1" },
  { id: "personal.projects", localKey: "second-brain.personal.projects.v1" },
  { id: "personal.people", localKey: "second-brain.personal.people.v1" },
  { id: "personal.daily-log", localKey: "second-brain.personal.daily-log.v1" },
  { id: "personal.exercise-log", localKey: "second-brain.personal.exercise-log.v1" },
  { id: "personal.calendar", localKey: "second-brain.personal.calendar.v1" }
];

const DEFAULT_RETRY_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 700,
  maxDelayMs: 6000,
  jitterRatio: 0.2
};

/**
 * Only conflicts in this set are surfaced for manual intervention.
 *
 * Rationale:
 * - Most fields can be safely auto-resolved via timestamp precedence.
 * - These fields influence planning/state transitions and are expensive to get wrong.
 */
const MANUAL_CONFLICT_FIELDS = new Set([
  "title",
  "name",
  "status",
  "dueDate",
  "date",
  "startTime",
  "endTime",
  "assigneeId",
  "projectId",
  "archived"
]);

// Only require user input when important fields were edited near-simultaneously.
const MANUAL_CONFLICT_TIME_WINDOW_MS = 10 * 60 * 1000;

const SYNC_ERROR_REASON = Object.freeze({
  AUTH_EXPIRED: "auth-expired",
  QUOTA: "quota",
  NETWORK_TIMEOUT: "network-timeout",
  SCHEMA_MISMATCH: "schema-mismatch",
  UNKNOWN: "unknown"
});

/**
 * Creates an in-browser sync subsystem.
 */
export function createSyncSubsystem({
  onStateChange,
  authClientFactory = createGoogleAuthClient,
  driveClientFactory = createGoogleDriveClient,
  windowRef = window,
  navigatorRef = navigator
} = {}) {
  const listeners = new Set();
  if (typeof onStateChange === "function") {
    listeners.add(onStateChange);
  }

  const state = {
    syncStatus: navigatorRef.onLine ? "idle" : "offline",
    authStatus: "signed-out",
    authSession: null,
    pendingChanges: 0,
    conflictCount: 0,
    lastSuccessfulSyncAt: "",
    infoMessage: "",
    errorMessage: "",
    errorReason: "",
    retries: 0,
    isSyncing: false,
    conflicts: loadJson(SYNC_CONFLICT_QUEUE_KEY, [])
  };

  const authClient = authClientFactory({ clientId: windowRef.__APP_CONFIG__?.googleClientId || "" });
  const driveClient = driveClientFactory({ authClient });
  let loopTimerId = 0;

  recalculatePendingChanges();

  function emitState() {
    const snapshot = { ...state };
    listeners.forEach((listener) => listener(snapshot));
  }

  function setPartialState(nextState) {
    Object.assign(state, nextState);
    emitState();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener({ ...state });
    return () => listeners.delete(listener);
  }

  function start() {
    if (loopTimerId) {
      return;
    }

    // Keep sync status aligned with browser connectivity.
    windowRef.addEventListener("online", handleOnline);
    windowRef.addEventListener("offline", handleOffline);

    loopTimerId = windowRef.setInterval(() => {
      void syncNow({ reason: "scheduled" });
    }, 30000);

    // Boot path: attempt silent restoration first so returning users see connected state without prompts.
    void runBootAuthCheck();

    // Attempt immediate sync so topbar reflects true status quickly.
    void syncNow({ reason: "startup" });
  }

  function stop() {
    if (loopTimerId) {
      windowRef.clearInterval(loopTimerId);
      loopTimerId = 0;
    }

    windowRef.removeEventListener("online", handleOnline);
    windowRef.removeEventListener("offline", handleOffline);
  }

  function handleOnline() {
    setPartialState({ syncStatus: state.isSyncing ? "pulling" : "idle", errorMessage: "", errorReason: "" });
    void syncNow({ reason: "online" });
  }

  function handleOffline() {
    setPartialState({ syncStatus: "offline", errorMessage: "", errorReason: "" });
  }

  async function runBootAuthCheck() {
    setPartialState({ authStatus: "checking" });

    // Startup and background checks should not invoke GIS silent popup flows.
    // We only trust locally persisted session metadata here and require explicit
    // user interaction to recover expired sessions.
    const result = await authClient.ensureValidSession({ allowSilentRefresh: false });
    setPartialState({
      authStatus: result.status,
      authSession: result.session,
      errorReason: "",
      syncStatus: navigatorRef.onLine ? "idle" : "offline"
    });

    if (result.status === "signed-in") {
      void syncNow({ reason: "auth-boot" });
    }
  }

  async function signIn() {
    setPartialState({ authStatus: "checking", errorMessage: "", errorReason: "" });

    try {
      const result = await authClient.signInInteractive();
      setPartialState({
        authStatus: result.status,
        authSession: result.session,
        errorReason: "",
        syncStatus: navigatorRef.onLine ? "idle" : "offline"
      });
      void syncNow({ reason: "auth-interactive" });
    } catch (error) {
      setPartialState({
        authStatus: "signed-out",
        authSession: null,
        errorReason: SYNC_ERROR_REASON.AUTH_EXPIRED,
        errorMessage: `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  function signOut() {
    const result = authClient.signOut();
    setPartialState({ authStatus: result.status, authSession: result.session });
  }

  function recalculatePendingChanges() {
    const shadowDocs = loadJson(SYNC_SHADOW_STORAGE_KEY, {});
    let pendingTotal = 0;

    for (const descriptor of SYNCABLE_DOCUMENTS) {
      const localDoc = loadJson(descriptor.localKey, null);
      const shadowDoc = shadowDocs[descriptor.id] ?? null;
      pendingTotal += countDocumentDifferences(localDoc, shadowDoc);
    }

    setPartialState({ pendingChanges: pendingTotal });
  }

  /**
   * Persists and emits conflict queue updates so the UI can offer explicit resolution controls.
   */
  function setConflicts(conflicts) {
    localStorage.setItem(SYNC_CONFLICT_QUEUE_KEY, JSON.stringify(conflicts));
    setPartialState({ conflicts, conflictCount: conflicts.length });
  }

  async function syncNow({ reason } = { reason: "manual" }) {
    recalculatePendingChanges();

    const shouldSkipScheduledSync = reason === "scheduled" && state.pendingChanges <= 0;
    if (shouldSkipScheduledSync) {
      return;
    }

    if (state.authStatus !== "signed-in") {
      setPartialState({ syncStatus: navigatorRef.onLine ? "idle" : "offline", errorMessage: "", errorReason: "" });
      return;
    }

    // Token expiry is checked before sync so stale persisted metadata does not imply auth validity.
    setPartialState({ syncStatus: "auth-check", errorMessage: "", errorReason: "" });
    const authResult = await authClient.ensureValidSession({ allowSilentRefresh: false });
    if (authResult.status !== "signed-in") {
      setPartialState({
        authStatus: "signed-out",
        authSession: null,
        syncStatus: "error",
        errorReason: SYNC_ERROR_REASON.AUTH_EXPIRED,
        errorMessage: syncFailureMessage(SYNC_ERROR_REASON.AUTH_EXPIRED)
      });
      return;
    }

    setPartialState({ authSession: authResult.session });

    if (!navigatorRef.onLine) {
      setPartialState({ syncStatus: "offline", errorMessage: "", errorReason: "" });
      return;
    }

    if (state.isSyncing) {
      return;
    }

    state.isSyncing = true;
    setPartialState({ syncStatus: "pulling", errorMessage: "", errorReason: "" });

    try {
      const result = await withRetry(
        () =>
          performSyncCycle(driveClient, {
            onStageChange: (stage) => setPartialState({ syncStatus: stage })
          }),
        DEFAULT_RETRY_POLICY,
        (attempt) => setPartialState({ retries: attempt })
      );

      setPartialState({
        syncStatus: "idle",
        retries: 0,
        conflictCount: result.conflictCount,
        lastSuccessfulSyncAt: new Date().toISOString(),
        errorReason: "",
        infoMessage:
          result.backupCount > 0
            ? `Sync complete. Created ${result.backupCount} rollback backup${result.backupCount === 1 ? "" : "s"}.`
            : "Sync complete.",
        errorMessage: ""
      });

      setConflicts(result.conflicts);
    } catch (error) {
      const failure = classifySyncFailure(error);
      const errorCode = typeof error?.code === "string" ? error.code : "unknown";

      // Auth-related transport failures usually mean the runtime no longer has a
      // usable token. Reset auth state so UI clearly guides the user to reconnect.
      const authRecoveryState =
        failure.reason === SYNC_ERROR_REASON.AUTH_EXPIRED
          ? { authStatus: "signed-out", authSession: null }
          : {};

      setPartialState({
        ...authRecoveryState,
        syncStatus: "error",
        infoMessage: "",
        errorReason: failure.reason,
        errorMessage: `${syncFailureMessage(failure.reason)} (${reason}; code: ${errorCode})`
      });
    } finally {
      state.isSyncing = false;
      recalculatePendingChanges();
    }
  }

  return {
    subscribe,
    start,
    stop,
    syncNow,
    signIn,
    signOut,
    applyConflictResolutions,
    getState: () => ({ ...state })
  };

  /**
   * Applies user-selected values for unresolved field conflicts, then requeues a sync.
   */
  async function applyConflictResolutions(resolutions = {}) {
    const currentConflicts = loadJson(SYNC_CONFLICT_QUEUE_KEY, []);
    if (!Array.isArray(currentConflicts) || currentConflicts.length === 0) {
      return { appliedCount: 0, pendingCount: 0 };
    }

    const documentsById = new Map();
    for (const descriptor of SYNCABLE_DOCUMENTS) {
      documentsById.set(descriptor.id, {
        descriptor,
        value: loadJson(descriptor.localKey, null)
      });
    }

    let appliedCount = 0;

    for (const conflict of currentConflicts) {
      const choice = resolutions[conflict.conflictId] || "suggested";
      const documentRef = documentsById.get(conflict.documentId);
      const entities = documentRef?.value?.[conflict.collectionField];
      if (!Array.isArray(entities)) {
        continue;
      }

      const entity = entities.find((candidate) => candidate.id === conflict.entityId);
      if (!entity) {
        continue;
      }

      const pickedValue =
        choice === "local" ? conflict.localValue : choice === "remote" ? conflict.remoteValue : conflict.suggestedValue;
      entity[conflict.field] = pickedValue;

      if (!entity.lastUpdatedByField || typeof entity.lastUpdatedByField !== "object") {
        entity.lastUpdatedByField = {};
      }

      entity.lastUpdatedByField[conflict.field] = new Date().toISOString();
      entity.updatedAt = new Date().toISOString();
      appliedCount += 1;
    }

    for (const documentRef of documentsById.values()) {
      if (documentRef.value !== null) {
        localStorage.setItem(documentRef.descriptor.localKey, JSON.stringify(documentRef.value));
      }
    }

    setConflicts([]);
    recalculatePendingChanges();
    await syncNow({ reason: "manual" });
    return { appliedCount, pendingCount: 0 };
  }
}

/**
 * Executes one full pull/merge/push pass and updates local + shadow snapshots.
 */
async function performSyncCycle(driveClient, { onStageChange } = {}) {
  const shadowDocs = loadJson(SYNC_SHADOW_STORAGE_KEY, {});
  let conflictCount = 0;
  let backupCount = 0;
  const conflicts = [];

  for (const descriptor of SYNCABLE_DOCUMENTS) {
    const localDoc = loadJson(descriptor.localKey, null);
    onStageChange?.("pulling");
    const remoteDoc = await driveClient.pullDocument(descriptor.id);

    onStageChange?.("merging");
    const merged = mergeDocument(localDoc, remoteDoc, descriptor.id);
    conflictCount += merged.conflictCount;
    conflicts.push(...merged.conflicts);

    if (merged.document !== null) {
      const nextRaw = JSON.stringify(merged.document);
      const previousRaw = localStorage.getItem(descriptor.localKey);

      // Backup convention: before replacing a primary dataset record, snapshot the prior value
      // under backups/<document-id>/<ISO timestamp> so rollback always targets the exact dataset.
      const backupRecord = writeDatasetBackup({
        documentId: descriptor.id,
        localStorageKey: descriptor.localKey,
        previousRaw,
        nextRaw,
        reason: "sync-overwrite"
      });

      if (backupRecord) {
        backupCount += 1;
      }

      localStorage.setItem(descriptor.localKey, nextRaw);
      onStageChange?.("pushing");
      await driveClient.pushDocument(descriptor.id, merged.document);

      // Invariant: shadow snapshot mirrors remote truth, so it only advances after a successful push.
      shadowDocs[descriptor.id] = merged.document;
    }
  }

  localStorage.setItem(SYNC_SHADOW_STORAGE_KEY, JSON.stringify(shadowDocs));
  return { conflictCount, backupCount, conflicts };
}

/**
 * Merges two documents with deterministic field-level conflict resolution for entity arrays.
 */
function mergeDocument(localDoc, remoteDoc, documentId = "") {
  if (!localDoc && !remoteDoc) {
    return { document: null, conflictCount: 0, conflicts: [] };
  }

  if (!localDoc) {
    return { document: remoteDoc, conflictCount: 0, conflicts: [] };
  }

  if (!remoteDoc) {
    return { document: localDoc, conflictCount: 0, conflicts: [] };
  }

  const localEntityArrayInfo = getEntityArrayInfo(localDoc);
  const remoteEntityArrayInfo = getEntityArrayInfo(remoteDoc);

  if (!localEntityArrayInfo || !remoteEntityArrayInfo || localEntityArrayInfo.fieldName !== remoteEntityArrayInfo.fieldName) {
    // Fallback for non-entity documents: newest updatedAt wins with deterministic tie-break.
    return {
      document: pickLatestValue(localDoc, remoteDoc, extractObjectTimestamp(localDoc), extractObjectTimestamp(remoteDoc)).value,
      conflictCount: 0,
      conflicts: []
    };
  }

  const fieldName = localEntityArrayInfo.fieldName;
  const localEntities = localEntityArrayInfo.entities;
  const remoteEntities = remoteEntityArrayInfo.entities;
  const mergedById = new Map();
  let conflictCount = 0;
  const conflicts = [];

  for (const entity of localEntities) {
    mergedById.set(entity.id, entity);
  }

  for (const remoteEntity of remoteEntities) {
    const localEntity = mergedById.get(remoteEntity.id);
    if (!localEntity) {
      mergedById.set(remoteEntity.id, remoteEntity);
      continue;
    }

    const mergedEntity = mergeEntityFields(localEntity, remoteEntity, {
      documentId,
      collectionField: fieldName,
      entityId: remoteEntity.id
    });
    conflictCount += mergedEntity.conflictCount;
    conflicts.push(...mergedEntity.conflicts);
    mergedById.set(remoteEntity.id, mergedEntity.entity);
  }

  const mergedCollection = Array.from(mergedById.values());
  const mergedDocument = {
    ...localDoc,
    ...remoteDoc,
    [fieldName]: mergedCollection
  };

  return { document: mergedDocument, conflictCount, conflicts };
}

/**
 * Merge for one entity based on per-field lastUpdatedByField timestamps.
 */
function mergeEntityFields(localEntity, remoteEntity, context = {}) {
  const localFieldUpdates = isObject(localEntity.lastUpdatedByField) ? localEntity.lastUpdatedByField : {};
  const remoteFieldUpdates = isObject(remoteEntity.lastUpdatedByField) ? remoteEntity.lastUpdatedByField : {};

  const fields = new Set([
    ...Object.keys(localEntity),
    ...Object.keys(remoteEntity),
    ...Object.keys(localFieldUpdates),
    ...Object.keys(remoteFieldUpdates)
  ]);

  fields.delete("lastUpdatedByField");

  const merged = {
    ...localEntity,
    ...remoteEntity,
    lastUpdatedByField: { ...localFieldUpdates, ...remoteFieldUpdates }
  };

  let conflictCount = 0;
  const conflicts = [];

  for (const field of fields) {
    const localValue = localEntity[field];
    const remoteValue = remoteEntity[field];
    const localTimestamp = localFieldUpdates[field] || localEntity.updatedAt || localEntity.createdAt || "";
    const remoteTimestamp = remoteFieldUpdates[field] || remoteEntity.updatedAt || remoteEntity.createdAt || "";

    const picked = pickLatestValue(localValue, remoteValue, localTimestamp, remoteTimestamp);

    if (!isEqualValue(localValue, remoteValue) && localTimestamp && remoteTimestamp) {
      const shouldRequireManualResolution = shouldQueueManualConflict({
        field,
        localValue,
        remoteValue,
        localTimestamp,
        remoteTimestamp
      });

      if (shouldRequireManualResolution) {
        conflictCount += 1;
        conflicts.push({
          conflictId: `${context.documentId || "doc"}:${context.entityId || "entity"}:${field}`,
          documentId: context.documentId,
          collectionField: context.collectionField,
          entityId: context.entityId,
          field,
          localValue,
          remoteValue,
          localTimestamp,
          remoteTimestamp,
          suggestedValue: picked.value
        });
      }
    }

    merged[field] = picked.value;
    merged.lastUpdatedByField[field] = picked.timestamp;
  }

  merged.updatedAt = pickLatestTimestamp(localEntity.updatedAt, remoteEntity.updatedAt) || new Date().toISOString();

  return { entity: merged, conflictCount, conflicts };
}

/**
 * Returns true only for high-impact, near-concurrent edits that are risky to auto-resolve silently.
 */
function shouldQueueManualConflict({ field, localValue, remoteValue, localTimestamp, remoteTimestamp }) {
  if (!MANUAL_CONFLICT_FIELDS.has(field)) {
    return false;
  }

  if (isEffectivelyEmpty(localValue) || isEffectivelyEmpty(remoteValue)) {
    return false;
  }

  const localMs = Date.parse(localTimestamp || "");
  const remoteMs = Date.parse(remoteTimestamp || "");
  if (Number.isNaN(localMs) || Number.isNaN(remoteMs)) {
    return false;
  }

  return Math.abs(localMs - remoteMs) <= MANUAL_CONFLICT_TIME_WINDOW_MS;
}

function isEffectivelyEmpty(value) {
  return value === null || value === undefined || value === "";
}

function getEntityArrayInfo(document) {
  if (!isObject(document)) {
    return null;
  }

  if (Array.isArray(document)) {
    const hasObjectItems = document.every((item) => isObject(item));
    const hasStableIds = hasObjectItems && document.every((item) => typeof item.id === "string" && item.id.length > 0);
    return hasStableIds ? { fieldName: "items", entities: document } : null;
  }

  for (const [fieldName, value] of Object.entries(document)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    const hasObjectItems = value.every((item) => isObject(item));
    if (!hasObjectItems) {
      continue;
    }

    const hasStableIds = value.every((item) => typeof item.id === "string" && item.id.length > 0);
    if (!hasStableIds) {
      continue;
    }

    return { fieldName, entities: value };
  }

  return null;
}

function countDocumentDifferences(left, right) {
  if (left === null && right === null) {
    return 0;
  }

  const leftText = JSON.stringify(left ?? null);
  const rightText = JSON.stringify(right ?? null);
  if (leftText === rightText) {
    return 0;
  }

  const leftEntityArray = getEntityArrayInfo(left);
  const rightEntityArray = getEntityArrayInfo(right);
  if (!leftEntityArray || !rightEntityArray || leftEntityArray.fieldName !== rightEntityArray.fieldName) {
    return 1;
  }

  const rightById = new Map(rightEntityArray.entities.map((entity) => [entity.id, entity]));
  let delta = 0;

  for (const entity of leftEntityArray.entities) {
    const other = rightById.get(entity.id);
    if (!other || JSON.stringify(entity) !== JSON.stringify(other)) {
      delta += 1;
    }
  }

  for (const entity of rightEntityArray.entities) {
    if (!leftEntityArray.entities.find((item) => item.id === entity.id)) {
      delta += 1;
    }
  }

  return delta;
}

function pickLatestValue(leftValue, rightValue, leftTimestamp, rightTimestamp) {
  const winner = compareTimestamps(leftTimestamp, rightTimestamp);
  if (winner > 0) {
    return { value: leftValue, timestamp: leftTimestamp || rightTimestamp || "" };
  }

  if (winner < 0) {
    return { value: rightValue, timestamp: rightTimestamp || leftTimestamp || "" };
  }

  // Deterministic tie-break: stable lexical comparison of serialized values.
  const leftString = JSON.stringify(leftValue);
  const rightString = JSON.stringify(rightValue);
  return leftString <= rightString
    ? { value: leftValue, timestamp: leftTimestamp || rightTimestamp || "" }
    : { value: rightValue, timestamp: rightTimestamp || leftTimestamp || "" };
}

function pickLatestTimestamp(leftTimestamp, rightTimestamp) {
  const winner = compareTimestamps(leftTimestamp, rightTimestamp);
  if (winner > 0) {
    return leftTimestamp;
  }

  if (winner < 0) {
    return rightTimestamp;
  }

  return leftTimestamp || rightTimestamp || "";
}

function compareTimestamps(leftTimestamp, rightTimestamp) {
  const leftValue = Date.parse(leftTimestamp || "");
  const rightValue = Date.parse(rightTimestamp || "");

  if (Number.isNaN(leftValue) && Number.isNaN(rightValue)) {
    return 0;
  }

  if (Number.isNaN(leftValue)) {
    return -1;
  }

  if (Number.isNaN(rightValue)) {
    return 1;
  }

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

function extractObjectTimestamp(value) {
  if (!isObject(value)) {
    return "";
  }

  return value.updatedAt || value.lastSyncedAt || "";
}

function isEqualValue(leftValue, rightValue) {
  return JSON.stringify(leftValue) === JSON.stringify(rightValue);
}

function loadJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Generic retry helper with exponential backoff + jitter for transient failures.
 */
async function withRetry(task, policy, onAttempt, { waitFor = wait, random = Math.random } = {}) {
  let attempt = 0;

  while (attempt < policy.maxAttempts) {
    attempt += 1;
    onAttempt?.(attempt - 1);

    try {
      return await task();
    } catch (error) {
      if (attempt >= policy.maxAttempts || !isTransientError(error)) {
        throw error;
      }

      const baseDelay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      const jitter = baseDelay * policy.jitterRatio * random();
      await waitFor(baseDelay + jitter);
    }
  }

  throw new Error("Retry attempts exhausted.");
}

function isTransientError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return error.transient === true || /timeout|network|503|429/i.test(String(error.message || ""));
}

function wait(delayMs) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}


function classifySyncFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  if (/401|403|token|auth/.test(message) || /401|403|token|auth/.test(code)) {
    return { reason: SYNC_ERROR_REASON.AUTH_EXPIRED };
  }

  if (/quota|429|rate.?limit/.test(message) || /quota|429/.test(code)) {
    return { reason: SYNC_ERROR_REASON.QUOTA };
  }

  if (/timeout|network|408|503|504/.test(message) || /timeout|network|408|503|504/.test(code)) {
    return { reason: SYNC_ERROR_REASON.NETWORK_TIMEOUT };
  }

  if (/invalid\s*json|schema|shape|migration/.test(message) || /invalid-json|schema/.test(code)) {
    return { reason: SYNC_ERROR_REASON.SCHEMA_MISMATCH };
  }

  return { reason: SYNC_ERROR_REASON.UNKNOWN };
}

function syncFailureMessage(reason) {
  switch (reason) {
    case SYNC_ERROR_REASON.AUTH_EXPIRED:
      return "Drive session expired. Reconnect to sync.";
    case SYNC_ERROR_REASON.QUOTA:
      return "Drive quota or rate limit reached.";
    case SYNC_ERROR_REASON.NETWORK_TIMEOUT:
      return "Network timeout during sync.";
    case SYNC_ERROR_REASON.SCHEMA_MISMATCH:
      return "Sync data format mismatch detected.";
    default:
      return "Sync failed.";
  }
}

export const __TESTING__ = {
  mergeDocument,
  countDocumentDifferences,
  shouldQueueManualConflict,
  withRetry,
  performSyncCycle,
  classifySyncFailure,
  SYNC_ERROR_REASON
};
