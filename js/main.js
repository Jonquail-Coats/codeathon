// main.js — thin entry point for Martian Mindhunter.
//
// Per structure.md, the entry point only bootstraps and wires modules
// together; the real logic lives in the modules under js/. It creates the
// store, builds a router over the content region, defines the handlers that
// translate view intents into store actions, subscribes the router to the
// store, and renders the first screen.

import { createStore, ActionType } from "./state/appState.js";
import { createRouter } from "./router/router.js";

const MOUNT_ID = "app";

function mount() {
  const root = document.getElementById(MOUNT_ID);
  if (!root) {
    console.error(`Martian Mindhunter: missing #${MOUNT_ID} content region.`);
    return;
  }

  const store = createStore();

  const handlers = {
    // QuizItems are now built upstream (deckSetup handles extraction + generation),
    // so this handler just dispatches them directly. Both the sample deck and the
    // file-upload path produce QuizItem[] before calling onItems.
    onItems(items) {
      if (!items || items.length === 0) {
        store.dispatch({
          type: ActionType.SET_MESSAGE,
          payload: { kind: "error", text: "That deck had no usable cards." },
        });
        return;
      }
      store.dispatch({ type: ActionType.QUIZ_GENERATED, payload: { items } });
    },
    // A mode bubble was activated.
    onOpenMode(mode) {
      store.dispatch({ type: ActionType.OPEN_MODE, payload: { mode } });
    },
    // A back control inside a mode was used.
    onBackToModes() {
      store.dispatch({ type: ActionType.BACK_TO_MODES });
      store.dispatch({ type: ActionType.MASCOT_STATE, payload: { state: "idle" } });
    },
    // "Load a different deck" returns to the empty setup screen.
    onNewDeck() {
      store.dispatch({ type: ActionType.EXTRACTION_FAILED, payload: null });
    },
  };

  const router = createRouter({ mount: root, store, handlers });
  store.subscribe(() => router.render());
  router.render();

  console.info("Martian Mindhunter: app mounted.");
}

mount();
