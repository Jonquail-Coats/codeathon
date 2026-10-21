// multipleChoiceMode.js — pick the correct definition (R6).
//
// Shows a question with options built from `answer` + `distractors`; marks the
// chosen option correct/incorrect with text AND a non-color cue (R6.2/6.3);
// identifies the correct option on a wrong answer; dispatches SCORE_CHANGED and
// shows the running score (R6.4); renders a back control (R4.6).

import { el, screen, button } from "../ui/viewHelpers.js";
import { announce, showIn } from "../ui/messages.js";
import { ActionType } from "../state/appState.js";

/**
 * Deterministically order options (answer + distractors) so the correct one
 * isn't always first, without using Math.random (keeps it stable per item).
 *
 * @param {Object} item
 * @returns {{ text: string, correct: boolean }[]}
 */
function optionsFor(item) {
  const opts = [{ text: item.answer, correct: true }];
  for (const d of item.distractors || []) opts.push({ text: d, correct: false });
  // Rotate by a value derived from the item id so placement is varied but fixed.
  const rot = hash(item.id) % opts.length;
  return opts.slice(rot).concat(opts.slice(0, rot));
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i += 1) {
    h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * @param {HTMLElement} container
 * @param {{ items: Object[], store: Object, onBack: () => void }} ctx
 * @returns {() => void} teardown
 */
export function open(container, { items, store, onBack }) {
  // Only items with enough distractors can be answered as multiple choice.
  const playable = items.filter((i) => (i.distractors || []).length >= 2);
  let index = 0;
  let answered = false;
  let correctCount = 0;
  let finished = false;

  const { section, heading, body } = screen({ title: "Multiple Choice", onBack });

  if (playable.length === 0) {
    body.append(
      el("p", {
        class: "message message--info",
        text: "This deck is too small for multiple choice. Add at least three cards to play.",
      })
    );
    container.replaceChildren(section);
    heading.focus();
    return () => container.replaceChildren();
  }

  const score = el("p", { class: "mc__score", role: "status", "aria-live": "polite" });
  const counter = el("p", { class: "mc__counter" });
  const question = el("p", { class: "mc__question" });
  const optionList = el("div", { class: "mc__options", role: "group", "aria-label": "Answer options" });
  const feedback = el("div", { class: "mc__feedback", "aria-live": "polite" });

  const nextBtn = button("Next question \u2192", onNext, { class: "btn--primary" });
  nextBtn.disabled = true;
  const controls = el("div", { class: "controls" }, [nextBtn]);

  // Single click handler whose behavior depends on where we are in the quiz.
  function onNext() {
    if (finished) {
      index = 0;
      correctCount = 0;
      finished = false;
      renderQuestion();
    } else if (index < playable.length - 1) {
      index += 1;
      renderQuestion();
    } else {
      showResults();
    }
  }

  body.append(counter, question, optionList, feedback, controls, score);
  container.replaceChildren(section);
  heading.focus();
  renderQuestion();

  function renderQuestion() {
    answered = false;
    nextBtn.disabled = true;
    feedback.replaceChildren();
    const item = playable[index];
    counter.textContent = `Question ${index + 1} of ${playable.length}`;
    question.textContent = `Which definition matches: "${item.prompt}"?`;
    score.textContent = `Score: ${correctCount} of ${playable.length}`;

    optionList.replaceChildren();
    optionsFor(item).forEach((opt, i) => {
      const btn = el("button", {
        type: "button",
        class: "mc__option",
        dataset: { correct: opt.correct ? "true" : "false" },
        text: `${String.fromCharCode(65 + i)}. ${opt.text}`,
        on: { click: () => choose(btn, opt) },
      });
      optionList.append(btn);
    });
    heading.focus();
  }

  function choose(btn, opt) {
    if (answered) return;
    answered = true;
    nextBtn.disabled = false;

    // Lock all options and mark the correct one with a text/shape cue.
    const buttons = [...optionList.querySelectorAll(".mc__option")];
    for (const b of buttons) b.disabled = true;

    if (opt.correct) {
      correctCount += 1;
      store.dispatch({ type: ActionType.SCORE_CHANGED });
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "celebrate" } });
      btn.classList.add("mc__option--correct");
      btn.append(el("span", { class: "mc__tag", text: " \u2714 Correct" }));
      showIn(feedback, { kind: "success", text: "Correct!" });
    } else {
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "encourage" } });
      btn.classList.add("mc__option--wrong");
      btn.append(el("span", { class: "mc__tag", text: " \u2717 Not this one" }));
      // Reveal the correct option (identified by its dataset flag, not text).
      const correctBtn = buttons.find((b) => b.dataset.correct === "true");
      if (correctBtn) {
        correctBtn.classList.add("mc__option--correct");
        correctBtn.append(el("span", { class: "mc__tag", text: " \u2714 Correct answer" }));
      }
      showIn(feedback, { kind: "error", text: `Not quite. The correct answer is: ${playable[index].answer}` });
    }
    score.textContent = `Score: ${correctCount} of ${playable.length}`;

    nextBtn.textContent = index === playable.length - 1 ? "See results \u2192" : "Next question \u2192";
  }

  function showResults() {
    finished = true;
    question.textContent = "Quiz complete!";
    counter.textContent = "";
    optionList.replaceChildren();
    const pct = Math.round((correctCount / playable.length) * 100);
    showIn(feedback, {
      kind: pct >= 50 ? "success" : "info",
      text: `You scored ${correctCount} of ${playable.length} (${pct}%).`,
    });
    nextBtn.disabled = false;
    nextBtn.textContent = "Play again";
    announce(`Quiz complete. You scored ${correctCount} of ${playable.length}.`);
  }

  return function teardown() {
    container.replaceChildren();
  };
}
