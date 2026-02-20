import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { loadProjects, saveProject, upsertProjectRaidEntry, normaliseProject } from "../src/modules/projects-store.js";

test("normaliseProject initialises RAID containers for legacy projects", () => {
  const legacy = normaliseProject({ id: "p1", title: "Legacy", status: "active" });
  assert.deepEqual(legacy.raid, { risks: [], actions: [], issues: [], decisions: [] });
});

test("upsertProjectRaidEntry stores risk scoring and meeting backlink", () => {
  const created = saveProject("work", { title: "Project", status: "active" });
  assert.equal(created.ok, true);

  const result = upsertProjectRaidEntry("work", created.project.id, "risk", {
    title: "Supplier delay",
    description: "Key supplier has delivery uncertainty.",
    date: "2026-03-01",
    status: "Open",
    likelihood: 4,
    impact: 5,
    mitigatingActions: ["Build alternate vendor list"],
    meetingIds: ["meeting-1", "meeting-1"]
  });

  assert.equal(result.ok, true);
  const saved = loadProjects("work").find((project) => project.id === created.project.id);
  assert.equal(saved.raid.risks.length, 1);
  assert.equal(saved.raid.risks[0].level, 20);
  assert.deepEqual(saved.raid.risks[0].meetingIds, ["meeting-1"]);
});
