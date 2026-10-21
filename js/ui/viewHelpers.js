// viewHelpers.js — small, purpose-scoped DOM construction helpers.
//
// Scoped strictly to building DOM nodes for the views; not a generic "utils"
// dumping ground (structure.md). Keeping element creation here keeps the views
// declarative and free of repeated boilerplate.

/**
 * Create an element with attributes, dataset, and children in one call.
 *
 * @param {string} tag                 Tag name.
 * @param {Object} [attrs]             Attributes. Keys: `class`/`className`,
 *   `text` (textContent), `html` is intentionally unsupported (no innerHTML),
 *   `dataset` (object), `on` (event map), everything else set via setAttribute.
 * @param {(Node|string)[]} [children] Child nodes or text.
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class" || key === "className") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
    } else if (key === "on") {
      for (const [evt, handler] of Object.entries(value)) {
        node.addEventListener(evt, handler);
      }
    } else if (key === "html") {
      throw new Error("viewHelpers.el: raw html is not supported; build nodes instead");
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Build a standard view scaffold: a titled section with a heading that can
 * receive focus (for the router's focus management) and a back control.
 *
 * @param {Object} opts
 * @param {string} opts.title             Screen heading text.
 * @param {string} [opts.screenClass]     Extra class on the section.
 * @param {() => void} [opts.onBack]      If given, renders a "Back" button.
 * @param {string} [opts.backLabel]       Back button label.
 * @returns {{ section: HTMLElement, heading: HTMLElement, body: HTMLElement }}
 */
export function screen({ title, screenClass = "", onBack, backLabel = "Back to modes" }) {
  const heading = el("h1", { class: "screen__title", tabindex: "-1", text: title });

  const header = el("div", { class: "screen__header" }, [heading]);
  if (typeof onBack === "function") {
    const back = el("button", {
      type: "button",
      class: "btn btn--ghost screen__back",
      text: `\u2190 ${backLabel}`,
      on: { click: onBack },
    });
    header.prepend(back);
  }

  const body = el("div", { class: "screen__body" });
  const section = el("section", { class: `screen ${screenClass}`.trim() }, [header, body]);
  return { section, heading, body };
}

/**
 * Create a labeled button.
 *
 * @param {string} label
 * @param {() => void} onClick
 * @param {Object} [opts] extra attributes (e.g. { class, disabled })
 * @returns {HTMLButtonElement}
 */
export function button(label, onClick, opts = {}) {
  return el("button", {
    type: "button",
    class: `btn ${opts.class ?? ""}`.trim(),
    text: label,
    ...(opts.disabled ? { disabled: "" } : {}),
    on: { click: onClick },
  });
}
