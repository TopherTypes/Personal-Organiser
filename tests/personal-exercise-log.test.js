import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";

// personal-exercise-log stores a plain JSON array under this key.
const STORAGE_KEY = "second-brain.personal.exercise-log.v1";

function loadEntries() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

test("load returns empty array when storage is empty", () => {
  localStorage.clear();
  assert.deepEqual(loadEntries(), []);
});

test("load returns empty array for malformed JSON", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, "not-json");
  assert.deepEqual(loadEntries(), []);
});

test("load returns empty array when value is not an array", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
  assert.deepEqual(loadEntries(), []);
});

test("persist and reload an exercise entry", () => {
  localStorage.clear();
  const entry = {
    id: "elog_1",
    type: "Run",
    date: "2026-03-18",
    distanceKm: 5.2,
    durationMins: 28
  };
  persistEntries([entry]);
  const loaded = loadEntries();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "elog_1");
  assert.equal(loaded[0].type, "Run");
  assert.equal(loaded[0].distanceKm, 5.2);
  assert.equal(loaded[0].durationMins, 28);
});

test("multiple entries are preserved in insertion order", () => {
  localStorage.clear();
  const entries = [
    { id: "elog_2", type: "Walk", date: "2026-03-18", distanceKm: 3, durationMins: 45 },
    { id: "elog_1", type: "Run", date: "2026-03-17", distanceKm: 5, durationMins: 25 }
  ];
  persistEntries(entries);
  const loaded = loadEntries();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, "elog_2");
  assert.equal(loaded[1].id, "elog_1");
});

test("persist overwrites existing entries", () => {
  localStorage.clear();
  persistEntries([{ id: "old", type: "Walk", date: "2026-01-01", distanceKm: 1, durationMins: 10 }]);
  persistEntries([{ id: "new", type: "Run", date: "2026-03-18", distanceKm: 8, durationMins: 40 }]);
  const loaded = loadEntries();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "new");
});
