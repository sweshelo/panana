// Making a new dungeon (docs/integrations/panana/new-map.md §10): a vacant mapGroup row gets the settings of a
// template dungeon, a name of its own (a new message), its own state ranges in the save (0x8E / 0x91 / 0x92) and its
// own event archive (a copy of the template's, with an empty EventObject table). Its maps go into a row of the
// dungeon table that has none (game/mappatch.ts), so code.bin keeps its 56 rows.
//
// Why a vacant row and not a new one: the dungeon ID (mapGroup row) is checked against 0x3A (the 58 rows) in many
// functions (FUN_0031bac4, FUN_0031c3d8, FUN_0031bff4, FUN_003048f8 ...), and save value 0x8D has a slot per ID.
import { parseArchive, rebuildArchive, unpackEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { hex8, u16, u32, w16, w32 } from '../util/bytes';
import type { Game } from './game';
import { dungeonRows, freeTableRows, newHash } from './mappatch';
import { WORLD_DUNGEON } from './worldmap';

/** Dungeon IDs are checked against this (the number of mapGroup rows of the game). */
export const DUNGEON_LIMIT = 0x3a;

/** mapGroup fields (44 bytes a row; docs/kahara/map.md §6, event-list.md §4). */
export const MG = {
  /** Event archive (RomFS root file name; holds xXX_EventObject.bin). */
  archive: 0x0c,
  /** u16 message: the name. */
  name: 0x14,
  /** u16 first slot in save value 0x8E (event row states) and u8 the number of slots. */
  states: 0x1a,
  stateCount: 0x1c,
  /** u16 first value in 0x91 and u8 the number. */
  values: 0x1e,
  valueCount: 0x20,
  /** u16 first flag in 0x92 and u8 the number. */
  flags: 0x22,
  flagCount: 0x24,
} as const;

/** Save values (flagData.bin rows) the ranges are in. */
export const SAVE_STATES = 0x8e;
export const SAVE_VALUES = 0x91;
export const SAVE_FLAGS = 0x92;

const RANGES = [
  { key: SAVE_STATES, first: MG.states, count: MG.stateCount },
  { key: SAVE_VALUES, first: MG.values, count: MG.valueCount },
  { key: SAVE_FLAGS, first: MG.flags, count: MG.flagCount },
] as const;

/** The ID of every dungeon of the game's dungeon table (as it was before any row was given to a new dungeon). */
function tableDungeons(game: Game): Set<number> {
  const given = new Set(game.code.dungeons.map((d) => d.dungeon));
  return new Set(dungeonRows(game.dump.code).filter((d) => d.count > 0 && !given.has(d.dungeon)).map((d) => d.dungeon));
}

/**
 * mapGroup rows a new dungeon can use: below {@link DUNGEON_LIMIT}, not 0 (none), not a world map (0x34..0x37), with
 * no map of the game and not used by another new dungeon. In v1.1.0 that is row 11 (a second 山のどうくつ, "E00").
 */
export function vacantDungeons(game: Game): number[] {
  const used = tableDungeons(game);
  for (const m of game.code.maps) if (m.dungeon >= 0) used.add(m.dungeon);
  for (const d of game.code.dungeons) used.add(d.dungeon);
  const rows = Math.min(game.master.mapGroup.rows, DUNGEON_LIMIT);
  const out: number[] = [];
  for (let r = 1; r < rows; r++) if (!used.has(r) && !(r >= WORLD_DUNGEON && r < WORLD_DUNGEON + 4)) out.push(r);
  return out;
}

/** How many more dungeons can be added (vacant mapGroup rows and free rows of the dungeon table). */
export function dungeonRoom(game: Game): number {
  const free = freeTableRows(game.dump.code).length - game.code.dungeons.length;
  return Math.max(0, Math.min(vacantDungeons(game).length, free));
}

/** Row labels of mapGroup.bin ("D01" ... "X02", 4 bytes each at +0x30, the count at +0x1C) for rows 1..57. */
export function rowLabels(t: GsTable): string[] {
  const n = u32(t.data, 0x1c);
  const out: string[] = [];
  for (let i = 0; i < n && 0x30 + i * 4 + 4 <= t.offset; i++) {
    let s = '';
    for (let k = 0; k < 4 && t.data[0x30 + i * 4 + k]; k++) s += String.fromCharCode(t.data[0x30 + i * 4 + k]!);
    out.push(s);
  }
  return out;
}

/**
 * The label of a mapGroup row, when the labels are in row order from row 1 (checked against the dungeon table:
 * every dungeon there has its code as its label). null when they are not.
 */
export function rowLabel(game: Game, row: number): string | null {
  const labels = rowLabels(game.master.mapGroup);
  const given = new Set(game.code.dungeons.map((d) => d.dungeon));
  const table = dungeonRows(game.dump.code).filter((d) => d.count > 0 && !given.has(d.dungeon));
  if (!table.length) return null;
  const code = (d: { name: number }): string => {
    let s = '';
    for (let a = d.name - 0x100000; game.dump.code[a]; a++) s += String.fromCharCode(game.dump.code[a]!);
    return s;
  };
  if (!table.every((d) => labels[d.dungeon - 1] === code(d))) return null;
  return labels[row - 1] ?? null;
}

/** Every dungeon code in use: the dungeon table's, the mapGroup labels (but `except`'s own) and the new dungeons'. */
export function takenCodes(game: Game, except = -1): Set<string> {
  const out = new Set<string>();
  for (const m of game.code.maps) if (m.dungeonCode) out.add(m.dungeonCode.toUpperCase());
  for (const d of dungeonRows(game.dump.code)) {
    let s = '';
    for (let a = d.name - 0x100000; a >= 0 && game.dump.code[a]; a++) s += String.fromCharCode(game.dump.code[a]!);
    if (s) out.add(s.toUpperCase());
  }
  const own = except >= 0 ? rowLabel(game, except) : null;
  rowLabels(game.master.mapGroup).forEach((l, i) => {
    if (l && !(own !== null && i === except - 1)) out.add(l.toUpperCase());
  });
  for (const d of game.code.dungeons) out.add(d.code.toUpperCase());
  return out;
}

/** "D11": the next free number of a kind (D = dungeon, K = 暗闇のどうくつ, S = small places ...). */
export function suggestCode(game: Game, kind = 'D', dungeon = -1): string {
  const taken = takenCodes(game, dungeon);
  for (let n = 1; n < 100; n++) {
    const c = `${kind}${String(n).padStart(2, '0')}`;
    if (!taken.has(c)) return c;
  }
  throw new Error(`${kind} の番号がもうありません`);
}

/** Problems of a dungeon code (empty = fine). */
export function codeProblem(game: Game, code: string, dungeon = -1): string {
  if (!/^[A-Z][0-9]{2}$/.test(code)) return 'ダンジョンのコードは英大文字 1 つと数字 2 つにしてください (例: D11)';
  if (takenCodes(game, dungeon).has(code)) return `${code} はもう使われています`;
  return '';
}

/** A range [first, first + count) of a save value. */
export interface Range {
  first: number;
  count: number;
}

/** Number of elements of a save value (flagData.bin +0x08, u16). */
export function saveSize(game: Game, key: number): number {
  const t = game.master.table('flagData.bin');
  return key < t.rows ? u16(t.row(key), 8) : 0;
}

/** The ranges of a save value that the dungeons use (but `except`). */
export function usedRanges(game: Game, field: number, countField: number, except = -1): Range[] {
  const t = game.master.mapGroup;
  const out: Range[] = [];
  for (let r = 0; r < t.rows; r++) {
    if (r === except) continue;
    const row = t.row(r);
    const count = row[countField]!;
    if (count) out.push({ first: u16(row, field), count });
  }
  return out.sort((a, b) => a.first - b.first);
}

/**
 * A free range of `want` elements in [0, size) besides `used`: the first gap that is large enough, else the largest
 * gap (fewer elements), else none (count 0).
 */
export function freeRange(size: number, used: Range[], want: number): Range {
  const gaps: Range[] = [];
  let pos = 0;
  for (const u of [...used].sort((a, b) => a.first - b.first)) {
    if (u.first > pos) gaps.push({ first: pos, count: u.first - pos });
    pos = Math.max(pos, u.first + u.count);
  }
  if (size > pos) gaps.push({ first: pos, count: size - pos });
  const fit = gaps.find((g) => g.count >= want);
  if (fit) return { first: fit.first, count: want };
  const best = gaps.reduce<Range | null>((a, g) => (!a || g.count > a.count ? g : a), null);
  return best ? { first: best.first, count: Math.min(best.count, 0xff) } : { first: 0, count: 0 };
}

export interface NewDungeonSpec {
  /** mapGroup row to use (one of {@link vacantDungeons}). */
  dungeon: number;
  /** Dungeon code ("D11"): the prefix of its map codes. */
  code: string;
  /** Name shown in the game (the message of mapGroup +0x14). */
  name: string;
  /** Dungeon whose settings (flags, mapData rows = tileset / BGM, the number of slots) and event archive are copied. */
  template: number;
}

export interface NewDungeon {
  dungeon: number;
  code: string;
  /** The new event archive: RomFS root file name and bytes. */
  archiveName: string;
  archive: Uint8Array;
  /** Save ranges given to it: 0x8E, 0x91, 0x92. */
  ranges: Range[];
  /** Name message ID. */
  nameId: number;
}

/**
 * Fill the vacant mapGroup row (an edit of mapGroup.bin, exported with the master archive) and make the event archive.
 * `existing` = RomFS root files that the archive name must not be.
 */
export async function makeDungeon(game: Game, spec: NewDungeonSpec, existing: Set<string>, rand: () => number = Math.random): Promise<NewDungeon> {
  const code = spec.code.trim().toUpperCase();
  const name = spec.name.trim();
  if (!vacantDungeons(game).includes(spec.dungeon)) throw new Error(`mapGroup の行 ${spec.dungeon} は空いていません`);
  if (dungeonRoom(game) < 1) throw new Error('ダンジョンの表に空いている行がありません');
  const problem = codeProblem(game, code, spec.dungeon);
  if (problem) throw new Error(problem);
  if (!name) throw new Error('ダンジョンの名前を入れてください');
  const mg = game.master.table('mapGroup.bin');
  if (spec.template <= 0 || spec.template >= mg.rows || spec.template === spec.dungeon) throw new Error('写す元のダンジョンが不正です');
  const tmpl = mg.row(spec.template);
  const archiveOf = u32(tmpl, MG.archive);
  if (!archiveOf) throw new Error('写す元のダンジョンにイベントのアーカイブがありません');
  const texts = game.master.texts;
  const units = texts.units(u16(tmpl, MG.name));
  if (!units || !texts.canAdd()) throw new Error('ダンジョンの名前のメッセージを追加できません');

  // The event archive: the template's, with its own name and no EventObject rows (the new maps refer to none).
  const src = parseArchive(await game.dump.readRomfs(hex8(archiveOf)));
  const taken = new Set([...existing].map((n) => n.toUpperCase()));
  const hash = newHash((h) => taken.has(hex8(h)), rand);
  const repl = new Map<number, Uint8Array>();
  for (const e of src.entries) {
    if (e.comp !== 1) continue;
    const { name: n, body } = unpackEntry(src, e);
    if (n && /_EventObject\.bin$/.test(n)) repl.set(e.index, new GsTable(body).withRows([]));
  }
  if (!repl.size) throw new Error('写す元のアーカイブに EventObject がありません');
  const archive = rebuildArchive({ ...src, hash }, repl);

  // Save ranges: as many slots as the template has, where no other dungeon's are.
  const ranges = RANGES.map((r) => freeRange(saveSize(game, r.key), usedRanges(game, r.first, r.count, spec.dungeon), tmpl[r.count]!));
  const row = mg.row(spec.dungeon);
  row.set(tmpl);
  w32(row, MG.archive, hash);
  const nameId = texts.add(units);
  texts.setText(nameId, name);
  w16(row, MG.name, nameId);
  RANGES.forEach((r, i) => {
    w16(row, r.first, ranges[i]!.first);
    row[r.count] = ranges[i]!.count;
  });
  // The row's label in the table header ("E00" for row 11) becomes the code, when the labels are in row order.
  if (rowLabel(game, spec.dungeon) !== null) {
    const o = 0x30 + (spec.dungeon - 1) * 4;
    mg.data.fill(0, o, o + 4);
    for (let k = 0; k < 3; k++) mg.data[o + k] = code.charCodeAt(k);
  }
  return { dungeon: spec.dungeon, code, archiveName: hex8(hash), archive, ranges, nameId };
}
