// Free rows of a dungeon's EventObject table: rows that nothing points at any more (a chest or gimmick was deleted),
// so new objects take them again instead of growing the table up to mapGroup +0x1C.
//
// A row is in use when a record of one of the dungeon's maps points at it (sections 3 / 4 / 5 / 7 / 8), or when a
// row in use leads to it: the targets of a generic switch (+0x08 / +0x0C), the rows a hard-coded script opens
// (SCRIPT_LINKS) and the data rows of a scene's script (kind 0x31 stages, game/cutscene.ts). Row 0 means "none".
// Of the rows not in use, only these are free: rows the editor added, rows the game's own maps pointed at (so the
// game reaches them through the maps, not the code) and blank rows (how a released row is left, so it stays free
// after the edits are saved and loaded again). Other unused rows of the game are kept, as the code may use them.
import { KIND_BOSS, readStages } from './boss';
import { KIND_SWITCH, SCRIPT_LINKS } from './eventkinds';
import type { EventTable } from './events';
import { u32 } from '../util/bytes';

/** Rows a row in use leads to (switch targets, hard-coded script targets, script data rows). */
export function linkedRows(ev: EventTable, row: number, dungeon: number): number[] {
  if (!ev.has(row)) return [];
  const out = [...(SCRIPT_LINKS[dungeon]?.[row] ?? [])];
  const r = ev.table.row(row);
  if (r[0x4d] === KIND_SWITCH) out.push(u32(r, 0x08), u32(r, 0x0c));
  if (r[0x4d] === KIND_BOSS)
    for (const s of readStages(r)) if (s.script) for (let k = 0; k < s.script.rows; k++) out.push(s.script.first + k);
  return out.filter((x) => x > 0 && ev.has(x));
}

/** Rows in use: `refs` (the rows records point at) and every row they lead to; row 0 always. */
export function liveRows(ev: EventTable, refs: Iterable<number>, dungeon: number): Set<number> {
  const live = new Set<number>([0]);
  const todo = [...refs];
  while (todo.length) {
    const r = todo.pop()!;
    if (live.has(r) || !ev.has(r)) continue;
    live.add(r);
    todo.push(...linkedRows(ev, r, dungeon));
  }
  return live;
}

/** A row with nothing but its state slot (+0x44 / +0x45): how a released row is left. */
export function isBlankRow(row: Uint8Array): boolean {
  for (let i = 0; i < row.length; i++) if (row[i] && i !== 0x44 && i !== 0x45) return false;
  return true;
}

/** Rows new objects can take (lowest first): not in use and added, used by the game's maps only (`romRefs`) or blank. */
export function freeRows(ev: EventTable, live: ReadonlySet<number>, romRefs: ReadonlySet<number>): number[] {
  const out: number[] = [];
  const added = ev.originalRows;
  for (let r = 1; r < ev.rows; r++)
    if (!live.has(r) && (r >= added || romRefs.has(r) || isBlankRow(ev.table.row(r)))) out.push(r);
  return out;
}

/**
 * Release free rows: blank them (the state slot stays, other rows may share it) and drop the free rows at the end of
 * the table that the editor added, so adding and deleting an object leaves the table as it was.
 */
export function releaseRows(ev: EventTable, free: readonly number[]): void {
  const set = new Set(free);
  let n = ev.rows;
  while (n > ev.originalRows && set.has(n - 1)) n--;
  ev.truncate(n);
  for (const r of free) {
    if (r >= ev.rows) continue;
    const row = ev.table.row(r);
    const s0 = row[0x44]!,
      s1 = row[0x45]!;
    row.fill(0);
    row[0x44] = s0;
    row[0x45] = s1;
  }
}
