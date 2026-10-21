// modeSelect.js — the mode-selection screen ("bubbles") (R4).
//
// When quiz content is available, renders four bubbles: Flashcards, Multiple
// Choice, Free-response, Minigame (R4.1). Each bubble is keyboard-focusable
// with a visible focus indicator and activatable by click and Enter/Space
// (buttons give this for free), with a programmatic label (R4.4, R11.4). When
// no content is available the bubbles are disabled and a note says a deck must
// be loaded first (R4.5). Activation calls onOpen(mode); if items are missing
// it stays put and shows an error (R4.3).

import { el, button } from "../ui/viewHelpers.js";
import { render as renderMascot } from "../ui/mascot.js";
import { announce } from "../ui/messages.js";

const BUBBLES = [
  { mode: "flashcards", label: "Flashcards", blurb: "Flip cards to study terms and definitions.", icon: "\u{1F0CF}" },
  { mode: "multipleChoice", label: "Multiple Choice", blurb: "Pick the matching definition.", icon: "\u2714" },
  { mode: "freeResponse", label: "Free Response", blurb: "Type the answer, then check it.", icon: "\u270E" },
  { mode: "minigame", label: "Minigame", blurb: "Catch the right answer with Marty's UFO.", icon: "\u{1F6F8}" },
];

/**
 * @param {HTMLElement} container
 * @param {Object} ctx
 * @param {Object[]} ctx.items          Current quiz items.
 * @param {number} ctx.cardCount        Number of cards in the loaded deck.
 * @param {(mode: string) => void} ctx.onOpen
 * @param {() => void} ctx.onNewDeck    Go back to the deck setup screen.
 * @returns {() => void} teardown
 */
export function open(container, { items, cardCount, onOpen, onNewDeck }) {
  const hasContent = Array.isArray(items) && items.length > 0;

  const heading = el("h1", { class: "screen__title", tabindex: "-1", text: "Choose a study mode" });
  const corner = el("div", { class: "mode-select__mascot" });
  renderMascot(corner, { variant: "corner", state: "idle" });

  const header = el("div", { class: "screen__header mode-select__header" }, [heading, corner]);

  const intro = el(
    "p",
    { class: "mode-select__intro" },
    hasContent
      ? `Your deck has ${cardCount} card${cardCount === 1 ? "" : "s"}. Pick how you want to practice.`
      : "Load a deck first to unlock the study modes."
  );

  const grid = el("ul", { class: "bubbles", "aria-label": "Study modes" });
  for (const b of BUBBLES) {
    const bubble = el("button", {
      type: "button",
      class: "bubble",
      "aria-label": `${b.label}: ${b.blurb}`,
      ...(hasContent ? {} : { disabled: "", "aria-disabled": "true" }),
      on: {
        click: () => {
          if (!hasContent) return;
          if (!Array.isArray(items) || items.length === 0) {
            announce("The quiz content could not be loaded.");
            return;
          }
          onOpen(b.mode);
        },
      },
    }, [
      el("span", { class: "bubble__icon", "aria-hidden": "true", text: b.icon }),
      el("span", { class: "bubble__label", text: b.label }),
      el("span", { class: "bubble__blurb", text: b.blurb }),
    ]);
    grid.append(el("li", { class: "bubbles__item" }, [bubble]));
  }

  const footer = el("div", { class: "mode-select__footer" }, [
    button(hasContent ? "Load a different deck" : "Load a deck", onNewDeck, { class: "btn--ghost" }),
  ]);

  const section = el("section", { class: "screen mode-select" }, [header, intro, grid, footer]);
  container.replaceChildren(section);
  heading.focus();

  return function teardown() {
    container.replaceChildren();
  };
}
