// deckSetup.js — the first screen: choose or create a deck of flashcards.
//
// The hero Marty names the required first action (product.md: deliberate empty
// states; design → Mascot hero greeter, R10.4). The user can start instantly
// with a built-in sample deck, or paste/type their own term/definition cards.

import { el, button } from "./viewHelpers.js";
import { render as renderMascot } from "./mascot.js";
import { showIn } from "./messages.js";
import { parseCards, buildItems, SAMPLE_DECK } from "../content/deck.js";

/**
 * @param {HTMLElement} container
 * @param {Object} ctx
 * @param {(items: Object[]) => void} ctx.onItems
 * @returns {() => void} teardown
 */
export function open(container, { onItems }) {
  const hero = el("div", { class: "setup__hero" });
  renderMascot(hero, {
    variant: "hero",
    state: "idle",
    decorative: false,
    label:
      "Marty the Martian, a friendly green alien in a silver flying saucer, " +
      "pointing at the deck controls. Start by choosing the sample deck or pasting your own cards.",
  });

  const heading = el("h1", { class: "screen__title", tabindex: "-1", text: "Mindhunter Study" });
  const tagline = el("p", {
    class: "setup__tagline",
    text: "Turn any set of terms into flashcards, quizzes, and a space minigame — right in your browser.",
  });

  // Sample deck quick-start.
  const sampleBtn = button(
    `Start with the sample deck (${SAMPLE_DECK.length} cards)`,
    () => onItems(buildItems(SAMPLE_DECK)),
    { class: "btn--primary setup__sample" }
  );

  // Custom-deck input.
  const textareaId = "deck-input";
  const label = el("label", {
    class: "setup__label",
    for: textareaId,
    text: "Or paste your own cards \u2014 one per line, as \u201cTerm: Definition\u201d (or Term \u2014 Definition, or tab-separated):",
  });
  const textarea = el("textarea", {
    id: textareaId,
    class: "setup__textarea",
    rows: "8",
    spellcheck: "false",
    placeholder:
      "Mitochondria: the powerhouse of the cell\nPhotosynthesis \u2014 how plants make food from light\nNewton\u2019s first law\tan object stays in motion unless acted on",
  });

  const count = el("p", { class: "setup__count", role: "status", "aria-live": "polite", text: "0 valid cards detected." });
  const feedback = el("div", { class: "setup__feedback", "aria-live": "polite" });

  const useBtn = button("Study my cards", startCustom, { class: "btn--primary" });
  useBtn.disabled = true;

  textarea.addEventListener("input", () => {
    const n = parseCards(textarea.value).length;
    count.textContent = `${n} valid card${n === 1 ? "" : "s"} detected.`;
    useBtn.disabled = n === 0;
  });

  function startCustom() {
    const cards = parseCards(textarea.value);
    if (cards.length === 0) {
      showIn(feedback, {
        kind: "error",
        text: "No cards found. Put one card per line as \u201cTerm: Definition\u201d.",
      });
      textarea.focus();
      return;
    }
    onItems(buildItems(cards));
  }

  const customBlock = el("div", { class: "setup__custom" }, [label, textarea, count, feedback, useBtn]);

  const panel = el("div", { class: "setup__panel" }, [
    el("div", { class: "setup__quickstart" }, [
      el("h2", { class: "setup__subhead", text: "Quick start" }),
      sampleBtn,
    ]),
    el("div", { class: "setup__divider", "aria-hidden": "true", text: "or" }),
    customBlock,
  ]);

  const section = el("section", { class: "screen setup" }, [
    el("div", { class: "setup__header" }, [hero, el("div", { class: "setup__intro" }, [heading, tagline])]),
    panel,
  ]);

  container.replaceChildren(section);
  heading.focus();

  return function teardown() {
    container.replaceChildren();
  };
}
