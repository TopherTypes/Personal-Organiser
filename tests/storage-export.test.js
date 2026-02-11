import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDatasetExport,
  parseAndValidateImportPayload,
  restoreFromImportPayload
} from "../src/modules/storage-export.js";

const WORK_UPDATES_KEY = "second-brain.work.updates.work.v1";
const WORK_TASKS_KEY = "second-brain.work.tasks.work.v1";

test("buildDatasetExport(work) includes updates storage key", () => {
  localStorage.clear();
  localStorage.setItem(WORK_UPDATES_KEY, JSON.stringify({ records: [{ id: "u-1" }] }));

  const payload = buildDatasetExport("work");

  assert.ok(payload.datasets.work.storageKeys.includes(WORK_UPDATES_KEY));
  assert.deepEqual(payload.datasets.work.data[WORK_UPDATES_KEY], { records: [{ id: "u-1" }] });
});

test("parseAndValidateImportPayload accepts updates key in work dataset", () => {
  const importPayload = {
    schema: "second-brain.dataset-export",
    schemaVersion: 1,
    datasets: {
      work: {
        data: {
          [WORK_UPDATES_KEY]: { records: [{ id: "u-1", meetingId: null }] }
        }
      }
    }
  };

  const parsed = parseAndValidateImportPayload(JSON.stringify(importPayload));

  assert.deepEqual(parsed.datasets.work.data[WORK_UPDATES_KEY], { records: [{ id: "u-1", meetingId: null }] });
});

test("restoreFromImportPayload merge path touches and restores updates entries", () => {
  localStorage.clear();
  localStorage.setItem(WORK_TASKS_KEY, JSON.stringify({ records: [{ id: "t-1", title: "Existing" }] }));
  localStorage.setItem(WORK_UPDATES_KEY, JSON.stringify({ records: [{ id: "u-1", toUpdate: false }] }));

  const payload = parseAndValidateImportPayload(
    JSON.stringify({
      schema: "second-brain.dataset-export",
      schemaVersion: 1,
      datasets: {
        work: {
          data: {
            [WORK_UPDATES_KEY]: { records: [{ id: "u-1", toUpdate: true, meetingId: "meeting-1" }] }
          }
        }
      }
    })
  );

  const result = restoreFromImportPayload(payload, "merge");

  assert.ok(result.updatedKeys.includes(WORK_UPDATES_KEY));
  assert.deepEqual(JSON.parse(localStorage.getItem(WORK_UPDATES_KEY)), {
    records: [{ id: "u-1", toUpdate: true, meetingId: "meeting-1" }]
  });
});
