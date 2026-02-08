import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteProject,
  loadPersonProjectLinks,
  loadProjects,
  PROJECT_STORAGE_KEY,
  saveProject,
  upsertProjectPersonLink
} from "../src/modules/projects-store.js";
import { loadTasks } from "../src/modules/tasks.js";
import { loadMeetings } from "../src/modules/meetings.js";
import { loadSprints } from "../src/modules/sprints.js";

test("migrates legacy task payloads to an envelope with backup", () => {
  localStorage.clear();
  const legacy = [{ id: "task_1", title: "Legacy task", status: "done" }];
  localStorage.setItem("second-brain.work.tasks.work.v1", JSON.stringify(legacy));

  const loaded = loadTasks("work");

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].status, "Done");
  assert.equal(JSON.parse(localStorage.getItem("second-brain.work.tasks.work.v1")).schemaVersion, 1);
  assert.deepEqual(JSON.parse(localStorage.getItem("second-brain.work.tasks.work.v1.backup")), legacy);
});

test("migrates legacy meetings and sprints with backup creation", () => {
  localStorage.clear();
  const meetingsLegacy = [{ id: "m1", name: "Retro", date: "2026-01-01" }];
  const sprintsLegacy = [{ id: "s1", name: "Sprint 1", status: "active" }];

  localStorage.setItem("second-brain.work.meetings.work", JSON.stringify(meetingsLegacy));
  localStorage.setItem("second-brain.work.sprints.work", JSON.stringify(sprintsLegacy));

  assert.equal(loadMeetings("work")[0].name, "Retro");
  assert.equal(loadSprints("work")[0].name, "Sprint 1");
  assert.deepEqual(JSON.parse(localStorage.getItem("second-brain.work.meetings.work.backup")), meetingsLegacy);
  assert.deepEqual(JSON.parse(localStorage.getItem("second-brain.work.sprints.work.backup")), sprintsLegacy);
});

test("project CRUD invariants: create, update link merge, and delete", () => {
  localStorage.clear();
  const create = saveProject("work", { title: "Platform uplift", status: "planned" });
  assert.equal(create.ok, true);
  const projectId = create.project.id;

  upsertProjectPersonLink("work", projectId, "person_1", ["SME", "SME", "approval"]);
  upsertProjectPersonLink("work", projectId, "person_2", ["stakeholder"]);

  assert.deepEqual(loadPersonProjectLinks("work", "person_1"), [{ projectId, roles: ["SME", "approval"] }]);

  upsertProjectPersonLink("work", projectId, "person_1", []);
  assert.deepEqual(loadPersonProjectLinks("work", "person_1"), []);

  const removed = deleteProject("work", projectId);
  assert.equal(removed.ok, true);
  assert.deepEqual(loadProjects("work"), []);
  assert.deepEqual(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)).projects, []);
});
