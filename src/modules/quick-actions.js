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

  // Menu remains collapsed by default so the floating affordance stays unobtrusive
  // until the user explicitly asks for quick-create shortcuts.
  let isMenuOpen = false;

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "quick-actions-trigger";
  launcher.textContent = "+";
  launcher.setAttribute("aria-label", "Expand quick create actions");
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
    const icon = document.createElement("span");
    icon.className = "quick-actions-item-icon";
    icon.textContent = action.icon;

    const body = document.createElement("span");
    body.className = "quick-actions-item-body";

    const label = document.createElement("span");
    label.className = "quick-actions-item-label";
    label.textContent = action.label;

    const hint = document.createElement("span");
    hint.className = "quick-actions-item-hint";
    hint.textContent = action.hint;

    body.append(label, hint);
    item.append(icon, body);
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
    container.classList.add("quick-actions-expanded");
    menu.hidden = false;
    launcher.textContent = "×";
    launcher.setAttribute("aria-label", "Collapse quick create actions");
    launcher.setAttribute("aria-expanded", "true");
    menuItems[0]?.focus();
  }

  function closeMenu({ returnFocus = true } = {}) {
    isMenuOpen = false;
    container.classList.remove("quick-actions-expanded");
    menu.hidden = true;
    launcher.textContent = "+";
    launcher.setAttribute("aria-label", "Expand quick create actions");
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
      { label: "New task", icon: "✓", hint: "Capture a personal to-do", moduleKey: "tasks", createIntent: "task", ariaLabel: "Create a new work task" },
      { label: "New project", icon: "◫", hint: "Start a scoped initiative", moduleKey: "projects", createIntent: "project", ariaLabel: "Create a new work project" },
      { label: "New meeting", icon: "◷", hint: "Schedule and prep an agenda", moduleKey: "meetings", createIntent: "meeting", ariaLabel: "Create a new work meeting" },
      { label: "New update", icon: "↗", hint: "Log progress for stakeholders", moduleKey: "updates", createIntent: "update", ariaLabel: "Create a new work update" },
      { label: "New note", icon: "✎", hint: "Write down context fast", moduleKey: "notes", createIntent: "note", ariaLabel: "Create a new work note" }
    ];
  }

  return [
    { label: "New task", icon: "✓", hint: "Capture something to do", moduleKey: "tasks", createIntent: "task", ariaLabel: "Create a new personal task" },
    { label: "New project", icon: "◫", hint: "Track a goal or plan", moduleKey: "projects", createIntent: "project", ariaLabel: "Create a new personal project" },
    {
      label: "New calendar event",
      icon: "◷",
      hint: "Block time with context",
      moduleKey: "calendar",
      createIntent: "calendar-event",
      ariaLabel: "Create a new personal calendar event"
    },
    { label: "New note", icon: "✎", hint: "Capture an idea quickly", moduleKey: "notes", createIntent: "note", ariaLabel: "Create a new personal note" }
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
