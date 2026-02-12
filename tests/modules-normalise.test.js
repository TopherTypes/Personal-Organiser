import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { normaliseTask, normaliseTaskStatus } from "../src/modules/tasks.js";
import { loadTasks } from "../src/modules/tasks.js";
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
  assert.equal(task.recurrenceMeta, null);
});

test("loadTasks generates next recurring instance for completed recurring tasks", () => {
  localStorage.clear();
  const storageKey = "second-brain.work.tasks.work.v1";
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      schemaVersion: 1,
      tasks: [
        {
          id: "task-1",
          title: "Weekly planning",
          status: "Done",
          dueDate: "2099-02-01",
          recurrence: "weekly",
          recurrenceMeta: {
            frequency: "weekly",
            interval: 1,
            parentRecurrenceId: "series-1"
          }
        }
      ]
    })
  );

  const tasks = loadTasks("work");
  assert.equal(tasks.length, 2);
  const followUp = tasks.find((task) => task.id !== "task-1");

  assert.ok(followUp);
  assert.equal(followUp.dueDate, "2099-02-08");
  assert.equal(followUp.status, "Backlog");
  assert.equal(followUp.recurrenceMeta?.parentRecurrenceId, "series-1");
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

test("normaliseMeeting keeps migration-safe attendee parsing and object defaults", () => {
  const meeting = normaliseMeeting({ name: "Sync", attendeeIds: "p1, p1, p2", auditTrail: null });

  assert.equal(meeting.name, "Sync");
  assert.deepEqual(meeting.attendeeIds, ["p1", "p2"]);
  assert.deepEqual(meeting.auditTrail, []);
});

test("normaliseSprint deduplicates task ids and canonicalises status", () => {
  const sprint = normaliseSprint({ status: "invalid", taskIds: ["t1", "t1", ""] });

  assert.equal(sprint.status, "planning");
  assert.deepEqual(sprint.taskIds, ["t1"]);
});
