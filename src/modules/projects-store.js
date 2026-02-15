import { loadVersionedCollection, persistVersionedCollection } from "./storage-core.js";
import { generateId } from "./id.js";

export const PROJECT_STORAGE_KEY = "second-brain.work.projects.work";
const PERSONAL_PROJECT_STORAGE_KEY = "second-brain.personal.projects.personal";
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_CADENCE_UNITS = ["days", "weeks", "months"];
const DEFAULT_CADENCE_INTERVAL = 1;
const DEFAULT_CADENCE_UNIT = "weeks";

/**
 * Enumerated person roles used when linking people to a project.
 */
export const PROJECT_PERSON_ROLES = [
  "stakeholder",
  "SME",
  "governance",
  "assurance",
  "approval"
];

/**
 * Loads projects from localStorage and normalises to a safe shape.
 */
export function loadProjects(mode = "work") {
  const storageKey = resolveProjectStorageKey(mode);
  if (!storageKey) {
    return [];
  }

  return loadVersionedCollection({
    storageKey,
    collectionKey: "projects",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    normaliseItem: normaliseProject,
    fallback: []
  });
}

/**
 * Persists projects in a versioned envelope for safe schema growth.
 */
export function persistProjects(mode = "work", projects = []) {
  const storageKey = resolveProjectStorageKey(mode);
  if (!storageKey) {
    return;
  }

  persistVersionedCollection({
    storageKey,
    collectionKey: "projects",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    records: projects
  });
}

/**
 * Creates or updates a project and enforces required fields.
 */
export function saveProject(mode = "work", payload, editingId = "") {
  if (!payload.title) {
    return { ok: false, error: "Project title is required." };
  }
  if (!payload.status) {
    return { ok: false, error: "Project status is required." };
  }

  const projects = loadProjects(mode);
  const now = new Date().toISOString();
  const cadenceFields = normaliseProjectCadenceFields(payload);

  if (editingId) {
    const index = projects.findIndex((project) => project.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Project no longer exists." };
    }

    const existing = projects[index];
    projects[index] = {
      ...existing,
      ...payload,
      ...cadenceFields,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        title: now,
        description: now,
        startDate: now,
        targetDate: now,
        status: now,
        lastProgressUpdate: now,
        cadenceInterval: now,
        cadenceUnit: now
      }
    };

    persistProjects(mode, projects);
    return { ok: true, wasEdit: true, project: projects[index] };
  }

  const nextProject = normaliseProject({
    id: buildProjectId(),
    ...payload,
    ...cadenceFields,
    peopleLinks: [],
    createdAt: now,
    updatedAt: now,
    lastUpdatedByField: {
      title: now,
      description: now,
      startDate: now,
      targetDate: now,
      status: now,
      lastProgressUpdate: now,
      cadenceInterval: now,
      cadenceUnit: now,
      peopleLinks: now
    }
  });

  projects.push(nextProject);
  persistProjects(mode, projects);
  return { ok: true, wasEdit: false, project: nextProject };
}

/**
 * Deletes a project and returns its removed entity for downstream unlinking.
 */
export function deleteProject(mode = "work", projectId) {
  const projects = loadProjects(mode);
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return { ok: false, error: "Project no longer exists." };
  }

  const [removed] = projects.splice(index, 1);
  persistProjects(mode, projects);
  return { ok: true, removed };
}

/**
 * Upserts person roles for a project while preserving existing links.
 */
export function upsertProjectPersonLink(mode = "work", projectId, personId, roles) {
  const projects = loadProjects(mode);
  const now = new Date().toISOString();

  /**
   * Merge strategy: replace only the target person's link, preserve all other links,
   * and remove the link entirely when no roles remain.
   */
  const updated = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const sanitizedRoles = Array.from(new Set(roles.filter(Boolean)));
    const withoutPerson = project.peopleLinks.filter((entry) => entry.personId !== personId);
    const nextLinks = sanitizedRoles.length
      ? [...withoutPerson, { personId, roles: sanitizedRoles }]
      : withoutPerson;

    return {
      ...project,
      peopleLinks: nextLinks,
      updatedAt: now,
      lastUpdatedByField: {
        ...project.lastUpdatedByField,
        peopleLinks: now
      }
    };
  });

  persistProjects(mode, updated);
}

/**
 * Returns project links for a person to support person-edit UX.
 */
export function loadPersonProjectLinks(mode = "work", personId) {
  return loadProjects(mode)
    .map((project) => {
      const link = project.peopleLinks.find((entry) => entry.personId === personId);
      return link ? { projectId: project.id, roles: link.roles } : null;
    })
    .filter(Boolean);
}



/**
 * Resolves the versioned storage key for a supported mode.
 */
function resolveProjectStorageKey(mode) {
  if (mode === "work") {
    return PROJECT_STORAGE_KEY;
  }

  if (mode === "personal") {
    return PERSONAL_PROJECT_STORAGE_KEY;
  }

  return "";
}

function normaliseProjectCadenceFields(project) {
  return {
    lastProgressUpdate: normaliseDateString(project?.lastProgressUpdate),
    cadenceInterval: normaliseCadenceInterval(project?.cadenceInterval),
    cadenceUnit: normaliseCadenceUnit(project?.cadenceUnit)
  };
}

function normaliseCadenceInterval(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CADENCE_INTERVAL;
}

function normaliseCadenceUnit(value) {
  return PROJECT_CADENCE_UNITS.includes(value) ? value : DEFAULT_CADENCE_UNIT;
}

/**
 * Adds defensive defaults so old records remain compatible.
 */
export function normaliseProject(project) {
  return {
    id: project.id || buildProjectId(),
    title: project.title || "",
    description: project.description || "",
    startDate: project.startDate || "",
    targetDate: project.targetDate || "",
    status: project.status || "planned",
    ...normaliseProjectCadenceFields(project),
    peopleLinks: Array.isArray(project.peopleLinks)
      ? project.peopleLinks
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => ({
            personId: entry.personId || "",
            roles: Array.isArray(entry.roles) ? entry.roles.filter(Boolean) : []
          }))
      : [],
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    lastUpdatedByField:
      typeof project.lastUpdatedByField === "object" && project.lastUpdatedByField !== null
        ? project.lastUpdatedByField
        : {}
  };
}

/**
 * Computes the next expected progress update date from cadence metadata.
 */
export function deriveNextExpectedUpdateDate(project) {
  const baselineDate = normaliseDateString(project?.lastProgressUpdate);
  if (!baselineDate) {
    return "";
  }

  return addIsoDateInterval(
    baselineDate,
    normaliseCadenceInterval(project?.cadenceInterval),
    normaliseCadenceUnit(project?.cadenceUnit)
  );
}

/**
 * Adds day/week/month cadence intervals while preserving ISO date precision.
 */
export function addIsoDateInterval(isoDate, interval, unit) {
  const start = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    return "";
  }

  const next = new Date(start);
  if (unit === "months") {
    next.setUTCMonth(next.getUTCMonth() + interval);
  } else {
    const unitDays = unit === "weeks" ? 7 : 1;
    next.setUTCDate(next.getUTCDate() + interval * unitDays);
  }

  return next.toISOString().slice(0, 10);
}

function normaliseDateString(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  // Accept either ISO date-only values or full timestamp strings.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function buildProjectId() {
  return generateId("project_");
}
