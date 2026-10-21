// pdfExtractor.js — extract text from a PDF using the vendored pdfText library.
//
// Wraps extractPdfText() into the common { ok, text } / { ok, reason } shape
// that textExtractor.js uses. All extraction runs entirely in the browser on
// the bytes already held in memory — no network I/O (R2.7, R9.1).

import { extractPdfText } from "../../vendor/pdf-text/pdfText.js";

/**
 * Extract plain text from a PDF File.
 *
 * @param {File} file
 * @returns {Promise<{ ok: true, text: string } | { ok: false, reason: 'corrupt'|'empty' }>}
 */
export async function extractFromPdf(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "corrupt" };
  }

  try {
    const text = extractPdfText(bytes);
    const trimmed = (text || "").trim();
    if (trimmed.length === 0) return { ok: false, reason: "empty" };
    return { ok: true, text: trimmed };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}
