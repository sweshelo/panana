// The effects of RPG FREE! (lanai): particles (.ptcl, magic SPBD v0x33) named by rows of the master's EffectData
// (1578 × 0x2C). Read so far (Codex 2026-11-26, roms/tmpmap/ptcl/report.md; not in docs yet):
// - EffectData +0x00 is the hash of the .ptcl in the archive 90ED0000, or in F0F40000 when +0x26 bit 0 is set
//   (FUN_002DC4DC @0x2DC590: 1097 / 477 rows; rows 0 / 962 / 964 / 966 have none).
// - A .ptcl's first texture: +0x14 / +0x18 its data and length, +0x40 / +0x44 the MATC section, whose register pairs
//   (8 bytes from +0x10: u16 id, u32 value at +4) hold the size (0x81: width << 16 | height) and the PICA200 format
//   (0x85; 12 = ETC1, 9 = LA4 seen). The emitters' lifetimes, rates, velocities and blending are not read: the editor
//   shows the texture only, as a mark of where the game puts an effect and which one.
import { findEntry, unpackEntry } from '../archive/gsarc';
import { decodeTexture, textureDataSize } from '../cgfx/texture';
import { u16, u32 } from '../util/bytes';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** The archives of the .ptcl files (EffectData +0x26 bit 0 picks the second). */
export const LANAI_EFFECT_ARCHIVES = ['90ED0000', 'F0F40000'] as const;

/** The .ptcl an EffectData row names: its archive and the entry's hash; null when the row has none. */
export function lanaiEffectRef(
  effectData: LanaiTable | undefined,
  row: number,
): { archive: string; entry: number } | null {
  if (!effectData || row <= 0 || row >= effectData.rows) return null;
  const r = effectData.row(row);
  const entry = u32(r, 0);
  return entry ? { archive: LANAI_EFFECT_ARCHIVES[r[0x26]! & 1]!, entry } : null;
}

/** The first texture of a .ptcl, decoded to RGBA (top row first); null when the file has none that can be read. */
export interface PtclTexture {
  width: number;
  height: number;
  format: number;
  rgba: Uint8Array;
}

export function ptclTexture(b: Uint8Array): PtclTexture | null {
  if (b.length < 0x48 || String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) !== 'SPBD') return null;
  const start = u32(b, 0x14),
    len = u32(b, 0x18),
    matc = u32(b, 0x40),
    matcLen = u32(b, 0x44);
  if (matc + matcLen > b.length || String.fromCharCode(...b.subarray(matc, matc + 4)) !== 'MATC') return null;
  const reg = (id: number): number | null => {
    for (let o = matc + 0x10; o + 8 <= matc + matcLen; o += 8) if (u16(b, o) === id) return u32(b, o + 4);
    return null;
  };
  const size = reg(0x81),
    format = reg(0x85);
  if (size === null || format === null) return null;
  const width = size >>> 16,
    height = size & 0xffff;
  if (!width || !height || textureDataSize(format, width, height) > len || start + len > b.length) return null;
  try {
    return { width, height, format, rgba: decodeTexture(b.subarray(start, start + len), width, height, format) };
  } catch {
    return null;
  }
}

/** The .ptcl file names, keyed by EffectData row, once read. */
const cache = new WeakMap<LanaiSession, Map<number, Promise<{ name: string; texture: PtclTexture | null } | null>>>();

/** An EffectData row's .ptcl: its name and first texture (read once per session); null when the row names none. */
export function lanaiEffect(
  session: LanaiSession,
  row: number,
): Promise<{ name: string; texture: PtclTexture | null } | null> {
  const m = cache.get(session) ?? cache.set(session, new Map()).get(session)!;
  let p = m.get(row);
  if (!p) {
    p = (async () => {
      const ref = lanaiEffectRef(session.table('EffectData'), row);
      if (!ref) return null;
      const arc = await session.archive(ref.archive);
      const e = findEntry(arc, ref.entry);
      if (!e) return null;
      const { name, body } = unpackEntry(arc, e);
      return { name: name ?? '', texture: ptclTexture(body) };
    })();
    p.catch(() => m.delete(row));
    m.set(row, p);
  }
  return p;
}
