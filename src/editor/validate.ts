// Checks before export (docs/map-editor-design.md §7 "検証ルール").
import type { EventTable } from '../game/events';
import { GATE_KINDS, KIND_SWITCH } from '../game/eventkinds';
import type { Game } from '../game/game';
import { AUTOMAP_LIMIT, hasAutomap } from '../game/newmap';
import { LAYOUTS, P3, loadDoc, type MapDoc } from '../game/sections';
import { ENT, parseEntrances } from '../game/worldmap';
import { hex8 } from '../util/bytes';
import { GRID, tileAt, type Selection } from './state';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
  target?: Selection;
  /** Index-independent identity, used to hide problems the unedited ROM already has. */
  key: string;
}

const DOOR_KINDS = new Set([11, 12, 13, 14, 15, 16, 17]);

/** Section 3 point IDs of a map (edited document if opened). */
function pointIds(game: Game, docs: Map<number, MapDoc>, map: number): Set<number> | null {
  // World map: the IDs of its entrances (the world page does not change them). docs/worldmap.md §6.
  const w = game.code.world(map);
  if (w) return new Set(parseEntrances(game.db.get(w.sections[2]!)).map(ENT.id));
  const doc = docs.get(map) ?? (game.code.byHash(map) ? loadDoc(game.db, game.code.byHash(map)!) : null);
  if (!doc) return null;
  return new Set((doc.recs[3] ?? []).map((r) => P3.id(r.raw)));
}

const baselines = new Map<string, Set<string>>();

/**
 * Problems of an edited map that the unedited ROM does not already have (vanilla data has a few
 * references this editor cannot resolve, e.g. points defined outside section 3).
 */
export function validate(game: Game, doc: MapDoc, tileset: number, docs: Map<number, MapDoc>, events: EventTable | null = null): Issue[] {
  const key = `${doc.hash}/${tileset}/${events ? 1 : 0}`;
  let base = baselines.get(key);
  if (!base) {
    const info = game.code.byHash(doc.hash);
    // A map added in the editor has nothing in the ROM to compare with: every problem counts.
    const inRom = info && !(info.added && !game.db.has(info.hash));
    base = new Set(inRom ? validateAll(game, loadDoc(game.db, info), tileset, new Map(), events).map((i) => i.key) : []);
    baselines.set(key, base);
  }
  return validateAll(game, doc, tileset, docs, events).filter((i) => !base!.has(i.key));
}

export function validateAll(game: Game, doc: MapDoc, tileset: number, docs: Map<number, MapDoc>, events: EventTable | null): Issue[] {
  const out: Issue[] = [];

  // Event rows (sections 4 / 5 / 8 at +0, section 3 at +0x0C) must exist in the dungeon's EventObject table.
  if (events) {
    const chests = new Map<number, number>();
    const slots = new Map<number, number[]>();
    for (const k of [3, 4, 5, 8]) {
      (doc.recs[k] ?? []).forEach((r, i) => {
        const row = k === 3 ? P3.door(r.raw) : r.raw[0]! | (r.raw[1]! << 8) | (r.raw[2]! << 16) | (r.raw[3]! << 24);
        if (k === 3 && !row) return;
        if (!events.has(row))
          out.push({ level: 'error', msg: `${LAYOUTS[k]!.label} #${i}: イベントの行 ${row} がありません (表は ${events.rows} 行)`, target: { type: 'rec', section: k, index: i }, key: `evrow/${k}/${row}` });
        if (k === 4) chests.set(row, (chests.get(row) ?? 0) + 1);
        if (events.has(row)) {
          const slot = events.slot(row);
          if (row >= events.capacity || slot >= events.capacity)
            out.push({ level: 'error', msg: `${LAYOUTS[k]!.label} #${i}: イベントの行 ${row} (状態の枠 ${slot}) がダンジョンの枠 (${events.capacity}) を超えています。状態が別のダンジョンのものと混ざります`, target: { type: 'rec', section: k, index: i }, key: `evcap/${row}/${slot}` });
          slots.set(slot, [...(slots.get(slot) ?? []), row]);
        }
      });
    }
    // generic switches (elpulse docs/events.md §7)
    const inMap = (row: number): { section: number; raw: Uint8Array }[] => {
      const out: { section: number; raw: Uint8Array }[] = [];
      for (const k of [3, 4, 5, 8])
        for (const r of doc.recs[k] ?? []) {
          const x = k === 3 ? P3.door(r.raw) : r.raw[0]! | (r.raw[1]! << 8) | (r.raw[2]! << 16) | (r.raw[3]! << 24);
          if (x === row) out.push({ section: k, raw: r.raw });
        }
      return out;
    };
    for (const k of [3, 4, 5, 8]) {
      (doc.recs[k] ?? []).forEach((r, i) => {
        const row = k === 3 ? P3.door(r.raw) : r.raw[0]! | (r.raw[1]! << 8) | (r.raw[2]! << 16) | (r.raw[3]! << 24);
        if (!events.has(row) || events.kind(row) !== KIND_SWITCH) return;
        const target: Selection = { type: 'rec', section: k, index: i };
        if (!game.switchVersion)
          out.push({ level: 'error', msg: `汎用スイッチ (イベント #${row}) がありますが、土台の MOD に汎用スイッチの code.ips がありません`, target, key: `swpatch/${row}` });
        if (k !== 5 || ![2, 3, 4, 8].includes(r.raw[8]!))
          out.push({ level: 'error', msg: `汎用スイッチ (イベント #${row}) は区画 5 の種類 2 / 3 / 4 / 8 に置いてください`, target, key: `swsec/${row}` });
        const tr = events.table.row(row);
        const targets = [tr[8]! | (tr[9]! << 8) | (tr[10]! << 16) | (tr[11]! << 24), tr[12]! | (tr[13]! << 8) | (tr[14]! << 16) | (tr[15]! << 24)].filter((x) => x);
        if (!targets.length) out.push({ level: 'warn', msg: `汎用スイッチ (イベント #${row}) に開ける対象がありません`, target, key: `swnone/${row}` });
        for (const t of targets) {
          const recs = inMap(t);
          if (!recs.length) out.push({ level: 'error', msg: `汎用スイッチ (イベント #${row}) の対象 #${t} がこのマップにありません`, target, key: `swmiss/${row}/${t}` });
          else if (!recs.some((x) => x.section === 3 && GATE_KINDS.has(x.raw[0x14]!)))
            out.push({ level: 'warn', msg: `汎用スイッチ (イベント #${row}) の対象 #${t} が扉・門 (区画 3 の種類 11 / 16 / 17) ではありません`, target, key: `swkind/${row}/${t}` });
        }
      });
    }
    for (const [slot, rows] of slots) {
      const distinct = [...new Set(rows)];
      if (distinct.length > 1)
        out.push({ level: 'warn', msg: `イベントの行 ${distinct.join(', ')} が同じ状態の枠 ${slot} を使っています (開けた・押したなどの状態を共有します)`, key: `slotdup/${slot}/${distinct.join(',')}` });
    }
    for (const [row, n] of chests)
      if (n > 1) out.push({ level: 'warn', msg: `宝箱 ${n} 個が同じイベントの行 ${row} を使っています (中身と「開けた」フラグを共有します)`, key: `chestdup/${row}` });
  }
  const cell = (x: number, y: number): Selection => ({ type: 'tiles', cells: [[x, y]] });

  // Tiles
  const seen = new Map<string, number>();
  for (const t of doc.tiles) {
    const key = `${t.x},${t.y}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (t.x < 0 || t.y < 0 || t.x >= GRID || t.y >= GRID)
      out.push({ level: 'error', msg: `タイル (${t.x}, ${t.y}) が範囲 0〜${GRID - 1} の外です`, target: cell(t.x, t.y), key: `range/${key}` });
    const letter = t.letter >= 0x61 && t.letter <= 0x67 ? t.letter - 0x60 : 0;
    if (!game.master.partModel(t.kind, tileset, letter))
      out.push({ level: 'warn', msg: `タイル (${t.x}, ${t.y}) 種類 ${t.kind}: このタイルセットにモデルがありません`, target: cell(t.x, t.y), key: `model/${key}/${t.kind}/${letter}` });
  }
  for (const [key, n] of seen)
    if (n > 1) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      out.push({ level: 'warn', msg: `セル (${x}, ${y}) にタイルが ${n} 枚あります (後の 1 枚が使われます)`, target: cell(x, y), key: `dup/${key}` });
    }
  if (!doc.tiles.length) out.push({ level: 'error', msg: 'タイルがありません', key: 'empty' });

  // Fine coordinates: 0..299, otherwise the game rounds to 0.
  for (const k of [2, 4, 5, 8, 9]) {
    const L = LAYOUTS[k]!;
    (doc.recs[k] ?? []).forEach((r, i) => {
      if (r.x < 0 || r.x > 299 || r.y < 0 || r.y > 299)
        out.push({ level: 'error', msg: `${L.label} #${i}: 座標 (${r.x}, ${r.y}) が 0〜299 の外です`, target: { type: 'rec', section: k, index: i }, key: `fine/${k}/${r.x},${r.y}` });
    });
  }
  (doc.recs[1] ?? []).forEach((r, i) => {
    if (!tileAt(doc, r.x, r.y))
      out.push({ level: 'warn', msg: `床のギミック (区画 1) #${i}: セル (${r.x}, ${r.y}) にタイルがありません`, target: { type: 'rec', section: 1, index: i }, key: `s1tile/${r.x},${r.y}` });
  });

  // Section 3
  const pts = doc.recs[3] ?? [];
  const idCount = new Map<number, number>();
  pts.forEach((r, i) => {
    const target: Selection = { type: 'rec', section: 3, index: i };
    const id = P3.id(r.raw);
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
    if (!tileAt(doc, r.x, r.y))
      out.push({ level: 'error', msg: `出入口 #${i}: セル (${r.x}, ${r.y}) にタイルがありません`, target, key: `p3tile/${hex8(id)}/${r.x},${r.y}` });
    const dest = P3.destMap(r.raw);
    // Destinations outside the map tables (towns' special maps) cannot be checked here.
    const ids = dest ? pointIds(game, docs, dest) : null;
    if (ids && !ids.has(P3.destPoint(r.raw)))
      out.push({
        level: 'error',
        msg: `出入口 #${i}: 行き先 ${game.code.byHash(dest)?.name ?? game.code.world(dest)?.code ?? hex8(dest)} に地点 ${hex8(P3.destPoint(r.raw))} がありません`,
        target,
        key: `dest/${hex8(dest)}/${hex8(P3.destPoint(r.raw))}`,
      });
  });
  pts.forEach((r, i) => {
    if (DOOR_KINDS.has(P3.kind(r.raw)) && idCount.get(P3.id(r.raw)) === 1)
      out.push({ level: 'warn', msg: `扉 #${i}: 同じ ID (${hex8(P3.id(r.raw))}) の相方がありません`, target: { type: 'rec', section: 3, index: i }, key: `door/${hex8(P3.id(r.raw))}` });
  });

  // Points of the original map that other maps (or the original pairs) refer to must still exist.
  const info = game.code.byHash(doc.hash);
  if (info) {
    const now = new Set(pts.map((r) => P3.id(r.raw)));
    const orig = loadDoc(game.db, info).recs[3] ?? [];
    for (const r of orig) {
      if (P3.destMap(r.raw) && !now.has(P3.id(r.raw)))
        out.push({ level: 'warn', msg: `元の出入口 ${hex8(P3.id(r.raw))} (${game.code.byHash(P3.destMap(r.raw))?.name ?? ''} 行き) が消えています`, key: `gone/${hex8(P3.id(r.raw))}` });
    }
    for (const other of game.editableMaps()) {
      if (other.hash === doc.hash) continue;
      const od = docs.get(other.hash) ?? null;
      const recs = od ? od.recs[3] ?? [] : null;
      const list = recs ?? loadDoc(game.db, other).recs[3] ?? [];
      for (const r of list)
        if (P3.destMap(r.raw) === doc.hash && !now.has(P3.destPoint(r.raw)))
          out.push({ level: 'error', msg: `${other.name} の出入口が、このマップの地点 ${hex8(P3.destPoint(r.raw))} を指していますが、その地点がありません`, key: `ref/${other.name}/${hex8(P3.destPoint(r.raw))}` });
    }
  }

  if (info?.added) out.push(...validateNewMap(game, doc, docs));

  // Section 6 cells should be on tiles.
  doc.cells6.forEach((c) => {
    if (!tileAt(doc, c.x, c.y)) out.push({ level: 'warn', msg: `区画 6 のセル (${c.x}, ${c.y}) にタイルがありません`, target: cell(c.x, c.y), key: `s6/${c.x},${c.y}` });
  });
  return out;
}

/** Checks of a map added in the editor (docs/new-map.md §6). */
function validateNewMap(game: Game, doc: MapDoc, docs: Map<number, MapDoc>): Issue[] {
  const out: Issue[] = [];
  if (!doc.tiles.length) out.push({ level: 'error', msg: '新しいマップにタイルがありません', key: 'new/tiles' });
  if (doc.sec6Header.length < 8) out.push({ level: 'error', msg: '新しいマップに敵の出現の見出し (区画 6) がありません', key: 'new/sec6' });
  if (!(doc.recs[3] ?? []).length)
    out.push({ level: 'warn', msg: '出入口 (区画 3) がありません。ほかのマップから来る地点と、戻る出口を置いてください', key: 'new/points' });
  const reached = game.editableMaps().some((m) => {
    if (m.hash === doc.hash) return false;
    const d = docs.get(m.hash) ?? loadDoc(game.db, m);
    return (d.recs[3] ?? []).some((r) => P3.destMap(r.raw) === doc.hash);
  });
  if (!reached) out.push({ level: 'warn', msg: 'このマップに来る出入口がほかのマップにありません (行き先をこのマップにしてください)', key: 'new/reach' });
  const n = game.code.maps.filter((m) => m.dungeon === doc.dungeon).length;
  if (hasAutomap(doc.dungeon) && n > AUTOMAP_LIMIT)
    out.push({ level: 'warn', msg: `このダンジョンのマップが ${n} 枚あり、オートマップの枠 (${AUTOMAP_LIMIT}) を超えます。あとから入ったマップにはオートマップが付きません`, key: 'new/automap' });
  return out;
}

/** A problem of a world map entrance (index into the entrance list). */
export interface WorldIssue extends Issue {
  index: number;
}

/**
 * Checks of the edited entrances of a world map (the unedited ones are left alone: in the ROM, 18 of the 64
 * dungeon exits to W01 do not lead back to the entrance that leads to them).
 */
export function validateWorld(game: Game, world: number, list: Uint8Array[], original: Uint8Array[], docs: Map<number, MapDoc>): WorldIssue[] {
  const out: WorldIssue[] = [];
  const ids = new Map<number, number>();
  for (const r of list) ids.set(ENT.id(r), (ids.get(ENT.id(r)) ?? 0) + 1);
  list.forEach((r, index) => {
    const o = original[index];
    if (o && o.every((b, i) => b === r[i])) return;
    const id = ENT.id(r);
    const name = `入口 ${hex8(id)}`;
    if (ids.get(id)! > 1) out.push({ level: 'error', msg: `${name}: 同じ ID の入口がほかにもあります`, index, key: `wdup/${hex8(id)}` });
    const dest = ENT.destMap(r);
    const info = game.code.byHash(dest);
    if (!info && !game.code.world(dest)) {
      out.push({ level: 'error', msg: `${name}: 行き先のマップ ${hex8(dest)} が表にありません`, index, key: `wmap/${hex8(id)}` });
      return;
    }
    if (!info) return;
    const doc = docs.get(dest) ?? loadDoc(game.db, info);
    const p = (doc.recs[3] ?? []).find((q) => P3.id(q.raw) === ENT.destPoint(r));
    if (!p) {
      out.push({ level: 'error', msg: `${name}: 行き先 ${info.name} に地点 ${hex8(ENT.destPoint(r))} がありません`, index, key: `wpoint/${hex8(id)}` });
      return;
    }
    if (P3.destMap(p.raw) !== world || P3.destPoint(p.raw) !== id)
      out.push({
        level: 'warn',
        msg: `${name}: 行き先 ${info.name} の地点 ${hex8(P3.id(p.raw))} から出ると、この入口には戻りません (${game.code.world(P3.destMap(p.raw)) ? `入口 ${hex8(P3.destPoint(p.raw))}` : hex8(P3.destMap(p.raw))} へ)`,
        index,
        key: `wback/${hex8(id)}`,
      });
  });
  return out;
}
