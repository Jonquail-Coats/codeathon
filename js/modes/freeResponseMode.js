// freeResponseMode.js — type the answer, then reveal it (R7).
//
// Shows a question with a labeled text input; on submit reveals the expected
// answer (R7.2); blocks empty submits with a prompt message (R7.3); advancing
// clears the input (R7.4); renders a back control (R4.6). Answer grading is a
// lenient, case/space-insensitive comparison used only as a friendly hint — the
// authoritative expected answer is always revealed.

import { el, screen, button } from "../ui/viewHelpers.js";
import { showIn, announce } from "../ui/messages.js";
import { ActionType } from "../state/appState.js";

/** Normalize for lenient comparison: trim, lowercase, collapse whitespace. */
function normalize(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * @param {HTMLElement} container
 * @param {{ items: Object[], store: Object, onBack: () => void }} ctx
 * @returns {() => void} teardown
 */
export function open(container, { items, store, onBack }) {
  let index = 0;
  let revealed = false;

  const { section, heading, body } = screen({ title: "Free Response", onBack });

  const counter = el("p", { class: "fr__counter" });
  const question = el("p", { class: "fr__question" });

  const inputId = "fr-input";
  const label = el("label", { class: "fr__label", for: inputId, text: "Your answer" });
  const input = el("input", {
    id: inputId,
    type: "text",
    class: "fr__input",
    autocomplete: "off",
    "aria-describedby": "fr-feedback",
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });

  const feedback = el("div", { id: "fr-feedback", class: "fr__feedback", "aria-live": "polite" });
  const answerReveal = el("div", { class: "fr__answer", hidden: "" });

  const submitBtn = button("Submit", submit, { class: "btn--primary" });
  const nextBtn = button("Next \u2192", next);
  const controls = el("div", { class: "controls" }, [submitBtn, nextBtn]);

  body.append(counter, question, label, input, feedback, answerReveal, controls);
  container.replaceChildren(section);
  heading.focus();
  renderQuestion();

  function renderQuestion() {
    if (index >= items.length) {
      question.textContent = "\u2728 You've answered every card!";
      counter.textContent = "";
      label.hidden = true;
      input.hidden = true;
      submitBtn.disabled = true;
      nextBtn.textContent = "Start over";
      answerReveal.hidden = true;
      feedback.replaceChildren();
      announce("You've answered every card.");
      return;
    }
    revealed = false;
    const item = items[index];
    counter.textContent = `Card ${index + 1} of ${items.length}`;
    question.textContent = item.prompt;
    label.hidden = false;
    input.hidden = false;
    input.value = "";
    input.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    nextBtn.textContent = "Next \u2192";
    feedback.replaceChildren();
    answerReveal.hidden = true;
    answerReveal.replaceChildren();
    input.focus();
  }

  function submit() {
    if (index >= items.length) return;
    const value = input.value;
    if (normalize(value) === "") {
      showIn(feedback, { kind: "error", text: "Enter an answer before submitting." });
      input.focus();
      return;
    }
    revealed = true;
    input.disabled = true;
    submitBtn.disabled = true;

    const item = items[index];
    const match = normalize(value) === normalize(item.answer);
    if (match) {
      store.dispatch({ type: ActionType.SCORE_CHANGED });
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "celebrate" } });
      showIn(feedback, { kind: "success", text: "That matches the expected answer." });
    } else {
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "encourage" } });
      showIn(feedback, { kind: "info", text: "Here's the expected answer — compare it with yours." });
    }
    answerReveal.hidden = false;
    answerReveal.replaceChildren(
      el("p", { class: "fr__answer-label", text: "Expected answer:" }),
      el("p", { class: "fr__answer-text", text: item.answer })
    );
  }

  function next() {
    if (index >= items.length) {
      index = 0;
      renderQuestion();
      heading.focus();
      return;
    }
    index += 1;
    renderQuestion();
  }

  return function teardown() {
    container.replaceChildren();
  };
}
