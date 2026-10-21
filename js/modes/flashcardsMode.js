// flashcardsMode.js — classic flip-card study (R5).
//
// open(container, { items, store, onBack }) renders the first card with the
// answer hidden; a reveal control flips it; advancing shows the next card with
// the answer hidden again; advancing past the last card shows an end-of-deck
// message (R5.4). Every mode renders a back control (R4.6).

import { el, screen, button } from "../ui/viewHelpers.js";
import { announce } from "../ui/messages.js";

/**
 * @param {HTMLElement} container
 * @param {{ items: Object[], store: Object, onBack: () => void }} ctx
 * @returns {() => void} teardown
 */
export function open(container, { items, onBack }) {
  let index = 0;
  let revealed = false;

  const { section, heading, body } = screen({ title: "Flashcards", onBack });

  const counter = el("p", { class: "flashcards__counter", role: "status", "aria-live": "polite" });
  const card = el("button", {
    type: "button",
    class: "flashcard",
    "aria-live": "polite",
  });
  const hint = el("p", { class: "flashcards__hint", text: "Click the card (or press Enter) to flip it." });

  const revealBtn = button("Flip card", flip, { class: "btn--primary" });
  const nextBtn = button("Next card \u2192", next);
  const restartBtn = button("Restart deck", restart, { class: "btn--ghost" });

  card.addEventListener("click", flip);

  const controls = el("div", { class: "controls" }, [revealBtn, nextBtn, restartBtn]);
  body.append(counter, card, hint, controls);
  container.replaceChildren(section);
  heading.focus();
  renderCard();

  function current() {
    return items[index];
  }

  function renderCard() {
    if (index >= items.length) {
      card.classList.add("flashcard--done");
      card.textContent = "\u2728 You've reached the end of the deck!";
      counter.textContent = `Reviewed all ${items.length} card${items.length === 1 ? "" : "s"}.`;
      hint.textContent = "Restart the deck to review again, or head back to the modes.";
      revealBtn.disabled = true;
      nextBtn.disabled = true;
      announce("End of deck reached.");
      return;
    }
    const item = current();
    card.classList.remove("flashcard--done", "flashcard--revealed");
    card.textContent = item.prompt;
    counter.textContent = `Card ${index + 1} of ${items.length} — term`;
    hint.textContent = "Click the card (or press Enter) to flip it.";
    revealBtn.disabled = false;
    revealBtn.textContent = "Flip card";
    nextBtn.disabled = false;
  }

  function flip() {
    if (index >= items.length) return;
    revealed = !revealed;
    const item = current();
    if (revealed) {
      card.classList.add("flashcard--revealed");
      card.textContent = item.answer;
      counter.textContent = `Card ${index + 1} of ${items.length} — definition`;
      revealBtn.textContent = "Show term";
      announce(`Answer: ${item.answer}`);
    } else {
      renderCard();
    }
  }

  function next() {
    index += 1;
    revealed = false;
    renderCard();
  }

  function restart() {
    index = 0;
    revealed = false;
    renderCard();
    heading.focus();
  }

  return function teardown() {
    container.replaceChildren();
  };
}
