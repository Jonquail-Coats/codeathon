// quizGenerator.js — derive QuizItems from plain extracted text (R3).
//
// No AI, no network. All generation is a pipeline of pure heuristics over the
// extracted text (design → Quiz generation heuristics):
//
//   1. Clean & segment (textCleaning.js).
//   2. Find term–definition pairs via structural patterns ("X is Y", "X: Y",
//      "X — Y", "X refers to Y").
//   3. Generate cloze items by blanking salient terms from remaining sentences.
//   4. Pick 2–5 distractors for each item from the shared answer pool (R3.3).
//   5. Cap at 1–50 items (R3.1). Return { tooShort: true } when the source
//      text has fewer than 200 non-whitespace characters (R3.4).

import {
  clean,
  splitSentences,
  tokenizeTerms,
  tokenizeDisplayTerms,
  nonWhitespaceLength,
} from "./textCleaning.js";

const MAX_ITEMS = 50;
const MIN_CONTENT_LENGTH = 200;
const MAX_DISTRACTORS = 5;
const MIN_DISTRACTORS = 2;

// --- Term-definition pattern matchers ----------------------------------------

/**
 * Each matcher is a function that receives a cleaned sentence and returns
 * { term, def } or null.
 *
 * Listed most-specific-first so the first match wins.
 */
const TERM_DEF_MATCHERS = [
  // "Term: long definition" — colon at word boundary, definition ≥ 15 chars.
  (s) => {
    const m = s.match(/^([A-Z][^:]{2,55}):\s+(.{15,})$/);
    if (!m) return null;
    const term = m[1].trim();
    if (term.split(/\s+/).length > 7) return null; // term too long
    return { term, def: m[2].replace(/[.!?]$/, "").trim() };
  },
  // "Term is/are/was/were the ..." or "Term refers to ..." or "Term means ..."
  (s) => {
    const m = s.match(
      /^([A-Z][^.!?]{2,55}?)\s+(?:is|are|was|were|refers to|means|denotes|represents)\s+(.{15,})$/
    );
    if (!m) return null;
    const term = m[1].trim();
    if (term.split(/\s+/).length > 6) return null;
    return { term, def: m[2].replace(/[.!?]$/, "").trim() };
  },
  // "Term — Definition" or "Term – Definition" (em/en dash)
  (s) => {
    const m = s.match(/^([A-Z][^—–]{2,55}?)\s*[—–]\s*(.{15,})$/);
    if (!m) return null;
    const term = m[1].trim();
    if (term.split(/\s+/).length > 6) return null;
    return { term, def: m[2].replace(/[.!?]$/, "").trim() };
  },
];

// --- Salience scoring for cloze candidates -----------------------------------

/** Words too common to be useful cloze blanks. */
const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","about","into","through","during","before","after",
  "above","below","between","out","off","over","under","again","then",
  "once","here","there","when","where","why","how","all","both","each",
  "more","most","other","some","such","no","nor","not","only","own","same",
  "so","than","too","very","just","been","have","has","had","is","are",
  "was","were","be","being","do","does","did","will","would","could",
  "should","may","might","shall","can","that","which","this","these",
  "those","it","its","he","she","they","we","i","you","his","her","our",
  "their","what","who","whom","whose","any","few","many","much","several",
  "also","although","because","however","therefore","thus","while",
]);

/**
 * Score a candidate term for cloze use. Higher is more salient.
 *
 * @param {string} displayTerm  Original-case term from the text.
 * @param {Map<string, number>} termFreq  Frequency of lowercased terms.
 * @returns {number}
 */
function salienceScore(displayTerm, termFreq) {
  const lower = displayTerm.toLowerCase();
  if (STOP_WORDS.has(lower)) return -999;
  if (lower.length < 5) return -1;

  let score = 0;
  // Capitalized mid-sentence → likely a proper noun or technical term.
  const isCapitalized =
    displayTerm[0] === displayTerm[0].toUpperCase() &&
    displayTerm[0] !== displayTerm[0].toLowerCase();
  if (isCapitalized) score += 3;
  // Longer words tend to be more specific.
  score += Math.min(Math.floor(displayTerm.length / 3), 4);
  // Higher frequency within the doc → more central to the topic.
  score += Math.min((termFreq.get(lower) || 0), 4);
  return score;
}

// --- Main generator ----------------------------------------------------------

/**
 * @typedef {Object} QuizItem
 * @property {string} id
 * @property {'termDef'|'cloze'} kind
 * @property {string} prompt
 * @property {string} answer
 * @property {string[]} distractors
 * @property {string[]} keywords
 * @property {string} source
 */

/**
 * Generate QuizItems from plain text.
 *
 * @param {string} text          Raw extracted text.
 * @param {{ prompt?: string }} [options]  Unused for now; reserved for R3.5.
 * @returns {{ items: QuizItem[] } | { tooShort: true }}
 */
export function generate(text, _options = {}) {
  const cleaned = clean(text);
  if (nonWhitespaceLength(cleaned) < MIN_CONTENT_LENGTH) return { tooShort: true };

  const sentences = splitSentences(cleaned);
  const allTokensDisplay = tokenizeDisplayTerms(cleaned);

  // Term frequency map (lowercased) for salience scoring.
  const termFreq = new Map();
  for (const t of tokenizeTerms(cleaned)) {
    termFreq.set(t, (termFreq.get(t) || 0) + 1);
  }

  // --- Phase 1: term-definition pairs ----------------------------------------
  /** @type {QuizItem[]} */
  const termDefItems = [];
  const usedSentences = new Set();

  for (const sentence of sentences) {
    if (termDefItems.length >= Math.floor(MAX_ITEMS * 0.6)) break;
    for (const matcher of TERM_DEF_MATCHERS) {
      const pair = matcher(sentence);
      if (pair && pair.term && pair.def && pair.def !== pair.term) {
        termDefItems.push({
          id: `td-${termDefItems.length}`,
          kind: "termDef",
          prompt: pair.term,
          answer: pair.def,
          distractors: [],
          keywords: [pair.term.toLowerCase()],
          source: sentence,
        });
        usedSentences.add(sentence);
        break;
      }
    }
  }

  // --- Phase 2: cloze items from remaining sentences -------------------------
  /** @type {QuizItem[]} */
  const clozeItems = [];
  const usedTerms = new Set(termDefItems.map((i) => i.prompt.toLowerCase()));

  // Build a scored, deduplicated term list for cloze candidates.
  const candidateMap = new Map(); // lower → { display, score }
  for (const t of allTokensDisplay) {
    const lower = t.toLowerCase();
    if (STOP_WORDS.has(lower) || lower.length < 5) continue;
    const score = salienceScore(t, termFreq);
    if (score < 0) continue;
    if (!candidateMap.has(lower) || candidateMap.get(lower).score < score) {
      candidateMap.set(lower, { display: t, score });
    }
  }
  const sortedCandidates = [...candidateMap.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([lower, { display }]) => ({ lower, display }));

  for (const sentence of sentences) {
    if (clozeItems.length >= MAX_ITEMS - termDefItems.length) break;
    if (usedSentences.has(sentence)) continue;
    if (sentence.length < 30) continue;

    const sentLower = sentence.toLowerCase();
    const match = sortedCandidates.find((c) => {
      // Term must appear in the sentence but not be the very first token
      // (blanking the first word makes confusing prompts).
      const idx = sentLower.indexOf(c.lower);
      return idx > 0 && !usedTerms.has(c.lower);
    });
    if (!match) continue;

    // Build cloze by replacing the first occurrence of the term.
    const re = new RegExp(
      match.lower.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&"),
      "i"
    );
    const prompt = sentence.replace(re, "_____");
    if (prompt === sentence) continue; // nothing was replaced

    clozeItems.push({
      id: `cz-${clozeItems.length}`,
      kind: "cloze",
      prompt,
      answer: match.display,
      distractors: [],
      keywords: [match.lower],
      source: sentence,
    });
    usedTerms.add(match.lower);
    usedSentences.add(sentence);
  }

  // --- Combine and add distractors -------------------------------------------
  const allItems = [...termDefItems, ...clozeItems].slice(0, MAX_ITEMS);
  if (allItems.length === 0) return { tooShort: true };

  const allAnswers = allItems.map((i) => i.answer);
  return {
    items: allItems.map((item, idx) => ({
      ...item,
      distractors: pickDistractors(allAnswers, idx),
    })),
  };
}

/**
 * Pick 2–5 distinct distractors for the item at `index` from the other answers.
 * Deterministic: walks outward from the index.
 *
 * @param {string[]} allAnswers
 * @param {number} index
 * @returns {string[]}
 */
function pickDistractors(allAnswers, index) {
  const own = allAnswers[index].toLowerCase();
  const seen = new Set([own]);
  const picked = [];

  for (
    let offset = 1;
    offset < allAnswers.length && picked.length < MAX_DISTRACTORS;
    offset += 1
  ) {
    for (const ci of [index + offset, index - offset]) {
      if (ci < 0 || ci >= allAnswers.length) continue;
      const candidate = allAnswers[ci];
      if (seen.has(candidate.toLowerCase())) continue;
      seen.add(candidate.toLowerCase());
      picked.push(candidate);
      if (picked.length >= MAX_DISTRACTORS) break;
    }
  }
  return picked;
}
