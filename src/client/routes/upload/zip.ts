/**
 * W7-B (F0225 / F0297, the ZIP half) — expand a ZIP of pitch decks in the
 * BROWSER, into the review list, before anything is uploaded.
 *
 * Why here and not in the Worker: the plan forbids a new package on the
 * critical path without a recorded reason, and an unzip library in the Worker
 * would be exactly that. The browser already ships the one hard part —
 * `DecompressionStream("deflate-raw")` — so the container format is ~100 lines
 * of reading headers, and each PDF inside becomes a staged deck the operator
 * sees, sizes, previews and approves like any other. The upload route never
 * learns a ZIP existed, so the credit metering path is untouched.
 *
 * Supported: the two compression methods real archivers write (0 stored,
 * 8 deflate). Refused, and reported rather than guessed at: encrypted entries
 * and ZIP64 archives. Oversized entries are never inflated — their declared size
 * comes back so the review list can show them as refused.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipDeckEntry {
  name: string;
  /** Uncompressed size, as the archive declares it. */
  size: number;
  /** The PDF, or null when it was not inflated (oversized). */
  file: File | null;
}

export interface ZipExpansion {
  decks: ZipDeckEntry[];
  /** Entries that are not PDFs (and are not archive noise), by name. */
  skipped: string[];
  /** Why the archive, or an entry in it, could not be read. */
  errors: string[];
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Archive noise nobody put there on purpose: folders, macOS resource forks. */
function isNoise(path: string): boolean {
  return path.endsWith("/") || path.startsWith("__MACOSX/") || baseName(path).startsWith("._");
}

export function isZipFile(file: { name: string; type?: string }): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

async function inflateRaw(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

/**
 * Read every PDF out of a ZIP archive. Never throws for a malformed archive —
 * the error is returned so the screen can say what went wrong.
 */
export async function expandZip(buffer: ArrayBuffer, maxBytes: number): Promise<ZipExpansion> {
  const out: ZipExpansion = { decks: [], skipped: [], errors: [] };
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();

  // The End Of Central Directory record sits within the last 22 + 65 535 bytes.
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    out.errors.push("This file is not a readable ZIP archive.");
    return out;
  }

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    out.errors.push("ZIP64 archives are not supported — re-save the archive or choose the PDFs directly.");
    return out;
  }

  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== CENTRAL_SIG) {
      out.errors.push("The archive's directory is damaged.");
      return out;
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (isNoise(path)) continue;
    const name = baseName(path);
    if (!/\.pdf$/i.test(name)) {
      out.skipped.push(name);
      continue;
    }
    if (flags & 0x1) {
      out.errors.push(`${name} is encrypted and was not read.`);
      continue;
    }
    if (size > maxBytes) {
      out.decks.push({ name, size, file: null });
      continue;
    }
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      out.errors.push(`${name} could not be located in the archive.`);
      continue;
    }
    // The local header's name/extra lengths may differ from the central copy.
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compSize);
    try {
      let content: ArrayBuffer;
      if (method === 0) content = data.slice().buffer;
      else if (method === 8) content = await inflateRaw(data);
      else {
        out.errors.push(`${name} uses an unsupported compression method.`);
        continue;
      }
      out.decks.push({ name, size: content.byteLength, file: new File([content], name, { type: "application/pdf" }) });
    } catch {
      out.errors.push(`${name} could not be decompressed.`);
    }
  }
  return out;
}
