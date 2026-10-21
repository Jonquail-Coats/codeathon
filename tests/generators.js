// generators.js — input generators for the property-based testing harness.
//
// A generator is `(prng) => value`: a pure function of a seeded PRNG, so the
// same seed reproduces the same value. Generators are the building blocks that
// `forAll` (in runner.js) samples from, and they are the first argument to the
// `shrink` helpers the runner uses to minimize a failing case.
//
// Ranges are configurable via an options object so later property tests can
// constrain the input space (e.g. sizes spanning 0..>25MB for file validation,
// or longer strings for text-cleaning idempotence).

const MB = 1024 * 1024;

// Characters that later text-cleaning tests care about: ASCII, a spread of
// whitespace (space, tab, newline, CR, no-break space, various Unicode spaces),
// control characters, and a few non-ASCII/"unicode-ish" letters.
const WHITESPACE_CHARS = [
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  "\v",
  "\u00a0", // no-break space
  "\u2003", // em space
  "\u2009", // thin space
  "\u200b", // zero-width space
];
const CONTROL_CHARS = ["\u0000", "\u0001", "\u0007", "\u001b", "\u007f"];
const LETTER_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const UNICODE_CHARS = ["é", "ñ", "ü", "λ", "д", "あ", "文", "😀", "—", "“", "”"];

/**
 * Integer in a configurable inclusive range.
 *
 * @param {{ min?: number, max?: number }} [opts]
 * @returns {(prng: import('./prng.js').Prng) => number}
 */
export function integer({ min = -1000, max = 1000 } = {}) {
  return (prng) => prng.int(min, max);
}

/**
 * Non-negative size in bytes, configurable. Defaults deliberately span the
 * 25 MB file-size boundary so file-validation tests exercise both sides of the
 * limit (and 0-byte files).
 *
 * @param {{ min?: number, max?: number }} [opts]
 * @returns {(prng: import('./prng.js').Prng) => number}
 */
export function size({ min = 0, max = 30 * MB } = {}) {
  return (prng) => prng.int(min, max);
}

/**
 * String generator. Picks characters from configurable pools so tests can bias
 * toward whitespace, control chars, or unicode. Length is drawn from a
 * configurable range.
 *
 * @param {Object} [opts]
 * @param {number} [opts.minLength]
 * @param {number} [opts.maxLength]
 * @param {boolean} [opts.letters]    Include ASCII letters (default true).
 * @param {boolean} [opts.whitespace] Include assorted whitespace (default true).
 * @param {boolean} [opts.control]    Include control characters (default false).
 * @param {boolean} [opts.unicode]    Include non-ASCII letters/punctuation (default true).
 * @returns {(prng: import('./prng.js').Prng) => string}
 */
export function string({
  minLength = 0,
  maxLength = 40,
  letters = true,
  whitespace = true,
  control = false,
  unicode = true,
} = {}) {
  const pool = [];
  if (letters) pool.push(...LETTER_CHARS);
  if (whitespace) pool.push(...WHITESPACE_CHARS);
  if (control) pool.push(...CONTROL_CHARS);
  if (unicode) pool.push(...UNICODE_CHARS);
  if (pool.length === 0) pool.push(...LETTER_CHARS); // never empty

  return (prng) => {
    const len = prng.int(minLength, maxLength);
    let out = "";
    for (let i = 0; i < len; i += 1) {
      out += prng.pick(pool);
    }
    return out;
  };
}

/**
 * Array generator over an element generator, with a configurable length range.
 *
 * @template T
 * @param {(prng: import('./prng.js').Prng) => T} element
 * @param {{ minLength?: number, maxLength?: number }} [opts]
 * @returns {(prng: import('./prng.js').Prng) => T[]}
 */
export function array(element, { minLength = 0, maxLength = 10 } = {}) {
  return (prng) => {
    const len = prng.int(minLength, maxLength);
    const out = [];
    for (let i = 0; i < len; i += 1) {
      out.push(element(prng));
    }
    return out;
  };
}

/**
 * Pick one value uniformly from a fixed set.
 *
 * @template T
 * @param {readonly T[]} choices Non-empty list of candidate values.
 * @returns {(prng: import('./prng.js').Prng) => T}
 */
export function oneOf(choices) {
  if (!choices || choices.length === 0) {
    throw new Error("oneOf: choices must be a non-empty array");
  }
  return (prng) => prng.pick(choices);
}

/**
 * Constant generator — always yields the same value. Useful for composing with
 * other generators or pinning one field of a record.
 *
 * @template T
 * @param {T} value
 * @returns {(prng: import('./prng.js').Prng) => T}
 */
export function constant(value) {
  return () => value;
}

/**
 * File-descriptor generator producing the simple `{ name, type, size }` shape
 * the FileImporter validation tests (task 4.2) exercise. The `type` spans
 * supported extensions (`pdf`, `docx`) and unsupported ones (`txt`, `exe`,
 * `png`, `""`); the `size` spans 0..>25MB so both boundaries of the file-size
 * limit are hit. All ranges/sets are configurable.
 *
 * `name` is derived to carry the extension so extension-based detection can be
 * tested, but `type` is kept as the authoritative field for convenience.
 *
 * @param {Object} [opts]
 * @param {readonly string[]} [opts.types]  Extensions to pick from.
 * @param {number} [opts.minSize]
 * @param {number} [opts.maxSize]
 * @returns {(prng: import('./prng.js').Prng) => { name: string, type: string, size: number }}
 */
export function fileDescriptor({
  types = ["pdf", "docx", "txt", "exe", "png", "jpg", ""],
  minSize = 0,
  maxSize = 30 * MB,
} = {}) {
  const sizeGen = size({ min: minSize, max: maxSize });
  return (prng) => {
    const type = prng.pick(types);
    const stem = string({ minLength: 1, maxLength: 12, whitespace: false, unicode: false })(
      prng
    );
    const name = type ? `${stem}.${type}` : stem;
    return { name, type, size: sizeGen(prng) };
  };
}
