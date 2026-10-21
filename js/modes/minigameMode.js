// minigameMode.js — "Answer Catch", a space-alien minigame on the flashcards (R8).
//
// Marty's UFO sits at the bottom of a starfield. For each card, answer choices
// (the correct definition plus distractors) drift down from the top as falling
// "capsules". The player moves the UFO left/right and fires a tractor beam to
// catch a capsule. Catching the correct one awards points with visual feedback
// (R8.2); catching a wrong one gives corrective feedback via text AND a shape/
// icon cue (R8.3). When every card is played the final score is shown (R8.4).
// A back control is always present (R4.6).
//
// Controls are fully keyboard-operable (arrows / A-D to move, Space/Enter to
// fire) and also expose on-screen buttons, so the game does not rely on a
// pointer or on color alone.

import { el, screen, button } from "../ui/viewHelpers.js";
import { showIn, announce } from "../ui/messages.js";
import { ActionType } from "../state/appState.js";

const LANES = 4; // horizontal positions the UFO can occupy
const FALL_MS = 13000; // time for a capsule to fall top-to-bottom

/**
 * @param {HTMLElement} container
 * @param {{ items: Object[], store: Object, onBack: () => void }} ctx
 * @returns {() => void} teardown
 */
export function open(container, { items, store, onBack }) {
  const playable = items.filter((i) => (i.distractors || []).length >= 1);
  const { section, heading, body } = screen({ title: "Minigame: Answer Catch", onBack });

  if (playable.length === 0) {
    body.append(
      el("p", {
        class: "message message--info",
        text: "This deck needs at least two cards to play the minigame.",
      })
    );
    container.replaceChildren(section);
    heading.focus();
    return () => container.replaceChildren();
  }

  let index = 0;
  let score = 0;
  let laneOf = Math.floor(LANES / 2);
  let capsules = []; // { el, lane, correct, text, startedAt }
  let rafId = null;
  let roundResolved = false;
  let running = true;

  // --- DOM -----------------------------------------------------------------
  const hud = el("div", { class: "mg__hud" }, [
    el("span", { class: "mg__counter" }),
    el("span", { class: "mg__score", role: "status", "aria-live": "polite" }),
  ]);
  const prompt = el("p", { class: "mg__prompt", "aria-live": "polite" });
  const field = el("div", { class: "mg__field", "aria-hidden": "true" });
  const ufo = el("div", { class: "mg__ufo" });
  field.append(ufo);

  const feedback = el("div", { class: "mg__feedback", "aria-live": "polite" });

  const leftBtn = button("\u2190 Left", () => moveTo(laneOf - 1), { class: "btn--ghost" });
  const fireBtn = button("Fire beam", onFire, { class: "btn--primary" });
  const rightBtn = button("Right \u2192", () => moveTo(laneOf + 1), { class: "btn--ghost" });

  // One stable fire-button handler: fires during play, restarts after game over.
  function onFire() {
    if (!running) {
      restart();
    } else {
      fire();
    }
  }

  function restart() {
    index = 0;
    score = 0;
    running = true;
    fireBtn.textContent = "Fire beam";
    startRound();
    loop(performance.now());
  }
  const controls = el("div", { class: "controls mg__controls" }, [leftBtn, fireBtn, rightBtn]);
  const help = el("p", {
    class: "mg__help",
    text: "Move with \u2190/\u2192 (or A/D), fire the tractor beam with Space or Enter. Catch the correct definition.",
  });

  body.append(hud, prompt, field, feedback, controls, help);
  container.replaceChildren(section);
  heading.focus();

  document.addEventListener("keydown", onKey);

  startRound();
  loop(performance.now());

  // --- game flow -----------------------------------------------------------
  function startRound() {
    roundResolved = false;
    leftBtn.disabled = false;
    rightBtn.disabled = false;
    laneOf = Math.floor(LANES / 2);
    positionUfo();
    clearCapsules();

    const item = playable[index];
    hud.querySelector(".mg__counter").textContent = `Card ${index + 1} of ${playable.length}`;
    hud.querySelector(".mg__score").textContent = `Score: ${score}`;
    prompt.textContent = `Catch the definition of: "${item.prompt}"`;
    feedback.replaceChildren();

    const choices = buildChoices(item);
    const laneOrder = shuffleLanes(item.id, choices.length);
    choices.forEach((choice, i) => {
      spawnCapsule(choice, laneOrder[i % LANES]);
    });
  }

  function buildChoices(item) {
    const distractors = (item.distractors || []).slice(0, LANES - 1);
    const choices = [{ text: item.answer, correct: true }];
    for (const d of distractors) choices.push({ text: d, correct: false });
    return choices.slice(0, LANES);
  }

  // Deterministic lane assignment derived from the item id (no Math.random).
  function shuffleLanes(seed, n) {
    const lanes = Array.from({ length: LANES }, (_, i) => i);
    let h = 0;
    for (let i = 0; i < String(seed).length; i += 1) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
    for (let i = lanes.length - 1; i > 0; i -= 1) {
      h = (h * 1103515245 + 12345) >>> 0;
      const j = h % (i + 1);
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes.slice(0, Math.max(n, LANES));
  }

  function spawnCapsule(choice, lane) {
    const node = el("div", { class: `mg__capsule${choice.correct ? " mg__capsule--target" : ""}`, text: choice.text });
    node.style.left = `${lanePercent(lane)}%`;
    node.style.top = "-12%";
    field.append(node);
    capsules.push({ el: node, lane, correct: choice.correct, text: choice.text, startedAt: performance.now() });
  }

  function lanePercent(lane) {
    // Center each lane within its horizontal band.
    return ((lane + 0.5) / LANES) * 100;
  }

  function positionUfo() {
    ufo.style.left = `${lanePercent(laneOf)}%`;
  }

  function moveTo(lane) {
    laneOf = Math.max(0, Math.min(LANES - 1, lane));
    positionUfo();
  }

  function fire() {
    if (!running || roundResolved) return;
    // Catch the lowest capsule currently in the UFO's lane.
    const inLane = capsules
      .filter((c) => c.lane === laneOf)
      .sort((a, b) => b.el.offsetTop - a.el.offsetTop);
    if (inLane.length === 0) {
      showIn(feedback, { kind: "info", text: "No capsule in your lane yet — line up under one." });
      return;
    }
    resolveRound(inLane[0]);
  }

  function resolveRound(caught) {
    roundResolved = true;
    caught.el.classList.add("mg__capsule--caught");

    if (caught.correct) {
      score += 1;
      store.dispatch({ type: ActionType.SCORE_CHANGED });
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "celebrate" } });
      caught.el.classList.add("mg__capsule--hit");
      showIn(feedback, { kind: "success", text: "\u2714 Caught the right one! +1 point." });
    } else {
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "encourage" } });
      caught.el.classList.add("mg__capsule--miss");
      const correct = playable[index].answer;
      showIn(feedback, { kind: "error", text: `\u2717 That one was off. The correct definition was: ${correct}` });
    }
    hud.querySelector(".mg__score").textContent = `Score: ${score}`;

    // Brief pause so the player reads the feedback, then advance.
    window.setTimeout(() => {
      if (!running) return;
      if (index < playable.length - 1) {
        index += 1;
        startRound();
      } else {
        endGame();
      }
    }, 1400);
  }

  function missedRound() {
    // A capsule reached the bottom uncaught: count as a miss, show the answer.
    roundResolved = true;
    store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "encourage" } });
    showIn(feedback, {
      kind: "info",
      text: `\u23f1 Time's up. The correct definition was: ${playable[index].answer}`,
    });
    window.setTimeout(() => {
      if (!running) return;
      if (index < playable.length - 1) {
        index += 1;
        startRound();
      } else {
        endGame();
      }
    }, 1400);
  }

  function endGame() {
    running = false;
    cancelAnimationFrame(rafId);
    clearCapsules();
    prompt.textContent = "Game over!";
    field.replaceChildren(ufo);
    const pct = Math.round((score / playable.length) * 100);
    showIn(feedback, {
      kind: pct >= 50 ? "success" : "info",
      text: `Final score: ${score} of ${playable.length} (${pct}%).`,
    });
    announce(`Game over. Final score ${score} of ${playable.length}.`);
    // The same fire button now restarts (handled by onFire while !running).
    fireBtn.textContent = "Play again";
    fireBtn.disabled = false;
    leftBtn.disabled = true;
    rightBtn.disabled = true;
  }

  // --- animation loop ------------------------------------------------------
  function loop(now) {
    if (!running) return;
    for (const c of capsules) {
      const t = Math.min(1, (now - c.startedAt) / FALL_MS);
      c.el.style.top = `${-12 + t * 112}%`;
      if (t >= 1 && !roundResolved) {
        missedRound();
        break;
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  function clearCapsules() {
    for (const c of capsules) c.el.remove();
    capsules = [];
  }

  function onKey(e) {
    if (!running || roundResolved) {
      // Allow restart via Space/Enter when game is over and fire is rebound.
      return;
    }
    switch (e.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        e.preventDefault();
        moveTo(laneOf - 1);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        e.preventDefault();
        moveTo(laneOf + 1);
        break;
      case " ":
      case "Enter":
        // Don't hijack Enter/Space when focus is on a button (let it click).
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
        e.preventDefault();
        fire();
        break;
      default:
        break;
    }
  }

  return function teardown() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener("keydown", onKey);
    container.replaceChildren();
  };
}
