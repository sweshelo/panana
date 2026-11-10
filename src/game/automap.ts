// Panana's patch "新しいダンジョンのオートマップ" for RPG2 (kahara): a new dungeon (game/newdungeon.ts, mapGroup row 11
// in v1.1.0) gets the automap (the minimap of the lower screen) by sharing the automap slot of a dungeon that has one.
// (naauao kahara/new-map.md §3)
//
// RPG2 v1.1.0: the slot of a dungeon ID is ID 1-10 -> 0-9, 15-18 -> 10-13, 28-29 -> 14-15, other IDs none. Each slot
// is a pointer at save +0x410 + slot * 4 to 14 records of {u32 map hash, 0x98 bytes of visited cells}; a record is
// found by the map hash, or a free one (hash 0) is taken. So two dungeons can share a slot while their maps together
// are at most 14 (new maps have hashes of their own).
// The mapping is in two places that matter here, both right after FUN_0030b788 (global +0x404) -> the dungeon ID of
// the map the party is on:
// - 0x40269C, in the constructor of the field's lower screen: FUN_002f8de0 (the mapping as a function) < 0 (or the
//   map 0x762181CF) -> a screen without a map (FUN_001e1f34), otherwise the automap screen (FUN_0021cc68, 0xBFC4 B).
// - 0x2F8CD4, in FUN_002f8cb0 (the record of the map the party is on, 0 = none; FUN_0021a9e0 reads the visited cells
//   from it when a map is entered): the same mapping inlined.
// The patch puts its own call at both: FUN_0030b788, then a new dungeon's ID becomes the ID of the dungeon whose slot
// it shares. Neither caller uses the ID for anything else. FUN_002f8de0 itself is not changed: its other callers are
// the warp records (save 0x5F-0x63, slots < 13), which the new dungeon must not share.
import { BASE } from './codeconst';
import type { Game } from './game';
import type { CodePatch } from './patch';
import { u32 } from '../util/bytes';

export const AUTOMAP_PATCH_ID = 'panana:automap';
export const AUTOMAP_PATCH_TITLE = '新しいダンジョンのオートマップ';

/** Automap records per slot (save +0x410: 14 x 0x9C, found by map hash). */
export const AUTOMAP_LIMIT = 14;

/** Dungeons with an automap slot of their own (FUN_002f8de0): D01-D10, K01-K04, and IDs 0x1C / 0x1D. */
export const hasAutomapSlot = (dungeon: number): boolean =>
  (dungeon >= 1 && dungeon <= 10) || (dungeon >= 0x0f && dungeon <= 0x12) || dungeon === 0x1c || dungeon === 0x1d;

const SLOT_DUNGEONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0x0f, 0x10, 0x11, 0x12, 0x1c, 0x1d];

/** The calls of FUN_0030b788 that the patch replaces, and the instruction there in the game. */
const FUN_DUNGEON = 0x30b788;
export const AUTOMAP_SITES = [0x2f8cd4, 0x40269c] as const;

/** `bl target` at `addr`. */
const blWord = (addr: number, target: number): number => (0xeb000000 | (((target - addr - 8) >> 2) & 0xffffff)) >>> 0;

/**
 * Which dungeon's slot each new dungeon shares: the dungeon with a slot whose maps (with the new dungeons already
 * given to it) are fewest, the lower ID on a tie. `maps(d)` = the number of maps of dungeon d.
 */
export function automapHosts(added: readonly number[], maps: (d: number) => number): Map<number, number> {
  const load = new Map(SLOT_DUNGEONS.map((d) => [d, maps(d)]));
  const out = new Map<number, number>();
  for (const d of [...added].sort((a, b) => a - b)) {
    if (hasAutomapSlot(d)) continue;
    let best = SLOT_DUNGEONS[0]!;
    for (const h of SLOT_DUNGEONS) if (load.get(h)! < load.get(best)!) best = h;
    out.set(d, best);
    load.set(best, load.get(best)! + maps(d));
  }
  return out;
}

/** The patch's source for `hosts` (new dungeon -> the dungeon whose slot it shares); null when there are none. */
export function automapPatchSource(hosts: ReadonlyMap<number, number>): string | null {
  if (!hosts.size) return null;
  const pairs = [...hosts].sort(([a], [b]) => a - b);
  return [
    `; ${AUTOMAP_PATCH_TITLE} (RPG2): 新しいダンジョンに、オートマップの枠があるダンジョンの枠を使わせる`,
    `; ${pairs.map(([d, h]) => `ID ${d} -> ID ${h} の枠`).join('、')} (記録はマップの hash で探すので、マップの数の合計が ${AUTOMAP_LIMIT} まで相乗りできる)`,
    '@0x2F8CD4',
    '  bl automap_dungeon ; FUN_002f8cb0: 今いるマップのオートマップの記録',
    '@0x40269C',
    '  bl automap_dungeon ; 下画面: オートマップの枠がなければ地図なしの画面',
    '',
    '; r0 = global + 0x404 -> r0 = 今いるマップのダンジョン ID (新しいダンジョンは枠を借りるダンジョンの ID)',
    '@cave automap_dungeon',
    '  push {r4, lr}',
    '  bl FUN_0030b788',
    ...pairs.flatMap(([d, h]) => [`  cmp r0, #${d}`, `  moveq r0, #${h}`]),
    '  pop {r4, pc}',
  ].join('\n');
}

/** Why the patch cannot go into this code.bin (the calls it replaces are not the game's), or null. */
export function automapProblem(code: Uint8Array): string | null {
  const bad = AUTOMAP_SITES.filter((a) => a - BASE + 4 > code.length || u32(code, a - BASE) !== blWord(a, FUN_DUNGEON));
  return bad.length ? `code.bin の 0x${bad.map((a) => a.toString(16).toUpperCase()).join('・0x')} が元のゲームと違うので、「${AUTOMAP_PATCH_TITLE}」を入れられません (別の版か、土台の MOD が同じ場所を書き換えています)` : null;
}

const mapsOf = (game: Game) => (d: number): number => game.code.maps.filter((m) => m.dungeon === d).length;

/** The new dungeons with maps -> the dungeon whose automap slot each shares. */
export function gameAutomapHosts(game: Game): Map<number, number> {
  const count = mapsOf(game);
  return automapHosts(game.code.dungeons.map((d) => d.dungeon).filter((d) => count(d) > 0), count);
}

/** The patch for the new dungeons of the game (null: none has maps). */
export function automapPatch(game: Game): CodePatch | null {
  const source = automapPatchSource(gameAutomapHosts(game));
  return source ? { id: AUTOMAP_PATCH_ID, title: AUTOMAP_PATCH_TITLE, source, enabled: true } : null;
}

/**
 * The dungeons whose maps share the automap records of `dungeon` (itself first), or null when it has no automap.
 * New dungeons count as the patch gives them a slot.
 */
export function automapGroup(game: Game, dungeon: number): number[] | null {
  const hosts = gameAutomapHosts(game);
  const isNew = game.code.dungeons.some((d) => d.dungeon === dungeon);
  // a new dungeon without maps yet: the slot it will get with its first map
  const host = hosts.get(dungeon) ?? (isNew && !hasAutomapSlot(dungeon) ? automapHosts([...hosts.keys(), dungeon], (d) => (d === dungeon ? 1 : mapsOf(game)(d))).get(dungeon) : undefined);
  if (host === undefined && !hasAutomapSlot(dungeon)) return null;
  const slot = host ?? dungeon;
  return [dungeon, ...[slot, ...[...hosts].filter(([, h]) => h === slot).map(([d]) => d)].filter((d) => d !== dungeon)];
}

/** The number of maps that share the automap records of `dungeon` (null: it has no automap). */
export function automapMaps(game: Game, dungeon: number): number | null {
  const g = automapGroup(game, dungeon);
  return g ? g.reduce((n, d) => n + mapsOf(game)(d), 0) : null;
}
