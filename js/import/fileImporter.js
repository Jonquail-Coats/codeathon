// fileImporter.js — file-type/size validation and (thin) input wiring.
//
// Per design (Components and Interfaces → FileImporter) and structure.md, this
// module owns one responsibility: deciding whether a selected file may enter
// the extraction pipeline, and surfacing the exact user-facing message when it
// may not. The heart of the module is the PURE `validate(file)` function; the
// optional `init(uploadEl, { onAccept })` is a thin DOM adapter around it (the
// real upload view and drag-and-drop are wired in tasks 12.1 / 12.3).
//
// Accept criteria (R1.2): the file's type is `.pdf` or `.docx` AND its size is
// greater than 0 bytes AND its size is at or below Max_File_Size (25 MB). Every
// rejection carries a `reason` that matches the specific failing condition and
// an exact message from the design's Error Handling table.
//
// Requirements: 1.1 (keyboard-operable select control — see init), 1.2 (accept
// criteria), 1.3 (unsupported type), 1.4 (too large), 1.5 (empty file).
// Design refs: FileImporter, Error Handling table, Property 1.

// --- Constants --------------------------------------------------------------

/**
 * Max_File_Size — the maximum accepted upload size, 25 MB.
 *
 * Defined in BINARY megabytes: 25 * 1024 * 1024 = 26,214,400 bytes. The
 * requirement states "25 MB"; we read that as 25 MiB because file sizes in the
 * browser (`File.size`) and operating-system file managers are overwhelmingly
 * reported in binary units, so a 25-"MB" file a user sees in their OS maps to
 * this bound. A file of exactly this many bytes is accepted (`size <= MAX`);
 * one byte more is rejected.
 *
 * @type {number}
 */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Rejection reasons. Exported so callers (the upload view, tests) branch on a
 * constant reference instead of a hand-typed string literal.
 *
 * @readonly
 */
export const RejectReason = Object.freeze({
  UNSUPPORTED_TYPE: "unsupportedType",
  TOO_LARGE: "tooLarge",
  EMPTY: "empty",
});

/**
 * Exact user-facing messages, one per rejection reason, copied verbatim from
 * the design's Error Handling table so wording stays consistent and testable.
 *
 * @readonly
 */
export const REJECT_MESSAGES = Object.freeze({
  [RejectReason.UNSUPPORTED_TYPE]: "Only .pdf and .docx files are supported.",
  [RejectReason.TOO_LARGE]: "The maximum supported size is 25 MB.",
  [RejectReason.EMPTY]: "That file is empty.",
});

/**
 * The supported file extensions (primary type signal). Lowercased, no dot.
 *
 * @readonly
 */
const SUPPORTED_EXTENSIONS = Object.freeze(["pdf", "docx"]);

/**
 * MIME types that, where a real browser reports them, also count as supported.
 * The harness's file descriptors put a bare extension in `type` rather than a
 * MIME string, so MIME is a secondary, lenient signal — extension is primary.
 *
 * @readonly
 */
const SUPPORTED_MIME_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
});

// --- Type detection ---------------------------------------------------------

/**
 * Extract the lowercased extension from a filename — the characters after the
 * last dot. Returns "" when there is no dot, the dot is leading (a dotfile with
 * no extension, e.g. ".pdf" as a bare name is treated as having no stem), or
 * the name is empty.
 *
 * @param {string} name
 * @returns {string} lowercased extension without the dot, or "".
 */
function extensionOf(name) {
  if (typeof name !== "string") return "";
  const lastDot = name.lastIndexOf(".");
  // No dot, or a leading dot with nothing before it → no usable extension.
  if (lastDot <= 0) return "";
  return name.slice(lastDot + 1).toLowerCase();
}

/**
 * Decide whether a file descriptor is a Supported_File_Type.
 *
 * Precedence of signals (documented, deterministic):
 *   1. The filename extension (primary). If `name`'s extension is `pdf` or
 *      `docx`, the file is supported. This is the authoritative signal because
 *      the test harness encodes the real type in the extension, and a user's
 *      filename extension is the most reliable cheap signal in the browser.
 *   2. The `type` field, interpreted leniently (secondary). It may be either a
 *      bare extension string (`"pdf"` / `"docx"`, as the harness emits) or a
 *      real MIME type (`"application/pdf"` / the DOCX MIME). Either form that
 *      resolves to a supported kind counts.
 *
 * Both signals are "accept" signals: a match on EITHER makes the file
 * supported. We do not reject on a mismatch *between* extension and MIME here;
 * the requirement (R1.3) rejects only when the type is not supported at all. A
 * deeper magic-byte cross-check is intentionally out of scope for this
 * synchronous function (see the note on `sniffMagicBytes` below).
 *
 * @param {{ name?: string, type?: string }} file
 * @returns {boolean}
 */
function isSupportedType(file) {
  const ext = extensionOf(file && file.name);
  if (SUPPORTED_EXTENSIONS.includes(ext)) return true;

  const rawType = typeof (file && file.type) === "string" ? file.type.toLowerCase() : "";
  if (!rawType) return false;
  // Real MIME string?
  if (Object.prototype.hasOwnProperty.call(SUPPORTED_MIME_TYPES, rawType)) {
    return true;
  }
  // Bare extension string in `type` (the harness's descriptor shape).
  if (SUPPORTED_EXTENSIONS.includes(rawType)) return true;

  return false;
}

// --- validate (pure) --------------------------------------------------------

/**
 * @typedef {Object} ValidationOk
 * @property {true} ok
 */

/**
 * @typedef {Object} ValidationReject
 * @property {false} ok
 * @property {'unsupportedType'|'tooLarge'|'empty'} reason
 * @property {string} message  One of REJECT_MESSAGES.
 */

/**
 * Validate a selected file against the accept criteria (R1.2). PURE and
 * SYNCHRONOUS: it reads only `file.name`, `file.type`, and `file.size`, never
 * touches the DOM, does no I/O, and does not read the file's bytes. That purity
 * is what makes it directly property-testable (task 4.2) and unit-testable
 * (task 4.3).
 *
 * Works with both real browser `File` objects (where `type` is a MIME string)
 * and the plain `{ name, type, size }` descriptors the harness generates (where
 * `type` is a bare extension). See `isSupportedType` for the signal precedence.
 *
 * Rejection-reason PRECEDENCE (deterministic, documented — this ordering is the
 * contract Property 1 relies on, "each rejection reason matches the specific
 * failing condition"):
 *   1. `unsupportedType` — if the type is not `.pdf`/`.docx`. Checked FIRST so a
 *      wrong-type file is reported by the reason the user can act on (pick a
 *      different kind of file), regardless of its size. A 0-byte `.exe` is an
 *      unsupported type, not "empty" — the type is the primary, more actionable
 *      problem.
 *   2. `empty` — if the type is supported but `size === 0`.
 *   3. `tooLarge` — if the type is supported, `size > 0`, but `size > 25 MB`.
 *
 * With this order every returned reason reflects a genuinely failing condition:
 * a file is accepted iff it passes all three checks, i.e. iff (supported type
 * AND size > 0 AND size <= MAX), exactly the Property 1 / R1.2 criterion.
 *
 * A non-object, or a `size` that is not a finite non-negative number, is
 * treated as empty — there is no readable content to extract.
 *
 * @param {{ name?: string, type?: string, size?: number }} file
 * @returns {ValidationOk | ValidationReject}
 */
export function validate(file) {
  // Defensive: a missing/!object file has nothing to extract → treat as empty.
  if (!file || typeof file !== "object") {
    return reject(RejectReason.EMPTY);
  }

  // 1) Unsupported type (checked first — see precedence note above).
  if (!isSupportedType(file)) {
    return reject(RejectReason.UNSUPPORTED_TYPE);
  }

  // Normalize size: anything not a finite, non-negative number is "no content".
  const size =
    typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0
      ? file.size
      : 0;

  // 2) Empty.
  if (size === 0) {
    return reject(RejectReason.EMPTY);
  }

  // 3) Too large.
  if (size > MAX_FILE_SIZE_BYTES) {
    return reject(RejectReason.TOO_LARGE);
  }

  return { ok: true };
}

/**
 * Build a rejection result for a reason, attaching its exact message.
 *
 * @param {'unsupportedType'|'tooLarge'|'empty'} reason
 * @returns {ValidationReject}
 */
function reject(reason) {
  return { ok: false, reason, message: REJECT_MESSAGES[reason] };
}

// --- Magic-byte sniffing: intentionally NOT in validate ---------------------

/**
 * Best-effort magic-byte (file-signature) sniff. This is ASYNC because reading
 * a file's bytes in the browser is asynchronous, so it deliberately lives
 * OUTSIDE the synchronous, pure `validate` — keeping `validate` deterministic
 * and property-testable. The extractor layer (task 5/6/7) may use this as an
 * extra guard before parsing; `validate` must not, and does not, depend on it.
 *
 * Signatures checked:
 *   - PDF:  `%PDF-` → 25 50 44 46 2D
 *   - DOCX: a ZIP container → `PK\x03\x04` (50 4B 03 04). DOCX (like all OOXML)
 *     is a ZIP archive, so this confirms "a zip", not "a docx" specifically;
 *     the DOCX extractor confirms the inner `word/document.xml`.
 *
 * Returns the detected kind, or `null` when it matches no known signature or
 * the bytes cannot be read. Never throws for an unreadable blob; resolves null.
 *
 * @param {Blob} blob  A File/Blob whose leading bytes will be read.
 * @returns {Promise<'pdf'|'docx'|null>}
 */
export async function sniffMagicBytes(blob) {
  if (!blob || typeof blob.slice !== "function") return null;
  try {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    // %PDF-
    if (
      head.length >= 5 &&
      head[0] === 0x25 &&
      head[1] === 0x50 &&
      head[2] === 0x44 &&
      head[3] === 0x46 &&
      head[4] === 0x2d
    ) {
      return "pdf";
    }
    // PK\x03\x04 (zip container → OOXML/docx)
    if (
      head.length >= 4 &&
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      head[2] === 0x03 &&
      head[3] === 0x04
    ) {
      return "docx";
    }
    return null;
  } catch {
    // Unreadable blob: signal "unknown" rather than failing validation.
    return null;
  }
}

// --- init (thin DOM adapter; full wiring in tasks 12.1 / 12.3) --------------

/**
 * @typedef {Object} InitOptions
 * @property {(file: File) => void} onAccept  Called with a file that passes
 *   `validate`. The upload view supplies this to kick off extraction (R1.2).
 * @property {(result: ValidationReject, file: File) => void} [onReject]  Called
 *   with the rejection result and the offending file when `validate` fails, so
 *   the view can show `result.message` while retaining the prior file
 *   (R1.3/1.4/1.5). Optional; omitting it simply drops rejected files silently.
 */

/**
 * Wire a keyboard-operable file `<input type="file">` to `validate` (R1.1).
 * This is a THIN adapter: it finds or creates the input, listens for `change`,
 * runs the pure `validate`, and routes to `onAccept` / `onReject`. The richer
 * upload view (progress indicator, drag-and-drop, mascot states) is built in
 * tasks 12.1 and 12.3 and may replace or extend this.
 *
 * If `uploadEl` is itself a file input it is used directly; otherwise the first
 * descendant `input[type=file]` is used, and if none exists one is created and
 * appended so the control is always keyboard-reachable.
 *
 * @param {HTMLElement} uploadEl  The upload container (or a file input).
 * @param {InitOptions} options
 * @returns {() => void} teardown — removes the change listener.
 */
export function init(uploadEl, { onAccept, onReject } = {}) {
  if (!uploadEl || typeof uploadEl.querySelector !== "function") {
    throw new TypeError("init: uploadEl must be a DOM element");
  }
  if (typeof onAccept !== "function") {
    throw new TypeError("init: options.onAccept must be a function");
  }

  /** @type {HTMLInputElement} */
  let input;
  if (uploadEl.tagName === "INPUT" && uploadEl.type === "file") {
    input = /** @type {HTMLInputElement} */ (uploadEl);
  } else {
    input = /** @type {HTMLInputElement} */ (
      uploadEl.querySelector('input[type="file"]')
    );
    if (!input) {
      input = uploadEl.ownerDocument.createElement("input");
      input.type = "file";
      input.accept = ".pdf,.docx";
      uploadEl.appendChild(input);
    }
  }

  function handleChange() {
    const file = input.files && input.files[0];
    if (!file) return; // selection cancelled: keep prior state unchanged.
    const result = validate(file);
    if (result.ok) {
      onAccept(file);
    } else if (typeof onReject === "function") {
      onReject(result, file);
    }
    // Reset so selecting the same file again re-fires `change`.
    input.value = "";
  }

  input.addEventListener("change", handleChange);
  return function teardown() {
    input.removeEventListener("change", handleChange);
  };
}
