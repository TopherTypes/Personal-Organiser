/**
 * Renders cross-life landing dashboard shown before a mode is entered.
 */
export function renderLandingDashboard({ onEnterMode }) {
  const section = document.createElement("section");
  section.className = "landing-dashboard";

  const title = document.createElement("h1");
  title.textContent = "Choose where to focus";

  const intro = document.createElement("p");
  intro.textContent =
    "Start in Work or Personal mode. Data remains separated by design.";

  const cards = document.createElement("div");
  cards.className = "landing-cards";

  cards.append(
    createModeCard("Work", "Projects, tasks, meetings, and stakeholder updates.", "work", onEnterMode),
    createModeCard(
      "Personal",
      "Tasks, relationships, and daily wellbeing logs.",
      "personal",
      onEnterMode
    )
  );

  section.append(title, intro, cards);
  return section;
}

/**
 * Builds an individual landing card.
 */
function createModeCard(name, description, mode, onEnterMode) {
  const card = document.createElement("article");
  card.className = "landing-card";

  const heading = document.createElement("h2");
  heading.textContent = name;

  const copy = document.createElement("p");
  copy.textContent = description;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "enter-mode-button";
  button.textContent = `Enter ${name}`;
  button.addEventListener("click", () => onEnterMode(mode));

  card.append(heading, copy, button);
  return card;
}

/**
 * Renders placeholder content for an active mode.
 */
export function renderModeDashboard(mode) {
  const section = document.createElement("section");
  section.className = "mode-dashboard";

  const title = document.createElement("h1");
  title.textContent = mode === "work" ? "Work Dashboard" : "Personal Dashboard";

  const body = document.createElement("p");
  body.textContent =
    "This is a baseline shell. Functional modules and sync workflows will be added in later tasks.";

  section.append(title, body);
  return section;
}
