import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { computeProjectHealth } from "../src/modules/project-health.js";

test("computeProjectHealth returns at-risk when no update exists on active project", () => {
  const result = computeProjectHealth({ status: "active", cadenceInterval: 2, cadenceUnit: "weeks" }, [], new Date("2026-02-15T00:00:00Z"));
  assert.equal(result.healthStatus, "at_risk");
  assert.ok(result.reasonList.includes("No update recorded yet"));
});

test("computeProjectHealth returns overdue when past expected cadence", () => {
  const result = computeProjectHealth({ status: "active", lastProgressUpdate: "2026-02-01", cadenceInterval: 1, cadenceUnit: "weeks" }, [], new Date("2026-02-20T00:00:00Z"));
  assert.equal(result.healthStatus, "overdue");
  assert.ok(result.reasonList.includes("Past cadence window"));
});

test("computeProjectHealth uses overdue tasks as at-risk pressure", () => {
  const result = computeProjectHealth(
    { status: "active", lastProgressUpdate: "2026-02-10", cadenceInterval: 4, cadenceUnit: "weeks" },
    [{ status: "In Progress", dueDate: "2026-02-12", archived: false }],
    new Date("2026-02-20T00:00:00Z")
  );
  assert.equal(result.healthStatus, "at_risk");
  assert.equal(result.overdueTasksCount, 1);
});
