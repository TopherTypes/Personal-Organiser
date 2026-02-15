import { renderWorkTasksModule } from "./tasks.js";

/**
 * Personal Tasks now reuses the Work Tasks renderer with `mode: "personal"`
 * so both modes expose the same creation/editing workflow, filtering controls,
 * and visual presentation while still persisting to mode-scoped storage.
 */
export function renderPersonalTasksModule({ focusCreateForm = false } = {}) {
  return renderWorkTasksModule({
    mode: "personal",
    openComposer: focusCreateForm
  });
}
