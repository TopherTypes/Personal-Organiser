import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTodayFocusInclusion, suggestPrioritiesFromOverdue } from "../src/modules/today-focus.js";

test("evaluateTodayFocusInclusion applies scope rules consistently", () => {
  const selectedDate = "2026-03-03";

  assert.equal(evaluateTodayFocusInclusion({ itemDate: "2026-03-03", selectedDate, scope: "today" }).included, true);
  assert.equal(evaluateTodayFocusInclusion({ itemDate: "2026-03-02", selectedDate, scope: "today" }).included, false);

  const overdue = evaluateTodayFocusInclusion({ itemDate: "2026-03-01", selectedDate, scope: "overdue" });
  assert.equal(overdue.included, true);
  assert.equal(overdue.relation, "overdue");

  assert.equal(evaluateTodayFocusInclusion({ itemDate: "2026-03-06", selectedDate, scope: "next7" }).included, true);
  assert.equal(evaluateTodayFocusInclusion({ itemDate: "2026-03-12", selectedDate, scope: "next7" }).included, false);

  assert.equal(evaluateTodayFocusInclusion({ itemDate: "", selectedDate, scope: "all", includeUndatedInAll: true }).included, true);
});

test("suggestPrioritiesFromOverdue fills only empty slots with oldest overdue first", () => {
  const priorities = [
    { kind: "text", text: "Keep this", taskId: "" },
    { kind: "text", text: "", taskId: "" },
    { kind: "text", text: "", taskId: "" }
  ];

  const tasks = [
    { id: "t2", title: "Later overdue", dueDate: "2026-03-01" },
    { id: "t1", title: "Oldest overdue", dueDate: "2026-02-26" },
    { id: "t3", title: "Due today", dueDate: "2026-03-03" }
  ];

  const next = suggestPrioritiesFromOverdue({ priorities, tasks, selectedDate: "2026-03-03" });

  assert.equal(next[0].text, "Keep this");
  assert.equal(next[1].taskId, "t1");
  assert.equal(next[2].taskId, "t2");
});
