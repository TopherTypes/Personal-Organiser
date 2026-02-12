import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { searchCommandPalette } from "../src/modules/command-palette.js";
import { buildPersonalStorageKey } from "../src/modules/personal-keys.js";

test("searchCommandPalette indexes work and personal records from local datasets", () => {
  localStorage.clear();

  localStorage.setItem(
    "second-brain.work.tasks.work.v1",
    JSON.stringify([{ id: "wt-1", title: "Prepare board deck", status: "In Progress", dueDate: "2026-02-20" }])
  );
  localStorage.setItem(
    "second-brain.work.meetings.work",
    JSON.stringify([{ id: "wm-1", name: "Weekly Ops", date: "2026-02-19", notes: "KPIs" }])
  );
  localStorage.setItem(
    buildPersonalStorageKey("calendar", 1),
    JSON.stringify([{ id: "pc-1", title: "Family dinner", date: "2026-02-22", location: "Home" }])
  );

  const workResults = searchCommandPalette("board");
  const personalResults = searchCommandPalette("family");

  assert.equal(workResults[0].mode, "work");
  assert.equal(workResults[0].moduleKey, "tasks");
  assert.equal(workResults[0].title, "Prepare board deck");

  assert.equal(personalResults[0].mode, "personal");
  assert.equal(personalResults[0].moduleKey, "calendar");
  assert.equal(personalResults[0].title, "Family dinner");
});
