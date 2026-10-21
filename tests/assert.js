// assert.js — assertion helpers for the in-browser test harness.
//
// These throw an AssertionError on failure; the runner catches it and records a
// failing test. Keeping assertions in their own module keeps runner.js focused
// on orchestration and reporting.

/** Error type thrown by every assertion so the runner can distinguish it. */
export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Deep structural equality for the value shapes our tests produce: primitives,
 * arrays, and plain objects. Uses `Object.is` for primitives so `NaN` equals
 * `NaN` and `+0`/`-0` differ. Does not attempt to compare Maps, Sets, Dates, or
 * class instances — tests should not rely on those.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean} True when `a` and `b` are structurally equal.
 */
export function deepEqual(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) {
    return false;
  }

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

/** Compact, readable rendering of a value for assertion messages. */
function show(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "function") {
    return `[function ${value.name || "anonymous"}]`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Assert deep equality between `actual` and `expected`.
 *
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message] Optional context prepended to the failure message.
 */
export function assertEqual(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    const prefix = message ? `${message}: ` : "";
    throw new AssertionError(
      `${prefix}expected ${show(expected)} but got ${show(actual)}`
    );
  }
}

/**
 * Assert that `value` is strictly `true` (truthy is not enough, to catch
 * accidental non-boolean returns).
 *
 * @param {unknown} value
 * @param {string} [message]
 */
export function assertTrue(value, message) {
  if (value !== true) {
    throw new AssertionError(message || `expected true but got ${show(value)}`);
  }
}

/**
 * Assert that `value` is strictly `false`.
 *
 * @param {unknown} value
 * @param {string} [message]
 */
export function assertFalse(value, message) {
  if (value !== false) {
    throw new AssertionError(message || `expected false but got ${show(value)}`);
  }
}

/**
 * Assert that calling `fn` throws. When `matcher` is provided, the thrown error
 * must satisfy it: a string is matched as a substring of the error message, a
 * RegExp is tested against the message, and a function receives the error and
 * must return a truthy value.
 *
 * @param {() => unknown} fn Function expected to throw when invoked.
 * @param {string | RegExp | ((err: unknown) => boolean)} [matcher]
 * @param {string} [message]
 * @returns {unknown} The thrown error (for further inspection).
 */
export function assertThrows(fn, matcher, message) {
  const prefix = message ? `${message}: ` : "";
  let thrown;
  let didThrow = false;
  try {
    fn();
  } catch (err) {
    didThrow = true;
    thrown = err;
  }
  if (!didThrow) {
    throw new AssertionError(`${prefix}expected function to throw, but it did not`);
  }
  if (matcher !== undefined) {
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    let ok;
    if (typeof matcher === "string") {
      ok = msg.includes(matcher);
    } else if (matcher instanceof RegExp) {
      ok = matcher.test(msg);
    } else if (typeof matcher === "function") {
      ok = Boolean(matcher(thrown));
    } else {
      ok = true;
    }
    if (!ok) {
      throw new AssertionError(
        `${prefix}thrown error ${show(msg)} did not match the expected condition`
      );
    }
  }
  return thrown;
}
