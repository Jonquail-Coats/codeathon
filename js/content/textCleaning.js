// textCleaning.js — pure text normalization and segmentation for the generator.
//
// This is the pure-logic layer for step 1 of the quiz-generation heuristics
// (design.md, "Quiz generation heuristics"): normalize Unicode and whitespace,
// strip control characters, split into sentences, and tokenize into candidate
// terms. Every export here is a pure, deterministic function — no Date, no
// Math.random, no I/O — so it is safe to drive from property-based tests.
//
// Responsibility (structure.md): text cleaning and segmentation only. The quiz
// generator (task 8.1) builds salience scoring and item construction on top of
// these primitives; this module deliberately keeps that scope out.
//
// Requirements: 2.1, 2.2. Correctness Property 6 (idempotent, whitespace-
// collapsing) is the key invariant — see clean() below.

// The single canonical interior separator. After clean(), every run of
// whitespace has been collapsed to exactly this character, so a second pass
// finds nothing left to collapse.
const CANONICAL_SPACE = " ";

// Characters removed outright (not collapsed to a space). These carry no
// textual meaning and would otherwise survive a whitespace collapse and break
// idempotence or pollute tokens:
//   - C0 controls U+0000–U+001F except the whitespace we intentionally collapse
//     (tab \t, line feed \n, vertical tab \v, form feed \f, carriage return \r).
//   - DEL U+007F and the C1 control block U+0080–U+009F.
//   - Zero-width and bidi/format characters: ZWSP, ZWNJ, ZWJ, BOM/ZWNBSP, and
//     the LRM/RLM/LRE..RLO/LRI..PDI formatting marks (U+200B–U+200F, U+202A–
//     U+202E, U+2060, U+2066–U+2069, U+FEFF).
//
// Note: the whitespace controls (\t \n \v \f \r) are NOT stripped here; they are
// handled by the whitespace collapse below so that a line break becomes a word
// separator rather than gluing two words together.
const STRIP_CHARS_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

// Any run of "whitespace" — the standard \s class (which includes \t \n \r \f
// \v, the ASCII space, NBSP U+00A0, and the Unicode space separators) — is
// collapsed to a single CANONICAL_SPACE. \s in JavaScript already covers
// U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, and U+3000, so this one
// class handles every space variant the task calls out.
const WHITESPACE_RUN_RE = /\s+/g;

// Sentence boundary: one or more terminators (. ! ?) optionally followed by
// closing quotes/brackets, then the single canonical space that clean() left
// between sentences. Kept deliberately simple per the task — no abbreviation
// handling — and deterministic.
const SENTENCE_BOUNDARY_RE = /([.!?]+["'”’)\]]*)\s+/g;

// A candidate term is a maximal run of letters/digits, allowing a single
// internal apostrophe or hyphen between word characters (so "don't" and
// "well-known" stay intact) — but not leading/trailing punctuation. Unicode
// letters are matched via \p{L}; the 'u' flag enables that.
const TERM_RE = /\p{L}[\p{L}\p{N}]*(?:['\-][\p{L}\p{N}]+)*/gu;

/**
 * Coerce an arbitrary input into a string for defensive, pure handling.
 *
 * null and undefined become the empty string. Any other non-string is coerced
 * with String(...) so the function stays total and deterministic.
 *
 * @param {unknown} value - Any value.
 * @returns {string} A string; "" for null/undefined.
 */
function toStringSafe(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : String(value);
}

/**
 * Normalize and clean a string of extracted document text.
 *
 * Steps, in order (the order matters for idempotence):
 *   1. Coerce defensively to a string ("" for null/undefined).
 *   2. Unicode-normalize to NFC so canonically equivalent sequences collapse to
 *      one representation.
 *   3. Strip control, zero-width, and format characters outright (STRIP_CHARS_RE).
 *   4. Collapse every run of whitespace to a single ASCII space.
 *   5. Trim leading/trailing whitespace.
 *
 * Idempotence (Correctness Property 6): after one pass the result contains no
 * stripped characters, no whitespace run longer than one ASCII space, and no
 * leading/trailing whitespace. A second pass therefore changes nothing —
 * NFC of an already-NFC ASCII-separated string is itself, STRIP_CHARS_RE matches
 * nothing, each lone ASCII space is already "collapsed", and trim is a no-op.
 * Hence clean(clean(x)) === clean(x) for every input.
 *
 * Pure and deterministic.
 *
 * @param {string} text - Raw text to clean (non-strings are coerced).
 * @returns {string} The cleaned text; "" when there is no visible content.
 * @example
 * clean("  Hello\t\tworld\n\n");        // => "Hello world"
 * clean("a\u200Bb\u00A0 c");            // => "ab c"
 * clean(clean("  x   y  ")) === clean("  x   y  "); // => true
 */
export function clean(text) {
  const normalized = toStringSafe(text).normalize("NFC");
  const stripped = normalized.replace(STRIP_CHARS_RE, "");
  const collapsed = stripped.replace(WHITESPACE_RUN_RE, CANONICAL_SPACE);
  return collapsed.trim();
}

/**
 * Count the non-whitespace characters in a string.
 *
 * Used to measure content length consistently against Min_Content_Length (the
 * generator requires >= 200 non-whitespace characters; Requirement 3.4). This
 * counts on the cleaned form so the measure is stable regardless of incoming
 * whitespace; callers may pass raw text and it is cleaned first.
 *
 * Pure and deterministic.
 *
 * @param {string} text - Text to measure (non-strings are coerced).
 * @returns {number} The number of non-whitespace characters.
 * @example
 * nonWhitespaceLength("  a b  c ");  // => 3
 */
export function nonWhitespaceLength(text) {
  const cleaned = clean(text);
  // After clean(), the only whitespace left is single ASCII spaces, so removing
  // spaces yields exactly the non-whitespace characters.
  return cleaned.replace(/ /g, "").length;
}

/**
 * Split text into sentences using a simple, deterministic heuristic.
 *
 * The input is cleaned first, so sentences are separated by a single space
 * following a run of terminators (. ! ?) and optional closing quotes/brackets.
 * This intentionally does not special-case abbreviations ("e.g.", "Dr.") — the
 * heuristic is kept simple per the task and the design. Trailing text without a
 * terminator is returned as a final sentence. Empty segments are dropped.
 *
 * Pure and deterministic.
 *
 * @param {string} text - Text to segment (non-strings are coerced).
 * @returns {string[]} Trimmed, non-empty sentences in document order.
 * @example
 * splitSentences("Hi there. How are you? Fine!");
 * // => ["Hi there.", "How are you?", "Fine!"]
 */
export function splitSentences(text) {
  const cleaned = clean(text);
  if (cleaned === "") {
    return [];
  }

  // Insert a unit-separator marker after each boundary, keeping the terminator
  // with the sentence it ends, then split on the marker. Using a sentinel that
  // cannot appear in cleaned text (control chars are stripped) keeps this
  // deterministic and avoids lookbehind for broader browser support.
  const SENTINEL = "\u0001";
  const marked = cleaned.replace(SENTENCE_BOUNDARY_RE, `$1${SENTINEL}`);

  return marked
    .split(SENTINEL)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Tokenize text into candidate terms (words) for salience scoring.
 *
 * Terms are maximal runs of Unicode letters/digits, allowing a single internal
 * apostrophe or hyphen (so "don't" and "well-known" survive). Tokens are
 * lowercased so the generator can compare terms case-insensitively; use
 * {@link tokenizeDisplayTerms} when the original surface form is needed (for
 * example, to detect capitalization as a salience signal).
 *
 * Pure and deterministic.
 *
 * @param {string} text - Text to tokenize (non-strings are coerced).
 * @returns {string[]} Lowercased candidate terms in document order (with
 *   repeats preserved, so callers can compute frequency).
 * @example
 * tokenizeTerms("The Red planet is well-known.");
 * // => ["the", "red", "planet", "is", "well-known"]
 */
export function tokenizeTerms(text) {
  return tokenizeDisplayTerms(text).map((term) => term.toLowerCase());
}

/**
 * Tokenize text into candidate terms preserving their original surface form.
 *
 * Same tokenization as {@link tokenizeTerms} but without lowercasing, so the
 * generator can use capitalization as a salience signal (design step 2).
 *
 * Pure and deterministic.
 *
 * @param {string} text - Text to tokenize (non-strings are coerced).
 * @returns {string[]} Candidate terms in document order, original casing kept.
 * @example
 * tokenizeDisplayTerms("The Red planet");
 * // => ["The", "Red", "planet"]
 */
export function tokenizeDisplayTerms(text) {
  const cleaned = clean(text);
  if (cleaned === "") {
    return [];
  }
  const matches = cleaned.match(TERM_RE);
  return matches === null ? [] : matches;
}
