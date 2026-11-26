// The game's patch (code.ips with the custom stages) and its version, as the game asks for them to update itself.
//
// lanai-custom-stages' `bun 3ds/build.ts` writes the patch with its build ID baked into the code (lcs_build_id), and
// build.json beside it. Panana bundles the patch as server/assets/lanai-cs.ips and that build's ID as lanai-cs.json:
//   { "buildId": "3dd3168a", "sha256": "<of lanai-cs.ips>", "source": "lanai-custom-stages 3dd3168 (2026-11-25)" }
// The sha256 ties the JSON to the IPS: when they disagree the version is unknown and the game is told nothing (it
// would otherwise keep fetching a patch that is not the one it was told about).
//
// The game reads GET /api/patch.bin (16 bytes, little endian):
//   +0 "LCSP"  +4 build ID  +8 size of the IPS  +12 FNV-1a (32 bit) of the IPS
// and, when the build ID is not its own, GET /api/patch/code.ips, which it checks against the size and the FNV-1a
// before writing it to the SD.

export interface PatchInfo {
  /** The build ID the patch carries, 8 lowercase hex digits. */
  buildId: string;
  size: number;
  /** FNV-1a (32 bit) of the IPS, what the game checks a download with. */
  fnv1a: number;
  sha256: string;
  source: string | null;
}

export const PATCH_MAGIC = 'LCSP';

/** FNV-1a, 32 bit (offset basis 0x811C9DC5, prime 0x01000193). */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}

export const sha256Hex = (bytes: Uint8Array): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/** The patch's version from its JSON; null with the reason when it cannot be told. */
export function patchInfo(ips: Uint8Array, json: unknown): { info: PatchInfo } | { error: string } {
  const j = json as { buildId?: unknown; sha256?: unknown; source?: unknown } | null;
  if (!j || typeof j.buildId !== 'string' || !/^[0-9a-f]{8}$/iu.test(j.buildId))
    return { error: 'lanai-cs.json の buildId は 16 進 8 桁にしてください。' };
  const sha256 = sha256Hex(ips);
  if (typeof j.sha256 !== 'string' || j.sha256.toLowerCase() !== sha256)
    return { error: 'lanai-cs.json の sha256 が lanai-cs.ips と合いません。' };
  return {
    info: {
      buildId: j.buildId.toLowerCase(),
      size: ips.length,
      fnv1a: fnv1a32(ips),
      sha256,
      source: typeof j.source === 'string' ? j.source : null,
    },
  };
}

/** GET /api/patch.bin's 16 bytes. */
export function patchManifest(info: PatchInfo): Uint8Array {
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(PATCH_MAGIC), 0);
  view.setUint32(4, Number.parseInt(info.buildId, 16), true);
  view.setUint32(8, info.size, true);
  view.setUint32(12, info.fnv1a, true);
  return out;
}

/** Reads the bundled patch and its JSON; the version is null when the JSON is missing or does not match. */
export async function loadPatch(
  patchPath: string | null | undefined,
  infoPath: string | null | undefined,
): Promise<{ bytes: Uint8Array; info: PatchInfo | null; error: string | null } | null> {
  if (!patchPath) return null;
  const file = Bun.file(patchPath);
  if (!(await file.exists())) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!infoPath || !(await Bun.file(infoPath).exists()))
    return { bytes, info: null, error: 'パッチの版 (lanai-cs.json) が同梱されていません。' };
  let json: unknown;
  try {
    json = await Bun.file(infoPath).json();
  } catch {
    return { bytes, info: null, error: 'lanai-cs.json を読めません。' };
  }
  const r = patchInfo(bytes, json);
  return 'info' in r ? { bytes, info: r.info, error: null } : { bytes, info: null, error: r.error };
}
