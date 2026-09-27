// Sound names: soundData (56562135, 0xC bytes per row, +0 = sound archive item ID 0x01nnnnnn) and the
// sound names of sound/sound.bcsar (STRG + INFO blocks). elpulse docs/encounters.md §4.
import { u16, u32 } from '../util/bytes';
import type { MapInfo } from './codebin';
import type { Game } from './game';
import type { MapDoc } from './sections';

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

/** The sounds a mapData row picks ([4] / [5] / [6], one byte each: soundData rows 0-255). */
export const SOUND_SLOTS = [
  ['bgm', 'フィールドの BGM', 4],
  ['battle', '戦闘の BGM', 5],
  ['steps', '足音', 6],
] as const;
export type SoundSlot = (typeof SOUND_SLOTS)[number][0];
/** Largest soundData row a mapData byte can hold. */
export const MAX_MAP_SOUND = 0xff;

export type SoundKind = 'bgm' | 'se' | 'other';
export const SOUND_KIND: Record<SoundKind, string> = { bgm: 'BGM', se: '効果音', other: 'その他' };

export class SoundNames {
  constructor(
    /** soundData rows: item IDs (+0). */
    private readonly items: number[],
    /** Sound names by index, or null when the dump has no sound archive. */
    private readonly names: string[] | null,
    /** soundData rows: volume (+8). */
    private readonly volumes: number[] = [],
  ) {}

  /** Rows of soundData (row 0 = none). */
  get rows(): number {
    return this.items.length;
  }

  /** Sound archive item ID of a row (0x01nnnnnn = sound nnnnnn). */
  item(row: number): number {
    return this.items[row] ?? 0;
  }

  volume(row: number): number {
    return this.volumes[row] ?? 0;
  }

  /** The names come from sound.bcsar (false: rows are only numbered). */
  get named(): boolean {
    return !!this.names;
  }

  /** BGM_* / SE_* by name (without names: rows 1-34 are BGM, docs/encounters.md §4). */
  kind(row: number): SoundKind {
    const n = this.name(row);
    if (n) return n.startsWith('BGM_') ? 'bgm' : n.startsWith('SE_') ? 'se' : 'other';
    return row >= 1 && row <= 34 ? 'bgm' : 'other';
  }

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

/** Where a mapData row is used: its maps (the edited documents, for their indoor flag). */
export function mapDataUsers(game: Game, docOf: (m: MapInfo) => MapDoc): Map<number, MapInfo[]> {
  const out = new Map<number, MapInfo[]>();
  for (const m of game.editableMaps()) {
    const row = game.master.mapDataRow(game.mapRef(m, docOf(m)));
    out.set(row, [...(out.get(row) ?? []), m]);
  }
  return out;
}

export interface SoundUse {
  mapDataRow: number;
  slot: SoundSlot;
}

/** soundData row -> the mapData rows (and slots) that pick it. */
export function soundUses(game: Game): Map<number, SoundUse[]> {
  const out = new Map<number, SoundUse[]>();
  const t = game.master.mapData;
  for (let r = 0; r < t.rows; r++) {
    const row = t.row(r);
    for (const [slot, , o] of SOUND_SLOTS) {
      const s = row[o]!;
      if (s) out.set(s, [...(out.get(s) ?? []), { mapDataRow: r, slot }]);
    }
  }
  return out;
}
