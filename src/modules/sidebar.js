import { MODULES_BY_MODE } from "./config.js";

/**
 * Renders the mode-specific sidebar.
 */
export function renderSidebar({ mode }) {
  const aside = document.createElement("aside");
  aside.className = "sidebar";

  const heading = document.createElement("h2");
  heading.className = "sidebar-heading";
  heading.textContent = mode === "work" ? "Work modules" : "Personal modules";

  const list = document.createElement("ul");
  list.className = "module-list";

  for (const moduleItem of MODULES_BY_MODE[mode]) {
    const row = document.createElement("li");
    row.className = "module-item";

    const icon = document.createElement("span");
    icon.className = "module-icon";
    icon.textContent = moduleItem.icon;
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "module-label";
    label.textContent = moduleItem.label;

    row.append(icon, label);
    list.appendChild(row);
  }

  aside.append(heading, list);
  return aside;
}
