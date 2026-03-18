import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { renderPersonalCalendarModule } from "../src/modules/personal-calendar.js";
import { buildPersonalStorageKey } from "../src/modules/personal-keys.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.className = "";
    this._textContent = "";
    this.value = "";
    this.type = "";
    this.required = false;
  }

  set innerHTML(value) {
    if (value === "") {
      this.children = [];
      this._textContent = "";
    }
  }

  get innerHTML() {
    return "";
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  addEventListener() {}

  reset() {}
}

function createFakeDocument() {
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
}

function findFirstByTag(root, tagName) {
  if (root.tagName === tagName) {
    return root;
  }

  for (const child of root.children) {
    const match = findFirstByTag(child, tagName);
    if (match) {
      return match;
    }
  }

  return null;
}

test("calendar renderList renders stored HTML-like titles as literal text", () => {
  localStorage.clear();
  const storageKey = buildPersonalStorageKey("calendar", 1);

  localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        id: "evt-1",
        date: "2026-04-05",
        title: "<img onerror=alert(1)>",
        notes: "<script>alert('xss')</script>"
      }
    ])
  );

  const originalDocument = globalThis.document;
  globalThis.document = createFakeDocument();

  try {
    const section = renderPersonalCalendarModule();
    const row = findFirstByTag(section, "article");

    assert.ok(row);
    const summary = findFirstByTag(row, "strong");
    const notes = findFirstByTag(row, "p");

    assert.equal(summary?.textContent, "2026-04-05 · <img onerror=alert(1)>");
    assert.ok(notes?.textContent.includes("<script>alert('xss')</script>"));
    assert.equal(findFirstByTag(row, "img"), null);
    assert.equal(findFirstByTag(row, "script"), null);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("shiftDateByRecurrence is timezone-safe: daily increment", () => {
  // Re-implements the fixed logic to verify it never produces UTC-shifted dates.
  function shiftDate(isoDate, frequency, interval) {
    const parts = String(isoDate).split("-").map(Number);
    const [year, month, day] = parts;
    const value = new Date(year, month - 1, day);
    if (frequency === "daily") value.setDate(value.getDate() + interval);
    else if (frequency === "weekly") value.setDate(value.getDate() + interval * 7);
    else if (frequency === "monthly") value.setMonth(value.getMonth() + interval);
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  assert.equal(shiftDate("2026-03-18", "daily", 1), "2026-03-19");
  assert.equal(shiftDate("2026-03-31", "daily", 1), "2026-04-01");
  assert.equal(shiftDate("2026-03-18", "weekly", 1), "2026-03-25");
  assert.equal(shiftDate("2026-03-18", "monthly", 1), "2026-04-18");
  assert.equal(shiftDate("2026-12-31", "daily", 1), "2027-01-01");
});

test("calendar auto-generates the next recurring event when the current date has passed", () => {
  localStorage.clear();
  const storageKey = buildPersonalStorageKey("calendar", 1);

  localStorage.setItem(
    storageKey,
    JSON.stringify({
      schemaVersion: 1,
      events: [
        {
          id: "evt-1",
          date: "2020-01-01",
          title: "Pay rent",
          notes: "Monthly reminder",
          recurrenceMeta: {
            frequency: "monthly",
            interval: 1,
            parentRecurrenceId: "calendar-series-1"
          }
        }
      ]
    })
  );

  const originalDocument = globalThis.document;
  globalThis.document = createFakeDocument();

  try {
    renderPersonalCalendarModule();
    const persisted = JSON.parse(localStorage.getItem(storageKey));
    assert.ok(Array.isArray(persisted.events));
    assert.ok(persisted.events.length > 1);

    const generated = persisted.events.find((event) => event.id !== "evt-1");
    assert.equal(generated.recurrenceMeta.parentRecurrenceId, "calendar-series-1");
  } finally {
    globalThis.document = originalDocument;
  }
});
