// Where a battle of 電波人間のRPG3 gets its background and BGM (docs/oahu/sound.md §3.1・§3.3・§3.5). Both come from
// the dungeon's mapData row (mapGroup +0x2E, save +0x5469 in the game): its [5] is the battle BGM, and its [1] is the
// mapResource row whose +0x10 is the background (an entry of archive 52120000). Groups have no background; a fixed
// battle started without a BGM plays BGM_BATTLE_2 when the group's +0x32 bit2 is set (sound.ts).
import { hex8, u32, w32 } from '../util/bytes';
import type { ModelRef } from '../pages/modelview';
import type { Dump } from '../rom/dump';
import { oahuObjectModels } from './mapModels';
import type { MapDoc } from '../game/sections';
import type { OahuMaps, OahuMapInfo } from './maps';
import type { OahuMaster } from './master';

/** The archive of the battle backgrounds (FUN_001C3D08 is its only reader). */
export const OAHU_BATTLE_BG_ARCHIVE = 0x52120000;
/** mapResource +0x10: the background's entry in OAHU_BATTLE_BG_ARCHIVE (0 = no background). */
export const OAHU_RESOURCE_BATTLE_BG = 0x10;
/** mapData [1]: the mapResource row. */
const MAP_DATA_RESOURCE = 1;

/** The 22 entries of 52120000 (Base): hash -> model name (from the path in each entry's header). */
export const OAHU_BATTLE_BACKGROUNDS: [hash: number, name: string][] = [
  [0x8336a000, 'btmp_01_caveA'],
  [0x60346c00, 'btmp_02_caveB'],
  [0xe6d9dc00, 'btmp_03_towerA'],
  [0xf1bae400, 'btmp_04_forestA'],
  [0x33378400, 'btmp_05_volcanoA'],
  [0x6ced0400, 'btmp_06_ruinsA'],
  [0x44dd9400, 'btmp_07_ruinsB'],
  [0xb28aa000, 'btmp_08_iceA'],
  [0x0a35f800, 'btmp_09_relic'],
  [0xcede2800, 'btmp_10_temple'],
  [0x8f1c8c00, 'btmp_10_templeB'],
  [0x3f3a2000, 'btmp_11_caveC'],
  [0x34f66400, 'btmp_11_opnforest'],
  [0x3c100c00, 'btmp_12_flat'],
  [0x6b8e0000, 'btmp_13_sand'],
  [0xeb4ac400, 'btmp_14_sea'],
  [0x5acb5000, 'btmp_15_arena'],
  [0x59e9a400, 'btmp_16_caveD'],
  [0x99b53c00, 'btmp_17_towerB'],
  [0x5f333c00, 'btmp_18_hell'],
  [0x032d2000, 'btmp_19_snow'],
  [0x39528000, 'btmp_20_snowfst'],
];

const BG_NAMES = new Map(OAHU_BATTLE_BACKGROUNDS);

/** "btmp_01_caveA", "なし" or the hash. */
export function oahuBattleBackgroundName(hash: number): string {
  if (!hash) return 'なし';
  return BG_NAMES.get(hash >>> 0) ?? `${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')} (表にないエントリ)`;
}

/** The rows a battle on a map reads. */
export interface OahuBattleRows {
  /** mapData row of the battles: the dungeon's (+0x2E); the map's own row when it has no dungeon. */
  mapData: number;
  /** Whether that is the dungeon's row. */
  fromDungeon: boolean;
  /** mapResource row = mapData[mapData][1]. */
  resource: number;
  /** mapResource +0x10 (0 = none). */
  background: number;
}

export function oahuBattleRows(maps: OahuMaps, info: OahuMapInfo, doc: MapDoc): OahuBattleRows {
  const d = maps.dungeonOf(info);
  const fromDungeon = !!d?.mapData;
  const mapData = fromDungeon ? d!.mapData : maps.mapDataRow(info, doc);
  const md = maps.master.table('mapData.bin');
  const resource = mapData < md.rows ? md.row(mapData)[MAP_DATA_RESOURCE]! : 0;
  return { mapData, fromDungeon, resource, background: oahuResourceBackground(maps.master, resource) };
}

export function oahuResourceBackground(master: OahuMaster, resource: number): number {
  const t = master.table('mapResource.bin');
  return resource > 0 && resource < t.rows ? u32(t.row(resource), OAHU_RESOURCE_BATTLE_BG) : 0;
}

export function setOahuResourceBackground(master: OahuMaster, resource: number, hash: number): void {
  const t = master.table('mapResource.bin');
  if (resource <= 0 || resource >= t.rows) throw new Error(`mapResource に行 ${resource} がありません`);
  w32(t.row(resource), OAHU_RESOURCE_BATTLE_BG, hash >>> 0);
}

/** mapResource row -> the mapData rows whose [1] is it. */
export function oahuResourceUsers(master: OahuMaster): Map<number, number[]> {
  const md = master.table('mapData.bin');
  const out = new Map<number, number[]>();
  for (let r = 0; r < md.rows; r++) {
    const res = md.row(r)[MAP_DATA_RESOURCE]!;
    out.set(res, [...(out.get(res) ?? []), r]);
  }
  return out;
}

/** The background model (an entry of 52120000) for the viewer. */
export function oahuBattleBackgroundRef(dump: Dump, hash: number): ModelRef | null {
  if (!hash) return null;
  const archive = hex8(OAHU_BATTLE_BG_ARCHIVE).toUpperCase();
  return { key: `oahu-btmp/${dump.title.key}/${hex8(hash)}`, load: async () => ({ set: await oahuObjectModels(dump, { archive, entry: hash >>> 0 }), hash: hash >>> 0 }) };
}
