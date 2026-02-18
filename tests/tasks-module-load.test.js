import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Syntax smoke test for tasks module.
 *
 * We import the module namespace directly so any parse-time syntax regression
 * (for example an unmatched brace before an `export`) fails this test suite
 * before reaching browser runtime.
 */
test("tasks module exports load successfully", async () => {
  const module = await import("../src/modules/tasks.js");

  // Keep checks lightweight: validate key exports used by dashboard/tasks entrypoints.
  assert.equal(typeof module.renderWorkTasksModule, "function");
  assert.equal(typeof module.saveTask, "function");
  assert.equal(typeof module.loadTasks, "function");
});
