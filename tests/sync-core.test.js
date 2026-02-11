import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { __TESTING__ } from "../src/modules/sync.js";

const { mergeDocument, countDocumentDifferences, shouldQueueManualConflict, withRetry } = __TESTING__;

test("mergeDocument resolves conflicts with latest field timestamp and only surfaces important conflicts", () => {
  const local = {
    items: [
      {
        id: "task-1",
        title: "Local title",
        notes: "Local notes",
        updatedAt: "2026-02-10T10:00:00.000Z",
        lastUpdatedByField: {
          title: "2026-02-10T10:00:00.000Z",
          notes: "2026-02-10T09:00:00.000Z"
        }
      }
    ]
  };

  const remote = {
    items: [
      {
        id: "task-1",
        title: "Remote title",
        notes: "Remote notes",
        updatedAt: "2026-02-10T10:05:00.000Z",
        lastUpdatedByField: {
          title: "2026-02-10T10:05:00.000Z",
          notes: "2026-02-10T08:00:00.000Z"
        }
      }
    ]
  };

  const result = mergeDocument(local, remote);

  // Only critical, near-simultaneous fields are escalated for manual resolution.
  assert.equal(result.conflictCount, 1);
  assert.equal(result.document.items[0].title, "Remote title");
  assert.equal(result.document.items[0].notes, "Local notes");
});

test("shouldQueueManualConflict only returns true for important fields in tight edit windows", () => {
  assert.equal(
    shouldQueueManualConflict({
      field: "title",
      localValue: "A",
      remoteValue: "B",
      localTimestamp: "2026-02-10T10:00:00.000Z",
      remoteTimestamp: "2026-02-10T10:05:00.000Z"
    }),
    true
  );

  assert.equal(
    shouldQueueManualConflict({
      field: "notes",
      localValue: "A",
      remoteValue: "B",
      localTimestamp: "2026-02-10T10:00:00.000Z",
      remoteTimestamp: "2026-02-10T10:05:00.000Z"
    }),
    false
  );

  assert.equal(
    shouldQueueManualConflict({
      field: "title",
      localValue: "A",
      remoteValue: "B",
      localTimestamp: "2026-02-10T10:00:00.000Z",
      remoteTimestamp: "2026-02-10T12:00:00.000Z"
    }),
    false
  );
});

test("countDocumentDifferences reports changed, added, and removed entities", () => {
  const left = {
    items: [
      { id: "a", value: 1 },
      { id: "b", value: 2 }
    ]
  };

  const right = {
    items: [
      { id: "a", value: 1 },
      { id: "b", value: 3 },
      { id: "c", value: 4 }
    ]
  };

  assert.equal(countDocumentDifferences(left, right), 2);
  assert.equal(countDocumentDifferences(right, left), 2);
  assert.equal(countDocumentDifferences(left, left), 0);
});

test("withRetry retries up to maxAttempts and caps backoff delay", async () => {
  const waits = [];
  let attempts = 0;

  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw Object.assign(new Error("network timeout"), { transient: true });
      },
      { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0.2 },
      undefined,
      {
        waitFor: async (ms) => {
          waits.push(ms);
        },
        random: () => 1
      }
    )
  );

  assert.equal(attempts, 4);
  assert.deepEqual(waits, [120, 240, 300]);
});
