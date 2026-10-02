// Single-file ZIP entries (archive compression 1).
import { unzipSync, zipSync } from 'fflate';

export function unzipSingle(blob: Uint8Array): { name: string | null; body: Uint8Array } {
  const files = unzipSync(blob);
  const names = Object.keys(files);
  if (!names.length) return { name: null, body: new Uint8Array(0) };
  return { name: names[0]!, body: files[names[0]!]! };
}

export function zipSingle(name: string | null, body: Uint8Array): Uint8Array {
  // Fixed timestamp (1980-01-01) so builds are reproducible, like tools/gsarc.py.
  if (!name) return zipSync({});
  return zipSync({ [name]: [body, { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0) }] });
}

/** Name of the first file of a ZIP from its local header, without inflating it (null when it is not a ZIP). */
export function zipEntryName(blob: Uint8Array): string | null {
  if (blob.length < 30 || blob[0] !== 0x50 || blob[1] !== 0x4b || blob[2] !== 3 || blob[3] !== 4) return null;
  const n = blob[26]! | (blob[27]! << 8);
  if (30 + n > blob.length) return null;
  return new TextDecoder().decode(blob.subarray(30, 30 + n));
}
