import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonalStorageKey } from "../src/modules/personal-keys.js";
import { loadNotes, saveNote, setNoteArchived } from "../src/modules/notes.js";

const WORK_NOTES_KEY = "second-brain.work.notes.work.v1";

test("loadNotes migrates legacy work notes arrays to versioned envelope with backup", () => {
  localStorage.clear();
  const legacyPayload = [{ id: "n_1", body: "Legacy note", createdAt: "2026-01-01T00:00:00.000Z" }];
  localStorage.setItem(WORK_NOTES_KEY, JSON.stringify(legacyPayload));

  const loaded = loadNotes("work");

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].body, "Legacy note");
  assert.equal(loaded[0].title, "");
  assert.equal(JSON.parse(localStorage.getItem(WORK_NOTES_KEY)).schemaVersion, 1);
  assert.deepEqual(JSON.parse(localStorage.getItem(`${WORK_NOTES_KEY}.backup`)), legacyPayload);
});

test("notes CRUD supports create, edit, and archive transitions", () => {
  localStorage.clear();

  const createResult = saveNote("work", { title: "Standup", body: "Capture blockers" });
  assert.equal(createResult.ok, true);
  assert.equal(createResult.wasEdit, false);

  const created = createResult.note;
  const firstLoad = loadNotes("work");
  assert.equal(firstLoad.length, 1);
  assert.equal(firstLoad[0].title, "Standup");

  const editResult = saveNote("work", { title: "Standup notes", body: "Capture blockers and actions" }, created.id);
  assert.equal(editResult.ok, true);
  assert.equal(editResult.wasEdit, true);
  assert.equal(editResult.note.createdAt, created.createdAt);
  assert.equal(editResult.note.body, "Capture blockers and actions");

  const archiveResult = setNoteArchived("work", created.id, true);
  assert.equal(archiveResult.ok, true);

  const archived = loadNotes("work").find((note) => note.id === created.id);
  assert.ok(archived);
  assert.equal(archived.archived, true);
});

test("personal notes persist to isolated personal storage key", () => {
  localStorage.clear();

  const result = saveNote("personal", { body: "Personal idea" });
  assert.equal(result.ok, true);

  const personalKey = buildPersonalStorageKey("notes", 1);
  const persisted = JSON.parse(localStorage.getItem(personalKey));

  assert.equal(Array.isArray(persisted.notes), true);
  assert.equal(persisted.notes[0].body, "Personal idea");
});
