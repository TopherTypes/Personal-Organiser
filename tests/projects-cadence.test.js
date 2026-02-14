import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  addIsoDateInterval,
  deriveNextExpectedUpdateDate,
  normaliseProject
} from "../src/modules/projects-store.js";
import { selectProjectsNeedingAttention } from "../src/modules/dashboard.js";

test("addIsoDateInterval handles day/week/month cadence math", () => {
  assert.equal(addIsoDateInterval("2026-01-10", 3, "days"), "2026-01-13");
  assert.equal(addIsoDateInterval("2026-01-10", 2, "weeks"), "2026-01-24");
  assert.equal(addIsoDateInterval("2026-01-31", 1, "months"), "2026-03-03");
});

test("deriveNextExpectedUpdateDate falls back to sane cadence defaults", () => {
  const migratedProject = normaliseProject({
    title: "Legacy migration",
    lastProgressUpdate: "2026-02-01T09:00:00.000Z",
    cadenceInterval: 0,
    cadenceUnit: "quarters"
  });

  assert.equal(migratedProject.lastProgressUpdate, "2026-02-01");
  assert.equal(migratedProject.cadenceInterval, 1);
  assert.equal(migratedProject.cadenceUnit, "weeks");
  assert.equal(deriveNextExpectedUpdateDate(migratedProject), "2026-02-08");
});

test("selectProjectsNeedingAttention includes cadence overdue and legacy target fallback", () => {
  const projects = [
    normaliseProject({
      id: "p-overdue",
      title: "Overdue cadence",
      status: "active",
      lastProgressUpdate: "2026-01-01",
      cadenceInterval: 2,
      cadenceUnit: "weeks"
    }),
    normaliseProject({
      id: "p-ontrack",
      title: "On track cadence",
      status: "active",
      lastProgressUpdate: "2026-02-10",
      cadenceInterval: 2,
      cadenceUnit: "weeks"
    }),
    normaliseProject({
      id: "p-legacy",
      title: "Legacy target fallback",
      status: "active",
      targetDate: "2026-02-01"
    })
  ];

  const attention = selectProjectsNeedingAttention(projects, "2026-02-20");
  assert.deepEqual(
    attention.map((project) => project.id).sort(),
    ["p-legacy", "p-overdue"]
  );
});
