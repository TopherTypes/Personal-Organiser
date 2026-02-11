/**
 * Hydrates a <select> element from canonical entity-backed options.
 * Centralising this avoids ad-hoc option rendering drift across modules.
 */
export function hydrateSelectOptions(select, options = []) {
  select.innerHTML = "";
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    select.appendChild(option);
  }
}

/**
 * Creates a standard empty-state helper for select-driven controls.
 * Reusing this keeps fallback copy predictable and accessible.
 */
export function createSelectEmptyState(message) {
  const note = document.createElement("small");
  note.className = "module-intro";
  note.textContent = message;
  return note;
}

/**
 * Builds a labelled single-select field with optional empty-state messaging.
 */
export function buildSingleSelectField({
  label,
  className = "field-label",
  options = [],
  value = "",
  emptyMessage = "",
  disabledWhenEmpty = true
}) {
  const wrapper = document.createElement("label");
  wrapper.className = className;
  wrapper.textContent = label;

  const select = document.createElement("select");
  select.className = "field-input";
  hydrateSelectOptions(select, options);

  if (options.some((entry) => entry.value === value)) {
    select.value = value;
  }

  if (options.length === 0 && disabledWhenEmpty) {
    select.disabled = true;
  }

  wrapper.appendChild(select);

  if (emptyMessage && options.length === 0) {
    wrapper.appendChild(createSelectEmptyState(emptyMessage));
  }

  return { wrapper, select };
}

/**
 * Builds a labelled multi-select field with optional empty-state messaging.
 */
export function buildMultiSelectField({
  label,
  className = "field-label",
  options = [],
  values = [],
  size = 6,
  emptyMessage = "",
  disabledWhenEmpty = true
}) {
  const wrapper = document.createElement("label");
  wrapper.className = className;
  wrapper.textContent = label;

  const select = document.createElement("select");
  select.className = "field-input";
  select.multiple = true;
  select.size = Math.max(3, Math.min(size, options.length || 3));
  hydrateSelectOptions(select, options);

  const selected = new Set(values.map((value) => String(value)));
  for (const option of Array.from(select.options)) {
    option.selected = selected.has(option.value);
  }

  if (options.length === 0 && disabledWhenEmpty) {
    select.disabled = true;
  }

  wrapper.appendChild(select);

  if (emptyMessage && options.length === 0) {
    wrapper.appendChild(createSelectEmptyState(emptyMessage));
  }

  return { wrapper, select };
}

/**
 * Reads selected values from <select multiple> controls as unique non-empty IDs.
 */
export function readSelectedValues(select) {
  return [...new Set(Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean))];
}

/**
 * Builds a token/chip multi-select for canonical entities (for example, people).
 *
 * Compared with native <select multiple>, this pattern keeps entity discovery fast
 * for long person lists and surfaces active selections as removable chips.
 */
export function buildEntityTokenMultiSelectField({
  label,
  className = "field-label",
  options = [],
  values = [],
  emptyMessage = "",
  disabledWhenEmpty = true,
  inputPlaceholder = "Search and add"
}) {
  const wrapper = document.createElement("label");
  wrapper.className = className;
  wrapper.textContent = label;

  const container = document.createElement("div");
  container.className = "field-input";

  const tokenList = document.createElement("div");
  tokenList.className = "token-multi-select-list";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "field-input";
  input.placeholder = inputPlaceholder;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const listId = `entity-token-list-${Math.random().toString(36).slice(2, 10)}`;
  input.setAttribute("aria-controls", listId);

  const suggestions = document.createElement("ul");
  suggestions.id = listId;
  suggestions.className = "token-multi-select-suggestions";
  suggestions.setAttribute("role", "listbox");

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";

  const canonical = options.map((option) => ({
    value: String(option.value || ""),
    label: option.label || option.value || ""
  })).filter((option) => option.value);

  const selectedIds = [];
  let highlightedIndex = -1;

  const syncHiddenInput = () => {
    hiddenInput.value = selectedIds.join(",");
    hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const emitFieldInput = () => {
    wrapper.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const removeSelectedId = (id) => {
    const index = selectedIds.indexOf(id);
    if (index === -1) {
      return;
    }
    selectedIds.splice(index, 1);
    renderTokens();
    renderSuggestions();
    syncHiddenInput();
    emitFieldInput();
  };

  const addSelectedId = (id) => {
    const candidate = canonical.find((option) => option.value === id);
    if (!candidate || selectedIds.includes(id)) {
      return;
    }
    selectedIds.push(id);
    input.value = "";
    highlightedIndex = -1;
    renderTokens();
    renderSuggestions();
    syncHiddenInput();
    emitFieldInput();
  };

  const renderTokens = () => {
    tokenList.innerHTML = "";
    selectedIds.forEach((id) => {
      const option = canonical.find((entry) => entry.value === id);
      if (!option) {
        return;
      }

      const token = document.createElement("span");
      token.className = "entity-token";
      token.textContent = option.label;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "module-button-secondary";
      removeButton.textContent = "Remove";
      removeButton.setAttribute("aria-label", `Remove ${option.label}`);
      removeButton.addEventListener("click", () => removeSelectedId(id));

      token.appendChild(removeButton);
      tokenList.appendChild(token);
    });
  };

  const getVisibleSuggestions = () => {
    const filterText = input.value.trim().toLowerCase();
    return canonical.filter((option) => {
      if (selectedIds.includes(option.value)) {
        return false;
      }
      if (!filterText) {
        return true;
      }
      return option.label.toLowerCase().includes(filterText);
    });
  };

  const renderSuggestions = () => {
    const visibleSuggestions = getVisibleSuggestions();
    suggestions.innerHTML = "";

    if (!visibleSuggestions.length) {
      highlightedIndex = -1;
      input.setAttribute("aria-activedescendant", "");
      input.setAttribute("aria-expanded", "false");
      return;
    }

    if (highlightedIndex >= visibleSuggestions.length) {
      highlightedIndex = visibleSuggestions.length - 1;
    }

    visibleSuggestions.forEach((option, index) => {
      const optionEl = document.createElement("li");
      optionEl.className = "token-multi-select-option";
      optionEl.textContent = option.label;
      optionEl.setAttribute("role", "option");
      optionEl.dataset.value = option.value;
      optionEl.id = `${listId}-option-${index}`;

      const isHighlighted = index === highlightedIndex;
      optionEl.setAttribute("aria-selected", isHighlighted ? "true" : "false");
      if (isHighlighted) {
        optionEl.classList.add("is-highlighted");
        input.setAttribute("aria-activedescendant", optionEl.id);
      }

      optionEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        addSelectedId(option.value);
      });

      suggestions.appendChild(optionEl);
    });

    input.setAttribute("aria-expanded", "true");
  };

  input.addEventListener("input", () => {
    highlightedIndex = -1;
    renderSuggestions();
  });

  input.addEventListener("focus", () => {
    renderSuggestions();
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      suggestions.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-activedescendant", "");
    }, 100);
  });

  input.addEventListener("keydown", (event) => {
    const visibleSuggestions = getVisibleSuggestions();

    if (event.key === "ArrowDown" && visibleSuggestions.length) {
      event.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, visibleSuggestions.length - 1);
      renderSuggestions();
      return;
    }

    if (event.key === "ArrowUp" && visibleSuggestions.length) {
      event.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      renderSuggestions();
      return;
    }

    if (event.key === "Enter" && visibleSuggestions.length) {
      event.preventDefault();
      const option = highlightedIndex >= 0 ? visibleSuggestions[highlightedIndex] : visibleSuggestions[0];
      addSelectedId(option.value);
      return;
    }

    if (event.key === "Backspace" && !input.value.trim() && selectedIds.length) {
      removeSelectedId(selectedIds[selectedIds.length - 1]);
    }
  });

  const initialValues = [...new Set(values.map((value) => String(value)).filter(Boolean))];
  initialValues.forEach((value) => {
    if (canonical.some((option) => option.value === value)) {
      selectedIds.push(value);
    }
  });

  renderTokens();
  syncHiddenInput();

  if (options.length === 0 && disabledWhenEmpty) {
    input.disabled = true;
  }

  container.append(tokenList, input, suggestions);
  wrapper.append(container, hiddenInput);

  if (emptyMessage && options.length === 0) {
    wrapper.appendChild(createSelectEmptyState(emptyMessage));
  }

  return {
    wrapper,
    input,
    hiddenInput,
    getSelectedIds: () => [...selectedIds]
  };
}

/**
 * Reads selected IDs from the hidden-input representation used by token controls.
 */
export function readEntityTokenHiddenValues(hiddenInput) {
  return [...new Set((hiddenInput?.value || "").split(",").map((value) => value.trim()).filter(Boolean))];
}
