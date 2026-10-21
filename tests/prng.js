// prng.js — small, seedable, deterministic pseudo-random number generator.
//
// Property-based tests must reproduce failures exactly (tech.md: tests must be
// deterministic). A seeded PRNG lets every run with the same seed draw the same
// sequence, so a reported seed re-creates a failing case precisely.
//
// The algorithm is `mulberry32`: a tiny, well-known 32-bit generator with good
// enough statistical quality for test-input generation. It is NOT cryptographic
// and must never be used for security purposes.

/**
 * A deterministic random source seeded by a single 32-bit integer.
 *
 * @typedef {Object} Prng
 * @property {() => number} next      Next float in [0, 1).
 * @property {(min: number, max: number) => number} int
 *   Next integer in [min, max] inclusive (min/max are rounded).
 * @property {(items: readonly T[]) => T} pick  Uniformly pick one element.
 * @property {() => number} seed      The seed this generator was created with.
 * @template T
 */

/**
 * Create a seedable PRNG using the mulberry32 algorithm.
 *
 * @param {number} [seed] 32-bit unsigned seed. Omit for a time-derived seed
 *   (still recorded on the returned object so the run can be reproduced).
 * @returns {Prng} A deterministic generator bound to `seed`.
 */
export function createPrng(seed) {
  const resolvedSeed =
    typeof seed === "number" && Number.isFinite(seed)
      ? seed >>> 0
      : (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;

  // mulberry32 internal state. Each `next()` advances it one step.
  let state = resolvedSeed;

  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Integer in [min, max] inclusive. If max < min the bounds are swapped so the
   * call is still well-defined.
   */
  function int(min, max) {
    let lo = Math.round(min);
    let hi = Math.round(max);
    if (hi < lo) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }
    const span = hi - lo + 1;
    return lo + Math.floor(next() * span);
  }

  /** Uniformly pick one element from a non-empty array. */
  function pick(items) {
    if (!items || items.length === 0) {
      throw new Error("prng.pick: cannot pick from an empty collection");
    }
    return items[int(0, items.length - 1)];
  }

  return {
    next,
    int,
    pick,
    seed: () => resolvedSeed,
  };
}
