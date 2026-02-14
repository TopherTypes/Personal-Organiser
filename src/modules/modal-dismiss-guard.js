/**
 * Creates a reusable dismiss guard for modal/editor overlays.
 *
 * The guard keeps unsaved-change semantics consistent across modules by:
 * - tracking whether a draft has been mutated,
 * - short-circuiting close when no edits were made,
 * - prompting before destructive dismiss when edits exist.
 */
export function createModalDismissGuard({
  onClose,
  confirmMessage = "Discard unsaved changes?"
}) {
  let isDirty = false;

  /** Marks the backing draft as dirty after the first user edit. */
  const markDirty = () => {
    isDirty = true;
  };

  /**
   * Wires generic input/change listeners to a form-like EventTarget.
   *
   * `input` captures text-style updates; `change` covers select/date/checkbox
   * controls so all field types can trigger unsaved-change protection.
   */
  const bindDirtyTracking = (target) => {
    target.addEventListener("input", markDirty);
    target.addEventListener("change", markDirty);
  };

  /**
   * Central close request used by backdrop clicks, Escape, and cancel buttons.
   * Returns true when the overlay can close.
   */
  const requestClose = () => {
    if (isDirty && !window.confirm(confirmMessage)) {
      return false;
    }

    onClose();
    return true;
  };

  return {
    bindDirtyTracking,
    markDirty,
    requestClose,
    isDirty: () => isDirty
  };
}

