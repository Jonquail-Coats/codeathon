// runner.js — the in-browser test harness for Martian Mindhunter.
//
// Self-contained, vanilla ES module. No npm, no build step, no network. It
// provides:
//   - a test registry: `test(name, fn)` registers; `run()` executes all.
//   - assertion helpers (re-exported from ./assert.js).
//   - a property-based testing API: `forAll(generators, predicate, opts)` with a
//     seedable, deterministic PRNG and basic shrinking of failing inputs.
//   - input generators (re-exported from ./generators.js).
//   - a results API: `run()` returns totals and per-test outcomes; `renderResults`
//     paints a readable, not-color-only report into the DOM.
//
// Later test tasks (2.2, 3.2, 4.2, 8.x, ...) author test modules under the
// mirrored tree (e.g. tests/content/textCleaning.test.js) that import this
// module and call `test(...)` / `forAll(...)` at module load time. runner.html
// imports those modules (see its REGISTER block) and then calls `run()`.

import { createPrng } from "./prng.js";
import * as assert from "./assert.js";
import * as gen from "./generators.js";

// Re-export the building blocks so test modules import everything from one place.
export { createPrng } from "./prng.js";
export {
  AssertionError,
  assertEqual,
  assertTrue,
  assertFalse,
  assertThrows,
  deepEqual,
} from "./assert.js";
export * as generators from "./generators.js";

/**
 * @typedef {Object} TestResult
 * @property {string} name
 * @property {'pass'|'fail'} status
 * @property {'unit'|'property'} kind
 * @property {string} [error]          Failure message (on fail).
 * @property {number} [seed]           Seed that reproduces a property failure.
 * @property {unknown} [failingExample] Minimal shrunk input (on property fail).
 * @property {number} [iterations]     Iterations run (property tests).
 */

/** @type {{ name: string, kind: 'unit'|'property', fn: () => void }[]} */
const registry = [];

/**
 * Register a test. The body runs synchronously during `run()` and signals
 * failure by throwing (assertion helpers throw AssertionError).
 *
 * @param {string} name Unique, descriptive test name.
 * @param {() => void} fn Test body.
 */
export function test(name, fn) {
  registry.push({ name, kind: "unit", fn });
}

/** Remove all registered tests. Primarily for the harness self-test. */
export function resetRegistry() {
  registry.length = 0;
}

/** Number of currently registered tests. */
export function registeredCount() {
  return registry.length;
}

// --- Property-based testing -------------------------------------------------

/** Signal thrown by a predicate indirectly via assertions, or returning false. */
class PropertyFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "PropertyFailure";
  }
}

/**
 * Run `predicate` against `generators` and record the result. A predicate
 * passes for an input tuple when it returns a value that is not strictly
 * `false` and does not throw. On the first failing tuple the harness shrinks
 * the input toward a simpler counterexample and reports it with the seed.
 *
 * This is used inside a registered `test(...)` body, e.g.:
 *
 *   test("Property 6: clean is idempotent", () => {
 *     forAll([generators.string({ maxLength: 60 })],
 *            (s) => clean(clean(s)) === clean(s),
 *            { seed: 42 });
 *   });
 *
 * @param {Array<(prng: import('./prng.js').Prng) => unknown>} genList
 *   One generator per predicate parameter.
 * @param {(...args: unknown[]) => unknown} predicate
 *   Returns `false` (or throws) to indicate the property does not hold.
 * @param {{ iterations?: number, seed?: number }} [opts]
 * @throws {PropertyFailure} with the minimal failing example and seed.
 */
export function forAll(genList, predicate, { iterations = 100, seed } = {}) {
  if (!Array.isArray(genList) || genList.length === 0) {
    throw new Error("forAll: provide at least one generator");
  }
  const runs = Math.max(1, iterations);
  const prng = createPrng(seed);
  const usedSeed = prng.seed();

  for (let i = 0; i < runs; i += 1) {
    const inputs = genList.map((g) => g(prng));
    const outcome = evaluate(predicate, inputs);
    if (!outcome.ok) {
      const minimal = shrink(genList, predicate, inputs);
      const rendered = JSON.stringify(minimal.inputs);
      throw new PropertyFailure(
        `property failed after ${i + 1} iteration(s) (seed ${usedSeed}); ` +
          `minimal failing input: ${rendered}` +
          (minimal.reason ? ` — ${minimal.reason}` : "")
      );
    }
  }
}

/** Evaluate the predicate on an input tuple, capturing throw-vs-false. */
function evaluate(predicate, inputs) {
  try {
    const result = predicate(...inputs);
    return { ok: result !== false, reason: result === false ? "returned false" : "" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/**
 * Shrink a failing input tuple toward a simpler one that still fails. We shrink
 * each position independently with type-aware candidate generators (smaller
 * numbers, shorter strings/arrays) and greedily accept any candidate that still
 * fails, repeating until no candidate improves. Deterministic — no PRNG use.
 *
 * @param {Array<Function>} genList (unused; kept for signature symmetry/future)
 * @param {Function} predicate
 * @param {unknown[]} inputs The original failing tuple.
 * @returns {{ inputs: unknown[], reason: string }}
 */
function shrink(genList, predicate, inputs) {
  let current = inputs.slice();
  let reason = evaluate(predicate, current).reason;
  let improved = true;
  let guard = 0;

  while (improved && guard < 1000) {
    improved = false;
    guard += 1;
    for (let pos = 0; pos < current.length; pos += 1) {
      for (const candidateValue of shrinkCandidates(current[pos])) {
        const trial = current.slice();
        trial[pos] = candidateValue;
        const outcome = evaluate(predicate, trial);
        if (!outcome.ok) {
          current = trial;
          reason = outcome.reason;
          improved = true;
          break; // restart this position with the smaller value
        }
      }
    }
  }
  return { inputs: current, reason };
}

/**
 * Yield simpler candidate values for a single input, ordered simplest-first.
 * Covers the shapes our generators produce: numbers, strings, arrays, and plain
 * objects (shrinking each own-enumerable field).
 *
 * @param {unknown} value
 * @returns {unknown[]}
 */
function shrinkCandidates(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidates = new Set();
    if (value !== 0) candidates.add(0);
    const halved = Math.trunc(value / 2);
    if (halved !== value) candidates.add(halved);
    if (value > 0) candidates.add(value - 1);
    if (value < 0) candidates.add(value + 1);
    return [...candidates];
  }

  if (typeof value === "string") {
    if (value.length === 0) return [];
    const out = [];
    out.push(""); // empty is simplest
    out.push(value.slice(0, Math.floor(value.length / 2))); // first half
    out.push(value.slice(1)); // drop first char
    out.push(value.slice(0, -1)); // drop last char
    return dedupe(out, value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const out = [];
    out.push([]); // empty is simplest
    out.push(value.slice(0, Math.floor(value.length / 2)));
    out.push(value.slice(1));
    out.push(value.slice(0, -1));
    return out;
  }

  if (value && typeof value === "object") {
    // Shrink one field at a time, recursively.
    const out = [];
    for (const key of Object.keys(value)) {
      for (const fieldCandidate of shrinkCandidates(value[key])) {
        out.push({ ...value, [key]: fieldCandidate });
      }
    }
    return out;
  }

  return [];
}

/** Drop duplicates and any candidate equal to the original. */
function dedupe(candidates, original) {
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = JSON.stringify(c);
    if (key === JSON.stringify(original) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// --- Running & results ------------------------------------------------------

/**
 * Execute every registered test in registration order.
 *
 * @returns {{ total: number, passed: number, failed: number, results: TestResult[] }}
 */
export function run() {
  /** @type {TestResult[]} */
  const results = [];
  for (const entry of registry) {
    // A test counts as a property test if it threw a PropertyFailure.
    try {
      entry.fn();
      results.push({ name: entry.name, status: "pass", kind: entry.kind });
    } catch (err) {
      const isProperty = err instanceof PropertyFailure;
      const message = err instanceof Error ? err.message : String(err);
      const seedMatch = isProperty ? /seed (\d+)/.exec(message) : null;
      results.push({
        name: entry.name,
        status: "fail",
        kind: isProperty ? "property" : entry.kind,
        error: message,
        ...(seedMatch ? { seed: Number(seedMatch[1]) } : {}),
      });
    }
  }
  const passed = results.filter((r) => r.status === "pass").length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

/**
 * Render a report into the DOM. Accessible by design: every row shows the
 * literal word PASS or FAIL (not color alone) and the summary is written into
 * an ARIA live region so assistive tech announces the outcome.
 *
 * @param {HTMLElement} target Container to render into (cleared first).
 * @param {ReturnType<typeof run>} summary Output of `run()`.
 */
export function renderResults(target, summary) {
  target.replaceChildren();

  const heading = document.createElement("h2");
  const allPass = summary.failed === 0 && summary.total > 0;
  const noTests = summary.total === 0;
  heading.textContent = noTests
    ? "0 tests registered"
    : `${summary.passed}/${summary.total} passed`;
  heading.className = noTests ? "summary empty" : allPass ? "summary pass" : "summary fail";

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = noTests
    ? "No tests were registered. Add test modules to runner.html."
    : allPass
    ? `PASS — all ${summary.total} tests passed.`
    : `FAIL — ${summary.failed} of ${summary.total} tests failed.`;

  const list = document.createElement("ul");
  list.className = "results";
  for (const r of summary.results) {
    const li = document.createElement("li");
    li.className = `result ${r.status}`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = r.status === "pass" ? "PASS" : "FAIL";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = ` ${r.name}`;

    li.append(badge, name);

    if (r.status === "fail" && r.error) {
      const detail = document.createElement("pre");
      detail.className = "detail";
      detail.textContent = r.error;
      li.append(detail);
    }
    list.append(li);
  }

  target.append(heading, status, list);
}

// Convenience grouped export for test modules that prefer a namespace import.
export const asserts = assert;
export const g = gen;
