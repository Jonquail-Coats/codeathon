// runner.selftest.js — a tiny sanity suite that exercises the harness itself.
//
// Opening runner.html runs these so a human can see the harness actually works,
// and so a later regression in the harness (PRNG, assertions, forAll, shrinking)
// shows up as a red row instead of silently breaking every real test. These are
// NOT application tests; they only validate the test infrastructure.
//
// Registered via `test(...)` at module load time, the same way real test modules
// (added by tasks 2.2, 3.2, ...) register their tests.

import {
  test,
  forAll,
  generators,
  createPrng,
  assertEqual,
  assertTrue,
  assertFalse,
  assertThrows,
  deepEqual,
} from "./runner.js";

test("assertEqual: deep equality for arrays and plain objects", () => {
  assertEqual([1, 2, { a: 3 }], [1, 2, { a: 3 }]);
  assertTrue(deepEqual({ x: [1], y: "z" }, { y: "z", x: [1] }));
  assertFalse(deepEqual({ a: 1 }, { a: 2 }));
});

test("assertThrows: detects a throwing function and matches its message", () => {
  assertThrows(() => {
    throw new Error("boom: not allowed");
  }, "not allowed");
  assertThrows(() => {
    throw new Error("regex path");
  }, /regex/);
});

test("PRNG: same seed yields identical sequences (reproducible)", () => {
  const a = createPrng(12345);
  const b = createPrng(12345);
  for (let i = 0; i < 20; i += 1) {
    assertEqual(a.next(), b.next(), `draw ${i}`);
  }
  // A different seed should diverge somewhere in the first few draws.
  const c = createPrng(999);
  let diverged = false;
  const d = createPrng(12345);
  for (let i = 0; i < 20; i += 1) {
    if (c.next() !== d.next()) {
      diverged = true;
      break;
    }
  }
  assertTrue(diverged, "distinct seeds should produce different sequences");
});

test("fileDescriptor generator yields the { name, type, size } shape", () => {
  const prng = createPrng(7);
  const make = generators.fileDescriptor();
  for (let i = 0; i < 50; i += 1) {
    const fd = make(prng);
    assertTrue(typeof fd.name === "string", "name is a string");
    assertTrue(typeof fd.type === "string", "type is a string");
    assertTrue(typeof fd.size === "number" && fd.size >= 0, "size is a non-negative number");
  }
});

test("Property (self): a true property passes across >= 100 iterations", () => {
  // Trivial invariant: integers in [-5, 5] are within their own bounds.
  forAll([generators.integer({ min: -5, max: 5 })], (n) => n >= -5 && n <= 5, {
    iterations: 100,
    seed: 1,
  });
});

test("Property (self): string length never exceeds its configured maximum", () => {
  forAll([generators.string({ minLength: 0, maxLength: 30 })], (s) => s.length <= 30, {
    iterations: 150,
    seed: 2,
  });
});

test("Property (self): a false property fails and shrinks toward a small case", () => {
  // Deliberately-false property: "every integer in [0, 50] is < 3". forAll must
  // throw, and shrinking should drive the counterexample down to the boundary 3.
  assertThrows(
    () => {
      forAll([generators.integer({ min: 0, max: 50 })], (n) => n < 3, {
        iterations: 200,
        seed: 3,
      });
    },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Minimal failing input for "n < 3" is 3; shrinking should reach it.
      return msg.includes("[3]") && msg.includes("seed");
    },
    "a false property should fail and report a minimal, seeded counterexample"
  );
});
