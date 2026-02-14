import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortMeetings, resolveMeetingStatusClass } from "../src/modules/meetings.js";

function buildState(overrides = {}) {
  return {
    search: "",
    filter: "active",
    showCompleted: false,
    ...overrides
  };
}

test("filterAndSortMeetings hides completed meetings by default", () => {
  const meetings = [
    { id: "m1", name: "Planning", notes: "", date: "2026-01-06", startTime: "09:00", archived: false, status: "scheduled" },
    { id: "m2", name: "Retro", notes: "", date: "2026-01-06", startTime: "10:00", archived: false, status: "completed" },
    { id: "m3", name: "Archive", notes: "", date: "2026-01-06", startTime: "11:00", archived: true, status: "scheduled" }
  ];

  const filtered = filterAndSortMeetings(meetings, buildState(), { start: "2026-01-01", end: "2026-01-31" });

  assert.deepEqual(filtered.map((meeting) => meeting.id), ["m1"]);
});

test("filterAndSortMeetings includes completed meetings when toggle is enabled", () => {
  const meetings = [
    { id: "m1", name: "Planning", notes: "", date: "2026-01-06", startTime: "09:00", archived: false, status: "scheduled" },
    { id: "m2", name: "Retro", notes: "", date: "2026-01-06", startTime: "10:00", archived: false, status: "completed" },
    { id: "m3", name: "Archive", notes: "", date: "2026-01-06", startTime: "11:00", archived: true, status: "completed" }
  ];

  const filtered = filterAndSortMeetings(
    meetings,
    buildState({ showCompleted: true }),
    { start: "2026-01-01", end: "2026-01-31" }
  );

  assert.deepEqual(filtered.map((meeting) => meeting.id), ["m1", "m2"]);
});

test("resolveMeetingStatusClass maps known statuses and falls back for unknown values", () => {
  assert.equal(resolveMeetingStatusClass("scheduled"), "meeting-status-scheduled");
  assert.equal(resolveMeetingStatusClass("completed"), "meeting-status-completed");
  assert.equal(resolveMeetingStatusClass("rescheduled"), "meeting-status-rescheduled");
  assert.equal(resolveMeetingStatusClass("cancelled"), "meeting-status-cancelled");
  assert.equal(resolveMeetingStatusClass("missed"), "meeting-status-missed");
  assert.equal(resolveMeetingStatusClass("unknown"), "meeting-status-scheduled");
});
