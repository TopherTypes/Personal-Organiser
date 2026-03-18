/**
 * Shared DOM form-field helpers used across personal modules.
 *
 * Centralising these avoids duplicating identical functions in personal-calendar,
 * personal-daily-log, personal-exercise-log, and personal-people. Any bug fix
 * or style change now applies to all four modules in one place.
 */

/**
 * Builds a labelled <input> field returning { wrap, input }.
 *
 * @param {string} labelText - Visible label text.
 * @param {string} type - HTML input type (text, date, number, …).
 * @param {boolean} required - Whether the field is required.
 * @param {string} [value=""] - Initial value.
 */
export function buildInput(labelText, type, required, value = "") {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("input");
  input.type = type;
  input.className = "field-input";
  input.required = required;
  input.value = value;
  wrap.appendChild(input);

  return { wrap, input };
}

/**
 * Builds a labelled <textarea> field returning { wrap, input }.
 *
 * @param {string} labelText - Visible label text.
 * @param {string} [value=""] - Initial value.
 */
export function buildTextarea(labelText, value = "") {
  const wrap = document.createElement("label");
  wrap.className = "field-label";
  wrap.textContent = labelText;

  const input = document.createElement("textarea");
  input.className = "field-input field-textarea";
  input.value = value;
  wrap.appendChild(input);

  return { wrap, input };
}
