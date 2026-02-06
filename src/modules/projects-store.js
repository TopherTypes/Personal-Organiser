export const PROJECT_STORAGE_KEY = "second-brain.work.projects.work";
export const PROJECT_SCHEMA_VERSION = 1;

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
  if (mode !== "work") {
    return [];
  }

  const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(normaliseProject);
    }

    if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.projects)) {
      return parsed.projects.map(normaliseProject);
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Persists projects in a versioned envelope for safe schema growth.
 */
export function persistProjects(mode = "work", projects = []) {
  if (mode !== "work") {
    return;
  }

  localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, projects })
  );
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

  if (editingId) {
    const index = projects.findIndex((project) => project.id === editingId);
    if (index < 0) {
      return { ok: false, error: "Project no longer exists." };
    }

    const existing = projects[index];
    projects[index] = {
      ...existing,
      ...payload,
      updatedAt: now,
      lastUpdatedByField: {
        ...existing.lastUpdatedByField,
        title: now,
        description: now,
        startDate: now,
        targetDate: now,
        status: now
      }
    };

    persistProjects(mode, projects);
    return { ok: true, wasEdit: true, project: projects[index] };
  }

  const nextProject = normaliseProject({
    id: buildProjectId(),
    ...payload,
    peopleLinks: [],
    createdAt: now,
    updatedAt: now,
    lastUpdatedByField: {
      title: now,
      description: now,
      startDate: now,
      targetDate: now,
      status: now,
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

function buildProjectId() {
  return `project_${Math.random().toString(36).slice(2, 10)}`;
}
