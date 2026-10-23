// The battle field of an RPG FREE! battle (docs/lanai/battle-field.md): one row of the master's BattleField or the
// content's BattleFieldContents (12 B: +0x00 archive and +0x04 entry of the background model, +0x08 the battle BGM as a
// SoundData row) picked by the group (MonsterGroup +0x00, from the content's table when +0x69 bit3 is set). A value the
// table doesn't have is its row 0. MapResource +0x10 is the content row a map starts with, and MapData +0x04 / +0x06 /
// +0x08 are the map's field BGM, the tune of one encounter path and the encounter sound.
import type { LanaiMaps } from './maps';
import { LANAI_MG_FIELD, LANAI_MG_FLAGS } from './monsterGroup';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

export const LANAI_BF = { archive: 0x00, entry: 0x04, bgm: 0x08 } as const;
/** MonsterGroup +0x69 bit3: the group's battle field is a row of the content's BattleFieldContents. */
export const LANAI_MG_FIELD_CONTENTS = 0x08;
/** MapResource +0x10: the BattleFieldContents row ID a map starts with (0 = the group's). */
export const LANAI_RESOURCE_BATTLE_FIELD = 0x10;
/** MapData: field BGM, the tune FUN_001DAB34 plays before a battle, the encounter sound (u16 SoundData rows). */
export const LANAI_MAP_SOUNDS = [
  { offset: 0x04, label: 'フィールドの BGM', kind: 'bgm', note: '0 なら MapGroup で決まる (ワールドマップ・海など)' },
  { offset: 0x06, label: '戦闘の前の曲', kind: 'bgm', note: 'エンカウントの経路の 1 つで戦闘の前に鳴らす。戦闘が始まると戦闘の背景の行の BGM に変わる (推定)' },
  { offset: 0x08, label: 'エンカウントの効果音', kind: 'se', note: '0 なら 107。値は 107〜111 (推定)' },
] as const;

export const LANAI_BG_ARCHIVES = [0x52120000, 0xf0f40000];

/** The btmp_* entries of the two archives the rows point at (entry headers' paths). */
export const LANAI_BATTLE_BACKGROUNDS: { archive: number; entry: number; name: string }[] = [
  ...([
    [0x8d63d000, 'btmp_01_caveA'], [0xa09dd800, 'btmp_02_caveB'], [0x1825d400, 'btmp_03_towerA'], [0x4bdec000, 'btmp_04_forestA'],
    [0x8ca98400, 'btmp_05_volcanoA'], [0x3afefc00, 'btmp_06_ruinsA'], [0x580a4800, 'btmp_07_ruinsB'], [0xe76b3400, 'btmp_08_iceA'],
    [0x81ee5400, 'btmp_09_relic'], [0x560c5c00, 'btmp_10_temple'], [0xfedf0c00, 'btmp_10_templeB'], [0x80b4f000, 'btmp_11_caveC'],
    [0x5b800400, 'btmp_11_opnforest'], [0x422cc400, 'btmp_12_flat'], [0x7fd5d400, 'btmp_13_sand'], [0x4b8f1400, 'btmp_14_sea'],
    [0xa08cfc00, 'btmp_15_arena'], [0xf8b91800, 'btmp_16_caveD'], [0x21306000, 'btmp_17_towerB'], [0x8a645000, 'btmp_18_hell'],
    [0x9212b800, 'btmp_19_snow'], [0x1125c400, 'btmp_20_snowfst'],
  ] as const).map(([entry, name]) => ({ archive: 0x52120000, entry, name })),
  ...([
    [0x57b86800, 'btmp_00_photo'], [0x0785fc00, 'btmp_04_forestB'], [0xf646fc00, 'btmp_04_forestB_n'], [0x81ee5400, 'btmp_09_relic'],
    [0xfedf0c00, 'btmp_10_templeB'], [0x2fb36800, 'btmp_10_templeC'], [0x1125c400, 'btmp_20_snowfst'], [0x6a634800, 'btmp_21_rain'],
  ] as const).map(([entry, name]) => ({ archive: 0xf0f40000, entry, name })),
];

const hex = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** "btmp_01_caveA" ("btmp_09_relic (F0F4)" for the effects archive), or the hashes. */
export function lanaiBackgroundName(archive: number, entry: number): string {
  if (!archive && !entry) return 'なし';
  const b = LANAI_BATTLE_BACKGROUNDS.find((x) => x.archive === archive >>> 0 && x.entry === entry >>> 0);
  if (!b) return `${hex(archive)} / ${hex(entry)}`;
  return archive >>> 0 === 0x52120000 ? b.name : `${b.name} (F0F4)`;
}

/** Key of a background in a <select>. */
export const lanaiBackgroundKey = (archive: number, entry: number): string => `${hex(archive)}:${hex(entry)}`;

/** The master's BattleField (26 rows) and the content's BattleFieldContents. */
export function lanaiBattleFieldTable(session: LanaiSession, maps: LanaiMaps, contents: boolean): LanaiTable | undefined {
  return contents ? maps.contentTable('BattleFieldContents') : session.table('BattleField');
}

/** The row a value names in the table the game reads: not found -> row 0. */
export function lanaiBattleFieldRow(t: LanaiTable | undefined, value: number): { row: number; found: boolean } {
  if (!t || !t.rows) return { row: -1, found: false };
  const r = t.find(value >>> 0);
  return r >= 0 ? { row: r, found: true } : { row: 0, found: false };
}

/** A group's battle field: which table, the value and the row it gives. */
export function lanaiGroupBattleField(session: LanaiSession, maps: LanaiMaps, row: number): { contents: boolean; value: number; table: LanaiTable | undefined; row: number; found: boolean } {
  const g = maps.monsterGroup!;
  const contents = !!(g.u8(row, LANAI_MG_FLAGS) & LANAI_MG_FIELD_CONTENTS);
  const value = g.u32(row, LANAI_MG_FIELD);
  const table = lanaiBattleFieldTable(session, maps, contents);
  return { contents, value, table, ...lanaiBattleFieldRow(table, value) };
}

export interface LanaiBattleFieldUse {
  /** "群れ #3" or "MapResource 行 5". */
  label: string;
  href?: string;
}

/** Who uses each row of a battle-field table: the content's groups (and, for BattleFieldContents, MapResource +0x10). */
export function lanaiBattleFieldUses(session: LanaiSession, maps: LanaiMaps, contents: boolean, groupHref: (row: number) => string): Map<number, LanaiBattleFieldUse[]> {
  const out = new Map<number, LanaiBattleFieldUse[]>();
  const add = (r: number, u: LanaiBattleFieldUse): void => void out.set(r, [...(out.get(r) ?? []), u]);
  const g = maps.monsterGroup;
  if (g)
    for (let r = 1; r < g.rows; r++) {
      const f = lanaiGroupBattleField(session, maps, r);
      if (f.contents === contents && f.row >= 0) add(f.row, { label: `群れ #${r}`, href: groupHref(r) });
    }
  const res = maps.contentTable('MapResource');
  const t = lanaiBattleFieldTable(session, maps, true);
  if (contents && res && t)
    for (let r = 0; r < res.rows; r++) {
      const v = res.u32(r, LANAI_RESOURCE_BATTLE_FIELD);
      if (v) add(lanaiBattleFieldRow(t, v).row, { label: `MapResource 行 ${r}` });
    }
  return out;
}
