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
