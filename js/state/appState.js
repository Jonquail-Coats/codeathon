// appState.js — the single source of truth for Martian Mindhunter.
//
// Per design (Components and Interfaces → appState) and structure.md, this
// module owns exactly one responsibility: application state. It exposes a small
// public API — a store factory plus the pure reducer, an initial-state factory,
// and the action-type constants — and nothing else. Views read snapshots via
// getState(), request transitions via dispatch(action), and re-render when
// subscribe(listener) fires.
//
// The reducer is a PURE function: (state, action) -> newState. It never mutates
// its input, performs no I/O, and calls nothing non-deterministic (no Date.now,
// no Math.random). That purity is what makes it directly unit- and
// property-testable (tasks 2.2, 2.3 import `reducer` and `createInitialState`).
//
// Requirements: 4.2 (open a mode), 4.6 (back control returns to mode select),
// 6.4 (running correct-answer count). Design refs: appState, AppState,
// Screen-state flow.

// --- Types (JSDoc) ----------------------------------------------------------

/**
 * @typedef {'empty'|'extracting'|'modeSelect'|'flashcards'|'multipleChoice'|'freeResponse'|'minigame'} Screen
 */

/**
 * @typedef {'idle'|'thinking'|'celebrate'|'encourage'} MascotState
 */

/**
 * @typedef {Object} UserMessage
 * @property {'error'|'info'} kind
 * @property {string} text
 */

/**
 * @typedef {Object} AppState
 * @property {Screen} currentScreen       Drives which view the router renders.
 * @property {?File} acceptedFile         Last accepted file; retained on reject.
 * @property {string} extractedText       Text handed to the quiz generator.
 * @property {Object[]} quizItems         Generated QuizItem[] (see data model).
 * @property {?string} activeMode         The open mode, or null on mode select.
 * @property {number} sessionScore        Running correct-answer count (R6.4).
 * @property {MascotState} mascotState    Marty's current expression.
 * @property {?UserMessage} message       Current user-facing message, or null.
 * @property {boolean} extracting         Drives the progress indicator (R1.6).
 */

/**
 * @typedef {Object} Action
 * @property {string} type                One of the ActionType values.
 * @property {*} [payload]                 Action-specific data (see reducer).
 */

// --- Action types -----------------------------------------------------------

/**
 * Action-type string constants. Exported so every module dispatches by
 * reference instead of by a hand-typed string literal, which prevents typos
 * from silently becoming no-op actions.
 *
 * @readonly
 */
export const ActionType = Object.freeze({
  FILE_REJECTED: "FILE_REJECTED",
  EXTRACTION_STARTED: "EXTRACTION_STARTED",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  QUIZ_GENERATED: "QUIZ_GENERATED",
  OPEN_MODE: "OPEN_MODE",
  BACK_TO_MODES: "BACK_TO_MODES",
  SCORE_CHANGED: "SCORE_CHANGED",
  MASCOT_STATE: "MASCOT_STATE",
  SET_MESSAGE: "SET_MESSAGE",
});

/**
 * Maps an activeMode name to the screen that renders it. OPEN_MODE uses this so
 * the mode name and its screen stay in lock-step.
 *
 * @type {Record<string, Screen>}
 * @readonly
 */
const MODE_SCREENS = Object.freeze({
  flashcards: "flashcards",
  multipleChoice: "multipleChoice",
  freeResponse: "freeResponse",
  minigame: "minigame",
});

// --- Initial state ----------------------------------------------------------

/**
 * Build a fresh initial AppState. A factory (not a shared constant) so every
 * store — and every test — starts from its own independent object graph and can
 * never accidentally share mutable state across sessions or test cases.
 *
 * @returns {AppState}
 */
export function createInitialState() {
  return {
    currentScreen: "empty",
    acceptedFile: null,
    extractedText: "",
    quizItems: [],
    activeMode: null,
    sessionScore: 0,
    mascotState: "idle",
    message: null,
    extracting: false,
  };
}

// --- Reducer (pure) ---------------------------------------------------------

/**
 * Pure reducer: derive the next state from the current state and an action.
 *
 * Never mutates `state`; every branch returns either `state` unchanged (for an
 * unknown action) or a new object built by spreading `state`. Has no side
 * effects and uses no non-deterministic sources, so `reducer(s, a)` always
 * yields the same result for the same inputs.
 *
 * Action handling (mirrors the design's Screen-state flow):
 * - FILE_REJECTED: set the error/info message; keep acceptedFile and all other
 *   state unchanged so a bad selection never discards the prior file
 *   (R1.3/1.4/1.5). payload: UserMessage.
 * - EXTRACTION_STARTED: screen → extracting, extracting → true, mascot →
 *   thinking, and clear any prior message.
 * - EXTRACTION_FAILED: screen → empty, extracting → false, set the error
 *   message, mascot → encourage. payload: UserMessage.
 * - QUIZ_GENERATED: store quizItems, screen → modeSelect, mascot → idle,
 *   extracting → false, clear the message. payload: { items, text? }.
 * - OPEN_MODE: set activeMode and switch to its matching screen (R4.2).
 *   payload: { mode } where mode is a key of MODE_SCREENS.
 * - BACK_TO_MODES: screen → modeSelect, activeMode → null (R4.6).
 * - SCORE_CHANGED: increment the running correct-answer count by 1 (R6.4).
 * - MASCOT_STATE: set mascotState. payload: { state }.
 * - SET_MESSAGE: set (or clear, with payload null) the user message.
 *
 * @param {AppState} state  Current state (treated as read-only).
 * @param {Action} action   Action to apply.
 * @returns {AppState}       The next state (a new object if anything changed).
 */
export function reducer(state, action) {
  switch (action.type) {
    case ActionType.FILE_REJECTED:
      // Keep acceptedFile and everything else; only surface the message.
      return { ...state, message: action.payload ?? null };

    case ActionType.EXTRACTION_STARTED:
      return {
        ...state,
        currentScreen: "extracting",
        extracting: true,
        mascotState: "thinking",
        message: null,
      };

    case ActionType.EXTRACTION_FAILED:
      return {
        ...state,
        currentScreen: "empty",
        extracting: false,
        mascotState: "encourage",
        message: action.payload ?? null,
      };

    case ActionType.QUIZ_GENERATED:
      return {
        ...state,
        quizItems: action.payload?.items ?? [],
        extractedText:
          action.payload?.text !== undefined
            ? action.payload.text
            : state.extractedText,
        currentScreen: "modeSelect",
        activeMode: null,
        mascotState: "idle",
        extracting: false,
        message: null,
      };

    case ActionType.OPEN_MODE: {
      const mode = action.payload?.mode;
      const screen = MODE_SCREENS[mode];
      // Ignore an unknown mode rather than entering an undefined screen.
      if (!screen) return state;
      return { ...state, activeMode: mode, currentScreen: screen };
    }

    case ActionType.BACK_TO_MODES:
      return { ...state, currentScreen: "modeSelect", activeMode: null };

    case ActionType.SCORE_CHANGED:
      // R6.4: the running score is a count of correct answers, so each correct
      // selection increments it by exactly one.
      return { ...state, sessionScore: state.sessionScore + 1 };

    case ActionType.MASCOT_STATE: {
      const next = action.payload?.state;
      if (!next || next === state.mascotState) return state;
      return { ...state, mascotState: next };
    }

    case ActionType.SET_MESSAGE:
      // payload may be a UserMessage or null (to clear the message).
      return { ...state, message: action.payload ?? null };

    default:
      // Unknown action: no change. Returning the same reference lets the store
      // skip notifying subscribers.
      return state;
  }
}

// --- Store ------------------------------------------------------------------

/**
 * @typedef {Object} Store
 * @property {() => AppState} getState   Current state snapshot (read-only).
 * @property {(action: Action) => void} dispatch  Apply an action via the reducer.
 * @property {(listener: () => void) => (() => void)} subscribe  Register a
 *   listener; returns an unsubscribe function.
 */

/**
 * Create a store wrapping the pure reducer with getState / dispatch / subscribe.
 *
 * dispatch runs the reducer and only notifies subscribers when the state
 * reference actually changed — the reducer returns the same object for no-op
 * actions, so an unknown or inert action costs nothing. Listeners are notified
 * from a snapshot of the listener list, so a listener that subscribes or
 * unsubscribes during notification does not corrupt the in-progress pass.
 *
 * @param {AppState} [preloadedState]  Optional starting state (defaults to a
 *   fresh createInitialState()); useful for tests and resuming a session.
 * @returns {Store}
 */
export function createStore(preloadedState) {
  let state = preloadedState ?? createInitialState();
  /** @type {Set<() => void>} */
  const listeners = new Set();

  /** @returns {AppState} the current state snapshot. */
  function getState() {
    return state;
  }

  /**
   * Apply an action through the reducer, then notify subscribers if the state
   * changed.
   *
   * @param {Action} action
   */
  function dispatch(action) {
    if (!action || typeof action.type !== "string") {
      throw new TypeError("dispatch: action must be an object with a string `type`");
    }
    const next = reducer(state, action);
    if (next === state) return; // no change → no notification
    state = next;
    // Snapshot the listeners so subscribe/unsubscribe during notification is safe.
    for (const listener of [...listeners]) {
      listener();
    }
  }

  /**
   * Register a listener invoked after any state change. The listener reads the
   * new state via getState(). Idempotent unsubscribe.
   *
   * @param {() => void} listener
   * @returns {() => void} unsubscribe
   */
  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("subscribe: listener must be a function");
    }
    listeners.add(listener);
    let subscribed = true;
    return function unsubscribe() {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  }

  return { getState, dispatch, subscribe };
}
