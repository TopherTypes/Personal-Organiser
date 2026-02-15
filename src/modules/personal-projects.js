import { renderWorkProjectsModule } from "./projects.js";
import { loadPersonalPeopleSnapshot } from "./personal-people.js";

/**
 * Personal Projects intentionally delegates to the Work Projects renderer so
 * both modes share the same card/list/detail workflow and editor affordances.
 *
 * The mode argument keeps persistence isolated, while personal people are
 * provided as the linkable entity set for project relationship mapping.
 */
export function renderPersonalProjectsModule({ focusCreateForm = false } = {}) {
  return renderWorkProjectsModule({
    mode: "personal",
    people: loadPersonalPeopleSnapshot(),
    meetings: [],
    openComposer: focusCreateForm
  });
}
