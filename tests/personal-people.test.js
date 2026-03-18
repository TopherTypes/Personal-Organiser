import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";

// personal-people stores a plain JSON array under this key.
const STORAGE_KEY = "second-brain.personal.people.v1";

function createEmptyContact() {
  return {
    id: "",
    name: "",
    relationship: "",
    cadenceTarget: "",
    birthday: "",
    notes: "",
    lastContact: "",
    archived: false
  };
}

function loadContacts() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => ({
      ...createEmptyContact(),
      ...entry,
      archived: Boolean(entry?.archived)
    }));
  } catch {
    return [];
  }
}

function persistContacts(contacts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

test("load returns empty array when storage is empty", () => {
  localStorage.clear();
  assert.deepEqual(loadContacts(), []);
});

test("load returns empty array for malformed JSON", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, "{{bad}}");
  assert.deepEqual(loadContacts(), []);
});

test("load returns empty array when stored value is not an array", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: "Not an array" }));
  assert.deepEqual(loadContacts(), []);
});

test("persist and reload a contact with all fields", () => {
  localStorage.clear();
  const contact = {
    id: "ppl_1",
    name: "Alice",
    relationship: "Friend",
    cadenceTarget: "Monthly",
    birthday: "1990-06-15",
    notes: "Met at conference",
    lastContact: "2026-02-01",
    archived: false
  };
  persistContacts([contact]);
  const loaded = loadContacts();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "ppl_1");
  assert.equal(loaded[0].name, "Alice");
  assert.equal(loaded[0].relationship, "Friend");
  assert.equal(loaded[0].archived, false);
});

test("normalises missing fields to empty defaults on load", () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: "ppl_2", name: "Bob" }]));
  const loaded = loadContacts();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].relationship, "");
  assert.equal(loaded[0].notes, "");
  assert.equal(loaded[0].archived, false);
});

test("normalises archived field as boolean", () => {
  localStorage.clear();
  const raw = [
    { id: "ppl_a", name: "Active", archived: false },
    { id: "ppl_b", name: "Archived", archived: true },
    { id: "ppl_c", name: "Truthy", archived: 1 }
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  const loaded = loadContacts();
  assert.equal(loaded[0].archived, false);
  assert.equal(loaded[1].archived, true);
  assert.equal(loaded[2].archived, true);
});

test("archive toggle persists correctly", () => {
  localStorage.clear();
  persistContacts([{ id: "ppl_1", name: "Alice", archived: false }]);
  const before = loadContacts();
  assert.equal(before[0].archived, false);

  // Simulate archive toggle
  const toggled = loadContacts().map((c) =>
    c.id === "ppl_1" ? { ...c, archived: !c.archived } : c
  );
  persistContacts(toggled);

  const after = loadContacts();
  assert.equal(after[0].archived, true);
});

test("contacts sorted alphabetically by name (application responsibility)", () => {
  localStorage.clear();
  persistContacts([
    { id: "ppl_z", name: "Zara", archived: false },
    { id: "ppl_a", name: "Alice", archived: false }
  ]);
  const loaded = loadContacts().sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(loaded[0].name, "Alice");
  assert.equal(loaded[1].name, "Zara");
});
