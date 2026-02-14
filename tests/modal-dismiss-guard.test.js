import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createModalDismissGuard } from "../src/modules/modal-dismiss-guard.js";

test("requestClose closes immediately when draft is clean", (t) => {
  const calls = [];
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  globalThis.window = {
    confirm: () => {
      throw new Error("confirm should not run for clean drafts");
    }
  };

  const guard = createModalDismissGuard({
    onClose: () => calls.push("closed")
  });

  assert.equal(guard.requestClose(), true);
  assert.deepEqual(calls, ["closed"]);
});

test("requestClose blocks close when draft is dirty and confirmation is declined", (t) => {
  const calls = [];
  const confirms = [];
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  globalThis.window = {
    confirm: (message) => {
      confirms.push(message);
      return false;
    }
  };

  const guard = createModalDismissGuard({
    onClose: () => calls.push("closed")
  });

  guard.markDirty();
  assert.equal(guard.requestClose(), false);
  assert.deepEqual(calls, []);
  assert.deepEqual(confirms, ["Discard unsaved changes?"]);
});

test("bound input/change events mark drafts dirty and require explicit confirmation", (t) => {
  const calls = [];
  const confirms = [];
  const form = new EventTarget();
  const previousWindow = globalThis.window;
  t.after(() => {
    globalThis.window = previousWindow;
  });

  globalThis.window = {
    confirm: (message) => {
      confirms.push(message);
      return true;
    }
  };

  const guard = createModalDismissGuard({
    onClose: () => calls.push("closed")
  });

  guard.bindDirtyTracking(form);
  form.dispatchEvent(new Event("input"));
  assert.equal(guard.isDirty(), true);

  assert.equal(guard.requestClose(), true);
  assert.deepEqual(confirms, ["Discard unsaved changes?"]);
  assert.deepEqual(calls, ["closed"]);
});
