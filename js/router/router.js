// router.js — screen switching + focus management.
//
// A single render(state) mounts the correct view for state.currentScreen into
// the main content region, tearing down the previous view first. Each view is
// responsible for moving focus to its own heading (tabindex=-1) when mounted,
// so keyboard users land on the new content after every screen change (R11.6)
// and focus is never trapped (R11.1/11.2). The router centralizes this wiring
// so views don't each re-implement it.

import * as deckSetup from "../ui/deckSetup.js";
import * as modeSelect from "../modes/modeSelect.js";
import * as flashcards from "../modes/flashcardsMode.js";
import * as multipleChoice from "../modes/multipleChoiceMode.js";
import * as freeResponse from "../modes/freeResponseMode.js";
import * as minigame from "../modes/minigameMode.js";

/**
 * Create a router bound to a mount element, store, and a set of callbacks the
 * views use to drive state transitions.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.mount       The main content region.
 * @param {Object} opts.store            The appState store.
 * @param {Object} opts.handlers         View callbacks.
 * @param {(cards: Object[]) => void} opts.handlers.onDeck
 * @param {(mode: string) => void} opts.handlers.onOpenMode
 * @param {() => void} opts.handlers.onBackToModes
 * @param {() => void} opts.handlers.onNewDeck
 * @returns {{ render: () => void }}
 */
export function createRouter({ mount, store, handlers }) {
  let teardown = null;
  let lastScreen = null;
  let lastMode = null;

  function render() {
    const state = store.getState();
    const screen = state.currentScreen;

    // Avoid re-mounting the same screen/mode on unrelated state changes
    // (e.g. a SCORE_CHANGED while inside a mode), which would reset the view.
    if (screen === lastScreen && state.activeMode === lastMode) return;
    lastScreen = screen;
    lastMode = state.activeMode;

    if (typeof teardown === "function") {
      teardown();
      teardown = null;
    }

    const items = state.quizItems;
    const cardCount = items.length;

    switch (screen) {
      case "empty":
      case "extracting":
        teardown = deckSetup.open(mount, { onItems: handlers.onItems });
        break;
      case "modeSelect":
        teardown = modeSelect.open(mount, {
          items,
          cardCount,
          onOpen: handlers.onOpenMode,
          onNewDeck: handlers.onNewDeck,
        });
        break;
      case "flashcards":
        teardown = flashcards.open(mount, { items, store, onBack: handlers.onBackToModes });
        break;
      case "multipleChoice":
        teardown = multipleChoice.open(mount, { items, store, onBack: handlers.onBackToModes });
        break;
      case "freeResponse":
        teardown = freeResponse.open(mount, { items, store, onBack: handlers.onBackToModes });
        break;
      case "minigame":
        teardown = minigame.open(mount, { items, store, onBack: handlers.onBackToModes });
        break;
      default:
        teardown = deckSetup.open(mount, { onDeck: handlers.onDeck });
        break;
    }
  }

  return { render };
}
