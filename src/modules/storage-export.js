import { APP_VERSION } from "../version.js";

/**
 * Export schema identifier used to validate import payloads.
 */
export const EXPORT_SCHEMA = "second-brain.dataset-export";

/**
 * Export schema version so future migrations can be handled safely.
 */
export const EXPORT_SCHEMA_VERSION = 1;

const BACKUP_INDEX_KEY = "second-brain.restore.backups.v1";
const BACKUP_KEY_PREFIX = "second-brain.restore.backup";
const MAX_BACKUP_SNAPSHOTS = 10;

/**
 * Canonical storage keys grouped by dataset, aligned with syncable documents.
 */
const DATASET_KEYS = Object.freeze({
  work: Object.freeze([
    "second-brain.work.tasks.work.v1",
    "second-brain.work.projects.work",
    "second-brain.work.people.work.v1",
    "second-brain.work.sprints.work",
    "second-brain.work.meetings.work"
  ]),
  personal: Object.freeze([
    "second-brain.personal.tasks.v1",
    "second-brain.personal.projects.v1",
    "second-brain.personal.people.v1",
    "second-brain.personal.daily-log.v1",
    "second-brain.personal.exercise-log.v1",
    "second-brain.personal.calendar.v1"
  ])
});

/**
 * Collects current localStorage data for a target dataset scope.
 */
export function buildDatasetExport(scope = "combined") {
  const includeWork = scope === "work" || scope === "combined";
  const includePersonal = scope === "personal" || scope === "combined";

  return {
    schema: EXPORT_SCHEMA,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    datasets: {
      ...(includeWork ? { work: collectDataset("work") } : {}),
      ...(includePersonal ? { personal: collectDataset("personal") } : {})
    }
  };
}

/**
 * Converts an export payload into a downloaded JSON file.
 */
export function downloadDatasetExport(scope = "combined") {
  const payload = buildDatasetExport(scope);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date().toISOString().replaceAll(":", "-");

  anchor.href = url;
  anchor.download = `second-brain-${scope}-export-${timestamp}.json`;
  anchor.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Validates an uploaded JSON payload and returns a normalised structure.
 */
export function parseAndValidateImportPayload(text) {
  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Import file must contain a JSON object.");
  }

  if (parsed.schema !== EXPORT_SCHEMA) {
    throw new Error(`Unsupported schema \"${String(parsed.schema)}\".`);
  }

  if (parsed.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version \"${String(parsed.schemaVersion)}\".`);
  }

  if (!parsed.datasets || typeof parsed.datasets !== "object") {
    throw new Error("Import payload must include a datasets object.");
  }

  const datasets = {};

  if (Object.prototype.hasOwnProperty.call(parsed.datasets, "work")) {
    datasets.work = validateDatasetObject(parsed.datasets.work, "work");
  }

  if (Object.prototype.hasOwnProperty.call(parsed.datasets, "personal")) {
    datasets.personal = validateDatasetObject(parsed.datasets.personal, "personal");
  }

  if (!datasets.work && !datasets.personal) {
    throw new Error("Import payload must include at least one dataset: work or personal.");
  }

  return {
    ...parsed,
    datasets
  };
}

/**
 * Applies a validated payload to localStorage with backup + rollback safety.
 */
export function restoreFromImportPayload(payload, strategy = "merge") {
  const touchedEntries = getTouchedStorageEntries(payload.datasets);
  const backupSnapshot = createBackupSnapshot(touchedEntries);

  try {
    for (const { key, incomingValue } of touchedEntries) {
      const currentValue = readStorageJson(key);
      const nextValue = strategy === "replace" ? incomingValue : mergeValues(currentValue, incomingValue);

      if (nextValue === null || typeof nextValue === "undefined") {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(nextValue));
      }
    }

    return {
      backupKey: backupSnapshot.key,
      updatedKeys: touchedEntries.map((entry) => entry.key)
    };
  } catch (error) {
    restoreBackupSnapshot(backupSnapshot);
    throw error;
  }
}

/**
 * Human-readable explanation used in Settings for merge strategy docs.
 */
export function getMergeRulesSummary() {
  return [
    "Objects merge recursively key-by-key.",
    "Arrays with id fields merge by id and keep the item with the newest updatedAt/lastUpdated timestamp.",
    "Arrays without stable ids are replaced by imported arrays.",
    "Primitive values are replaced by imported values."
  ];
}

function collectDataset(datasetName) {
  const keys = DATASET_KEYS[datasetName] || [];
  const data = {};

  for (const key of keys) {
    data[key] = readStorageJson(key);
  }

  return {
    dataset: datasetName,
    storageKeys: [...keys],
    data
  };
}

function validateDatasetObject(dataset, datasetName) {
  if (!dataset || typeof dataset !== "object") {
    throw new Error(`Dataset \"${datasetName}\" must be an object.`);
  }

  if (!dataset.data || typeof dataset.data !== "object") {
    throw new Error(`Dataset \"${datasetName}\" must include a data object.`);
  }

  const allowedKeys = new Set(DATASET_KEYS[datasetName]);
  const cleanedData = {};

  for (const [key, value] of Object.entries(dataset.data)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Dataset \"${datasetName}\" includes unsupported storage key: ${key}`);
    }
    assertJsonSafe(value, `dataset key ${key}`);
    cleanedData[key] = value;
  }

  return {
    dataset: datasetName,
    storageKeys: [...allowedKeys],
    data: cleanedData
  };
}

function assertJsonSafe(value, label) {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(`Value for ${label} is not JSON serialisable.`);
  }
}

function getTouchedStorageEntries(datasets) {
  const entries = [];

  for (const datasetName of ["work", "personal"]) {
    const dataset = datasets[datasetName];
    if (!dataset) {
      continue;
    }

    for (const key of DATASET_KEYS[datasetName]) {
      if (!Object.prototype.hasOwnProperty.call(dataset.data, key)) {
        continue;
      }

      entries.push({ key, incomingValue: dataset.data[key] });
    }
  }

  return entries;
}

function createBackupSnapshot(touchedEntries) {
  const timestamp = new Date().toISOString();
  const backupKey = `${BACKUP_KEY_PREFIX}.${timestamp}`;
  const snapshot = {
    createdAt: timestamp,
    keys: touchedEntries.map(({ key }) => key),
    values: Object.fromEntries(touchedEntries.map(({ key }) => [key, readStorageRaw(key)]))
  };

  localStorage.setItem(backupKey, JSON.stringify(snapshot));

  const index = readStorageJson(BACKUP_INDEX_KEY) || [];
  index.unshift(backupKey);

  while (index.length > MAX_BACKUP_SNAPSHOTS) {
    const staleKey = index.pop();
    if (staleKey) {
      localStorage.removeItem(staleKey);
    }
  }

  localStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(index));
  return { key: backupKey, snapshot };
}

function restoreBackupSnapshot(backupSnapshot) {
  for (const [key, raw] of Object.entries(backupSnapshot.snapshot.values)) {
    if (typeof raw === "string") {
      localStorage.setItem(key, raw);
    } else {
      localStorage.removeItem(key);
    }
  }
}

function mergeValues(currentValue, incomingValue) {
  if (Array.isArray(currentValue) && Array.isArray(incomingValue)) {
    return mergeArrays(currentValue, incomingValue);
  }

  if (isPlainObject(currentValue) && isPlainObject(incomingValue)) {
    const merged = { ...currentValue };
    for (const [key, value] of Object.entries(incomingValue)) {
      merged[key] = mergeValues(currentValue[key], value);
    }
    return merged;
  }

  return incomingValue;
}

function mergeArrays(currentArray, incomingArray) {
  const canMergeById = currentArray.every(hasIdObject) && incomingArray.every(hasIdObject);

  if (!canMergeById) {
    return incomingArray;
  }

  const mergedById = new Map(currentArray.map((entry) => [entry.id, entry]));

  for (const incomingEntry of incomingArray) {
    const currentEntry = mergedById.get(incomingEntry.id);
    if (!currentEntry) {
      mergedById.set(incomingEntry.id, incomingEntry);
      continue;
    }

    const currentTimestamp = extractTimestamp(currentEntry);
    const incomingTimestamp = extractTimestamp(incomingEntry);

    if (incomingTimestamp >= currentTimestamp) {
      mergedById.set(incomingEntry.id, mergeValues(currentEntry, incomingEntry));
    }
  }

  return [...mergedById.values()];
}

function extractTimestamp(entry) {
  if (!entry || typeof entry !== "object") {
    return 0;
  }

  const candidates = [entry.updatedAt, entry.lastUpdated, entry.lastUpdatedAt];
  for (const value of candidates) {
    if (typeof value === "string") {
      const millis = Date.parse(value);
      if (!Number.isNaN(millis)) {
        return millis;
      }
    }
  }

  return 0;
}

function hasIdObject(value) {
  return isPlainObject(value) && typeof value.id === "string" && value.id.length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStorageJson(key) {
  const raw = readStorageRaw(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStorageRaw(key) {
  return localStorage.getItem(key);
}
