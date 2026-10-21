// unzip.js — minimal, self-contained ZIP reader + RFC 1951 DEFLATE inflater.
//
// Martian Mindhunter vendored dependency. See ./README.md for the version,
// vetting notes, supported subset, license, and the no-network guarantee.
//
// WHY THIS EXISTS (and is not a downloaded third-party library)
// -------------------------------------------------------------
// The app is vanilla, no-build, and must run with zero runtime network access.
// The build/vetting environment likewise has no reliable network and no package
// manager for this browser project, so a third-party binary could neither be
// fetched nor audited. A `.docx` is just a ZIP container whose only compression
// methods are STORED (0) and DEFLATE (8), and the extractor only needs to read a
// single entry (`word/document.xml`). So this file is a small, purpose-built,
// fully-auditable reader we own outright: no dependencies, no network, no build.
//
// SCOPE (read-only, DOCX-sufficient subset)
// -----------------------------------------
//   - Container: parse the End Of Central Directory + central directory to list
//     entries, with a fallback to scanning local file headers. This locates each
//     entry's name, compression method, and compressed byte range.
//   - Decompression: STORED (method 0) is copied verbatim; DEFLATE (method 8) is
//     inflated per RFC 1951 — stored, fixed-Huffman, and dynamic-Huffman blocks.
//   - Data descriptors (general-purpose bit 3): the central directory carries the
//     authoritative sizes, so entries that defer sizes to a trailing descriptor
//     are still read correctly when the central directory is present.
//
// OUT OF SCOPE: writing/creating ZIPs, encryption, ZIP64, multi-disk archives,
// and compression methods other than 0 and 8. Such inputs throw a clear Error.
//
// References:
//   - RFC 1951, DEFLATE Compressed Data Format Specification, version 1.3.
//   - PKWARE .ZIP File Format Specification (APPNOTE.TXT): local file header
//     signature 0x04034b50, central directory 0x02014b50, EOCD 0x06054b50.

// ---------------------------------------------------------------------------
// Section 1: RFC 1951 DEFLATE inflater
// ---------------------------------------------------------------------------

// Length codes 257..285: base length for each symbol and extra bits to read.
// RFC 1951 §3.2.5, Table of length codes. Index 0 corresponds to symbol 257.
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];

// Distance codes 0..29: base distance and extra bits. RFC 1951 §3.2.5.
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];

// Order in which code-length code lengths appear in a dynamic block. §3.2.7.
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/**
 * A least-significant-bit-first reader over a byte buffer, as DEFLATE requires.
 * Bits within a byte are consumed low-to-high; Huffman codes are packed MSB-first
 * and are therefore reversed as they are decoded (see readSymbol).
 */
class BitReader {
  /** @param {Uint8Array} bytes @param {number} start byte offset to begin at */
  constructor(bytes, start) {
    this.bytes = bytes;
    this.pos = start; // next byte to load
    this.bitBuffer = 0; // accumulated bits not yet consumed
    this.bitCount = 0; // number of valid bits in bitBuffer
  }

  /** Read `n` bits (0..32) LSB-first and return them as an unsigned integer. */
  readBits(n) {
    while (this.bitCount < n) {
      if (this.pos >= this.bytes.length) {
        throw new Error("inflate: unexpected end of input");
      }
      this.bitBuffer |= this.bytes[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << n) - 1);
    this.bitBuffer >>>= n;
    this.bitCount -= n;
    return value;
  }

  /** Discard any bits left in the current partial byte (used before STORED). */
  alignToByte() {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
}

/**
 * A canonical Huffman decode table built from a list of code lengths.
 *
 * Canonical Huffman codes are assigned per RFC 1951 §3.2.2: codes are ordered
 * first by length, then by symbol value. We precompute, for each code length,
 * the first code value and the index into a symbol array, which lets decoding
 * walk one bit at a time without storing a full tree.
 */
class HuffmanTable {
  /** @param {number[]} lengths code length for each symbol (0 = unused) */
  constructor(lengths) {
    this.maxLength = 0;
    for (const len of lengths) {
      if (len > this.maxLength) this.maxLength = len;
    }

    // Count how many codes share each length.
    this.countByLength = new Array(this.maxLength + 1).fill(0);
    for (const len of lengths) {
      if (len > 0) this.countByLength[len]++;
    }

    // First canonical code value for each length (RFC 1951 §3.2.2 step 2/3).
    this.firstCode = new Array(this.maxLength + 1).fill(0);
    this.firstSymbolIndex = new Array(this.maxLength + 1).fill(0);
    let code = 0;
    let symbolIndex = 0;
    for (let len = 1; len <= this.maxLength; len++) {
      code = (code + this.countByLength[len - 1]) << 1;
      this.firstCode[len] = code;
      this.firstSymbolIndex[len] = symbolIndex;
      symbolIndex += this.countByLength[len];
    }

    // Symbols sorted by (length, symbol value) so an offset maps to a symbol.
    this.symbols = new Array(symbolIndex).fill(0);
    const nextIndex = this.firstSymbolIndex.slice();
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      const len = lengths[symbol];
      if (len > 0) {
        this.symbols[nextIndex[len]++] = symbol;
      }
    }
  }

  /**
   * Decode one symbol by consuming bits MSB-first. DEFLATE packs Huffman codes
   * most-significant-bit first, while BitReader yields LSB-first, so we build the
   * code value by shifting in one bit at a time at the low end.
   * @param {BitReader} reader
   */
  readSymbol(reader) {
    let code = 0;
    for (let len = 1; len <= this.maxLength; len++) {
      code = (code << 1) | reader.readBits(1);
      // At this length, valid canonical codes occupy the contiguous range
      // [firstCode[len], firstCode[len] + countByLength[len]); an in-range code
      // maps directly to a symbol by its offset within that range.
      const count = this.countByLength[len];
      const offset = code - this.firstCode[len];
      if (count > 0 && offset >= 0 && offset < count) {
        return this.symbols[this.firstSymbolIndex[len] + offset];
      }
    }
    throw new Error("inflate: invalid Huffman code");
  }
}

// The fixed Huffman code tables (RFC 1951 §3.2.6) are constant, so build once.
const FIXED_LITERAL_TABLE = (() => {
  const lengths = new Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return new HuffmanTable(lengths);
})();
const FIXED_DISTANCE_TABLE = new HuffmanTable(new Array(30).fill(5));

/**
 * Decode the two dynamic Huffman tables that prefix a type-2 block.
 * RFC 1951 §3.2.7: a code-length code is itself Huffman-coded and is used to
 * run-length-decode the literal/length and distance code lengths.
 * @param {BitReader} reader
 * @returns {{ literalTable: HuffmanTable, distanceTable: HuffmanTable }}
 */
function readDynamicTables(reader) {
  const numLiterals = reader.readBits(5) + 257; // HLIT
  const numDistances = reader.readBits(5) + 1; // HDIST
  const numCodeLengths = reader.readBits(4) + 4; // HCLEN

  // Code lengths for the code-length alphabet, in the specified permuted order.
  const codeLengthLengths = new Array(19).fill(0);
  for (let i = 0; i < numCodeLengths; i++) {
    codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.readBits(3);
  }
  const codeLengthTable = new HuffmanTable(codeLengthLengths);

  // Run-length decode the combined literal+distance code-length sequence.
  const allLengths = new Array(numLiterals + numDistances).fill(0);
  let i = 0;
  while (i < allLengths.length) {
    const symbol = codeLengthTable.readSymbol(reader);
    if (symbol < 16) {
      allLengths[i++] = symbol;
    } else if (symbol === 16) {
      // Repeat the previous code length 3..6 times.
      if (i === 0) throw new Error("inflate: repeat with no previous length");
      const repeat = reader.readBits(2) + 3;
      const prev = allLengths[i - 1];
      for (let r = 0; r < repeat && i < allLengths.length; r++) {
        allLengths[i++] = prev;
      }
    } else if (symbol === 17) {
      // Repeat a zero length 3..10 times.
      const repeat = reader.readBits(3) + 3;
      for (let r = 0; r < repeat && i < allLengths.length; r++) {
        allLengths[i++] = 0;
      }
    } else if (symbol === 18) {
      // Repeat a zero length 11..138 times.
      const repeat = reader.readBits(7) + 11;
      for (let r = 0; r < repeat && i < allLengths.length; r++) {
        allLengths[i++] = 0;
      }
    } else {
      throw new Error("inflate: invalid code-length symbol");
    }
  }

  return {
    literalTable: new HuffmanTable(allLengths.slice(0, numLiterals)),
    distanceTable: new HuffmanTable(allLengths.slice(numLiterals)),
  };
}

/**
 * A growable output buffer. DEFLATE back-references (LZ77) may point at bytes
 * just produced, so the sink must support random reads of already-written data.
 */
class ByteSink {
  constructor(expectedSize) {
    this.buffer = new Uint8Array(expectedSize > 0 ? expectedSize : 1024);
    this.length = 0;
  }

  ensure(extra) {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < needed) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  pushByte(byte) {
    this.ensure(1);
    this.buffer[this.length++] = byte;
  }

  /** Copy `length` bytes from `distance` behind the write head (LZ77 match). */
  copyMatch(distance, length) {
    if (distance > this.length) {
      throw new Error("inflate: back-reference before start of output");
    }
    this.ensure(length);
    let from = this.length - distance;
    for (let i = 0; i < length; i++) {
      // Reads may overlap the write head when distance < length; that overlap
      // is intentional in LZ77 and must be copied byte-by-byte.
      this.buffer[this.length++] = this.buffer[from++];
    }
  }

  toUint8Array() {
    return this.buffer.subarray(0, this.length);
  }
}

/**
 * Inflate a raw DEFLATE stream (RFC 1951) — no zlib or gzip wrapper.
 * @param {Uint8Array} bytes the compressed bytes
 * @param {number} start offset of the first DEFLATE byte
 * @param {number} expectedSize hint for the uncompressed size (0 if unknown)
 * @returns {Uint8Array} the uncompressed bytes
 */
function inflateRaw(bytes, start, expectedSize) {
  const reader = new BitReader(bytes, start);
  const sink = new ByteSink(expectedSize);

  let finalBlock = false;
  while (!finalBlock) {
    finalBlock = reader.readBits(1) === 1; // BFINAL
    const blockType = reader.readBits(2); // BTYPE

    if (blockType === 0) {
      // Stored (uncompressed) block: skip to a byte boundary, then LEN/NLEN.
      reader.alignToByte();
      if (reader.pos + 4 > bytes.length) {
        throw new Error("inflate: truncated stored block header");
      }
      const len = bytes[reader.pos] | (bytes[reader.pos + 1] << 8);
      const nlen = bytes[reader.pos + 2] | (bytes[reader.pos + 3] << 8);
      reader.pos += 4;
      if ((len ^ 0xffff) !== nlen) {
        throw new Error("inflate: stored block length check failed");
      }
      if (reader.pos + len > bytes.length) {
        throw new Error("inflate: truncated stored block data");
      }
      sink.ensure(len);
      for (let i = 0; i < len; i++) {
        sink.pushByte(bytes[reader.pos++]);
      }
    } else if (blockType === 1 || blockType === 2) {
      let literalTable;
      let distanceTable;
      if (blockType === 1) {
        literalTable = FIXED_LITERAL_TABLE;
        distanceTable = FIXED_DISTANCE_TABLE;
      } else {
        const tables = readDynamicTables(reader);
        literalTable = tables.literalTable;
        distanceTable = tables.distanceTable;
      }

      // Decode symbols until the end-of-block marker (256).
      for (;;) {
        const symbol = literalTable.readSymbol(reader);
        if (symbol < 256) {
          sink.pushByte(symbol);
        } else if (symbol === 256) {
          break; // end of block
        } else if (symbol <= 285) {
          const lengthIndex = symbol - 257;
          const length =
            LENGTH_BASE[lengthIndex] +
            reader.readBits(LENGTH_EXTRA[lengthIndex]);
          const distSymbol = distanceTable.readSymbol(reader);
          if (distSymbol > 29) {
            throw new Error("inflate: invalid distance symbol");
          }
          const distance =
            DIST_BASE[distSymbol] + reader.readBits(DIST_EXTRA[distSymbol]);
          sink.copyMatch(distance, length);
        } else {
          throw new Error("inflate: invalid literal/length symbol");
        }
      }
    } else {
      throw new Error("inflate: reserved block type 3");
    }
  }

  return sink.toUint8Array();
}

// ---------------------------------------------------------------------------
// Section 2: ZIP container reader
// ---------------------------------------------------------------------------

const SIG_LOCAL_FILE = 0x04034b50;
const SIG_CENTRAL_DIR = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Little-endian unsigned reads; ZIP integers are always little-endian. */
function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function readU32(bytes, offset) {
  // `>>> 0` keeps the result an unsigned 32-bit value.
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

const utf8Decoder = new TextDecoder("utf-8");

/**
 * Locate the End Of Central Directory record by scanning backwards for its
 * signature. The EOCD is near the end of the file but is followed by a variable
 * comment, so a backward scan is the standard way to find it (APPNOTE 4.3.16).
 * @returns {number|null} offset of the EOCD signature, or null if not found
 */
function findEocd(bytes) {
  // The EOCD is at least 22 bytes; the trailing comment can be up to 65535.
  const minOffset = Math.max(0, bytes.length - (22 + 0xffff));
  for (let offset = bytes.length - 22; offset >= minOffset; offset--) {
    if (readU32(bytes, offset) === SIG_EOCD) return offset;
  }
  return null;
}

/**
 * @typedef {Object} ZipEntry
 * @property {string} name
 * @property {number} method compression method (0 = stored, 8 = deflate)
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {number} localHeaderOffset offset of the entry's local file header
 */

/**
 * Parse the central directory into entry records. The central directory holds
 * the authoritative compressed/uncompressed sizes for every entry, which makes
 * reading correct even when a local header defers its sizes to a trailing data
 * descriptor (general-purpose bit 3).
 * @returns {ZipEntry[]}
 */
function readCentralDirectory(bytes) {
  const eocdOffset = findEocd(bytes);
  if (eocdOffset === null) return null;

  const entryCount = readU16(bytes, eocdOffset + 10);
  let offset = readU32(bytes, eocdOffset + 16); // start of central directory

  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (readU32(bytes, offset) !== SIG_CENTRAL_DIR) {
      throw new Error("unzip: corrupt central directory signature");
    }
    const method = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    const uncompressedSize = readU32(bytes, offset + 24);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localHeaderOffset = readU32(bytes, offset + 42);
    const name = utf8Decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    );
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Fallback: scan local file headers front-to-back. Used only when no central
 * directory is present. Limitation: an entry whose local header defers its sizes
 * to a trailing data descriptor (bit 3 set) cannot be sized reliably this way,
 * so such entries throw rather than risk returning corrupt bytes.
 * @returns {ZipEntry[]}
 */
function scanLocalHeaders(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && readU32(bytes, offset) === SIG_LOCAL_FILE) {
    const flags = readU16(bytes, offset + 6);
    const method = readU16(bytes, offset + 8);
    const compressedSize = readU32(bytes, offset + 18);
    const uncompressedSize = readU32(bytes, offset + 22);
    const nameLength = readU16(bytes, offset + 26);
    const extraLength = readU16(bytes, offset + 28);
    const name = utf8Decoder.decode(
      bytes.subarray(offset + 30, offset + 30 + nameLength)
    );
    const dataOffset = offset + 30 + nameLength + extraLength;

    if (flags & 0x08) {
      throw new Error(
        "unzip: entry uses a data descriptor and no central directory is " +
          "present; cannot determine sizes safely"
      );
    }

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset: offset,
    });
    offset = dataOffset + compressedSize;
  }
  if (entries.length === 0) {
    throw new Error("unzip: no ZIP entries found");
  }
  return entries;
}

/** Return the entry list, preferring the central directory for robustness. */
function listEntries(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("unzip: expected a Uint8Array");
  }
  if (bytes.length < 22) {
    throw new Error("unzip: input too small to be a ZIP archive");
  }
  const central = readCentralDirectory(bytes);
  if (central) return central;
  return scanLocalHeaders(bytes);
}

/**
 * Given an entry record, find the start of its compressed data by re-reading the
 * local file header (the local name/extra lengths are authoritative for the data
 * offset), then decompress according to the method.
 * @returns {Uint8Array}
 */
function readEntryData(bytes, entry) {
  const headerOffset = entry.localHeaderOffset;
  if (readU32(bytes, headerOffset) !== SIG_LOCAL_FILE) {
    throw new Error("unzip: corrupt local file header signature");
  }
  const nameLength = readU16(bytes, headerOffset + 26);
  const extraLength = readU16(bytes, headerOffset + 28);
  const dataOffset = headerOffset + 30 + nameLength + extraLength;

  if (dataOffset + entry.compressedSize > bytes.length) {
    throw new Error("unzip: entry data extends past end of archive");
  }

  if (entry.method === METHOD_STORED) {
    // Stored: the bytes are the content verbatim.
    return bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  }
  if (entry.method === METHOD_DEFLATE) {
    return inflateRaw(bytes, dataOffset, entry.uncompressedSize);
  }
  throw new Error(`unzip: unsupported compression method ${entry.method}`);
}

// ---------------------------------------------------------------------------
// Section 3: Public API
// ---------------------------------------------------------------------------

/**
 * Read a single entry's uncompressed bytes by exact name.
 * @param {Uint8Array} bytes the ZIP archive
 * @param {string} entryName e.g. "word/document.xml"
 * @returns {Uint8Array|null} the uncompressed bytes, or null if no such entry
 * @throws {Error} on malformed input or an unsupported compression method
 */
export function readEntry(bytes, entryName) {
  const entries = listEntries(bytes);
  const entry = entries.find((e) => e.name === entryName);
  if (!entry) return null;
  return readEntryData(bytes, entry);
}

/**
 * Read every entry into a map of name -> uncompressed bytes.
 * @param {Uint8Array} bytes the ZIP archive
 * @returns {Map<string, Uint8Array>}
 * @throws {Error} on malformed input or an unsupported compression method
 */
export function unzip(bytes) {
  const entries = listEntries(bytes);
  const result = new Map();
  for (const entry of entries) {
    // Directory entries end in "/" and have no content; skip them.
    if (entry.name.endsWith("/")) continue;
    result.set(entry.name, readEntryData(bytes, entry));
  }
  return result;
}

/**
 * List entry names without decompressing their data. Useful for diagnostics.
 * @param {Uint8Array} bytes the ZIP archive
 * @returns {string[]}
 * @throws {Error} on malformed input
 */
export function entryNames(bytes) {
  return listEntries(bytes).map((e) => e.name);
}

/** The vendored version of this reader. Keep in sync with ./README.md. */
export const VERSION = "1.0.0";
