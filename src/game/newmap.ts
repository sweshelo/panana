// Making a new map in an existing dungeon (issue #19, docs/new-map.md §6): hashes, map code, initial sections.
import { hex8 } from '../util/bytes';
import type { MapInfo } from './codebin';
import type { Game } from './game';
import { dungeonRows, newHash } from './mappatch';
import { loadDoc, type MapDoc } from './sections';
import { MapDb } from './mapdb';

/** Automap records per dungeon (save +0x410: 14 x 0x9C, found by map hash; docs/new-map.md §3). */
export const AUTOMAP_LIMIT = 14;
/** Dungeons with an automap (FUN_002f8de0): D01-D10, K01-K04, and IDs 0x1C / 0x1D. */
export const hasAutomap = (dungeon: number): boolean =>
  (dungeon >= 1 && dungeon <= 10) || (dungeon >= 0x0f && dungeon <= 0x12) || dungeon === 0x1c || dungeon === 0x1d;

export interface DungeonChoice {
  dungeon: number;
  code: string;
  maps: MapInfo[];
}

/** Dungeons a map can be added to (rows of the dungeon table with maps; not the world maps). */
export function addableDungeons(game: Game): DungeonChoice[] {
  const rows = dungeonRows(game.dump.code);
  const out: DungeonChoice[] = [];
  for (const r of rows) {
    if (r.count <= 0) continue;
    const maps = game.code.maps.filter((m) => m.dungeon === r.dungeon);
    if (!maps.length) continue;
    out.push({ dungeon: r.dungeon, code: maps[0]!.dungeonCode, maps });
  }
  return out;
}

/** "D01B03001": the next free number on that floor ("D01F02001" above ground, "D01OUT001" for floor 0). */
export function suggestName(game: Game, code: string, floor: number): string {
  const prefix = floor === 0 ? `${code}OUT` : `${code}${floor < 0 ? 'B' : 'F'}${String(Math.abs(floor)).padStart(2, '0')}`;
  for (let n = 1; ; n++) {
    const name = prefix + String(n).padStart(3, '0');
    if (!game.code.byName(name)) return name;
  }
}

export interface NewMapSpec {
  dungeon: number;
  floor: number;
  name: string;
  /** Map of the same dungeon whose mapData key, row +0x14, encounter header (section 6) and optionally tiles are used. */
  template: MapInfo;
  copyTiles: boolean;
  /** The template as edited (tiles are taken from it). */
  templateDoc: MapDoc;
}

/** Every hash in use: map DB entries, sections of every map and world map. */
export function takenHashes(game: Game): Set<number> {
  const taken = new Set<number>();
  for (const m of game.code.maps) for (const h of m.sections) taken.add(h);
  for (const w of game.code.worlds) for (const h of w.sections) taken.add(h);
  return taken;
}

/** The new map (not yet registered) and its initial document. */
export function makeMap(game: Game, spec: NewMapSpec, rand: () => number = Math.random): { info: MapInfo; doc: MapDoc } {
  const name = spec.name.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(name)) throw new Error('マップのコードは英数字 15 文字までにしてください (例: D01B03001)');
  if (game.code.byName(name)) throw new Error(`${name} はもうあります`);
  if (spec.template.dungeon !== spec.dungeon) throw new Error('写す元は同じダンジョンのマップにしてください');
  if (!Number.isInteger(spec.floor) || Math.abs(spec.floor) > 99) throw new Error('階は -99〜99 にしてください');
  const taken = takenHashes(game);
  const isTaken = (h: number): boolean => taken.has(h) || game.db.has(h);
  const sections: number[] = [];
  for (let k = 0; k < 10; k++) {
    const h = newHash(isTaken, rand);
    taken.add(h);
    sections.push(h);
  }
  const t = spec.template;
  const info: MapInfo = {
    hash: sections[0]!,
    name,
    dungeon: spec.dungeon,
    dungeonCode: t.dungeonCode,
    floor: spec.floor,
    mapDataKey: t.mapDataKey,
    sections,
    extra: t.extra,
    added: true,
  };
  const doc = loadDoc(new MapDb(new Uint8Array(4)), info);
  delete doc.raw[6]; // empty, so loadDoc kept it as bytes
  // Every map of the game has an encounter header (section 6: monsterGroup hash, -1).
  doc.sec6Header = spec.templateDoc.sec6Header.length ? spec.templateDoc.sec6Header.slice() : defaultSec6();
  if (spec.copyTiles) doc.tiles = spec.templateDoc.tiles.map((x) => ({ ...x }));
  return { info, doc };
}

function defaultSec6(): Uint8Array {
  const b = new Uint8Array(8);
  b.fill(0xff, 4);
  return b;
}

/** "D01B03001 (0x1234ABCD)" */
export const newMapLabel = (m: MapInfo): string => `${m.name} (${hex8(m.hash)})`;
