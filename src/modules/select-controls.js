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
