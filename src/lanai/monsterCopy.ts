// New monsters of RPG FREE!: a MonsterParameter row copied to the end of the table (the next row ID) with an ability
// row of its own, so its stats, drops and actions change alone; its name and group name are strings of the row. The
// look (MonsterDesign row) stays the original's until another is chosen. Only the last added row can be removed.
import { lanaiMonsterIndex } from './monsterBook';
import { forgetLanaiMonsters } from './monsters';
import { lanaiCopyStats, lanaiStatsOf, lanaiStatsSharers } from './monsterStats';
import type { LanaiSession } from './session';

/** Copies MonsterParameter row `row` as a new monster; returns the new row. */
export function lanaiCopyMonster(session: LanaiSession, row: number): number {
  const p = session.need('MonsterParameter');
  if (row < 0 || row >= p.rows) throw new RangeError(`MonsterParameter の行 ${row} はありません`);
  const n = p.addRow(row);
  // the book number (bits 10-19) belongs to the one row representing the species; the copy registers through +0x16
  p.setBits(n, 0x00, 10, 10, 0);
  if (lanaiStatsOf(session, n)) lanaiCopyStats(session, n);
  forgetLanaiMonsters(session);
  return n;
}

/** Whether a monster row can be removed: the last row, added by an edit. */
export function lanaiCanRemoveMonster(session: LanaiSession, row: number): boolean {
  const p = session.need('MonsterParameter');
  return row === p.rows - 1 && row >= p.originalRows;
}

/** The transformations into a monster (the monsters whose actions turn into it). */
export function lanaiTransformSources(session: LanaiSession, row: number): number[] {
  return [...new Set((lanaiMonsterIndex(session).into.get(row) ?? []).map((x) => x.use.monster))].filter((m) => m !== row);
}

/** Removes the last added monster, with its ability row when that is the last added one and no other monster uses it. */
export function lanaiRemoveMonster(session: LanaiSession, row: number): void {
  if (!lanaiCanRemoveMonster(session, row)) throw new Error('消せるのは最後に追加したモンスターだけです');
  const ref = lanaiStatsOf(session, row);
  session.need('MonsterParameter').removeLastRow();
  if (ref) {
    const t = session.need(ref.table);
    if (ref.row === t.rows - 1 && ref.row >= t.originalRows && !lanaiStatsSharers(session, ref).length) t.removeLastRow();
  }
  forgetLanaiMonsters(session);
}
