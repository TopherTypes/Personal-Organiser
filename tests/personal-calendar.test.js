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
    assert.equal(notes?.textContent, "<script>alert('xss')</script>");
    assert.equal(findFirstByTag(row, "img"), null);
    assert.equal(findFirstByTag(row, "script"), null);
  } finally {
    globalThis.document = originalDocument;
  }
});
