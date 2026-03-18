import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";

// personal-daily-log stores a plain JSON array under this key.
const STORAGE_KEY = "second-brain.personal.daily-log.v1";

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
  localStorage.setItem(STORAGE_KEY, "{not valid json");
  assert.deepEqual(loadEntries(), []);
});

test("load returns empty array when value is not an array", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ wrong: "shape" }));
  assert.deepEqual(loadEntries(), []);
});

test("persist and reload a daily log entry", () => {
  localStorage.clear();
  const entry = {
    id: "dlog_1",
    date: "2026-03-18",
    nutrition: "Oats, salad",
    exercise: "30 min walk",
    mood: "7",
    createdAt: "2026-03-18T08:00:00.000Z"
  };
  persistEntries([entry]);
  const loaded = loadEntries();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "dlog_1");
  assert.equal(loaded[0].date, "2026-03-18");
  assert.equal(loaded[0].nutrition, "Oats, salad");
  assert.equal(loaded[0].mood, "7");
});

test("multiple entries are preserved in order", () => {
  localStorage.clear();
  const entries = [
    { id: "dlog_2", date: "2026-03-18", nutrition: "B", exercise: "", mood: "8", createdAt: "" },
    { id: "dlog_1", date: "2026-03-17", nutrition: "A", exercise: "", mood: "6", createdAt: "" }
  ];
  persistEntries(entries);
  const loaded = loadEntries();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, "dlog_2");
  assert.equal(loaded[1].id, "dlog_1");
});

test("persist overwrites previous entries", () => {
  localStorage.clear();
  persistEntries([{ id: "dlog_old", date: "2026-01-01", nutrition: "", exercise: "", mood: "", createdAt: "" }]);
  persistEntries([{ id: "dlog_new", date: "2026-03-18", nutrition: "", exercise: "", mood: "", createdAt: "" }]);
  const loaded = loadEntries();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "dlog_new");
});
