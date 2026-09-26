// Checks before export (docs/map-editor-design.md §7 "検証ルール").
import type { Game } from '../game/game';
import { LAYOUTS, P3, loadDoc, type MapDoc } from '../game/sections';
import { hex8 } from '../util/bytes';
import { GRID, tileAt, type Selection } from './state';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
  target?: Selection;
}

const DOOR_KINDS = new Set([11, 12, 13, 14, 15, 16, 17]);

/** Section 3 point IDs of a map (edited document if opened). */
function pointIds(game: Game, docs: Map<number, MapDoc>, map: number): Set<number> | null {
  const doc = docs.get(map) ?? (game.code.byHash(map) ? loadDoc(game.db, game.code.byHash(map)!) : null);
  if (!doc) return null;
  return new Set((doc.recs[3] ?? []).map((r) => P3.id(r.raw)));
}

export function validate(game: Game, doc: MapDoc, tileset: number, docs: Map<number, MapDoc>): Issue[] {
  const out: Issue[] = [];
  const cell = (x: number, y: number): Selection => ({ type: 'tiles', cells: [[x, y]] });

  // Tiles
  const seen = new Map<string, number>();
  for (const t of doc.tiles) {
    const key = `${t.x},${t.y}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (t.x < 0 || t.y < 0 || t.x >= GRID || t.y >= GRID)
      out.push({ level: 'error', msg: `タイル (${t.x}, ${t.y}) が範囲 0〜${GRID - 1} の外です`, target: cell(t.x, t.y) });
    const letter = t.letter >= 0x61 && t.letter <= 0x67 ? t.letter - 0x60 : 0;
    if (!game.master.partModel(t.kind, tileset, letter))
      out.push({ level: 'warn', msg: `タイル (${t.x}, ${t.y}) 種類 ${t.kind}: このタイルセットにモデルがありません`, target: cell(t.x, t.y) });
  }
  for (const [key, n] of seen)
    if (n > 1) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      out.push({ level: 'warn', msg: `セル (${x}, ${y}) にタイルが ${n} 枚あります (後の 1 枚が使われます)`, target: cell(x, y) });
    }
  if (!doc.tiles.length) out.push({ level: 'error', msg: 'タイルがありません' });

  // Fine coordinates: 0..299, otherwise the game rounds to 0.
  for (const k of [2, 4, 5, 8, 9]) {
    const L = LAYOUTS[k]!;
    (doc.recs[k] ?? []).forEach((r, i) => {
      if (r.x < 0 || r.x > 299 || r.y < 0 || r.y > 299)
        out.push({ level: 'error', msg: `${L.label} #${i}: 座標 (${r.x}, ${r.y}) が 0〜299 の外です`, target: { type: 'rec', section: k, index: i } });
    });
  }
  (doc.recs[1] ?? []).forEach((r, i) => {
    if (!tileAt(doc, r.x, r.y))
      out.push({ level: 'warn', msg: `置物 (区画 1) #${i}: セル (${r.x}, ${r.y}) にタイルがありません`, target: { type: 'rec', section: 1, index: i } });
  });

  // Section 3
  const pts = doc.recs[3] ?? [];
  const idCount = new Map<number, number>();
  pts.forEach((r, i) => {
    const target: Selection = { type: 'rec', section: 3, index: i };
    const id = P3.id(r.raw);
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
    if (!tileAt(doc, r.x, r.y)) out.push({ level: 'error', msg: `出入口 #${i}: セル (${r.x}, ${r.y}) にタイルがありません`, target });
    const dest = P3.destMap(r.raw);
    if (dest) {
      const ids = pointIds(game, docs, dest);
      if (!ids) out.push({ level: 'error', msg: `出入口 #${i}: 行き先のマップ ${hex8(dest)} がありません`, target });
      else if (!ids.has(P3.destPoint(r.raw)))
        out.push({ level: 'error', msg: `出入口 #${i}: 行き先 ${game.code.byHash(dest)?.name ?? hex8(dest)} に地点 ${hex8(P3.destPoint(r.raw))} がありません`, target });
    }
  });
  pts.forEach((r, i) => {
    if (DOOR_KINDS.has(P3.kind(r.raw)) && idCount.get(P3.id(r.raw)) === 1)
      out.push({ level: 'warn', msg: `扉 #${i}: 同じ ID (${hex8(P3.id(r.raw))}) の相方がありません`, target: { type: 'rec', section: 3, index: i } });
  });

  // Points of the original map that other maps (or the original pairs) refer to must still exist.
  const info = game.code.byHash(doc.hash);
  if (info) {
    const now = new Set(pts.map((r) => P3.id(r.raw)));
    const orig = loadDoc(game.db, info).recs[3] ?? [];
    for (const r of orig) {
      if (P3.destMap(r.raw) && !now.has(P3.id(r.raw)))
        out.push({ level: 'warn', msg: `元の出入口 ${hex8(P3.id(r.raw))} (${game.code.byHash(P3.destMap(r.raw))?.name ?? ''} 行き) が消えています` });
    }
    for (const other of game.editableMaps()) {
      if (other.hash === doc.hash) continue;
      const od = docs.get(other.hash) ?? null;
      const recs = od ? od.recs[3] ?? [] : null;
      const list = recs ?? loadDoc(game.db, other).recs[3] ?? [];
      for (const r of list)
        if (P3.destMap(r.raw) === doc.hash && !now.has(P3.destPoint(r.raw)))
          out.push({ level: 'error', msg: `${other.name} の出入口が、このマップの地点 ${hex8(P3.destPoint(r.raw))} を指していますが、その地点がありません` });
    }
  }

  // Section 6 cells should be on tiles.
  doc.cells6.forEach((c) => {
    if (!tileAt(doc, c.x, c.y)) out.push({ level: 'warn', msg: `区画 6 のセル (${c.x}, ${c.y}) にタイルがありません`, target: cell(c.x, c.y) });
  });
  return out;
}
