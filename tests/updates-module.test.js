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
  selectPendingPeopleCount,
  selectUpdatesForPerson
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

test("saveUpdate persists selected person ids as structured recipients", () => {
  localStorage.clear();

  const result = saveUpdate("work", {
    text: "Share roadmap update",
    ownerId: "owner-1",
    toUpdate: ["person-a", "person-b"].map((id) => ({
      personId: id,
      status: "pending",
      required: true,
      updatedAt: ""
    }))
  });

  assert.equal(result.ok, true);

  const [saved] = loadUpdates("work");
  assert.deepEqual(saved.toUpdate, [
    { personId: "person-a", required: true, status: "pending", updatedAt: "", note: "" },
    { personId: "person-b", required: true, status: "pending", updatedAt: "", note: "" }
  ]);
});

test("saveUpdate rejects drafts when no recipients are selected", () => {
  localStorage.clear();

  const result = saveUpdate("work", {
    text: "Ship reminder",
    ownerId: "owner-1",
    toUpdate: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "At least one person to update is required.");
});

test("saveUpdate enforces owner and due date for action entities", () => {
  localStorage.clear();

  const noOwner = saveUpdate("work", {
    entityType: "action",
    text: "Follow up contract",
    dueDate: "2026-01-10",
    toUpdate: ["person-a"]
  });
  assert.equal(noOwner.ok, false);
  assert.equal(noOwner.error, "Actions require an owner.");

  const noDueDate = saveUpdate("work", {
    entityType: "action",
    text: "Follow up contract",
    ownerId: "person-a",
    toUpdate: ["person-a"]
  });
  assert.equal(noDueDate.ok, false);
  assert.equal(noDueDate.error, "Actions require a due date.");
});

test("saveUpdate accepts action owner 'me' for task-linked actions", () => {
  localStorage.clear();

  const result = saveUpdate(
    "work",
    {
      entityType: "action",
      text: "Prepare weekly status",
      ownerId: "me",
      dueDate: "2026-01-10",
      toUpdate: ["person-a"]
    },
    "",
    [{ id: "person-a", name: "Alex", archived: false }]
  );

  assert.equal(result.ok, true);
  const [saved] = loadUpdates("work");
  assert.equal(saved.entityType, "action");
  assert.equal(saved.ownerId, "me");
  assert.equal(saved.dueDate, "2026-01-10");
});



test("saveUpdate enforces owner referential integrity when people set is provided", () => {
  localStorage.clear();

  const invalid = saveUpdate(
    "work",
    {
      text: "Missing owner",
      ownerId: "person-missing",
      toUpdate: ["person-a"]
    },
    "",
    [{ id: "person-a", name: "Alex", archived: false }]
  );

  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "Selected owner no longer exists in active people.");

  const valid = saveUpdate(
    "work",
    {
      text: "Valid owner",
      ownerId: "person-a",
      toUpdate: ["person-a"]
    },
    "",
    [{ id: "person-a", name: "Alex", archived: false }]
  );

  assert.equal(valid.ok, true);
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


test("selectUpdatesForPerson defaults to pending-only and can include completed rows", () => {
  const updates = [
    normaliseUpdate({
      id: "upd-1",
      text: "Pending item",
      toUpdate: [{ personId: "person-a", status: "pending" }]
    }),
    normaliseUpdate({
      id: "upd-2",
      text: "Completed item",
      toUpdate: [{ personId: "person-a", status: "updated", updatedAt: "2025-02-01T10:00:00.000Z" }]
    }),
    normaliseUpdate({
      id: "upd-3",
      text: "Archived pending",
      archived: true,
      toUpdate: [{ personId: "person-a", status: "pending" }]
    })
  ];

  const pendingOnly = selectUpdatesForPerson(updates, "person-a");
  assert.deepEqual(pendingOnly.map(({ update }) => update.id), ["upd-1"]);

  const withCompleted = selectUpdatesForPerson(updates, "person-a", { includeCompleted: true });
  assert.deepEqual(withCompleted.map(({ update }) => update.id), ["upd-1", "upd-2"]);

  const includeArchived = selectUpdatesForPerson(updates, "person-a", { includeArchived: true });
  assert.deepEqual(includeArchived.map(({ update }) => update.id), ["upd-1", "upd-3"]);
});

test("pending/completed selectors remain stable for legacy note rows and structured recipients", () => {
  const update = normaliseUpdate({
    text: "Migration-safe recipient counting",
    toUpdate: [
      { personId: "person-a", status: "pending", required: true, updatedAt: "" },
      { personId: "person-b", status: "updated", required: true, updatedAt: "2025-04-01T09:00:00.000Z" },
      // Legacy free-text payloads may still exist in persisted notes.
      { personId: "", note: "Leadership team", status: "pending" }
    ]
  });

  assert.equal(selectPendingPeopleCount(update), 2);
  assert.equal(selectCompletedPeopleCount(update), 1);
});
