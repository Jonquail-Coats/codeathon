/**
 * zlibInflate.js — zlib (RFC 1950) wrapper around raw DEFLATE (RFC 1951).
 *
 * Martian Mindhunter vendored library.
 * Version: 1.0.0  (2025-06-09)
 * License: project-owned (authored in-repo; see README.md).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * PDF FlateDecode streams are raw DEFLATE data wrapped in a zlib container:
 * a 2-byte zlib header, the DEFLATE payload, and a 4-byte Adler-32 trailer
 * (RFC 1950). `zlibInflate` strips the 2-byte header and the 4-byte trailer and
 * inflates the DEFLATE payload (RFC 1951).
 *
 * INFLATE DEPENDENCY / RECONCILIATION NOTE (see README.md)
 * --------------------------------------------------------
 * The raw-DEFLATE algorithm's single intended home is the sibling vendored
 * library `vendor/unzip/` (implemented by task 5.1, in parallel with this one).
 * To avoid blocking on that task and to avoid a hard import failure at module
 * load time, this file:
 *
 *   1. Lazily tries to import a raw inflater from `../unzip/unzip.js`, probing a
 *      few likely export names (`inflateRaw`, `inflate`, `rawInflate`).
 *   2. Falls back to a minimal, self-contained raw-DEFLATE inflater included
 *      below if that import is unavailable or has no matching export.
 *
 * TASK 6.2 / 7.1 SHOULD RECONCILE: once `vendor/unzip/unzip.js` lands with a
 * stable raw-inflate export, delete the bundled fallback here and import the
 * shared implementation directly. The fallback is intentionally duplicated for
 * now and flagged for de-duplication.
 *
 * @module vendor/pdf-text/zlibInflate
 */

/** @type {?(input: Uint8Array) => Uint8Array} Cached shared inflater, if found. */
let sharedInflateRaw = null;
/** @type {boolean} Whether we have already attempted the shared import. */
let sharedProbed = false;

/**
 * Attempt to resolve a raw-DEFLATE inflater from the sibling vendor/unzip
 * module. Best-effort and silent: any failure falls back to the bundled
 * implementation. Dynamic import keeps this from being a hard load-time
 * dependency while task 5.1 is still in flight.
 *
 * @returns {Promise<void>}
 */
async function probeSharedInflater() {
  if (sharedProbed) return;
  sharedProbed = true;
  try {
    const mod = await import("../unzip/unzip.js");
    const candidate = mod.inflateRaw || mod.rawInflate || mod.inflate;
    if (typeof candidate === "function") sharedInflateRaw = candidate;
  } catch {
    // vendor/unzip not present yet (task 5.1) — use the bundled fallback.
    sharedInflateRaw = null;
  }
}

// Kick off the probe immediately; by the time extraction runs it will usually
// have resolved. `zlibInflate` is synchronous and simply uses whatever is
// available at call time (shared if resolved, bundled fallback otherwise).
probeSharedInflater();

/**
 * Inflate a zlib (RFC 1950) stream: validate/strip the 2-byte header, inflate
 * the raw DEFLATE payload, and ignore the Adler-32 trailer.
 *
 * @param {Uint8Array} data zlib-wrapped bytes (as found in a FlateDecode stream).
 * @returns {Uint8Array} The inflated bytes.
 * @throws {Error} If the header is not a valid zlib header or inflation fails.
 */
export function zlibInflate(data) {
  if (!(data instanceof Uint8Array) || data.length < 2) {
    throw new Error("zlibInflate: input too short to be a zlib stream.");
  }
  const cmf = data[0];
  const flg = data[1];
  if ((cmf & 0x0f) !== 0x08) {
    throw new Error("zlibInflate: not a DEFLATE-compressed zlib stream.");
  }
  if (((cmf << 8) | flg) % 31 !== 0) {
    throw new Error("zlibInflate: invalid zlib header checksum.");
  }
  if (flg & 0x20) {
    // FDICT set — a preset dictionary we do not carry; cannot inflate.
    throw new Error("zlibInflate: preset dictionary is not supported.");
  }

  // Payload is between the 2-byte header and the 4-byte Adler-32 trailer.
  const payload = data.subarray(2, data.length - 4);
  const inflate = sharedInflateRaw || inflateRawFallback;
  return inflate(payload);
}

// ===========================================================================
// Bundled fallback: minimal raw-DEFLATE (RFC 1951) inflater.
//
// DUPLICATION NOTE: this exists only until vendor/unzip exposes a shared raw
// inflater. Keep it small and correct; do not extend it with zip-container
// logic (that belongs in vendor/unzip). Flagged for removal in task 6.2 / 7.1.
// ===========================================================================

/**
 * Inflate raw DEFLATE data (no zlib/gzip wrapper).
 * Implements stored, fixed-Huffman, and dynamic-Huffman blocks per RFC 1951.
 *
 * @param {Uint8Array} input Raw DEFLATE payload.
 * @returns {Uint8Array} Decompressed bytes.
 * @throws {Error} On malformed input.
 */
function inflateRawFallback(input) {
  const reader = new BitReader(input);
  /** @type {number[]} growable output buffer */
  const out = [];

  let finalBlock = false;
  while (!finalBlock) {
    finalBlock = reader.readBit() === 1;
    const type = reader.readBits(2);

    if (type === 0) {
      inflateStored(reader, out);
    } else if (type === 1) {
      inflateHuffman(reader, out, FIXED_LIT_TREE, FIXED_DIST_TREE);
    } else if (type === 2) {
      const { litTree, distTree } = readDynamicTrees(reader);
      inflateHuffman(reader, out, litTree, distTree);
    } else {
      throw new Error("inflateRaw: invalid block type 3.");
    }
  }
  return Uint8Array.from(out);
}

/**
 * Copy a stored (uncompressed) block.
 * @param {BitReader} reader
 * @param {number[]} out
 */
function inflateStored(reader, out) {
  reader.align();
  const len = reader.readBits(16);
  const nlen = reader.readBits(16);
  if ((len ^ 0xffff) !== nlen) {
    throw new Error("inflateRaw: stored block length check failed.");
  }
  for (let i = 0; i < len; i++) out.push(reader.readByte());
}

/**
 * Decode a Huffman-coded block using the given literal/length and distance
 * trees, appending to `out`.
 * @param {BitReader} reader
 * @param {number[]} out
 * @param {HuffmanTree} litTree
 * @param {HuffmanTree} distTree
 */
function inflateHuffman(reader, out, litTree, distTree) {
  for (;;) {
    const sym = decodeSymbol(reader, litTree);
    if (sym === 256) return; // end of block
    if (sym < 256) {
      out.push(sym);
      continue;
    }
    // Length/distance back-reference.
    const lenIdx = sym - 257;
    const length = LENGTH_BASE[lenIdx] + reader.readBits(LENGTH_EXTRA[lenIdx]);
    const distSym = decodeSymbol(reader, distTree);
    const distance = DIST_BASE[distSym] + reader.readBits(DIST_EXTRA[distSym]);
    const start = out.length - distance;
    if (start < 0) throw new Error("inflateRaw: invalid back-reference distance.");
    for (let i = 0; i < length; i++) out.push(out[start + i]);
  }
}

/**
 * Read dynamic Huffman code trees from the stream (block type 2).
 * @param {BitReader} reader
 * @returns {{ litTree: HuffmanTree, distTree: HuffmanTree }}
 */
function readDynamicTrees(reader) {
  const hlit = reader.readBits(5) + 257;
  const hdist = reader.readBits(5) + 1;
  const hclen = reader.readBits(4) + 4;

  const clOrder = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ];
  const clLengths = new Array(19).fill(0);
  for (let i = 0; i < hclen; i++) clLengths[clOrder[i]] = reader.readBits(3);
  const clTree = buildHuffmanTree(clLengths);

  // Read code lengths for literal+distance alphabets using the code-length code.
  const lengths = new Array(hlit + hdist).fill(0);
  let i = 0;
  while (i < lengths.length) {
    const sym = decodeSymbol(reader, clTree);
    if (sym < 16) {
      lengths[i++] = sym;
    } else if (sym === 16) {
      const repeat = reader.readBits(2) + 3;
      const prev = lengths[i - 1];
      for (let r = 0; r < repeat; r++) lengths[i++] = prev;
    } else if (sym === 17) {
      const repeat = reader.readBits(3) + 3;
      for (let r = 0; r < repeat; r++) lengths[i++] = 0;
    } else {
      // sym === 18
      const repeat = reader.readBits(7) + 11;
      for (let r = 0; r < repeat; r++) lengths[i++] = 0;
    }
  }

  const litTree = buildHuffmanTree(lengths.slice(0, hlit));
  const distTree = buildHuffmanTree(lengths.slice(hlit));
  return { litTree, distTree };
}

/**
 * @typedef {Object} HuffmanTree
 * @property {Int32Array} counts  Count of codes of each bit length.
 * @property {Int32Array} symbols Symbols ordered for canonical decoding.
 */

/**
 * Build a canonical Huffman decode tree from a list of code lengths.
 * @param {number[]} lengths Code length per symbol (0 = unused).
 * @returns {HuffmanTree}
 */
function buildHuffmanTree(lengths) {
  const MAX_BITS = 15;
  const counts = new Int32Array(MAX_BITS + 1);
  for (const len of lengths) counts[len]++;
  counts[0] = 0;

  const offsets = new Int32Array(MAX_BITS + 1);
  for (let bits = 1; bits <= MAX_BITS; bits++) {
    offsets[bits] = offsets[bits - 1] + counts[bits - 1];
  }

  const symbols = new Int32Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym++) {
    if (lengths[sym] !== 0) symbols[offsets[lengths[sym]]++] = sym;
  }
  return { counts, symbols };
}

/**
 * Decode one symbol from the stream using a canonical Huffman tree.
 * @param {BitReader} reader
 * @param {HuffmanTree} tree
 * @returns {number} The decoded symbol.
 */
function decodeSymbol(reader, tree) {
  let code = 0;
  let first = 0;
  let index = 0;
  const { counts, symbols } = tree;
  for (let len = 1; len <= 15; len++) {
    code |= reader.readBit();
    const count = counts[len];
    if (code - first < count) return symbols[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  throw new Error("inflateRaw: invalid Huffman code.");
}

// --- RFC 1951 constant tables -------------------------------------------------

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];

/** Fixed literal/length tree (RFC 1951 §3.2.6). */
const FIXED_LIT_TREE = (() => {
  const lengths = new Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildHuffmanTree(lengths);
})();

/** Fixed distance tree (RFC 1951 §3.2.6): 30 codes of length 5. */
const FIXED_DIST_TREE = buildHuffmanTree(new Array(30).fill(5));

/**
 * Least-significant-bit-first bit reader over a byte array, per DEFLATE's bit
 * packing order (RFC 1951 §3.1.1).
 */
class BitReader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.bytePos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /** @returns {number} the next bit (0 or 1) */
  readBit() {
    if (this.bitCount === 0) {
      if (this.bytePos >= this.bytes.length) {
        throw new Error("inflateRaw: unexpected end of input.");
      }
      this.bitBuf = this.bytes[this.bytePos++];
      this.bitCount = 8;
    }
    const bit = this.bitBuf & 1;
    this.bitBuf >>= 1;
    this.bitCount--;
    return bit;
  }

  /**
   * Read `count` bits LSB-first and return them as an unsigned integer.
   * @param {number} count
   * @returns {number}
   */
  readBits(count) {
    let value = 0;
    for (let i = 0; i < count; i++) value |= this.readBit() << i;
    return value >>> 0;
  }

  /** Discard bits up to the next byte boundary (for stored blocks). */
  align() {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /** @returns {number} the next whole byte (must be byte-aligned). */
  readByte() {
    if (this.bytePos >= this.bytes.length) {
      throw new Error("inflateRaw: unexpected end of input (stored block).");
    }
    return this.bytes[this.bytePos++];
  }
}
