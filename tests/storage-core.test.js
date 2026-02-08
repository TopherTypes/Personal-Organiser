import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadVersionedCollection,
  persistVersionedCollection,
  safeJsonParse,
  safeJsonWrite
} from "../src/modules/storage-core.js";

test("safeJsonParse returns fallback for malformed payloads", () => {
  localStorage.clear();
  assert.deepEqual(safeJsonParse("{", { fallback: true }), { fallback: true });
  assert.deepEqual(safeJsonParse("", [1]), [1]);
});

test("safeJsonWrite persists serialisable values", () => {
  localStorage.clear();
  assert.equal(safeJsonWrite("test.key", { ok: true }), true);
  assert.deepEqual(JSON.parse(localStorage.getItem("test.key")), { ok: true });
});

test("migrates legacy arrays into envelopes and writes backup payloads", () => {
  localStorage.clear();
  localStorage.setItem("legacy.key", JSON.stringify([{ id: "1", title: "Item" }]));

  const loaded = loadVersionedCollection({
    storageKey: "legacy.key",
    collectionKey: "items",
    schemaVersion: 3,
    normaliseItem: (entry) => ({ id: entry.id || "generated", title: entry.title || "" }),
    fallback: []
  });

  assert.deepEqual(loaded, [{ id: "1", title: "Item" }]);
  assert.deepEqual(JSON.parse(localStorage.getItem("legacy.key")), {
    schemaVersion: 3,
    items: [{ id: "1", title: "Item" }]
  });
  assert.deepEqual(JSON.parse(localStorage.getItem("legacy.key.backup")), [{ id: "1", title: "Item" }]);
});

test("persists versioned envelopes with a collection key", () => {
  localStorage.clear();
  persistVersionedCollection({
    storageKey: "projects.key",
    collectionKey: "projects",
    schemaVersion: 1,
    records: [{ id: "p_1" }]
  });

  assert.deepEqual(JSON.parse(localStorage.getItem("projects.key")), {
    schemaVersion: 1,
    projects: [{ id: "p_1" }]
  });
});
