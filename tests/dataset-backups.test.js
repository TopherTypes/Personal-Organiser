import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DATASET_BACKUP_PREFIX,
  MAX_DATASET_BACKUPS_PER_DOCUMENT,
  listDatasetBackups,
  restoreDatasetBackup,
  writeDatasetBackup
} from "../src/modules/dataset-backups.js";

const DOCUMENT_ID = "work.tasks";
const STORAGE_KEY = "second-brain.work.tasks.work.v1";

test("backup rotation keeps only the newest 5 versions per dataset", () => {
  localStorage.clear();

  for (let index = 0; index < 7; index += 1) {
    const previousRaw = JSON.stringify({ revision: index });
    const nextRaw = JSON.stringify({ revision: index + 1 });
    writeDatasetBackup({
      documentId: DOCUMENT_ID,
      localStorageKey: STORAGE_KEY,
      previousRaw,
      nextRaw,
      now: new Date(Date.UTC(2026, 0, 1, 0, index, 0))
    });
  }

  const backups = listDatasetBackups(DOCUMENT_ID);
  assert.equal(backups.length, MAX_DATASET_BACKUPS_PER_DOCUMENT);
  assert.equal(backups[0].createdAt, "2026-01-01T00:06:00.000Z");
  assert.equal(backups.at(-1)?.createdAt, "2026-01-01T00:02:00.000Z");

  const allBackupKeys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(`${DATASET_BACKUP_PREFIX}${DOCUMENT_ID}/`)) {
      allBackupKeys.push(key);
    }
  }

  assert.equal(allBackupKeys.length, MAX_DATASET_BACKUPS_PER_DOCUMENT);
});

test("restore applies selected backup value after schema validation", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ revision: "current" }));

  const created = writeDatasetBackup({
    documentId: DOCUMENT_ID,
    localStorageKey: STORAGE_KEY,
    previousRaw: JSON.stringify({ revision: "old" }),
    nextRaw: JSON.stringify({ revision: "current" }),
    now: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.ok(created?.backupKey);

  const result = restoreDatasetBackup({
    documentId: DOCUMENT_ID,
    backupKey: created.backupKey,
    expectedLocalStorageKey: STORAGE_KEY
  });

  assert.equal(result.documentId, DOCUMENT_ID);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY)), { revision: "old" });
});

test("restore rejects backups with unsupported schema/version", () => {
  localStorage.clear();

  const badBackupKey = `${DATASET_BACKUP_PREFIX}${DOCUMENT_ID}/2026-01-01T00:00:00.000Z`;
  localStorage.setItem(
    badBackupKey,
    JSON.stringify({
      schema: "second-brain.dataset-backup",
      schemaVersion: 999,
      documentId: DOCUMENT_ID,
      localStorageKey: STORAGE_KEY,
      createdAt: "2026-01-01T00:00:00.000Z",
      value: { revision: "invalid" }
    })
  );

  assert.throws(
    () =>
      restoreDatasetBackup({
        documentId: DOCUMENT_ID,
        backupKey: badBackupKey,
        expectedLocalStorageKey: STORAGE_KEY
      }),
    /unsupported backup schema version/i
  );
});
