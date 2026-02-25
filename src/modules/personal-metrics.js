import { buildPersonalStorageKey } from "./personal-keys.js";

export const PERSONAL_METRIC_SETTINGS_KEY = buildPersonalStorageKey("metric-settings", 1);

export const METRIC_TYPES = Object.freeze({
  TEXT: "text",
  NUMBER: "number",
  BOOLEAN: "boolean"
});

const METRIC_TYPE_LABELS = Object.freeze({
  [METRIC_TYPES.TEXT]: "Text",
  [METRIC_TYPES.NUMBER]: "Number",
  [METRIC_TYPES.BOOLEAN]: "Yes / No"
});

/**
 * Default metrics preserve the current daily log schema while enabling future
 * customisation from the metric settings tab.
 */
const DEFAULT_METRIC_DEFINITIONS = Object.freeze([
  {
    id: "nutrition",
    name: "Nutrition summary",
    type: METRIC_TYPES.TEXT,
    grouping: "Wellbeing",
    activeFrom: "1970-01-01",
    activeUntil: ""
  },
  {
    id: "exercise",
    name: "Exercise summary",
    type: METRIC_TYPES.TEXT,
    grouping: "Wellbeing",
    activeFrom: "1970-01-01",
    activeUntil: ""
  },
  {
    id: "mood",
    name: "Mood",
    type: METRIC_TYPES.NUMBER,
    grouping: "Wellbeing",
    activeFrom: "1970-01-01",
    activeUntil: ""
  }
]);

/**
 * Reads metric definitions from storage and guarantees a valid list.
 */
export function loadPersonalMetricDefinitions() {
  const raw = localStorage.getItem(PERSONAL_METRIC_SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_METRIC_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_METRIC_DEFINITIONS.map((definition) => ({ ...definition }));
    }

    const safeDefinitions = parsed
      .map(sanitiseMetricDefinition)
      .filter((definition) => Boolean(definition.id) && Boolean(definition.name));

    return safeDefinitions.length
      ? safeDefinitions
      : DEFAULT_METRIC_DEFINITIONS.map((definition) => ({ ...definition }));
  } catch {
    return DEFAULT_METRIC_DEFINITIONS.map((definition) => ({ ...definition }));
  }
}

/**
 * Persists metric definitions after sanitisation.
 */
export function savePersonalMetricDefinitions(definitions) {
  const safeDefinitions = Array.isArray(definitions)
    ? definitions.map(sanitiseMetricDefinition)
    : [];
  localStorage.setItem(PERSONAL_METRIC_SETTINGS_KEY, JSON.stringify(safeDefinitions));
  return safeDefinitions;
}

/**
 * Returns metrics that are active for a specific date.
 */
export function selectMetricsForDate(definitions, date) {
  const targetDate = normaliseIsoDate(date);
  return definitions
    .filter((definition) => {
      const startsOnOrBefore = definition.activeFrom <= targetDate;
      const isNotEnded = !definition.activeUntil || definition.activeUntil >= targetDate;
      return startsOnOrBefore && isNotEnded;
    })
    .sort((first, second) => {
      if (first.grouping !== second.grouping) {
        return first.grouping.localeCompare(second.grouping);
      }
      return first.name.localeCompare(second.name);
    });
}

/**
 * Creates or versions a metric definition. Existing records are closed one day
 * before the new effective date so history remains immutable.
 */
export function upsertMetricDefinition(definitions, draft, { today = isoDateToday(), previousId = "" } = {}) {
  const safeDefinitions = definitions.map((definition) => ({ ...definition }));
  const effectiveDate = normaliseIsoDate(draft.activeFrom || today);
  const boundedEffectiveDate = effectiveDate < today ? today : effectiveDate;
  const nextId = String(draft.id || "").trim();

  if (!nextId) {
    return { ok: false, error: "Metric ID is required." };
  }

  const versionTargetId = previousId || nextId;
  const conflictingId = safeDefinitions.some((definition) => {
    if (definition.id !== nextId) {
      return false;
    }

    if (previousId && previousId === nextId) {
      return false;
    }

    const definitionStartsAfterEffectiveDate = definition.activeFrom > boundedEffectiveDate;
    const definitionEndedBeforeEffectiveDate = definition.activeUntil && definition.activeUntil < boundedEffectiveDate;
    return !(definitionStartsAfterEffectiveDate || definitionEndedBeforeEffectiveDate);
  });

  if (conflictingId) {
    return { ok: false, error: "Metric ID overlaps with an active metric version." };
  }

  const closedDefinitions = safeDefinitions.map((definition) => {
    if (definition.id !== versionTargetId) {
      return definition;
    }

    if (definition.activeFrom > boundedEffectiveDate) {
      return definition;
    }

    if (definition.activeUntil && definition.activeUntil < boundedEffectiveDate) {
      return definition;
    }

    return {
      ...definition,
      activeUntil: isoDateOffset(boundedEffectiveDate, -1)
    };
  });

  closedDefinitions.push(
    sanitiseMetricDefinition({
      id: nextId,
      name: draft.name,
      type: draft.type,
      grouping: draft.grouping,
      activeFrom: boundedEffectiveDate,
      activeUntil: ""
    })
  );

  return { ok: true, definitions: closedDefinitions };
}

/**
 * Deactivates all current/future versions for a metric id.
 */
export function deactivateMetricDefinition(definitions, metricId, { today = isoDateToday() } = {}) {
  const safeMetricId = String(metricId || "").trim();
  if (!safeMetricId) {
    return definitions.map((definition) => ({ ...definition }));
  }

  return definitions.map((definition) => {
    if (definition.id !== safeMetricId) {
      return definition;
    }

    if (definition.activeUntil && definition.activeUntil < today) {
      return definition;
    }

    if (definition.activeFrom > today) {
      return {
        ...definition,
        activeUntil: isoDateOffset(definition.activeFrom, -1)
      };
    }

    return {
      ...definition,
      activeUntil: isoDateOffset(today, -1)
    };
  });
}

/**
 * Reads all unique group labels from stored metric definitions.
 */
export function listMetricGroups(definitions) {
  return Array.from(
    new Set(
      definitions
        .map((definition) => String(definition.grouping || "").trim())
        .filter(Boolean)
    )
  ).sort((first, second) => first.localeCompare(second));
}

export function getMetricTypeLabel(type) {
  return METRIC_TYPE_LABELS[type] || METRIC_TYPE_LABELS[METRIC_TYPES.TEXT];
}

/**
 * Backward-compatible projection from legacy daily-log fields to the new
 * metric-values shape used by configurable metrics.
 */
export function coerceLegacyEntryValues(entry) {
  if (entry?.values && typeof entry.values === "object" && entry.values !== null) {
    return entry.values;
  }

  return {
    nutrition: entry?.nutrition || "",
    exercise: entry?.exercise || "",
    mood: entry?.mood || ""
  };
}

function sanitiseMetricDefinition(definition) {
  return {
    id: String(definition?.id || "").trim(),
    name: String(definition?.name || "").trim(),
    type: [METRIC_TYPES.TEXT, METRIC_TYPES.NUMBER, METRIC_TYPES.BOOLEAN].includes(definition?.type)
      ? definition.type
      : METRIC_TYPES.TEXT,
    grouping: String(definition?.grouping || "General").trim() || "General",
    activeFrom: normaliseIsoDate(definition?.activeFrom || isoDateToday()),
    activeUntil: definition?.activeUntil ? normaliseIsoDate(definition.activeUntil) : ""
  };
}

function normaliseIsoDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return isoDateToday();
  }
  return String(value);
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateOffset(isoDate, daysOffset) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return date.toISOString().slice(0, 10);
}
