/**
 * Navigation module configuration aligned to docs/SPECS.md section 5.
 *
 * Icons use emojis to keep the baseline dependency-free.
 */
export const MODULES_BY_MODE = {
  work: [
    { key: "dashboard", label: "Dashboard", icon: "🏠" },
    { key: "tasks", label: "Tasks", icon: "✅" },
    { key: "projects", label: "Projects", icon: "📁" },
    { key: "sprints", label: "Sprints", icon: "🏁" },
    { key: "meetings", label: "Meetings", icon: "🗓️" },
    { key: "people", label: "People", icon: "👥" },
    { key: "updates", label: "Updates", icon: "📝" },
    { key: "notes", label: "Notes", icon: "📒" }
  ],
  personal: [
    { key: "dashboard", label: "Dashboard", icon: "🏠" },
    { key: "tasks", label: "Tasks", icon: "✅" },
    { key: "projects", label: "Projects / Timeboxing", icon: "⏱️" },
    { key: "daily-log", label: "Daily Log", icon: "📔" },
    { key: "exercise-log", label: "Exercise Log", icon: "🏃" },
    { key: "people", label: "People", icon: "👥" },
    { key: "calendar", label: "Calendar", icon: "📆" },
    { key: "notes", label: "Notes", icon: "📒" }
  ]
};
