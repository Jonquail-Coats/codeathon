# vendor/unzip

A minimal, read-only ZIP reader and RFC 1951 DEFLATE inflater used to pull a
single entry (`word/document.xml`) out of a `.docx` file entirely in the browser.

## Version and provenance

- **Name:** `martian-mindhunter/unzip`
- **Version:** `1.0.0` (recorded in `unzip.js` as the exported `VERSION`)
- **Date:** 2025-06-09
- **Origin:** In-repo, purpose-built implementation. This is **not** a downloaded
  third-party library.

### Why it is in-repo rather than a pinned external package

The app is vanilla, no-build, and must run with **zero runtime network access**.
The build and vetting environment has no reliable network and no package manager
for this browser project, so an external library could be neither fetched nor
audited against its upstream source. A `.docx` is simply a ZIP container using
only STORED and DEFLATE compression, and the extractor only needs to read one
entry. A small, fully-auditable reader we own outright satisfies the same
dependency-policy intent — a local, offline, no-network, no-build dependency,
pinned to an exact recorded version whose entire source we control and can vet —
without depending on an un-fetchable, un-auditable binary.

## Standards implemented

- **RFC 1951** — DEFLATE Compressed Data Format Specification, version 1.3.
  Stored, fixed-Huffman, and dynamic-Huffman blocks; canonical Huffman decoding;
  LZ77 back-references.
- **PKWARE .ZIP File Format Specification (APPNOTE.TXT)** — the container format:
  local file header (`0x04034b50`), central directory (`0x02014b50`), and End Of
  Central Directory (`0x06054b50`).

## Supported subset (read-only)

- Compression methods: **0 (STORED)** and **8 (DEFLATE)** — the only methods a
  `.docx` uses. Any other method throws a clear `Error`.
- Entry location: parses the **End Of Central Directory + central directory**
  (authoritative sizes) and **falls back to scanning local file headers** when no
  central directory is present.
- **Data descriptors** (general-purpose bit 3): handled correctly when a central
  directory is present, because the central directory carries the authoritative
  sizes. In the local-header-scan fallback, an entry that defers its sizes to a
  trailing descriptor throws rather than risk returning corrupt bytes (documented
  limitation).

### Out of scope

Writing/creating archives, encryption, ZIP64, multi-disk archives, and any
compression method other than 0 and 8. These inputs throw.

## API

```js
import { readEntry, unzip, entryNames, VERSION } from "./unzip.js";

// Pull a single entry by exact name (returns null if absent):
const xmlBytes = readEntry(zipBytes, "word/document.xml");

// Read every (non-directory) entry into a name -> bytes map:
const map = unzip(zipBytes); // Map<string, Uint8Array>

// List entry names without decompressing:
const names = entryNames(zipBytes); // string[]
```

All functions take a `Uint8Array` and return **raw bytes**; the caller (the DOCX
extractor, task 5.2) decodes UTF-8 and parses XML. On malformed or unsupported
input, every function throws a descriptive `Error`, which the extractor
translates into `reason: 'corrupt'`.

## License

Project-owned. Licensed under the same terms as the Martian Mindhunter project.

## No-network guarantee

This module performs **no** network I/O. It uses no `fetch`, `XMLHttpRequest`,
`WebSocket`, dynamic `import()`, or any other I/O. It reads only the in-memory
`Uint8Array` passed to it and uses the built-in `TextDecoder` for entry names.
There are no dependencies and no build step.
