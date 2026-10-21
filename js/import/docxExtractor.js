// docxExtractor.js — extract text from a DOCX file using the vendored unzip library.
//
// A DOCX is a ZIP container. The body text lives in word/document.xml inside
// <w:t> elements. This module unzips that entry and parses it with a small
// regex-based XML reader — no DOM parser, no DOMParser API, no network I/O.
//
// References: OOXML spec (ECMA-376), word/document.xml <w:t>, <w:p>, <w:r>.

import { readEntry } from "../../vendor/unzip/unzip.js";

/** XML entities that appear in OOXML text content. */
const XML_ENTITIES = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": "\u00a0",
});

/**
 * Decode XML character entities and numeric character references.
 *
 * @param {string} s
 * @returns {string}
 */
function decodeXml(s) {
  return s
    .replace(/&[a-z]+;/gi, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * Pull plain text from the XML content of word/document.xml.
 *
 * Strategy:
 *   - Each <w:p> (paragraph) becomes a line.
 *   - Inside a paragraph, each <w:t> contributes its text content.
 *   - <w:br/> inserts a line break within the paragraph.
 *   - Text that has xml:space="preserve" already keeps its spacing, but we
 *     join all w:t runs within a paragraph as-is (the caller's clean() will
 *     normalise whitespace).
 *
 * @param {string} xml
 * @returns {string}
 */
function xmlToText(xml) {
  const lines = [];

  // Walk each paragraph.
  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let para;
  while ((para = paraRe.exec(xml)) !== null) {
    const paraXml = para[0];
    const words = [];

    // Collect text runs (<w:t>) and inline breaks (<w:br/>).
    const nodeRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g;
    let node;
    while ((node = nodeRe.exec(paraXml)) !== null) {
      if (node[0].startsWith("<w:t")) {
        words.push(decodeXml(node[1]));
      } else if (node[0].startsWith("<w:br")) {
        words.push("\n");
      } else if (node[0].startsWith("<w:tab")) {
        words.push("\t");
      }
    }

    const line = words.join("").trim();
    if (line) lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Extract plain text from a DOCX File.
 *
 * @param {File} file
 * @returns {Promise<{ ok: true, text: string } | { ok: false, reason: 'corrupt'|'empty' }>}
 */
export async function extractFromDocx(file) {
  let zipBytes;
  try {
    zipBytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "corrupt" };
  }

  try {
    const xmlBytes = readEntry(zipBytes, "word/document.xml");
    if (!xmlBytes) return { ok: false, reason: "corrupt" };

    const xml = new TextDecoder("utf-8").decode(xmlBytes);
    const text = xmlToText(xml).trim();
    if (text.length === 0) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}
