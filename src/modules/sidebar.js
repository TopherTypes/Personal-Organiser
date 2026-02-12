import { MODULES_BY_MODE } from "./config.js";

/**
 * Renders the mode-specific sidebar.
 *
 * On small screens this component exposes a built-in toggle button so module
 * navigation can collapse into a drawer-like panel without losing access.
 */
export function renderSidebar({ mode, activeModule = "dashboard", onModuleSelect }) {
  const aside = document.createElement("aside");
  aside.className = "sidebar";

  const header = document.createElement("div");
  header.className = "sidebar-header";

  const heading = document.createElement("h2");
  heading.className = "sidebar-heading";
  heading.textContent = mode === "work" ? "Work modules" : "Personal modules";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sidebar-toggle button button-secondary";
  toggle.textContent = "Modules";
  toggle.setAttribute("aria-expanded", "true");

  const list = document.createElement("ul");
  list.className = "module-list";
  list.id = `module-list-${mode}`;

  toggle.setAttribute("aria-controls", list.id);

  // Keep the toggle's visual state and ARIA state in sync for accessibility.
  toggle.addEventListener("click", () => {
    const isCollapsed = aside.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
  });

  header.append(heading, toggle);

  for (const moduleItem of MODULES_BY_MODE[mode]) {
    const row = document.createElement("li");
    row.className = "module-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "module-button";
    button.setAttribute("aria-pressed", String(activeModule === moduleItem.key));
    button.setAttribute("aria-label", moduleItem.label);

    if (activeModule === moduleItem.key) {
      row.classList.add("active");
    }

    const icon = document.createElement("span");
    icon.className = "module-icon";
    icon.textContent = moduleItem.icon;
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "module-label";
    label.textContent = moduleItem.label;

    button.append(icon, label);
    button.addEventListener("click", () => {
      onModuleSelect(moduleItem.key);
    });

    row.appendChild(button);
    list.appendChild(row);
  }

  aside.append(header, list);
  return aside;
}
