import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { normaliseTask, normaliseTaskStatus } from "../src/modules/tasks.js";
import { normaliseProject } from "../src/modules/projects-store.js";
import { normaliseMeeting } from "../src/modules/meetings.js";
import { normaliseSprint } from "../src/modules/sprints.js";

test("normaliseTask applies defensive defaults and canonical status migration", () => {
  localStorage.clear();
  const task = normaliseTask({ status: "completed", blockedByTaskIds: "a, a, b" });

  assert.equal(task.status, "Done");
  assert.equal(task.title, "");
  assert.deepEqual(task.blockedByTaskIds, ["a", "b"]);
  assert.equal(task.recurrence, "none");
});

test("normaliseTaskStatus maps unknown states to Backlog", () => {
  assert.equal(normaliseTaskStatus("ON HOLD"), "Waiting On");
  assert.equal(normaliseTaskStatus("not-a-status"), "Backlog");
});

test("normaliseProject sanitises people links and timestamp maps", () => {
  const project = normaliseProject({
    title: "Migration",
    peopleLinks: [{ personId: "p1", roles: ["SME", ""] }, null],
    lastUpdatedByField: null
  });

  assert.equal(project.title, "Migration");
  assert.deepEqual(project.peopleLinks, [{ personId: "p1", roles: ["SME"] }]);
  assert.deepEqual(project.lastUpdatedByField, {});
});

test("normaliseMeeting enforces valid array/object defaults", () => {
  const meeting = normaliseMeeting({ name: "Sync", attendeeIds: "oops", auditTrail: null });

  assert.equal(meeting.name, "Sync");
  assert.deepEqual(meeting.attendeeIds, []);
  assert.deepEqual(meeting.auditTrail, []);
});

test("normaliseSprint deduplicates task ids and canonicalises status", () => {
  const sprint = normaliseSprint({ status: "invalid", taskIds: ["t1", "t1", ""] });

  assert.equal(sprint.status, "planning");
  assert.deepEqual(sprint.taskIds, ["t1"]);
});
