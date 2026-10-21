/**
 * pdfText.js — pragmatic, self-contained, pure-JS PDF text extractor.
 *
 * Martian Mindhunter vendored library.
 * Version: 1.0.0  (2025-06-09)
 * License: project-owned (authored in-repo; see README.md).
 *
 * PURPOSE
 * -------
 * A small, offline, no-build, zero-network PDF text extractor for the common
 * case: simple/exported PDFs that use standard WinAnsi/ASCII text and (at most)
 * FlateDecode-compressed content streams. It is NOT a full PDF parser. See the
 * "SUPPORTED SUBSET" and "LIMITATIONS" sections in README.md for the exact
 * boundary of what this handles.
 *
 * PUBLIC API
 * ----------
 *   extractPdfText(bytes: Uint8Array): string
 *     Best-effort text extraction. Returns the concatenated text content,
 *     whitespace-joined, with heuristic spacing/newlines inserted at text
 *     positioning operators. Throws a clear Error when the input is clearly not
 *     a PDF (missing "%PDF-" header) so the extractor layer can map it to
 *     reason:'corrupt'. Degrades gracefully (returns whatever it could read)
 *     for complex-but-valid PDFs rather than throwing.
 *
 * REFERENCES
 * ----------
 *   - PDF 32000-1:2008, text-showing operators Tj / TJ and text-positioning
 *     operators Td / TD / T* / ' / " ; string literal and hex-string syntax.
 *   - RFC 1950 (zlib) — FlateDecode wraps raw DEFLATE in a 2-byte zlib header
 *     plus a 4-byte Adler-32 trailer.
 *   - RFC 1951 (DEFLATE) — the compression used inside the zlib wrapper.
 *
 * INFLATE DEPENDENCY (see README.md "Inflate dependency")
 * -------------------------------------------------------
 * FlateDecode needs a raw-DEFLATE inflater. The sibling vendored library
 * `vendor/unzip/` (task 5.1) is the intended single home for that algorithm.
 * This module imports it lazily and falls back to a minimal self-contained
 * inflater only if the shared module is unavailable, so this task does not
 * block on 5.1 and nothing crashes at load time. Task 6.2 / 7.1 should
 * reconcile to a single inflate once vendor/unzip lands.
 *
 * @module vendor/pdf-text/pdfText
 */

import { zlibInflate } from "./zlibInflate.js";

/** Library version, recorded per the dependency policy. */
export const VERSION = "1.0.0";

/**
 * Extract best-effort text content from PDF bytes.
 *
 * @param {Uint8Array} bytes Raw PDF file contents.
 * @returns {string} Concatenated, whitespace-joined extracted text.
 * @throws {Error} If `bytes` is not a Uint8Array or lacks a "%PDF-" header.
 */
export function extractPdfText(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("extractPdfText: expected a Uint8Array of PDF bytes.");
  }
  assertPdfHeader(bytes);

  const streams = findContentStreams(bytes);
  const pieces = [];
  for (const stream of streams) {
    const decoded = maybeInflate(stream);
    if (decoded == null) continue; // could not decode this stream; skip it
    const text = extractTextFromContentStream(decoded);
    if (text) pieces.push(text);
  }

  // Join streams with newlines, then normalize whitespace to a single clean pass.
  return normalizeWhitespace(pieces.join("\n"));
}

// ---------------------------------------------------------------------------
// Section 1: Header validation
// ---------------------------------------------------------------------------

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Throw if the bytes do not begin (within the first 1KB, to tolerate leading
 * junk some producers emit) with the "%PDF-" signature.
 * @param {Uint8Array} bytes
 */
function assertPdfHeader(bytes) {
  const limit = Math.min(bytes.length, 1024);
  for (let start = 0; start + PDF_HEADER.length <= limit; start++) {
    let match = true;
    for (let k = 0; k < PDF_HEADER.length; k++) {
      if (bytes[start + k] !== PDF_HEADER[k]) {
        match = false;
        break;
      }
    }
    if (match) return;
  }
  throw new Error("extractPdfText: not a PDF (missing %PDF- header).");
}

// ---------------------------------------------------------------------------
// Section 2: Locating content streams (stream ... endstream)
// ---------------------------------------------------------------------------

const KW_STREAM = asciiBytes("stream");
const KW_ENDSTREAM = asciiBytes("endstream");

/**
 * Scan the raw file for every `stream ... endstream` section and return each
 * stream's raw body bytes. Per PDF syntax, the `stream` keyword is followed by
 * CRLF or a single LF before the stream data begins.
 *
 * This deliberately ignores the cross-reference table and object structure: it
 * is a byte scan, which is robust enough for the common case and avoids a full
 * object/xref parser. Object streams and encrypted streams are not understood
 * here and are simply handled best-effort downstream.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array[]} Raw stream bodies, in file order.
 */
function findContentStreams(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const s = indexOfBytes(bytes, KW_STREAM, i);
    if (s === -1) break;

    // Guard against matching the tail of "endstream": require the preceding
    // byte to not be 'd' (the end of "end"). This is a cheap heuristic.
    if (s > 0 && bytes[s - 1] === 0x64 /* 'd' */) {
      i = s + KW_STREAM.length;
      continue;
    }

    // Data starts after the keyword and the following EOL (CRLF or LF).
    let dataStart = s + KW_STREAM.length;
    if (bytes[dataStart] === 0x0d /* CR */) dataStart++;
    if (bytes[dataStart] === 0x0a /* LF */) dataStart++;

    const e = indexOfBytes(bytes, KW_ENDSTREAM, dataStart);
    if (e === -1) break;

    // Trim a single trailing EOL that precedes "endstream" (not part of data).
    let dataEnd = e;
    if (dataEnd > dataStart && bytes[dataEnd - 1] === 0x0a) dataEnd--;
    if (dataEnd > dataStart && bytes[dataEnd - 1] === 0x0d) dataEnd--;

    out.push(bytes.subarray(dataStart, dataEnd));
    i = e + KW_ENDSTREAM.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section 3: Decoding — FlateDecode (zlib) with graceful fallthrough
// ---------------------------------------------------------------------------

/**
 * Try to interpret a raw stream body as text.
 *
 * Strategy:
 *   1. If the body already looks like uncompressed PDF content (contains text
 *      operators as ASCII), use it directly — covers uncompressed streams.
 *   2. Otherwise attempt a zlib/FlateDecode inflate. On success, use the
 *      inflated bytes.
 *   3. If neither works, return null so the caller skips this stream.
 *
 * We do not read the stream's /Filter dictionary (that would need a full object
 * parser); instead we detect the dominant case empirically. This is best-effort
 * by design.
 *
 * @param {Uint8Array} body Raw stream bytes.
 * @returns {?Uint8Array} Decoded content bytes, or null if undecodable.
 */
function maybeInflate(body) {
  if (body.length === 0) return null;

  if (looksLikeContentStream(body)) {
    return body;
  }

  // zlib streams begin with a 2-byte header whose first byte's low nibble is 8
  // (CM = deflate) and where (b0*256 + b1) % 31 === 0 (RFC 1950 FCHECK).
  if (body.length >= 2 && (body[0] & 0x0f) === 0x08) {
    const check = ((body[0] << 8) | body[1]) % 31;
    if (check === 0) {
      try {
        const inflated = zlibInflate(body);
        if (inflated && inflated.length) return inflated;
      } catch {
        // fall through — undecodable stream, skip it
      }
    }
  }
  return null;
}

/**
 * Heuristic: does this byte run look like an already-decoded content stream?
 * We look for the text-begin operator "BT" or a show operator near readable
 * ASCII. Cheap and good enough to distinguish from compressed binary.
 * @param {Uint8Array} body
 * @returns {boolean}
 */
function looksLikeContentStream(body) {
  const probe = Math.min(body.length, 2048);
  let printable = 0;
  for (let i = 0; i < probe; i++) {
    const c = body[i];
    if (c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e)) {
      printable++;
    }
  }
  if (printable / probe < 0.8) return false;
  return (
    indexOfBytes(body, asciiBytes("BT"), 0) !== -1 ||
    indexOfBytes(body, asciiBytes("Tj"), 0) !== -1 ||
    indexOfBytes(body, asciiBytes("TJ"), 0) !== -1
  );
}

// ---------------------------------------------------------------------------
// Section 4: Content-stream tokenizing and text-operator extraction
// ---------------------------------------------------------------------------

/**
 * Walk a decoded content stream and pull out the shown text, inserting spacing
 * and newline heuristics at text-positioning operators.
 *
 * Supported operators:
 *   (string) Tj          show a string
 *   [ ... ]  TJ          show an array of strings/numbers (numbers = kerning,
 *                        ignored; large negative numbers imply a space)
 *   Td / TD              move to next line offset  -> newline
 *   T*                   move to next line          -> newline
 *   '                    move to next line and show -> newline + show
 *   "                    set spacing, move, show     -> newline + show
 *
 * Strings may be literal `( ... )` (with PDF escapes) or hex `< ... >`.
 *
 * @param {Uint8Array} bytes Decoded content stream.
 * @returns {string}
 */
function extractTextFromContentStream(bytes) {
  const src = latin1Decode(bytes);
  const out = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    if (ch === "(") {
      const [str, next] = readLiteralString(src, i);
      out.push(str);
      i = next;
      continue;
    }

    if (ch === "<" && src[i + 1] !== "<") {
      const [str, next] = readHexString(src, i);
      out.push(str);
      i = next;
      continue;
    }

    if (ch === "[") {
      const [str, next] = readTextArray(src, i);
      out.push(str);
      i = next;
      continue;
    }

    // Detect line-advancing operators as standalone tokens so we add newlines.
    // Single-char operators ' and " ; multi-char Td/TD/T*.
    if (ch === "'" || ch === '"') {
      out.push("\n");
      i += 1;
      continue;
    }
    if (ch === "T" && (src[i + 1] === "d" || src[i + 1] === "D" || src[i + 1] === "*")) {
      // Ensure it is a token boundary (not part of a longer name).
      const after = src[i + 2];
      if (after === undefined || isDelimiterOrWhitespace(after)) {
        out.push("\n");
        i += 2;
        continue;
      }
    }

    i += 1;
  }

  return out.join("");
}

/**
 * Read a PDF literal string beginning at `src[start] === '('`.
 * Handles balanced parentheses, the escape sequences \( \) \\ \n \t \r \b \f,
 * line-continuation (backslash + EOL), and octal escapes \ddd.
 *
 * @param {string} src Latin-1 decoded stream text.
 * @param {number} start Index of the opening '('.
 * @returns {[string, number]} The decoded string and the index just past ')'.
 */
function readLiteralString(src, start) {
  let i = start + 1;
  let depth = 1;
  let result = "";
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === "\\") {
      const e = src[i + 1];
      switch (e) {
        case "n": result += "\n"; i += 2; continue;
        case "r": result += "\r"; i += 2; continue;
        case "t": result += "\t"; i += 2; continue;
        case "b": result += "\b"; i += 2; continue;
        case "f": result += "\f"; i += 2; continue;
        case "(": result += "("; i += 2; continue;
        case ")": result += ")"; i += 2; continue;
        case "\\": result += "\\"; i += 2; continue;
        case "\r": // line continuation: backslash + CR(LF)?
          i += 2;
          if (src[i] === "\n") i += 1;
          continue;
        case "\n": // line continuation: backslash + LF
          i += 2;
          continue;
        default:
          if (e >= "0" && e <= "7") {
            // Octal escape: 1-3 octal digits.
            let oct = "";
            let j = i + 1;
            while (j < n && oct.length < 3 && src[j] >= "0" && src[j] <= "7") {
              oct += src[j];
              j++;
            }
            result += String.fromCharCode(parseInt(oct, 8) & 0xff);
            i = j;
            continue;
          }
          // Unknown escape: per spec, the backslash is ignored.
          result += e;
          i += 2;
          continue;
      }
    }

    if (c === "(") {
      depth++;
      result += c;
      i++;
      continue;
    }
    if (c === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
      result += c;
      i++;
      continue;
    }

    result += c;
    i++;
  }

  return [result, i];
}

/**
 * Read a PDF hex string beginning at `src[start] === '<'`. Each pair of hex
 * digits is one byte; a trailing odd digit is padded with 0 per spec.
 *
 * @param {string} src
 * @param {number} start Index of the opening '<'.
 * @returns {[string, number]} The decoded string and the index just past '>'.
 */
function readHexString(src, start) {
  let i = start + 1;
  let hex = "";
  const n = src.length;
  while (i < n && src[i] !== ">") {
    const c = src[i];
    if (/[0-9a-fA-F]/.test(c)) hex += c;
    i++;
  }
  if (src[i] === ">") i++;
  if (hex.length % 2 === 1) hex += "0";

  let result = "";
  for (let k = 0; k < hex.length; k += 2) {
    result += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16) & 0xff);
  }
  return [result, i];
}

/**
 * Read a TJ-style array beginning at `src[start] === '['`. Concatenate the
 * contained strings; ignore kerning numbers, but treat a large negative number
 * as an inter-word space (common producer convention) so words don't merge.
 *
 * @param {string} src
 * @param {number} start Index of the opening '['.
 * @returns {[string, number]} The joined string and the index just past ']'.
 */
function readTextArray(src, start) {
  let i = start + 1;
  let result = "";
  let numBuf = "";
  const n = src.length;

  const flushNumber = () => {
    if (numBuf.length) {
      const value = parseFloat(numBuf);
      // In TJ, positive numbers shift text left (closer); large magnitudes of
      // negative numbers insert visible space. A threshold avoids spamming
      // spaces on tiny kerning adjustments.
      if (!Number.isNaN(value) && value <= -100) result += " ";
      numBuf = "";
    }
  };

  while (i < n && src[i] !== "]") {
    const c = src[i];
    if (c === "(") {
      flushNumber();
      const [str, next] = readLiteralString(src, i);
      result += str;
      i = next;
      continue;
    }
    if (c === "<") {
      flushNumber();
      const [str, next] = readHexString(src, i);
      result += str;
      i = next;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === "-" || c === "+" || c === ".") {
      numBuf += c;
      i++;
      continue;
    }
    // whitespace or other separators end a number token
    flushNumber();
    i++;
  }
  flushNumber();
  if (src[i] === "]") i++;
  return [result, i];
}

// ---------------------------------------------------------------------------
// Section 5: Byte / string helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ASCII string to a byte array (code points assumed < 128).
 * @param {string} str
 * @returns {number[]}
 */
function asciiBytes(str) {
  const out = new Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Find the first index of a byte pattern within `haystack` at or after `from`.
 * @param {Uint8Array} haystack
 * @param {number[]} needle
 * @param {number} from
 * @returns {number} Index of the first match, or -1.
 */
function indexOfBytes(haystack, needle, from) {
  const end = haystack.length - needle.length;
  for (let i = from; i <= end; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * Decode bytes as Latin-1 (ISO-8859-1): each byte maps to the same code point.
 * This is a lossless 1:1 mapping suitable for scanning PDF content-stream
 * syntax, which is byte-oriented. WinAnsi/ASCII text survives intact for the
 * common case.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function latin1Decode(bytes) {
  let s = "";
  // Chunk to avoid String.fromCharCode argument-count limits on large streams.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/**
 * True for PDF whitespace and delimiter characters.
 * @param {string} ch single character
 * @returns {boolean}
 */
function isDelimiterOrWhitespace(ch) {
  return (
    ch === " " ||
    ch === "\t" ||
    ch === "\r" ||
    ch === "\n" ||
    ch === "\f" ||
    ch === "\0" ||
    ch === "(" ||
    ch === ")" ||
    ch === "<" ||
    ch === ">" ||
    ch === "[" ||
    ch === "]" ||
    ch === "/" ||
    ch === "%"
  );
}

/**
 * Collapse runs of whitespace to single spaces, preserve paragraph breaks as
 * single newlines, and trim the result. Keeps output readable for the quiz
 * generator without leaking the PDF's internal layout whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  return text
    .replace(/\r\n?/g, "\n") // CRLF / CR -> LF
    .replace(/[ \t\f\v]+/g, " ") // collapse horizontal whitespace
    .replace(/ *\n */g, "\n") // trim spaces around newlines
    .replace(/\n{2,}/g, "\n") // collapse blank lines
    .trim();
}
