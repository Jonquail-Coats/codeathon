// deck.js — build sessionable QuizItems from simple term/definition cards.
//
// The spec's full pipeline derives QuizItems from an uploaded PDF/DOCX. That
// extraction pipeline depends on vendored libraries that are not yet present,
// so this module provides the other supported source of a deck: explicit
// term/definition cards (a built-in sample deck, or cards the user types or
// pastes). It produces the SAME QuizItem shape the four modes consume (see
// design.md → Data Models → QuizItem), so flashcards, multiple choice,
// free-response, and the minigame all work from it unchanged.
//
// Everything here is pure and deterministic: distractor selection is derived
// from the card set itself (other answers), not from randomness, so the output
// is stable and testable.

/**
 * @typedef {Object} QuizItem
 * @property {string} id
 * @property {'termDef'} kind
 * @property {string} prompt        Front of the card (the term/question).
 * @property {string} answer        Back of the card (the definition/answer).
 * @property {string[]} distractors 2..5 wrong options for Multiple Choice.
 * @property {string[]} keywords
 * @property {string} source
 */

/** Minimum distractors required to build a multiple-choice option set (R3.3). */
const MIN_DISTRACTORS = 2;
/** Maximum distractors kept per item (R3.3). */
const MAX_DISTRACTORS = 5;
/** Hard cap on items per session (R3.1). */
const MAX_ITEMS = 50;

/**
 * A small, self-contained sample deck so every mode is usable on first load
 * with zero setup. Theme-appropriate (space / Mars trivia), but the content is
 * incidental — any term/definition pairs work.
 *
 * @type {{ term: string, definition: string }[]}
 */
export const SAMPLE_DECK = Object.freeze([
  { term: "Olympus Mons", definition: "The tallest volcano and mountain in the solar system, on Mars." },
  { term: "Phobos", definition: "The larger and inner of the two moons of Mars." },
  { term: "Deimos", definition: "The smaller and outer of the two moons of Mars." },
  { term: "Sol", definition: "A solar day on Mars, about 24 hours and 39 minutes long." },
  { term: "Regolith", definition: "The layer of loose dust and broken rock covering solid bedrock." },
  { term: "Valles Marineris", definition: "A vast canyon system stretching along the Martian equator." },
  { term: "Perihelion", definition: "The point in an orbit closest to the Sun." },
  { term: "Aphelion", definition: "The point in an orbit farthest from the Sun." },
  { term: "Rover", definition: "A wheeled robotic vehicle that explores a planetary surface." },
  { term: "Terraforming", definition: "Hypothetically transforming a planet to make it habitable for humans." },
]);

/**
 * Parse pasted/typed text into term/definition cards.
 *
 * Each non-empty line is one card. The term and definition are separated by the
 * first tab, or the first " - " / " – " / " — " / ":" / "=" found (in that
 * order of preference). Lines with no separator and a definition are skipped
 * (a lone term has no answer to study). Pure and deterministic.
 *
 * @param {string} text
 * @returns {{ term: string, definition: string }[]}
 */
export function parseCards(text) {
  if (typeof text !== "string") return [];
  const lines = text.split(/\r?\n/);
  /** @type {{ term: string, definition: string }[]} */
  const cards = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") continue;
    const split = splitCardLine(line);
    if (!split) continue;
    const term = split.term.trim();
    const definition = split.definition.trim();
    if (term === "" || definition === "") continue;
    cards.push({ term, definition });
  }
  return cards;
}

/**
 * Split a single line into term/definition at the first recognized separator.
 *
 * @param {string} line  A trimmed, non-empty line.
 * @returns {{ term: string, definition: string } | null}
 */
function splitCardLine(line) {
  // Tab first: the format copied out of spreadsheets / Quizlet exports.
  const tab = line.indexOf("\t");
  if (tab !== -1) {
    return { term: line.slice(0, tab), definition: line.slice(tab + 1) };
  }
  // Then common inline separators, longest/most-specific first.
  for (const sep of [" — ", " – ", " - ", ": ", " = ", ":", "="]) {
    const at = line.indexOf(sep);
    if (at > 0) {
      return { term: line.slice(0, at), definition: line.slice(at + sep.length) };
    }
  }
  return null;
}

/**
 * Build QuizItems from term/definition cards.
 *
 * Each card becomes one QuizItem whose `prompt` is the term and `answer` is the
 * definition. Distractors for multiple choice are other cards' definitions,
 * chosen deterministically (nearest neighbors in the deck, skipping any equal
 * to the answer), 2..5 of them (R3.3). A deck with fewer than 3 cards cannot
 * supply the minimum 2 distinct distractors, so such items carry an empty
 * distractor set and multiple choice/minigame degrade gracefully.
 *
 * The result is capped at 50 items (R3.1).
 *
 * @param {{ term: string, definition: string }[]} cards
 * @returns {QuizItem[]}
 */
export function buildItems(cards) {
  if (!Array.isArray(cards)) return [];
  const clean = cards
    .filter((c) => c && typeof c.term === "string" && typeof c.definition === "string")
    .map((c) => ({ term: c.term.trim(), definition: c.definition.trim() }))
    .filter((c) => c.term !== "" && c.definition !== "")
    .slice(0, MAX_ITEMS);

  const allAnswers = clean.map((c) => c.definition);

  return clean.map((card, index) => ({
    id: `card-${index}`,
    kind: "termDef",
    prompt: card.term,
    answer: card.definition,
    distractors: pickDistractors(allAnswers, index),
    keywords: [card.term.toLowerCase()],
    source: `${card.term} — ${card.definition}`,
  }));
}

/**
 * Pick 2..5 distinct distractors for the card at `index` from the other
 * answers, deterministically (by proximity in the deck). Never includes the
 * card's own answer or a duplicate. Returns fewer than 2 only when the deck
 * genuinely cannot supply more.
 *
 * @param {string[]} allAnswers  Every card's answer, in deck order.
 * @param {number} index         The current card's index.
 * @returns {string[]}
 */
function pickDistractors(allAnswers, index) {
  const own = allAnswers[index];
  const seen = new Set([own]);
  /** @type {string[]} */
  const picked = [];
  // Walk outward from the current card for stable, spread-out choices.
  for (let offset = 1; offset < allAnswers.length && picked.length < MAX_DISTRACTORS; offset += 1) {
    for (const candidateIndex of [index + offset, index - offset]) {
      if (candidateIndex < 0 || candidateIndex >= allAnswers.length) continue;
      const candidate = allAnswers[candidateIndex];
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      picked.push(candidate);
      if (picked.length >= MAX_DISTRACTORS) break;
    }
  }
  // Return whatever we gathered. With >= 3 cards this is always >= 2; smaller
  // decks yield fewer, and the MC/minigame modes gate on the count themselves.
  return picked;
}

/**
 * Convenience: build the sample deck's QuizItems.
 *
 * @returns {QuizItem[]}
 */
export function sampleItems() {
  return buildItems(SAMPLE_DECK.map((c) => ({ term: c.term, definition: c.definition })));
}
