// textExtractor.js — orchestrate PDF/DOCX extraction with a 30-second timeout.
//
// Routes by file extension to the appropriate extractor and races extraction
// against a timer. On timeout it discards the partial result and returns
// reason: 'timeout' (R2.6). All I/O is on bytes already in memory — no
// outbound network requests (R2.7, R9.1).

import { extractFromPdf } from "./pdfExtractor.js";
import { extractFromDocx } from "./docxExtractor.js";

/** Max extraction time before giving up (R2.6). */
const TIMEOUT_MS = 30_000;

/**
 * Error messages for each failure reason, matching the design's Error Handling
 * table.
 *
 * @readonly
 */
export const EXTRACT_MESSAGES = Object.freeze({
  corrupt: "That file could not be read — it may be corrupt or use an unsupported format.",
  timeout: "The file could not be read within the allowed time.",
  empty: "No text was found — try a different file.",
  unsupported: "Only .pdf and .docx files are supported.",
});

/**
 * Extract text from a PDF or DOCX File.
 *
 * @param {File} file
 * @returns {Promise<
 *   | { ok: true,  text: string }
 *   | { ok: false, reason: 'corrupt'|'timeout'|'empty'|'unsupported', message: string }
 * >}
 */
export async function extract(file) {
  const ext = (file.name ?? "").split(".").pop().toLowerCase();

  if (ext !== "pdf" && ext !== "docx") {
    return { ok: false, reason: "unsupported", message: EXTRACT_MESSAGES.unsupported };
  }

  const extractorFn = ext === "pdf" ? extractFromPdf : extractFromDocx;

  /** @type {Promise<{ ok: true, text: string } | { ok: false, reason: string }>} */
  const extractPromise = extractorFn(file);
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ ok: false, reason: "timeout" }), TIMEOUT_MS)
  );

  const result = await Promise.race([extractPromise, timeoutPromise]);
  if (!result.ok) {
    return { ...result, message: EXTRACT_MESSAGES[result.reason] ?? EXTRACT_MESSAGES.corrupt };
  }
  return result;
}
