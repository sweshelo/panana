// Adding objects: chests (new EventObject row + treasure row), props (section 2), floor gimmicks
// (section 1) and copies of existing gimmicks (templates, sections 3 / 5).
import type { EventTable } from '../game/events';
import type { Master } from '../game/master';
import type { GimmickTemplate } from '../game/templates';
import { LAYOUTS, P3, setRecCellPos, type MapDoc, type Rec } from '../game/sections';
import { u32, w16, w32 } from '../util/bytes';
import { KIND_SWITCH, SWITCH_PRESETS } from '../game/eventkinds';

export type Stamp =
  | { type: 'chest' }
  | { type: 'prop'; row: number; dir: number }
  | { type: 'floor'; kind: number }
  | { type: 'template'; t: GimmickTemplate }
  /** Generic switch + gate: first click places the gate, the second the switch that opens it. */
  | { type: 'switchgate'; gate?: number };

export function stampLabel(s: Stamp): string {
  switch (s.type) {
    case 'chest': return '宝箱';
    case 'prop': return `置物 (mapObject #${s.row})`;
    case 'floor': return s.kind === 1 ? '凍った床' : 'ダメージ床';
    case 'template': return `${s.t.label} (${s.t.source} から)`;
    case 'switchgate': return s.gate === undefined ? 'スイッチと柵: まず柵を置く場所 (タイル) をクリック' : `スイッチと柵: 次に柵 (イベント #${s.gate}) を開けるスイッチを置く場所をクリック`;
  }
}

const CHEST_KIND = 0x0c;

/** A new EventObject row for a chest (copying the dungeon's own chest rows) and a new treasure row. */
function newChestRow(events: EventTable, master: Master, contentsFrom: number | null): number {
  let template: Uint8Array | null = null;
  for (let i = 0; i < events.rows; i++) if (events.kind(i) === CHEST_KIND) template = events.table.row(i);
  const row = template ? template.slice() : new Uint8Array(events.table.rowSize);
  row[0x4d] = CHEST_KIND;
  // always appear: clear the appearance conditions, default model
  w32(row, 0x00, 0);
  w32(row, 0x04, 0);
  row[0x4b] = 0;
  row[0x4c] = 0;
  w16(row, 0x46, 0);
  const src = contentsFrom ?? (template ? u32(template, 0x08) : 0);
  const slots = src >= 0 && src < master.treasureGroup.rows ? master.treasureSlots(src) : [{ item: 1, weight: 1 }];
  w32(row, 0x08, master.addTreasureRow(slots));
  return events.addRow(row);
}

function newPointId(docs: Iterable<MapDoc>): number {
  const used = new Set<number>();
  for (const d of docs) for (const r of d.recs[3] ?? []) used.add(P3.id(r.raw));
  let id: number;
  do id = (Math.random() * 0xffffffff) >>> 0;
  while (!id || used.has(id));
  return id;
}

export interface PlaceContext {
  doc: MapDoc;
  docs: Iterable<MapDoc>;
  events: EventTable | null;
  master: Master;
}

/** Add a record for `stamp` at cell coordinates (cx, cy). Returns [section, index]. */
export function placeStamp(ctx: PlaceContext, stamp: Stamp, cx: number, cy: number): [number, number] {
  const { doc, events, master } = ctx;
  const needsRow = stamp.type === 'chest' || stamp.type === 'switchgate' || (stamp.type === 'template' && !!stamp.t.event);
  const rows = stamp.type === 'switchgate' && stamp.gate === undefined ? 2 : 1;
  if (needsRow && (!events || events.roomLeft() < rows))
    throw new Error(events ? `このダンジョンのイベントの行はいっぱいです (${events.capacity} 行まで)` : 'このダンジョンにはイベントの表がありません');
  const add = (section: number, raw: Uint8Array): [number, number] => {
    const L = LAYOUTS[section]!;
    const rec: Rec = { raw, x: 0, y: 0 };
    setRecCellPos(rec, L, cx, cy);
    const list = (doc.recs[section] ??= []);
    list.push(rec);
    return [section, list.length - 1];
  };
  switch (stamp.type) {
    case 'chest': {
      if (!events) throw new Error('このダンジョンにはイベントの表がありません');
      const raw = new Uint8Array(12);
      w32(raw, 0, newChestRow(events, master, null));
      return add(4, raw);
    }
    case 'prop': {
      const raw = new Uint8Array(12);
      w32(raw, 0, stamp.row);
      raw[8] = stamp.dir & 3;
      return add(2, raw);
    }
    case 'floor': {
      const raw = new Uint8Array(8);
      raw[5] = stamp.kind;
      return add(1, raw);
    }
    case 'template': {
      const t = stamp.t;
      const raw = t.record.slice();
      if (t.section === 5) {
        if (!events) throw new Error('このダンジョンにはイベントの表がありません');
        if (t.event) w32(raw, 0, events.addRow(t.event));
        return add(5, raw);
      }
      w32(raw, 0x00, newPointId(ctx.docs));
      if (t.event && P3.door(raw)) {
        if (!events) throw new Error('このダンジョンにはイベントの表がありません');
        w32(raw, 0x0c, events.addRow(t.event));
      }
      return add(3, raw);
    }
    case 'switchgate': {
      const ev = events!;
      if (stamp.gate === undefined) {
        // gate: section 3 kind 17 (model gimk_03_gate_08), event row of kind 0 (like D01 row 13)
        const evRow = ev.addRow(new Uint8Array(ev.table.rowSize));
        const raw = new Uint8Array(28);
        w32(raw, 0x00, newPointId(ctx.docs));
        w32(raw, 0x0c, evRow);
        raw[0x14] = 17;
        w32(raw, 0x18, 0x400);
        stamp.gate = evRow;
        return add(3, raw);
      }
      // switch: section 5 kind 2, event kind 0x30 opening the gate (elpulse docs/events.md §7)
      const row = new Uint8Array(ev.table.rowSize);
      w32(row, 0x08, stamp.gate);
      const preset = SWITCH_PRESETS[0]!;
      row[0x10] = preset.loadAnim;
      row[0x11] = preset.openAnim;
      row[0x12] = preset.sound;
      w16(row, 0x46, SWITCH_MODEL);
      row[0x4d] = KIND_SWITCH;
      const raw = new Uint8Array(16);
      w32(raw, 0, ev.addRow(row));
      raw[8] = 2;
      stamp.gate = undefined;
      return add(5, raw);
    }
  }
}

/** mapObject row of the generic switch's model (gimk_12_switch_03; 0x27 has special handling). */
export const SWITCH_MODEL = 29;

/**
 * Copy a record. Records with an EventObject row (chests, gimmicks, doors) get a new row with their own
 * state slot; chests also get their own treasure row (same contents).
 */
export function duplicateRecord(ctx: PlaceContext, section: number, rec: Rec): Rec {
  const { events, master } = ctx;
  const ev0 = section === 3 ? P3.door(rec.raw) : section >= 4 ? u32(rec.raw, 0) : 0;
  if (ev0 && events?.has(ev0) && events.roomLeft() < 1) throw new Error(`このダンジョンのイベントの行はいっぱいです (${events.capacity} 行まで)`);
  const copy: Rec = { raw: rec.raw.slice(), x: rec.x, y: rec.y };
  const r = copy.raw;
  if (section === 3) {
    w32(r, 0x00, newPointId(ctx.docs));
    const ev = P3.door(r);
    if (ev && events?.has(ev)) w32(r, 0x0c, events.addRow(events.table.row(ev)));
  } else if ((section === 4 || section === 5 || section === 8) && events) {
    const ev = u32(r, 0);
    if (events.has(ev)) {
      if (section === 4 && events.kind(ev) === CHEST_KIND) {
        const tmpl = events.table.row(ev).slice();
        w32(tmpl, 0x08, master.addTreasureRow(master.treasureSlots(events.treasureRow(ev))));
        w32(r, 0, events.addRow(tmpl));
      } else w32(r, 0, events.addRow(events.table.row(ev)));
    }
  }
  return copy;
}
