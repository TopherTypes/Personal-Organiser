import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { getTaskTimelineSortDate, loadTasks, normaliseTask, saveTask } from "../src/modules/tasks.js";

test("normaliseTask and loadTasks apply migration-safe scheduleDate defaults", () => {
  localStorage.clear();
  localStorage.setItem(
    "second-brain.work.tasks.work.v1",
    JSON.stringify({
      schemaVersion: 1,
      tasks: [{ id: "legacy-task", title: "Legacy", status: "Backlog", dueDate: "2026-05-01" }]
    })
  );

  const directNormalised = normaliseTask({ id: "raw-legacy", title: "Raw" });
  const loaded = loadTasks("work");

  assert.equal(directNormalised.scheduleDate, "");
  assert.equal(loaded[0].scheduleDate, "");
});

test("saveTask persists scheduleDate and tracks scheduleDate updates", () => {
  localStorage.clear();
  const create = saveTask("work", {
    title: "Schedule a launch prep",
    effort: 4,
    impact: 8,
    status: "Ready",
    assigneeId: "",
    projectId: "",
    scheduleDate: "2026-03-05",
    dueDate: "2026-03-08",
    recurrence: "none",
    customRecurrence: "",
    recurrenceInterval: 1,
    blockedByTaskIds: [],
    blockingTaskIds: [],
    notes: "",
    archived: false
  });

  assert.equal(create.ok, true);

  const storedEnvelope = JSON.parse(localStorage.getItem("second-brain.work.tasks.work.v1"));
  const storedTask = storedEnvelope.tasks[0];

  assert.equal(storedTask.scheduleDate, "2026-03-05");
  assert.equal(typeof storedTask.lastUpdatedByField.scheduleDate, "string");
});

test("saveTask persists and reloads personal tasks using personal storage", () => {
  localStorage.clear();

  const create = saveTask("personal", {
    title: "Book dentist check-up",
    effort: 3,
    impact: 6,
    status: "Ready",
    assigneeId: "",
    projectId: "",
    scheduleDate: "2026-04-10",
    dueDate: "2026-04-12",
    recurrence: "none",
    customRecurrence: "",
    recurrenceInterval: 1,
    blockedByTaskIds: [],
    blockingTaskIds: [],
    notes: "",
    archived: false
  });

  assert.equal(create.ok, true);

  const storedEnvelope = JSON.parse(localStorage.getItem("second-brain.personal.tasks.v1"));
  assert.equal(storedEnvelope.schemaVersion, 1);
  assert.equal(storedEnvelope.tasks[0].title, "Book dentist check-up");

  const loaded = loadTasks("personal");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].title, "Book dentist check-up");
});

test("timeline sort precedence uses scheduleDate first, then dueDate, then fallback", () => {
  const withSchedule = getTaskTimelineSortDate({ scheduleDate: "2026-01-04", dueDate: "2026-01-01" });
  const withDueOnly = getTaskTimelineSortDate({ scheduleDate: "", dueDate: "2026-01-02" });
  const withNoDates = getTaskTimelineSortDate({ scheduleDate: "", dueDate: "" });

  assert.equal(withSchedule, "2026-01-04");
  assert.equal(withDueOnly, "2026-01-02");
  assert.equal(withNoDates, "9999-12-31");
});
