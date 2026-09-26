// Sound names: soundData (56562135, 0xC bytes per row, +0 = sound archive item ID 0x01nnnnnn) and the
// sound names of sound/sound.bcsar (STRG + INFO blocks). elpulse docs/encounters.md §4.
import { u16, u32 } from '../util/bytes';

export const BCSAR_PATH = 'sound/sound.bcsar';

/** Sound names by sound index (BCSAR INFO sound entries, their string ID). */
export function bcsarSoundNames(d: Uint8Array): string[] {
  if (String.fromCharCode(...d.subarray(0, 4)) !== 'CSAR') throw new Error('CSAR ではありません');
  const blocks = new Map<number, number>();
  const n = u16(d, 0x10);
  for (let i = 0; i < n; i++) blocks.set(u16(d, 0x14 + i * 12), u32(d, 0x14 + i * 12 + 4));
  const strg = blocks.get(0x2000);
  const info = blocks.get(0x2001);
  if (strg === undefined || info === undefined) throw new Error('CSAR に STRG / INFO がありません');
  const tab = strg + 8 + u32(d, strg + 8 + 4);
  const strings: string[] = [];
  for (let i = 0, count = u32(d, tab); i < count; i++) {
    const o = tab + u32(d, tab + 4 + i * 12 + 4);
    const size = u32(d, tab + 4 + i * 12 + 8);
    strings.push(new TextDecoder('ascii').decode(d.subarray(o, o + size - 1)));
  }
  let soundRef = -1;
  for (let i = 0; i < 8; i++) if (u16(d, info + 8 + i * 8) === 0x2100) soundRef = u32(d, info + 8 + i * 8 + 4);
  if (soundRef < 0) throw new Error('CSAR に音の一覧がありません');
  const st = info + 8 + soundRef;
  const out: string[] = [];
  for (let i = 0, count = u32(d, st); i < count; i++) {
    const e = st + u32(d, st + 4 + i * 8 + 4);
    const flags = u32(d, e + 0x14);
    out.push(flags & 1 ? strings[u32(d, e + 0x18)] ?? '' : '');
  }
  return out;
}

export class SoundNames {
  constructor(
    /** soundData rows: item IDs. */
    private readonly items: number[],
    /** Sound names by index, or null when the dump has no sound archive. */
    private readonly names: string[] | null,
  ) {}

  /** Name of a soundData row ("BGM_CAVE"), or "" when unknown. */
  name(row: number): string {
    const id = this.items[row];
    if (!id || id >>> 24 !== 1 || !this.names) return '';
    return this.names[id & 0xffffff] ?? '';
  }

  /** "BGM_CAVE (18)" or "サウンド 18". */
  label(row: number): string {
    if (!row) return 'なし';
    const n = this.name(row);
    return n ? `${n} (${row})` : `サウンド ${row}`;
  }
}
