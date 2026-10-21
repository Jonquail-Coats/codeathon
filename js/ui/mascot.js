// mascot.js — "Marty the Martian", the app's cartoon guide.
//
// Marty is a green alien piloting a silver flying saucer, authored as bundled
// inline SVG so the app stays fully offline with no external image file
// (design → Mascot design, Option A). Reaction states (idle / thinking /
// celebrate / encourage) are achieved purely by swapping a CSS class on the
// root and toggling which expression group is shown — no animation framework.
//
// Accessibility: the `hero` variant carries a meaningful role="img" + aria-label
// describing Marty and the onboarding instruction; decorative `corner`/`avatar`
// instances are aria-hidden and not focusable. The mascot is never the sole
// conveyor of information (design → Mascot accessibility; R11.3).

export const MASCOT_NAME = "Marty the Martian";

/** @typedef {'idle'|'thinking'|'celebrate'|'encourage'} MascotState */
/** @typedef {'hero'|'corner'|'avatar'} MascotVariant */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build the inline SVG for Marty. Expression-specific features (eyes, mouth)
 * live in groups toggled by `setState`.
 *
 * @returns {SVGSVGElement}
 */
function buildSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("class", "marty__svg");
  svg.innerHTML = `
    <!-- glow -->
    <ellipse class="marty__glow" cx="60" cy="96" rx="40" ry="8" />
    <!-- saucer -->
    <ellipse class="marty__saucer" cx="60" cy="86" rx="46" ry="14" />
    <ellipse class="marty__saucer-top" cx="60" cy="82" rx="34" ry="9" />
    <circle class="marty__light" cx="26" cy="86" r="3.5" />
    <circle class="marty__light" cx="44" cy="90" r="3.5" />
    <circle class="marty__light" cx="60" cy="91" r="3.5" />
    <circle class="marty__light" cx="76" cy="90" r="3.5" />
    <circle class="marty__light" cx="94" cy="86" r="3.5" />
    <!-- dome -->
    <path class="marty__dome" d="M30 82 A30 30 0 0 1 90 82 Z" />
    <!-- alien head -->
    <ellipse class="marty__head" cx="60" cy="58" rx="20" ry="22" />
    <!-- antennae -->
    <line class="marty__antenna" x1="50" y1="40" x2="44" y2="26" />
    <circle class="marty__antenna-tip" cx="44" cy="24" r="3" />
    <line class="marty__antenna" x1="70" y1="40" x2="76" y2="26" />
    <circle class="marty__antenna-tip" cx="76" cy="24" r="3" />
    <!-- eyes: idle (open) -->
    <g class="marty__eyes marty__eyes--idle">
      <ellipse class="marty__eye" cx="52" cy="56" rx="5" ry="7" />
      <ellipse class="marty__eye" cx="68" cy="56" rx="5" ry="7" />
      <circle class="marty__pupil" cx="52" cy="57" r="2" />
      <circle class="marty__pupil" cx="68" cy="57" r="2" />
    </g>
    <!-- eyes: thinking (half) -->
    <g class="marty__eyes marty__eyes--thinking">
      <path class="marty__eye-line" d="M47 56 Q52 59 57 56" />
      <path class="marty__eye-line" d="M63 56 Q68 59 73 56" />
    </g>
    <!-- eyes: celebrate (happy arcs) -->
    <g class="marty__eyes marty__eyes--celebrate">
      <path class="marty__eye-line" d="M47 58 Q52 52 57 58" />
      <path class="marty__eye-line" d="M63 58 Q68 52 73 58" />
    </g>
    <!-- eyes: encourage (gentle) -->
    <g class="marty__eyes marty__eyes--encourage">
      <ellipse class="marty__eye" cx="52" cy="57" rx="4.5" ry="5.5" />
      <ellipse class="marty__eye" cx="68" cy="57" rx="4.5" ry="5.5" />
      <circle class="marty__pupil" cx="52" cy="59" r="1.8" />
      <circle class="marty__pupil" cx="68" cy="59" r="1.8" />
    </g>
    <!-- mouths -->
    <path class="marty__mouth marty__mouth--idle" d="M53 68 Q60 72 67 68" />
    <path class="marty__mouth marty__mouth--thinking" d="M54 69 L66 69" />
    <path class="marty__mouth marty__mouth--celebrate" d="M51 66 Q60 78 69 66 Z" />
    <path class="marty__mouth marty__mouth--encourage" d="M53 70 Q60 67 67 70" />
  `;
  return svg;
}

/**
 * Render Marty into a target element.
 *
 * @param {HTMLElement} target
 * @param {Object} opts
 * @param {MascotVariant} [opts.variant]    Default 'corner'.
 * @param {MascotState} [opts.state]        Default 'idle'.
 * @param {boolean} [opts.decorative]       Override; hero defaults to meaningful.
 * @param {string} [opts.label]             aria-label for meaningful instances.
 * @returns {HTMLElement} the mascot root element.
 */
export function render(target, { variant = "corner", state = "idle", decorative, label } = {}) {
  const root = document.createElement("div");
  root.className = `marty marty--${variant} marty--state-${state}`;
  root.append(buildSvg());

  const isDecorative = decorative != null ? decorative : variant !== "hero";
  if (isDecorative) {
    root.setAttribute("aria-hidden", "true");
  } else {
    root.setAttribute("role", "img");
    root.setAttribute(
      "aria-label",
      label || `${MASCOT_NAME}, a friendly green alien in a silver flying saucer.`
    );
  }

  if (target) target.append(root);
  return root;
}

/**
 * Swap a mascot instance's expression by replacing its state class.
 *
 * @param {HTMLElement} rootEl  The element returned by render().
 * @param {MascotState} state
 */
export function setState(rootEl, state) {
  if (!rootEl) return;
  rootEl.classList.remove(
    "marty--state-idle",
    "marty--state-thinking",
    "marty--state-celebrate",
    "marty--state-encourage"
  );
  rootEl.classList.add(`marty--state-${state}`);
}
