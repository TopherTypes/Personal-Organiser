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
  aside.setAttribute("aria-label", mode === "work" ? "Work module navigation" : "Personal module navigation");

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
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-orientation", "vertical");

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
    row.setAttribute("role", "presentation");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "module-button";
    button.dataset.moduleKey = moduleItem.key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(activeModule === moduleItem.key));
    button.setAttribute("aria-current", activeModule === moduleItem.key ? "page" : "false");
    button.tabIndex = activeModule === moduleItem.key ? 0 : -1;
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

  wireModuleListKeyboard(list, onModuleSelect);

  aside.append(header, list);
  return aside;
}

/**
 * Implements roving tabindex + arrow navigation for module tabs so keyboard
 * users can move through module destinations without tabbing each entry.
 */
function wireModuleListKeyboard(list, onModuleSelect) {
  const tabs = Array.from(list.querySelectorAll(".module-button"));
  if (!tabs.length) {
    return;
  }

  const focusTabAt = (index) => {
    tabs.forEach((tab, tabIndex) => {
      tab.tabIndex = tabIndex === index ? 0 : -1;
    });
    tabs[index].focus();
  };

  list.addEventListener("keydown", (event) => {
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0) {
      return;
    }

    if (["ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % tabs.length;
      focusTabAt(nextIndex);
      onModuleSelect(tabs[nextIndex].dataset.moduleKey);
      return;
    }

    if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      const previousIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      focusTabAt(previousIndex);
      onModuleSelect(tabs[previousIndex].dataset.moduleKey);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusTabAt(0);
      onModuleSelect(tabs[0].dataset.moduleKey);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusTabAt(tabs.length - 1);
      onModuleSelect(tabs[tabs.length - 1].dataset.moduleKey);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onModuleSelect(tabs[currentIndex].dataset.moduleKey);
    }
  });
}
