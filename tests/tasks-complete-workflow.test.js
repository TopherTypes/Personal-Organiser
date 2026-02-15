import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { loadTasks, markTaskCompleted, saveTask } from "../src/modules/tasks.js";

function createTask(mode, title) {
  return saveTask(mode, {
    title,
    effort: 4,
    impact: 8,
    status: "Ready",
    assigneeId: "",
    projectId: "",
    scheduleDate: "",
    dueDate: "",
    recurrence: "none",
    customRecurrence: "",
    recurrenceInterval: 1,
    blockedByTaskIds: [],
    blockingTaskIds: [],
    notes: "",
    archived: false
  });
}

test("markTaskCompleted updates task status and status timestamp in work mode", () => {
  localStorage.clear();
  const create = createTask("work", "Ship release checklist");
  assert.equal(create.ok, true);

  const [created] = loadTasks("work");
  const wasUpdated = markTaskCompleted("work", created.id);

  assert.equal(wasUpdated, true);

  const [completed] = loadTasks("work");
  assert.equal(completed.status, "Done");
  assert.equal(typeof completed.lastUpdatedByField.status, "string");
});

test("markTaskCompleted persists against personal storage envelope", () => {
  localStorage.clear();
  const create = createTask("personal", "Call plumber");
  assert.equal(create.ok, true);

  const [created] = loadTasks("personal");
  const wasUpdated = markTaskCompleted("personal", created.id);

  assert.equal(wasUpdated, true);

  const storedEnvelope = JSON.parse(localStorage.getItem("second-brain.personal.tasks.v1"));
  assert.equal(storedEnvelope.tasks[0].status, "Done");
});
