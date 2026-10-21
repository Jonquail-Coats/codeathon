# Martian Mindhunter

Martian Mindhunter is a fully client-side, single-page study app built with
**vanilla HTML, CSS, and JavaScript** — no frameworks, no build step, no bundler.
You upload a `.pdf` or `.docx`, the app extracts its text in the browser, derives
quiz items from that text with simple heuristics (no AI, no network), and lets you
practice through four modes shown as clickable "bubbles": Flashcards, Multiple
Choice, Free-response, and a space-alien Minigame. A cartoon mascot — Marty the
Martian, a green alien in a silver flying saucer — guides you across every screen.

Your uploaded files and extracted text **never leave the browser**. The app makes
no outbound network request during import, extraction, quiz generation, or any
quiz mode.

## Running the app

The app uses native ES modules (`<script type="module">`). Browsers enforce
same-origin/CORS rules on module imports, so **opening `index.html` directly from
the filesystem (`file://`) will not work** — module imports are blocked there.
There is no build step; you just need to serve the static files over `http://`.

Start any static file server from the project root. For example, with Python:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Any equivalent static server
works (for example `npx serve`), as long as the app is served over HTTP.

If you don't have Python, any static server works. On Windows with only a
browser available, serving the folder over `http://` (not `file://`) is the only
requirement — ES module imports are blocked under `file://`.

## Using the app

On first load you land on the study-setup screen with Marty the Martian:

1. **Quick start** — click "Start with the sample deck" to jump straight in with
   a built-in 10-card deck.
2. **Your own cards** — paste one card per line in the textarea, as
   `Term: Definition` (a tab, ` - `, ` — `, or `=` also work as the separator).
   The live counter shows how many valid cards were detected; click "Study my
   cards".

You then pick a study mode from four bubbles:

- **Flashcards** — flip each card to reveal the answer, advance through the deck.
- **Multiple Choice** — pick the matching definition; the running score and the
  correct answer are shown, with a text + icon cue (not color alone).
- **Free Response** — type your answer, submit, and compare against the expected
  answer.
- **Minigame ("Answer Catch")** — a space-alien game: move Marty's UFO with the
  arrow keys (or A/D) and fire the tractor beam with Space/Enter to catch the
  correct definition as answers drift down.

Every screen has a "Back to modes" control, and "Load a different deck" returns
you to the setup screen.

> Note: importing a `.pdf`/`.docx` and auto-generating a deck from its text is
> the spec's planned import path (tasks 5–7, 12); it depends on vendored
> extraction libraries that are not yet bundled. The deck-input path above
> produces the same quiz-item shape, so all four modes are fully usable today.

## Running the tests

Tests run **in the browser** with a tiny harness — no bundler, no transpile.
Start the static server as above, then open the test runner via the served URL:

<http://localhost:8000/tests/runner.html>

(The test runner is built in task 1.2.) Open it through the served URL, not via
`file://`, for the same ES-module reason described above.

## Conventions

- **Vanilla only.** HTML + CSS + JavaScript. No frameworks, no bundler, no
  compilation, no transpile.
- **ES modules.** Code is organized as native ES modules loaded with
  `type="module"`. Each module owns one responsibility and exposes a small,
  explicit public API (no globals on `window`).
- **Entirely client-side.** No backend. No outbound network requests. Any
  third-party library is vendored locally under `vendor/`, pinned to an exact
  version, and vetted for license and the no-network guarantee.
- **Thin entry point.** `js/main.js` only bootstraps and wires modules together;
  logic lives in the modules under `js/`.
- **Tests mirror the source tree.** The `tests/` tree mirrors `js/` so tests are
  easy to locate.

## Project layout

```
martian-mindhunter/
  index.html          Thin shell: <main> content region + ES-module script
  README.md           This file
  css/                theme.css, layout.css, components.css
  js/
    main.js           Entry point (thin)
    state/            Central store (appState)
    router/           Screen switching + focus management
    import/           File import, text extraction (pdf/docx)
    content/          Quiz generation, text cleaning, prompt filtering
    modes/            Flashcards, Multiple Choice, Free-response, Minigame
    ui/               Mascot, messages, view helpers
  vendor/
    pdf-text/         Pinned, vetted PDF text-extraction library
    unzip/            Pinned, vetted inflate/unzip library
  assets/
    mascot/           Marty the Martian art (SVG)
  tests/              In-browser test harness, mirrors js/
```
