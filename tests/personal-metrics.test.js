import test from "node:test";
import assert from "node:assert/strict";
import {
  METRIC_TYPES,
  deactivateMetricDefinition,
  selectMetricsForDate,
  upsertMetricDefinition
} from "../src/modules/personal-metrics.js";

test("upsertMetricDefinition versions an existing metric from today forward", () => {
  const existing = [
    {
      id: "mood",
      name: "Mood",
      type: METRIC_TYPES.NUMBER,
      grouping: "Wellbeing",
      activeFrom: "1970-01-01",
      activeUntil: ""
    }
  ];

  const result = upsertMetricDefinition(existing, {
    id: "mood",
    name: "Mood score",
    type: METRIC_TYPES.NUMBER,
    grouping: "Wellbeing",
    activeFrom: "2025-01-01"
  }, {
    previousId: "mood",
    today: "2025-02-10"
  });

  assert.equal(result.ok, true);
  const historical = selectMetricsForDate(result.definitions, "2025-02-09").find((item) => item.id === "mood");
  const current = selectMetricsForDate(result.definitions, "2025-02-10").find((item) => item.id === "mood");

  assert.equal(historical?.name, "Mood");
  assert.equal(current?.name, "Mood score");
});

test("deactivateMetricDefinition removes current and future visibility only", () => {
  const existing = [
    {
      id: "sleep",
      name: "Sleep hours",
      type: METRIC_TYPES.NUMBER,
      grouping: "Recovery",
      activeFrom: "2025-01-01",
      activeUntil: ""
    }
  ];

  const next = deactivateMetricDefinition(existing, "sleep", { today: "2025-02-10" });

  const past = selectMetricsForDate(next, "2025-02-09").some((item) => item.id === "sleep");
  const today = selectMetricsForDate(next, "2025-02-10").some((item) => item.id === "sleep");

  assert.equal(past, true);
  assert.equal(today, false);
});
