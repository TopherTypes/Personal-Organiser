/**
 * Sync subsystem coordinating local queue detection, remote pull/push, and deterministic conflict resolution.
 *
 * The implementation intentionally keeps the transport layer pluggable so the same orchestration can
 * later work with the Google Drive API once OAuth and Drive wiring are available.
 */

const SYNC_SHADOW_STORAGE_KEY = "second-brain.sync.shadow.v1";
const SYNC_REMOTE_STORAGE_KEY = "second-brain.sync.remote.v1";
const SYNC_AUTH_STORAGE_KEY = "second-brain.sync.auth.v1";

const SYNCABLE_DOCUMENTS = [
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
 * Creates an in-browser sync subsystem.
 */
export function createSyncSubsystem({ onStateChange } = {}) {
  const listeners = new Set();
  if (typeof onStateChange === "function") {
    listeners.add(onStateChange);
  }

  const state = {
    syncStatus: navigator.onLine ? "idle" : "offline",
    authStatus: loadAuthStatus(),
    pendingChanges: 0,
    conflictCount: 0,
    lastSuccessfulSyncAt: "",
    errorMessage: "",
    retries: 0,
    isSyncing: false
  };

  const driveClient = createLocalDriveAdapter();
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
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    loopTimerId = window.setInterval(() => {
      void syncNow({ reason: "scheduled" });
    }, 30000);

    // Attempt immediate sync so topbar reflects true status quickly.
    void syncNow({ reason: "startup" });
  }

  function stop() {
    if (loopTimerId) {
      window.clearInterval(loopTimerId);
      loopTimerId = 0;
    }

    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  }

  function handleOnline() {
    setPartialState({ syncStatus: state.isSyncing ? "syncing" : "idle", errorMessage: "" });
    void syncNow({ reason: "online" });
  }

  function handleOffline() {
    setPartialState({ syncStatus: "offline", errorMessage: "" });
  }

  function signIn() {
    localStorage.setItem(SYNC_AUTH_STORAGE_KEY, "signed-in");
    setPartialState({ authStatus: "signed-in", syncStatus: navigator.onLine ? "idle" : "offline" });
    void syncNow({ reason: "auth" });
  }

  function signOut() {
    localStorage.setItem(SYNC_AUTH_STORAGE_KEY, "signed-out");
    setPartialState({ authStatus: "signed-out" });
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

  async function syncNow({ reason } = { reason: "manual" }) {
    recalculatePendingChanges();

    if (state.authStatus !== "signed-in") {
      setPartialState({ syncStatus: navigator.onLine ? "idle" : "offline", errorMessage: "" });
      return;
    }

    if (!navigator.onLine) {
      setPartialState({ syncStatus: "offline", errorMessage: "" });
      return;
    }

    if (state.isSyncing) {
      return;
    }

    state.isSyncing = true;
    setPartialState({ syncStatus: "syncing", errorMessage: "" });

    try {
      const result = await withRetry(
        () => performSyncCycle(driveClient),
        DEFAULT_RETRY_POLICY,
        (attempt) => setPartialState({ retries: attempt })
      );

      setPartialState({
        syncStatus: "idle",
        retries: 0,
        conflictCount: result.conflictCount,
        lastSuccessfulSyncAt: new Date().toISOString(),
        errorMessage: ""
      });
    } catch (error) {
      setPartialState({
        syncStatus: "error",
        errorMessage: `Sync failed (${reason}): ${error instanceof Error ? error.message : String(error)}`
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
    getState: () => ({ ...state })
  };
}

/**
 * Executes one full pull/merge/push pass and updates local + shadow snapshots.
 */
async function performSyncCycle(driveClient) {
  const shadowDocs = loadJson(SYNC_SHADOW_STORAGE_KEY, {});
  let conflictCount = 0;

  for (const descriptor of SYNCABLE_DOCUMENTS) {
    const localDoc = loadJson(descriptor.localKey, null);
    const remoteDoc = await driveClient.pullDocument(descriptor.id);

    const merged = mergeDocument(localDoc, remoteDoc);
    conflictCount += merged.conflictCount;

    if (merged.document !== null) {
      localStorage.setItem(descriptor.localKey, JSON.stringify(merged.document));
      await driveClient.pushDocument(descriptor.id, merged.document);
      shadowDocs[descriptor.id] = merged.document;
    }
  }

  localStorage.setItem(SYNC_SHADOW_STORAGE_KEY, JSON.stringify(shadowDocs));
  return { conflictCount };
}

/**
 * Merges two documents with deterministic field-level conflict resolution for entity arrays.
 */
function mergeDocument(localDoc, remoteDoc) {
  if (!localDoc && !remoteDoc) {
    return { document: null, conflictCount: 0 };
  }

  if (!localDoc) {
    return { document: remoteDoc, conflictCount: 0 };
  }

  if (!remoteDoc) {
    return { document: localDoc, conflictCount: 0 };
  }

  const localEntityArrayInfo = getEntityArrayInfo(localDoc);
  const remoteEntityArrayInfo = getEntityArrayInfo(remoteDoc);

  if (!localEntityArrayInfo || !remoteEntityArrayInfo || localEntityArrayInfo.fieldName !== remoteEntityArrayInfo.fieldName) {
    // Fallback for non-entity documents: newest updatedAt wins with deterministic tie-break.
    return {
      document: pickLatestValue(localDoc, remoteDoc, extractObjectTimestamp(localDoc), extractObjectTimestamp(remoteDoc)).value,
      conflictCount: 0
    };
  }

  const fieldName = localEntityArrayInfo.fieldName;
  const localEntities = localEntityArrayInfo.entities;
  const remoteEntities = remoteEntityArrayInfo.entities;
  const mergedById = new Map();
  let conflictCount = 0;

  for (const entity of localEntities) {
    mergedById.set(entity.id, entity);
  }

  for (const remoteEntity of remoteEntities) {
    const localEntity = mergedById.get(remoteEntity.id);
    if (!localEntity) {
      mergedById.set(remoteEntity.id, remoteEntity);
      continue;
    }

    const mergedEntity = mergeEntityFields(localEntity, remoteEntity);
    conflictCount += mergedEntity.conflictCount;
    mergedById.set(remoteEntity.id, mergedEntity.entity);
  }

  const mergedCollection = Array.from(mergedById.values());
  const mergedDocument = {
    ...localDoc,
    ...remoteDoc,
    [fieldName]: mergedCollection
  };

  return { document: mergedDocument, conflictCount };
}

/**
 * Merge for one entity based on per-field lastUpdatedByField timestamps.
 */
function mergeEntityFields(localEntity, remoteEntity) {
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

  for (const field of fields) {
    const localValue = localEntity[field];
    const remoteValue = remoteEntity[field];
    const localTimestamp = localFieldUpdates[field] || localEntity.updatedAt || localEntity.createdAt || "";
    const remoteTimestamp = remoteFieldUpdates[field] || remoteEntity.updatedAt || remoteEntity.createdAt || "";

    const picked = pickLatestValue(localValue, remoteValue, localTimestamp, remoteTimestamp);

    if (!isEqualValue(localValue, remoteValue) && localTimestamp && remoteTimestamp) {
      conflictCount += 1;
    }

    merged[field] = picked.value;
    merged.lastUpdatedByField[field] = picked.timestamp;
  }

  merged.updatedAt = pickLatestTimestamp(localEntity.updatedAt, remoteEntity.updatedAt) || new Date().toISOString();

  return { entity: merged, conflictCount };
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

function loadAuthStatus() {
  const raw = localStorage.getItem(SYNC_AUTH_STORAGE_KEY);
  return raw === "signed-in" ? "signed-in" : "signed-out";
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
async function withRetry(task, policy, onAttempt) {
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
      const jitter = baseDelay * policy.jitterRatio * Math.random();
      await wait(baseDelay + jitter);
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
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

/**
 * Temporary Drive adapter backed by localStorage.
 *
 * This keeps interfaces aligned with planned Google Drive transport while allowing offline-first
 * flow to be fully exercised in the static app environment.
 */
function createLocalDriveAdapter() {
  const remoteRoot = loadJson(SYNC_REMOTE_STORAGE_KEY, {});

  return {
    async pullDocument(documentId) {
      // Simulate occasional transient network faults to exercise retry/backoff behavior.
      if (Math.random() < 0.02) {
        const transientError = new Error("Network timeout while pulling document.");
        transientError.transient = true;
        throw transientError;
      }

      return remoteRoot[documentId] ?? null;
    },

    async pushDocument(documentId, payload) {
      if (Math.random() < 0.02) {
        const transientError = new Error("Network timeout while pushing document.");
        transientError.transient = true;
        throw transientError;
      }

      remoteRoot[documentId] = payload;
      localStorage.setItem(SYNC_REMOTE_STORAGE_KEY, JSON.stringify(remoteRoot));
    }
  };
}
