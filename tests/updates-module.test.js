import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadUpdates,
  markPersonPending,
  markPersonUpdated,
  normaliseUpdate,
  saveUpdate,
  selectCompletedPeopleCount,
  selectPendingPeopleCount
} from "../src/modules/updates.js";

const WORK_UPDATES_STORAGE_KEY = "second-brain.work.updates.work.v1";

test("normaliseUpdate migrates legacy toUpdate person-id arrays to structured pending entries", () => {
  const update = normaliseUpdate({
    text: "Quarterly status",
    toUpdate: ["person-a", " person-b "]
  });

  assert.deepEqual(update.toUpdate, [
    { personId: "person-a", required: true, status: "pending", updatedAt: "" },
    { personId: "person-b", required: true, status: "pending", updatedAt: "" }
  ]);
});

test("normaliseUpdate canonicalises updatedAt values as ISO timestamps", () => {
  const update = normaliseUpdate({
    text: "Prep note",
    toUpdate: [{ personId: "person-a", status: "updated", updatedAt: "2024-03-01T10:00:00-05:00" }]
  });

  assert.equal(update.toUpdate[0].status, "updated");
  assert.equal(update.toUpdate[0].updatedAt, "2024-03-01T15:00:00.000Z");
});

test("markPersonUpdated and markPersonPending mutate per-person status and selector counts", () => {
  localStorage.clear();

  const createResult = saveUpdate("work", {
    text: "Customer rollout",
    ownerId: "owner-1",
    toUpdate: ["person-a", "person-b"]
  });

  assert.equal(createResult.ok, true);

  const [created] = loadUpdates("work");
  assert.ok(created?.id);

  const at = "2025-01-02T03:04:05.000Z";
  markPersonUpdated(created.id, "person-a", at);

  let [afterUpdate] = loadUpdates("work");
  assert.equal(selectCompletedPeopleCount(afterUpdate), 1);
  assert.equal(selectPendingPeopleCount(afterUpdate), 1);
  assert.equal(afterUpdate.toUpdate.find((entry) => entry.personId === "person-a")?.updatedAt, at);

  markPersonPending(created.id, "person-a");

  [afterUpdate] = loadUpdates("work");
  assert.equal(selectCompletedPeopleCount(afterUpdate), 0);
  assert.equal(selectPendingPeopleCount(afterUpdate), 2);
  assert.equal(afterUpdate.toUpdate.find((entry) => entry.personId === "person-a")?.updatedAt, "");
});

test("loadUpdates migrates persisted legacy id arrays via normalisation", () => {
  localStorage.clear();

  localStorage.setItem(
    WORK_UPDATES_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: "2025-01-01T00:00:00.000Z",
      updates: [
        {
          id: "upd-1",
          text: "Legacy update",
          toUpdate: ["person-a"],
          archived: false,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          auditTrail: []
        }
      ]
    })
  );

  const [loaded] = loadUpdates("work");
  assert.deepEqual(loaded.toUpdate, [{ personId: "person-a", required: true, status: "pending", updatedAt: "" }]);
});
