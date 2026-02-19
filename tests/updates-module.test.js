import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveUpdate,
  deleteUpdate,
  isDueSoon,
  isOverdue,
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

test("normaliseUpdate migrates legacy fields into the new canonical model", () => {
  const update = normaliseUpdate({
    text: "Quarterly status",
    entityType: "action",
    toUpdate: ["person-a", " person-b "]
  });

  assert.equal(update.summary, "Quarterly status");
  assert.equal(update.type, "action");
  assert.deepEqual(update.recipients, [
    { personId: "person-a", status: "pending", updatedAt: "" },
    { personId: "person-b", status: "pending", updatedAt: "" }
  ]);
});

test("normaliseUpdate canonicalises complete recipient timestamps as ISO", () => {
  const update = normaliseUpdate({
    summary: "Prep note",
    recipients: [{ personId: "person-a", status: "complete", updatedAt: "2024-03-01T10:00:00-05:00" }]
  });

  assert.equal(update.recipients[0].status, "complete");
  assert.equal(update.recipients[0].updatedAt, "2024-03-01T15:00:00.000Z");
});

test("saveUpdate requires summary and recipients", () => {
  localStorage.clear();

  const missingSummary = saveUpdate("work", { recipients: [{ personId: "person-a", status: "pending" }] });
  assert.equal(missingSummary.ok, false);

  const missingRecipients = saveUpdate("work", { summary: "Ship reminder", recipients: [] });
  assert.equal(missingRecipients.ok, false);
  assert.equal(missingRecipients.error, "At least one recipient is required.");
});

test("markPersonUpdated and markPersonPending mutate per-recipient status", () => {
  localStorage.clear();

  const createResult = saveUpdate("work", {
    summary: "Customer rollout",
    ownerId: "owner-1",
    recipients: [
      { personId: "person-a", status: "pending", updatedAt: "" },
      { personId: "person-b", status: "pending", updatedAt: "" }
    ]
  });

  assert.equal(createResult.ok, true);
  const [created] = loadUpdates("work");

  const at = "2025-01-02T03:04:05.000Z";
  markPersonUpdated(created.id, "person-a", at);

  let [afterUpdate] = loadUpdates("work");
  assert.equal(selectCompletedPeopleCount(afterUpdate), 1);
  assert.equal(selectPendingPeopleCount(afterUpdate), 1);
  assert.equal(afterUpdate.recipients.find((entry) => entry.personId === "person-a")?.updatedAt, at);

  markPersonPending(created.id, "person-a");
  [afterUpdate] = loadUpdates("work");
  assert.equal(selectCompletedPeopleCount(afterUpdate), 0);
  assert.equal(selectPendingPeopleCount(afterUpdate), 2);
});

test("archive and delete workflows are non-destructive lifecycle state changes", () => {
  localStorage.clear();
  saveUpdate("work", {
    summary: "Lifecycle",
    recipients: [{ personId: "person-a", status: "pending", updatedAt: "" }]
  });

  let [saved] = loadUpdates("work");
  archiveUpdate("work", saved.id, true);
  [saved] = loadUpdates("work");
  assert.equal(saved.lifecycle, "archived");

  archiveUpdate("work", saved.id, false);
  [saved] = loadUpdates("work");
  assert.equal(saved.lifecycle, "active");

  const removed = deleteUpdate("work", saved.id);
  assert.equal(removed.ok, true);
  [saved] = loadUpdates("work");
  assert.equal(saved.lifecycle, "deleted");
});

test("loadUpdates migrates persisted legacy arrays via normalisation", () => {
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
          updatedAt: "2025-01-01T00:00:00.000Z"
        }
      ]
    })
  );

  const [loaded] = loadUpdates("work");
  assert.deepEqual(loaded.recipients, [{ personId: "person-a", status: "pending", updatedAt: "" }]);
});

test("selectUpdatesForPerson defaults to pending-only and excludes deleted rows", () => {
  const updates = [
    normaliseUpdate({ id: "upd-1", summary: "Pending item", recipients: [{ personId: "person-a", status: "pending" }] }),
    normaliseUpdate({ id: "upd-2", summary: "Completed item", recipients: [{ personId: "person-a", status: "complete", updatedAt: "2025-02-01T10:00:00.000Z" }] }),
    normaliseUpdate({ id: "upd-3", summary: "Archived pending", lifecycle: "archived", recipients: [{ personId: "person-a", status: "pending" }] }),
    normaliseUpdate({ id: "upd-4", summary: "Deleted pending", lifecycle: "deleted", recipients: [{ personId: "person-a", status: "pending" }] })
  ];

  const pendingOnly = selectUpdatesForPerson(updates, "person-a");
  assert.deepEqual(pendingOnly.map(({ update }) => update.id), ["upd-1"]);

  const withCompleted = selectUpdatesForPerson(updates, "person-a", { includeCompleted: true });
  assert.deepEqual(withCompleted.map(({ update }) => update.id), ["upd-1", "upd-2"]);

  const includeArchived = selectUpdatesForPerson(updates, "person-a", { includeArchived: true });
  assert.deepEqual(includeArchived.map(({ update }) => update.id), ["upd-1", "upd-3"]);
});

test("isOverdue and isDueSoon derive due-state with optional dates", () => {
  const now = new Date("2026-03-08T09:00:00.000Z");
  assert.equal(isOverdue({ dueDate: "2026-03-07" }, now), true);
  assert.equal(isDueSoon({ dueDate: "2026-03-12" }, now), true);
  assert.equal(isDueSoon({ dueDate: "" }, now), false);
});
