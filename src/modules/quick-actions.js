/**
 * Renders a global floating quick-action launcher that can trigger cross-module create flows.
 *
 * Accessibility behavior included here:
 * - Trigger button advertises expanded/collapsed state via ARIA.
 * - Expanded menu uses `role="menu"` / `role="menuitem"` semantics.
 * - Escape closes the menu and returns focus to the launcher.
 * - Tabbing is trapped within the menu while it is expanded.
 */
export function renderQuickActions({
  activeMode = "work",
  enabled = false,
  onTriggerAction = () => {}
} = {}) {
  const container = document.createElement("div");
  container.className = "quick-actions";

  // Keep the control mounted but hidden when mode-specific modules are not accessible yet.
  if (!enabled) {
    container.hidden = true;
    return container;
  }

  const quickActions = buildQuickActionConfig(activeMode);
  const menuId = `quick-actions-menu-${activeMode}`;

  let isMenuOpen = false;

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "quick-actions-trigger";
  launcher.textContent = "+";
  launcher.setAttribute("aria-label", "Open quick create actions");
  launcher.setAttribute("aria-haspopup", "menu");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", menuId);

  const menu = document.createElement("div");
  menu.className = "quick-actions-menu";
  menu.id = menuId;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${activeMode === "work" ? "Work" : "Personal"} quick create actions`);
  menu.hidden = true;

  const menuItems = quickActions.map((action, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "quick-actions-item";
    item.setAttribute("role", "menuitem");
    item.textContent = action.label;
    item.setAttribute("aria-label", action.ariaLabel || action.label);

    item.addEventListener("click", () => {
      onTriggerAction(action);
      closeMenu();
    });

    // Arrow-key roving improves keyboard ergonomics inside dense action lists.
    item.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        menuItems[(index + 1) % menuItems.length].focus();
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        menuItems[(index - 1 + menuItems.length) % menuItems.length].focus();
      }
    });

    return item;
  });

  menu.append(...menuItems);

  launcher.addEventListener("click", () => {
    if (isMenuOpen) {
      closeMenu();
      return;
    }
    openMenu();
  });

  // Keep Escape behavior local to this control so it does not interfere with module dialogs.
  container.addEventListener("keydown", (event) => {
    if (!isMenuOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === "Tab") {
      trapTabInsideMenu(event, menuItems);
    }
  });

  // Blur-close keeps lifecycle self-contained and avoids leaking global listeners on rerenders.
  container.addEventListener("focusout", () => {
    if (!isMenuOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!container.contains(document.activeElement)) {
        closeMenu({ returnFocus: false });
      }
    });
  });

  container.append(launcher, menu);
  return container;

  function openMenu() {
    isMenuOpen = true;
    menu.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    menuItems[0]?.focus();
  }

  function closeMenu({ returnFocus = true } = {}) {
    isMenuOpen = false;
    menu.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      launcher.focus();
    }
  }
}

/**
 * Returns mode-specific create actions to avoid exposing unsupported module/entity combinations.
 */
function buildQuickActionConfig(mode) {
  if (mode === "work") {
    return [
      { label: "New task", moduleKey: "tasks", createIntent: "task", ariaLabel: "Create a new work task" },
      { label: "New project", moduleKey: "projects", createIntent: "project", ariaLabel: "Create a new work project" },
      { label: "New meeting", moduleKey: "meetings", createIntent: "meeting", ariaLabel: "Create a new work meeting" },
      { label: "New update", moduleKey: "updates", createIntent: "update", ariaLabel: "Create a new work update" },
      { label: "New note", moduleKey: "notes", createIntent: "note", ariaLabel: "Create a new work note" }
    ];
  }

  return [
    { label: "New task", moduleKey: "tasks", createIntent: "task", ariaLabel: "Create a new personal task" },
    { label: "New project", moduleKey: "projects", createIntent: "project", ariaLabel: "Create a new personal project" },
    {
      label: "New calendar event",
      moduleKey: "calendar",
      createIntent: "calendar-event",
      ariaLabel: "Create a new personal calendar event"
    },
    { label: "New note", moduleKey: "notes", createIntent: "note", ariaLabel: "Create a new personal note" }
  ];
}

/**
 * Traps Tab focus in the menu to satisfy keyboard-only navigation requirements for transient popups.
 */
function trapTabInsideMenu(event, focusableItems) {
  if (!focusableItems.length) {
    return;
  }

  const currentIndex = focusableItems.findIndex((item) => item === document.activeElement);
  const safeCurrentIndex = currentIndex === -1 ? 0 : currentIndex;

  if (event.shiftKey) {
    if (safeCurrentIndex === 0) {
      event.preventDefault();
      focusableItems[focusableItems.length - 1].focus();
    }
    return;
  }

  if (safeCurrentIndex === focusableItems.length - 1) {
    event.preventDefault();
    focusableItems[0].focus();
  }
}
