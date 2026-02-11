/**
 * Dataset backup envelope metadata.
 *
 * Backups are stored under localStorage keys shaped as:
 *   backups/<document-id>/<ISO timestamp>
 *
 * This prefix-based naming makes versions easy to list, sort, and prune per dataset.
 */
export const DATASET_BACKUP_SCHEMA = "second-brain.dataset-backup";
export const DATASET_BACKUP_SCHEMA_VERSION = 1;
export const DATASET_BACKUP_PREFIX = "backups/";
export const MAX_DATASET_BACKUPS_PER_DOCUMENT = 5;

/**
 * Stores a timestamped rollback backup before a dataset overwrite operation.
 *
 * Safety note:
 * - We back up only when the existing local payload actually differs from the next payload.
 * - The backup stores a schema + version envelope so reverts can be validated before apply.
 */
export function writeDatasetBackup({ documentId, localStorageKey, previousRaw, nextRaw, reason = "overwrite", now = new Date() }) {
  if (typeof previousRaw !== "string" || previousRaw === nextRaw) {
    return null;
  }

  let parsedPreviousValue = null;
  try {
    parsedPreviousValue = JSON.parse(previousRaw);
  } catch {
    // If the old payload is malformed we skip backup creation to avoid storing invalid rollback data.
    return null;
  }

  const createdAt = now.toISOString();
  const backupKey = `${DATASET_BACKUP_PREFIX}${documentId}/${createdAt}`;
  const backupRecord = {
    schema: DATASET_BACKUP_SCHEMA,
    schemaVersion: DATASET_BACKUP_SCHEMA_VERSION,
    documentId,
    localStorageKey,
    createdAt,
    reason,
    value: parsedPreviousValue
  };

  localStorage.setItem(backupKey, JSON.stringify(backupRecord));
  rotateDocumentBackups(documentId);

  return {
    backupKey,
    createdAt
  };
}

/**
 * Lists backups for a dataset, newest first.
 */
export function listDatasetBackups(documentId) {
  if (!documentId) {
    return [];
  }

  const prefix = `${DATASET_BACKUP_PREFIX}${documentId}/`;
  const items = [];

  for (const key of getStorageKeys()) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const raw = localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    const record = parseBackupRecord(raw);
    if (!record || record.documentId !== documentId) {
      continue;
    }

    items.push({
      backupKey: key,
      createdAt: record.createdAt,
      localStorageKey: record.localStorageKey,
      reason: record.reason
    });
  }

  items.sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
  return items;
}

/**
 * Restores one backup after strict envelope validation.
 *
 * Rollback safety guarantees:
 * - schema and schemaVersion must match expected backup format,
 * - backup must belong to the selected dataset,
 * - backup must target the exact expected localStorage key.
 */
export function restoreDatasetBackup({ documentId, backupKey, expectedLocalStorageKey }) {
  const raw = localStorage.getItem(backupKey);
  if (!raw) {
    throw new Error("Selected backup does not exist anymore.");
  }

  const parsed = parseBackupRecord(raw);
  if (!parsed) {
    throw new Error("Selected backup is invalid or from an unsupported backup schema version.");
  }

  if (parsed.documentId !== documentId) {
    throw new Error("Backup dataset mismatch; restore aborted.");
  }

  if (parsed.localStorageKey !== expectedLocalStorageKey) {
    throw new Error("Backup storage-key mismatch; restore aborted.");
  }

  localStorage.setItem(expectedLocalStorageKey, JSON.stringify(parsed.value));

  return {
    restoredAt: new Date().toISOString(),
    backupCreatedAt: parsed.createdAt,
    documentId,
    localStorageKey: expectedLocalStorageKey
  };
}

function rotateDocumentBackups(documentId) {
  const backups = listDatasetBackups(documentId);

  // Retention policy: keep the most recent N backups and remove older versions deterministically.
  for (const stale of backups.slice(MAX_DATASET_BACKUPS_PER_DOCUMENT)) {
    localStorage.removeItem(stale.backupKey);
  }
}

function parseBackupRecord(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (parsed.schema !== DATASET_BACKUP_SCHEMA || parsed.schemaVersion !== DATASET_BACKUP_SCHEMA_VERSION) {
      return null;
    }

    if (typeof parsed.documentId !== "string" || typeof parsed.localStorageKey !== "string") {
      return null;
    }

    if (typeof parsed.createdAt !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getStorageKeys() {
  if (typeof localStorage.length === "number" && typeof localStorage.key === "function") {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (typeof key === "string") {
        keys.push(key);
      }
    }
    return keys;
  }

  if (localStorage?.store instanceof Map) {
    return Array.from(localStorage.store.keys());
  }

  return [];
}
