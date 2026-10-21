# vendor/pdf-text

A small, purpose-built, pure-JavaScript **PDF text extractor** for Martian
Mindhunter.

- **Version:** 1.0.0
- **Date:** 2025-06-09
- **License:** project-owned (authored in-repo; same license as the Martian
  Mindhunter project). Not a third-party download.
- **Entry module:** [`pdfText.js`](./pdfText.js) — ES module.

## Why this is in-repo (not downloaded)

The app is **vanilla, no-build, fully offline, with zero runtime network
access**. This environment has no reliable network and no package manager or
build step, so a third-party library (for example pdf.js) cannot be fetched or
bundled. A full production PDF text extractor (every font encoding, CMaps, CID
fonts, encrypted documents, object/xref streams) is far beyond the scope of one
module.

Instead, this is a **small, self-contained, pragmatic** extractor that handles
the **common case** and documents its supported subset and limitations. Keeping
it in-repo means the source is fully vetted (self-authored) and satisfies the
dependency-policy intent — **pinned, recorded, vetted, and guaranteed to make no
network request**. The `VERSION` constant exported from `pdfText.js` records the
pinned version.

## No-network guarantee

`pdfText.js` and `zlibInflate.js` perform **no network I/O** — no `fetch`, no
`XMLHttpRequest`, no dynamic URL loading. The only dynamic `import()` is a local,
same-origin probe of the sibling `vendor/unzip/` module (see "Inflate
dependency"); it never touches the network. All work happens in-browser on bytes
you already hold.

## Public API

```js
import { extractPdfText, VERSION } from "./vendor/pdf-text/pdfText.js";

const text = extractPdfText(bytes); // bytes: Uint8Array of the .pdf file
```

- **`extractPdfText(bytes: Uint8Array): string`** — best-effort text extraction.
  Returns the concatenated text content, whitespace-joined, with spacing and
  newlines inserted heuristically at text-positioning operators.
  - **Throws** a clear `Error` when the input is clearly **not a PDF** (no
    `%PDF-` header), so the extractor layer (`js/import/pdfExtractor.js`, task
    6.2) can map it to `reason: 'corrupt'`.
  - **Degrades gracefully** for complex-but-valid PDFs: it extracts whatever it
    can from the streams it understands and skips the rest, rather than throwing.
- **`VERSION: string`** — the pinned library version (`"1.0.0"`).

## Supported subset

This extractor implements the dominant path for simple and exported PDFs:

1. **Content-stream location.** Byte-scans the file for every
   `stream … endstream` section and extracts the raw stream bodies. (It does
   **not** parse the cross-reference table or object graph.)
2. **FlateDecode / zlib decompression.** Detects zlib-wrapped streams
   (RFC 1950: 2-byte header + raw DEFLATE + 4-byte Adler-32 trailer), strips the
   header/trailer, and inflates the DEFLATE payload (RFC 1951). Uncompressed
   content streams are used directly.
3. **Text-showing operators.** From decoded content streams it extracts:
   - `Tj` — show a string.
   - `TJ` — show an array of strings and numbers; strings are concatenated, the
     kerning numbers are ignored, and a large negative number is treated as an
     inter-word space so words don't run together.
   - String literals in `( … )` with PDF escape sequences: `\(`, `\)`, `\\`,
     `\n`, `\t`, `\r`, `\b`, `\f`, line continuations, and octal `\ddd`.
   - Hex strings in `< … >`.
4. **Spacing/newline heuristics.** Inserts newlines at the text-positioning
   operators `Td`, `TD`, `T*`, `'`, and `"` so words and lines stay separated,
   then normalizes whitespace into a clean, readable result.

This covers most simple PDFs that use standard **WinAnsi / ASCII** text — the
kind of fixtures the extraction integration tests (task 18.1) use.

## Limitations (unsupported / best-effort)

These are **not** fully supported. Where possible the extractor degrades
gracefully (extracts what it can) rather than crashing. Only clearly-not-a-PDF
input throws.

- **CID / Type0 fonts with custom CMaps** — byte values may not map to Unicode,
  so output can be garbled for such fonts.
- **Encrypted PDFs** — encrypted stream contents are not decrypted; those
  streams are skipped.
- **Object streams and cross-reference streams** (compressed object streams) —
  not parsed; text inside them may be missed.
- **Non-Flate stream filters** — LZWDecode, ASCII85Decode, ASCIIHexDecode,
  RunLengthDecode, DCT/CCITT image filters, and filter chains are **not**
  decoded. (ASCII85 / ASCIIHex are comparatively easy to add later if needed.)
- **Glyph positioning / reading order** — spacing is heuristic, not a true
  layout reconstruction; column order in complex layouts may be imperfect.

## References

- **PDF 32000-1:2008** — text-showing operators `Tj` / `TJ`, text-positioning
  operators `Td` / `TD` / `T*` / `'` / `"`, and the literal-string and
  hex-string syntax.
- **RFC 1950 (zlib)** — the FlateDecode container: 2-byte header + DEFLATE +
  Adler-32 trailer.
- **RFC 1951 (DEFLATE)** — the compression inside the zlib container (stored,
  fixed-Huffman, and dynamic-Huffman blocks).

## Inflate dependency

FlateDecode needs a raw-DEFLATE inflater. The project's **single intended home**
for that algorithm is the sibling vendored library
[`vendor/unzip/`](../unzip/) (task 5.1), which the `.docx` path also uses.

Because task 5.1 is implemented in parallel, [`zlibInflate.js`](./zlibInflate.js)
handles the dependency defensively:

1. It lazily `import()`s `../unzip/unzip.js` and probes for a raw-inflate export
   (`inflateRaw`, `rawInflate`, or `inflate`). If found, it uses that shared
   implementation.
2. If `vendor/unzip/` isn't available yet (or exposes no matching export), it
   falls back to a **minimal, self-contained raw-DEFLATE inflater bundled in
   `zlibInflate.js`**.

This keeps task 6.1 unblocked and prevents any load-time crash while 5.1 lands.

> **Reconciliation note for tasks 6.2 / 7.1:** once `vendor/unzip/unzip.js`
> exposes a stable raw-inflate export, remove the bundled fallback in
> `zlibInflate.js` and import the shared implementation directly. The fallback
> is intentional, documented duplication flagged for de-duplication.

## Files

| File | Purpose |
| --- | --- |
| `pdfText.js` | Public API: `extractPdfText`, `VERSION`. Stream location, operator extraction, string decoding, whitespace normalization. |
| `zlibInflate.js` | zlib (RFC 1950) wrapper + raw-DEFLATE (RFC 1951) inflater fallback; prefers the shared `vendor/unzip` inflater. |
| `README.md` | This file. |
