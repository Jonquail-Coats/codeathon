// messages.js — the single user-facing messaging mechanism.
//
// All feedback (errors and info) flows through here so wording and placement
// are consistent and announced to assistive technology via the ARIA live
// region declared in index.html (#live-region). Text is always the
// authoritative cue — the mascot may react in-character, but a reaction is
// never the sole signal (design → Error Handling, Mascot accessibility; R11.3).

import { el } from "./viewHelpers.js";

const LIVE_REGION_ID = "live-region";

/**
 * Announce a message to assistive tech without necessarily rendering it
 * visibly. Writes into the always-present ARIA live region.
 *
 * @param {string} text
 */
export function announce(text) {
  const region = document.getElementById(LIVE_REGION_ID);
  if (!region) return;
  // Clear then set on the next frame so repeated identical messages re-announce.
  region.textContent = "";
  // eslint-disable-next-line no-unused-expressions
  region.offsetHeight; // reflow
  region.textContent = text;
}

/**
 * Build a visible message element and announce it to the live region.
 *
 * @param {{ kind: 'error'|'info'|'success', text: string }} message
 * @returns {HTMLElement}
 */
export function renderMessage(message) {
  if (!message || !message.text) return el("span");
  const kind = message.kind || "info";
  const prefix = kind === "error" ? "Error: " : kind === "success" ? "Correct: " : "";
  announce(`${prefix}${message.text}`);
  return el("p", {
    class: `message message--${kind}`,
    role: kind === "error" ? "alert" : "status",
    text: message.text,
  });
}

/**
 * Write a message into an existing container (clearing prior content) and
 * announce it. Returns the element for convenience.
 *
 * @param {HTMLElement} container
 * @param {{ kind: 'error'|'info'|'success', text: string }} message
 * @returns {HTMLElement}
 */
export function showIn(container, message) {
  const node = renderMessage(message);
  container.replaceChildren(node);
  return node;
}
