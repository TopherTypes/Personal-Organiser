import { addIsoDateInterval } from "./projects-store.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const ACTIVE_HEALTH_STATUSES = new Set(["active", "planned"]);

/**
 * Computes deterministic project health/freshness values from cadence + task pressure.
 */
export function computeProjectHealth(project, tasksForProject = [], now = new Date()) {
  const nowDate = normaliseNowDate(now);
  const nowIso = toIsoDate(nowDate);
  const cadenceInterval = Math.max(1, Number.parseInt(String(project?.cadenceInterval ?? "1"), 10) || 1);
  const cadenceUnit = ["days", "weeks", "months"].includes(project?.cadenceUnit) ? project.cadenceUnit : "weeks";
  const lastProgressUpdate = normaliseIsoDate(project?.lastProgressUpdate || "");
  const openTasks = tasksForProject.filter((task) => !isTaskClosed(task));
  const overdueTasksCount = openTasks.filter((task) => Boolean(task.dueDate) && task.dueDate < nowIso).length;

  const reasonList = [];
  let nextExpectedUpdateDate = "";
  let daysSinceUpdate = null;
  let healthStatus = "healthy";

  if (!lastProgressUpdate) {
    if (ACTIVE_HEALTH_STATUSES.has(String(project?.status || "").toLowerCase())) {
      healthStatus = "at_risk";
      reasonList.push("No update recorded yet");
    }
  } else {
    nextExpectedUpdateDate = addIsoDateInterval(lastProgressUpdate, cadenceInterval, cadenceUnit);
    daysSinceUpdate = Math.max(0, diffInDays(nowDate, new Date(`${lastProgressUpdate}T00:00:00Z`)));

    if (nextExpectedUpdateDate) {
      const windowDays = Math.max(1, diffInDays(new Date(`${nextExpectedUpdateDate}T00:00:00Z`), new Date(`${lastProgressUpdate}T00:00:00Z`)));
      const elapsedDays = Math.max(0, diffInDays(nowDate, new Date(`${lastProgressUpdate}T00:00:00Z`)));
      const progressRatio = elapsedDays / windowDays;

      if (nowIso > nextExpectedUpdateDate) {
        healthStatus = "overdue";
        reasonList.push("Past cadence window");
      } else if (progressRatio >= 0.8) {
        healthStatus = "at_risk";
        reasonList.push("Cadence update window nearly due");
      }
    }
  }

  if (overdueTasksCount > 0) {
    reasonList.push(`${overdueTasksCount} overdue ${overdueTasksCount === 1 ? "task" : "tasks"}`);
    if (healthStatus !== "overdue") {
      healthStatus = "at_risk";
    }
  }

  return {
    healthStatus,
    daysSinceUpdate,
    nextExpectedUpdateDate,
    reasonList,
    overdueTasksCount,
    openTasksCount: openTasks.length,
    highPriorityCount: openTasks.filter((task) => Number(task.impact || 0) >= 8 || Number(task.effort || 0) >= 8).length,
    blockedTasksCount: openTasks.filter((task) => hasBlockedDependencies(task)).length
  };
}

export function formatFreshnessLine(health) {
  if (!health.nextExpectedUpdateDate) {
    return health.daysSinceUpdate === null ? "No progress update recorded" : `Updated ${health.daysSinceUpdate} days ago`;
  }

  const deltaDays = diffInDays(new Date(`${health.nextExpectedUpdateDate}T00:00:00Z`), new Date());
  if (deltaDays < 0) {
    return `Overdue by ${Math.abs(deltaDays)} ${Math.abs(deltaDays) === 1 ? "day" : "days"}`;
  }
  if (deltaDays === 0) {
    return "Update due today";
  }
  return `Update due in ${deltaDays} ${deltaDays === 1 ? "day" : "days"}`;
}

function hasBlockedDependencies(task) {
  return Array.isArray(task?.blockedByTaskIds) && task.blockedByTaskIds.length > 0;
}

function isTaskClosed(task) {
  const status = String(task?.status || "").toLowerCase();
  return task?.archived || status === "done" || status === "cancelled";
}

function normaliseNowDate(now) {
  const candidate = now instanceof Date ? now : new Date(now);
  return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
}

function normaliseIsoDate(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return toIsoDate(parsed);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function diffInDays(later, earlier) {
  return Math.floor((Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate()) - Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate())) / MS_PER_DAY);
}
