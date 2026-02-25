import { buildPersonalStorageKey } from "./personal-keys.js";
import { generateId } from "./id.js";
import {
  METRIC_TYPES,
  coerceLegacyEntryValues,
  getMetricTypeLabel,
  loadPersonalMetricDefinitions,
  selectMetricsForDate
} from "./personal-metrics.js";

const PERSONAL_DAILY_LOG_KEY = buildPersonalStorageKey("daily-log", 1);

/**
 * Daily log module now resolves a date-scoped metric schema from settings so
 * users can evolve tracked fields without mutating historic records.
 */
export function renderPersonalDailyLogModule() {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Personal Daily Log";

  const intro = document.createElement("p");
  intro.className = "module-intro";
  intro.textContent =
    "Capture day-level wellbeing notes against configurable metrics. Metric definitions are managed in Settings → Metric settings.";

  const form = document.createElement("form");
  form.className = "meeting-form";

  const dateField = buildInput("Date", "date", true);
  dateField.input.value = new Date().toISOString().slice(0, 10);
  const dynamicFieldsHost = document.createElement("div");
  dynamicFieldsHost.className = "daily-log-dynamic-fields";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "enter-mode-button";
  save.textContent = "Save daily log";

  const list = document.createElement("div");

  form.append(dateField.wrap, dynamicFieldsHost, save);

  const fieldRegistry = new Map();

  function renderDynamicFields() {
    fieldRegistry.clear();
    dynamicFieldsHost.innerHTML = "";

    const definitions = loadPersonalMetricDefinitions();
    const activeMetrics = selectMetricsForDate(definitions, dateField.input.value);

    if (!activeMetrics.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No active metrics for this date. Add one in Settings → Metric settings.";
      dynamicFieldsHost.appendChild(empty);
      return;
    }

    const groups = new Map();
    activeMetrics.forEach((metric) => {
      if (!groups.has(metric.grouping)) {
        groups.set(metric.grouping, []);
      }
      groups.get(metric.grouping).push(metric);
    });

    groups.forEach((metrics, groupLabel) => {
      const group = document.createElement("fieldset");
      group.className = "daily-log-metric-group";

      const legend = document.createElement("legend");
      legend.textContent = groupLabel;
      group.appendChild(legend);

      metrics.forEach((metric) => {
        const field = buildMetricInput(metric);
        fieldRegistry.set(metric.id, { input: field.input, type: metric.type, metricName: metric.name });
        group.appendChild(field.wrap);
      });

      dynamicFieldsHost.appendChild(group);
    });
  }

  dateField.input.addEventListener("change", renderDynamicFields);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const entries = loadEntries();
    const values = {};

    fieldRegistry.forEach(({ input, type }, metricId) => {
      if (type === METRIC_TYPES.BOOLEAN) {
        values[metricId] = input.checked ? "true" : "false";
        return;
      }
      values[metricId] = input.value.trim();
    });

    const payload = {
      id: generateId("dlog_"),
      date: dateField.input.value,
      values,
      createdAt: new Date().toISOString()
    };

    entries.unshift(payload);
    persistEntries(entries);
    renderList();
    form.reset();
    dateField.input.value = new Date().toISOString().slice(0, 10);
    renderDynamicFields();
  });

  function renderList() {
    list.innerHTML = "";
    const entries = loadEntries();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No daily logs yet.";
      list.appendChild(empty);
      return;
    }

    const definitions = loadPersonalMetricDefinitions();

    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "project-card";

      const heading = document.createElement("h3");
      heading.textContent = entry.date;

      const metricsForDate = selectMetricsForDate(definitions, entry.date);
      const values = coerceLegacyEntryValues(entry);

      const details = document.createElement("div");
      details.className = "daily-log-entry-details";

      metricsForDate.forEach((metric) => {
        if (!(metric.id in values)) {
          return;
        }

        const line = document.createElement("p");
        const label = document.createElement("strong");
        label.textContent = `${metric.name}: `;
        line.appendChild(label);

        const metricValue = renderMetricValue(metric, values[metric.id]);
        line.appendChild(metricValue);
        details.appendChild(line);
      });

      if (!details.childElementCount) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No metric values recorded for active fields.";
        details.appendChild(empty);
      }

      card.append(heading, details);
      list.appendChild(card);
    });
  }

  section.append(title, intro, form, list);
  renderDynamicFields();
  renderList();
  return section;
}

function loadEntries() {
  const raw = localStorage.getItem(PERSONAL_DAILY_LOG_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistEntries(entries) {
  localStorage.setItem(PERSONAL_DAILY_LOG_KEY, JSON.stringify(entries));
}

/**
 * Renders an input control based on the configured metric type.
 */
function buildMetricInput(metric) {
  if (metric.type === METRIC_TYPES.BOOLEAN) {
    const wrap = document.createElement("label");
    wrap.className = "field-label checkbox-field";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "field-input";

    const text = document.createElement("span");
    text.textContent = `${metric.name} (${getMetricTypeLabel(metric.type)})`;

    wrap.append(input, text);
    return { wrap, input };
  }

  const type = metric.type === METRIC_TYPES.NUMBER ? "number" : "text";
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = `${metric.name} (${getMetricTypeLabel(metric.type)})`;

  const input = metric.type === METRIC_TYPES.TEXT
    ? document.createElement("textarea")
    : document.createElement("input");

  input.className = "field-input";
  if (metric.type === METRIC_TYPES.TEXT) {
    input.classList.add("field-textarea");
  } else {
    input.type = type;
  }

  wrap.appendChild(input);
  return { wrap, input };
}

function renderMetricValue(metric, rawValue) {
  if (metric.type === METRIC_TYPES.BOOLEAN) {
    const chip = document.createElement("span");
    chip.className = "personal-log-chip personal-log-chip-neutral";
    chip.textContent = String(rawValue) === "true" ? "Yes" : "No";
    return chip;
  }

  if (metric.id === "mood") {
    const moodLine = document.createElement("span");
    moodLine.appendChild(buildMoodChip(rawValue));
    return moodLine;
  }

  const text = document.createElement("span");
  text.textContent = rawValue || "-";
  return text;
}

/**
 * Builds a mood chip with semantic score band classes to keep visual mapping
 * consistent while leaving persisted values untouched.
 */
function buildMoodChip(rawMoodValue) {
  const numericMood = Number(rawMoodValue);
  const chip = document.createElement("span");
  chip.className = "personal-log-chip personal-log-chip-mood";

  if (!Number.isFinite(numericMood)) {
    chip.classList.add("personal-log-chip-neutral");
    chip.textContent = rawMoodValue || "-";
    return chip;
  }

  const { className, label } = getMoodBand(numericMood);
  chip.classList.add(className);
  chip.textContent = `${label} (${numericMood}/10)`;
  return chip;
}

/**
 * Maps numeric mood values into low/medium/high presentation bands.
 */
function getMoodBand(score) {
  if (score <= 3) {
    return { className: "personal-log-chip-mood-low", label: "Low" };
  }
  if (score <= 7) {
    return { className: "personal-log-chip-mood-medium", label: "Medium" };
  }
  return { className: "personal-log-chip-mood-high", label: "High" };
}

function buildInput(labelText, type, required) {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.className = "field-input";
  input.type = type;
  input.required = required;
  wrap.appendChild(input);
  return { wrap, input };
}
