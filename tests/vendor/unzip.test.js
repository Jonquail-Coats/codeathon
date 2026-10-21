// unzip.test.js — correctness checks for the vendored ZIP/DEFLATE reader.
//
// These run in the in-browser harness (no build, no network). They exercise the
// three code paths that matter for reading a .docx:
//   1. STORED (method 0) entries via a hand-built ZIP.
//   2. DEFLATE fixed-Huffman literals + an LZ77 back-reference, encoded here by
//      an independent tiny encoder so the decoder is checked against an oracle it
//      does not share code with.
//   3. The public readEntry/unzip/entryNames API over a central directory.

import { test } from "../runner.js";
import { assertTrue, assertEqual } from "../assert.js";
import { readEntry, unzip, entryNames } from "../../vendor/unzip/unzip.js";

const te = new TextEncoder();
const td = new TextDecoder("utf-8");

// --- Minimal LSB-first bit writer (independent of the decoder's BitReader) ---
class BitWriter {
  constructor() {
    this.bytes = [];
    this.cur = 0;
    this.nbits = 0;
  }
  // Write n bits of value, LSB-first (matches DEFLATE's non-Huffman fields).
  writeBits(value, n) {
    for (let i = 0; i < n; i++) {
      this.cur |= ((value >> i) & 1) << this.nbits;
      this.nbits++;
      if (this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }
  // Write n bits of a Huffman code, MSB-first (matches DEFLATE's code packing).
  writeCodeMsbFirst(code, n) {
    for (let i = n - 1; i >= 0; i--) {
      this.writeBits((code >> i) & 1, 1);
    }
  }
  finish() {
    if (this.nbits > 0) this.bytes.push(this.cur);
    return new Uint8Array(this.bytes);
  }
}

// Fixed-Huffman literal code for a byte 0..143 is 8 bits: 0x30 + value.
function fixedLiteralCode(value) {
  if (value <= 143) return { code: 0x30 + value, len: 8 };
  if (value <= 255) return { code: 0x190 + (value - 144), len: 9 };
  throw new Error("test encoder only emits literal bytes 0..255");
}

// Build a single final fixed-Huffman DEFLATE block of the given literal bytes,
// terminated by the end-of-block symbol (256 -> 7-bit code 0).
function deflateFixedLiterals(byteArray) {
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL = 1
  w.writeBits(1, 2); // BTYPE = 01 (fixed Huffman)
  for (const b of byteArray) {
    const { code, len } = fixedLiteralCode(b);
    w.writeCodeMsbFirst(code, len);
  }
  w.writeCodeMsbFirst(0, 7); // symbol 256, end of block
  return w.finish();
}

// Build a fixed-Huffman block: literal 'A' then a length/distance back-reference
// that repeats it. length=3 -> symbol 257 (7-bit code 0), distance=1 -> dist
// symbol 0 (5-bit code 0). Output should be "AAAA".
function deflateFixedWithBackref() {
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL
  w.writeBits(1, 2); // fixed Huffman
  const a = fixedLiteralCode("A".charCodeAt(0));
  w.writeCodeMsbFirst(a.code, a.len); // literal 'A'
  w.writeCodeMsbFirst(1, 7); // length symbol 257 (fixed code: 256->0,257->1)
  // length base 3, no extra bits.
  w.writeCodeMsbFirst(0, 5); // distance symbol 0 (base 1, no extra)
  w.writeCodeMsbFirst(0, 7); // end of block
  return w.finish();
}

// --- ZIP container builders ---------------------------------------------------

function u16(n) {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

// Build a one-entry ZIP (local header + central directory + EOCD).
function buildZip(name, method, compressed, uncompressedSize) {
  const nameBytes = te.encode(name);
  const local = [];
  local.push(...u32(0x04034b50)); // local file header signature
  local.push(...u16(20)); // version needed
  local.push(...u16(0)); // flags
  local.push(...u16(method));
  local.push(...u16(0), ...u16(0)); // mod time/date
  local.push(...u32(0)); // crc-32 (unchecked by reader)
  local.push(...u32(compressed.length));
  local.push(...u32(uncompressedSize));
  local.push(...u16(nameBytes.length));
  local.push(...u16(0)); // extra length
  local.push(...nameBytes);
  const dataOffset = local.length;
  local.push(...compressed);

  const centralOffset = local.length;
  const central = [];
  central.push(...u32(0x02014b50)); // central dir signature
  central.push(...u16(20), ...u16(20)); // version made/needed
  central.push(...u16(0)); // flags
  central.push(...u16(method));
  central.push(...u16(0), ...u16(0)); // time/date
  central.push(...u32(0)); // crc
  central.push(...u32(compressed.length));
  central.push(...u32(uncompressedSize));
  central.push(...u16(nameBytes.length));
  central.push(...u16(0), ...u16(0)); // extra, comment lengths
  central.push(...u16(0), ...u16(0)); // disk, internal attrs
  central.push(...u32(0)); // external attrs
  central.push(...u32(0)); // local header offset
  central.push(...nameBytes);

  const eocd = [];
  eocd.push(...u32(0x06054b50)); // EOCD signature
  eocd.push(...u16(0), ...u16(0)); // disk numbers
  eocd.push(...u16(1), ...u16(1)); // entries on disk / total
  eocd.push(...u32(central.length)); // central dir size
  eocd.push(...u32(centralOffset)); // central dir offset
  eocd.push(...u16(0)); // comment length

  return new Uint8Array([...local, ...central, ...eocd]);
}

// --- Tests --------------------------------------------------------------------

test("unzip: STORED entry round-trips verbatim", () => {
  const content = te.encode("Hello, Mars!");
  const zip = buildZip("word/document.xml", 0, Array.from(content), content.length);
  const out = readEntry(zip, "word/document.xml");
  assertTrue(out !== null, "entry should be found");
  assertEqual(td.decode(out), "Hello, Mars!");
});

test("unzip: DEFLATE fixed-Huffman literals inflate correctly", () => {
  const text = "The quick brown fox";
  const raw = te.encode(text);
  const compressed = Array.from(deflateFixedLiterals(raw));
  const zip = buildZip("word/document.xml", 8, compressed, raw.length);
  const out = readEntry(zip, "word/document.xml");
  assertEqual(td.decode(out), text);
});

test("unzip: DEFLATE back-reference (LZ77) copies repeated bytes", () => {
  const compressed = Array.from(deflateFixedWithBackref());
  const zip = buildZip("x.txt", 8, compressed, 4);
  const out = readEntry(zip, "x.txt");
  assertEqual(td.decode(out), "AAAA");
});

test("unzip: unzip() lists all non-directory entries", () => {
  const content = te.encode("payload");
  const zip = buildZip("a/b.txt", 0, Array.from(content), content.length);
  const map = unzip(zip);
  assertTrue(map.has("a/b.txt"), "map should contain the entry");
  assertEqual(td.decode(map.get("a/b.txt")), "payload");
});

test("unzip: entryNames lists names without decompressing", () => {
  const content = te.encode("payload");
  const zip = buildZip("a/b.txt", 0, Array.from(content), content.length);
  assertEqual(entryNames(zip).join(","), "a/b.txt");
});

test("unzip: missing entry returns null", () => {
  const content = te.encode("payload");
  const zip = buildZip("a/b.txt", 0, Array.from(content), content.length);
  assertEqual(readEntry(zip, "not/there.xml"), null);
});

test("unzip: unsupported method throws", () => {
  const content = te.encode("payload");
  const zip = buildZip("a/b.txt", 12, Array.from(content), content.length);
  let threw = false;
  try {
    readEntry(zip, "a/b.txt");
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, "an unsupported compression method should throw");
});

test("unzip: too-small input throws", () => {
  let threw = false;
  try {
    readEntry(new Uint8Array([1, 2, 3]), "x");
  } catch (e) {
    threw = true;
  }
  assertTrue(threw, "input too small to be a ZIP should throw");
});
