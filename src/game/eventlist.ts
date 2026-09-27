// Every EventObject row of every dungeon, with what the ROM says about it: where the maps place it, when it
// appears (game/conditions.ts), the messages its fields name, and for scripts (kind 0x24) the class the game's code
// builds for it with the messages it shows and the rows it completes (game/scripts.ts). docs/event-list.md.
import type { MapInfo } from './codebin';
import { describeCondition, readConditionTypes, type ConditionType } from './conditions';
import { EVENT_KINDS } from './eventkinds';
import type { EventTable } from './events';
import type { Game } from './game';
import { buildAction, describeClasses, makeFunction, MAKE_FUNCTIONS, type BuiltAction, type ScriptClass } from './scripts';
import { LAYOUTS, P3, recCellPos, type MapDoc, type Rec } from './sections';
import { u32 } from '../util/bytes';

/** Kinds whose behaviour is written in the code by dungeon and row. */
export const SCRIPT_KINDS = new Set([0x0a, 0x24]);

export interface EventPlace {
  map: MapInfo;
  section: number;
  /** Record kind (section 3 +0x14, 5 / 8 +0x08; none for section 4). */
  recordKind?: number;
  x: number;
  y: number;
}

export interface EventCondition {
  /** +0x4B (appears when it holds) or +0x4C (gone when it holds). */
  field: 0x4b | 0x4c;
  type: number;
  value: number;
  text: string;
}

export interface EventScript {
  make: number;
  cls: ScriptClass;
}

export interface EventEntry {
  dungeon: number;
  row: number;
  kind: number;
  /** State slot (+0x44; the row number when 0xFFFF). */
  slot: number;
  model: number;
  /** The EventObject row (0x50 bytes, a copy). */
  raw: Uint8Array;
  conditions: EventCondition[];
  /** Messages named by the row's fields: offset -> ID. */
  messages: { off: number; id: number }[];
  places: EventPlace[];
  /** Scripts: one per "make the action" function that builds something for the row (usually one). */
  scripts: EventScript[];
}

function placeOf(section: number, rec: Rec): { row: number; recordKind?: number } {
  if (section === 3) return { row: P3.door(rec.raw), recordKind: P3.kind(rec.raw) };
  if (section === 4) return { row: u32(rec.raw, 0) };
  return { row: u32(rec.raw, 0), recordKind: rec.raw[8] };
}

const conditionCache = new WeakMap<Uint8Array, Map<number, ConditionType>>();

/** The condition types of this code.bin (cached). */
export function conditionTypes(code: Uint8Array): Map<number, ConditionType> {
  let c = conditionCache.get(code);
  if (!c) conditionCache.set(code, (c = readConditionTypes(code)));
  return c;
}

export async function eventEntries(game: Game, docOf: (m: MapInfo) => MapDoc, events: (d: number) => Promise<EventTable | null>): Promise<EventEntry[]> {
  const code = game.code.code;
  const conds = conditionTypes(code);
  const maps = new Map<number, MapInfo[]>();
  for (const m of game.editableMaps()) maps.set(m.dungeon, [...(maps.get(m.dungeon) ?? []), m]);
  const out: EventEntry[] = [];
  const pending: { entry: EventEntry; built: BuiltAction }[] = [];
  for (let dungeon = 0; dungeon < game.master.mapGroup.rows; dungeon++) {
    const ev = await events(dungeon);
    if (!ev) continue;
    const places = new Map<number, EventPlace[]>();
    for (const m of maps.get(dungeon) ?? []) {
      const doc = docOf(m);
      for (const section of [3, 4, 5, 8])
        for (const rec of doc.recs[section] ?? []) {
          const { row, recordKind } = placeOf(section, rec);
          if (section === 3 && !row) continue;
          const [x, y] = recCellPos(rec, LAYOUTS[section]!);
          places.set(row, [...(places.get(row) ?? []), { map: m, section, recordKind, x, y }]);
        }
    }
    for (let row = 0; row < ev.rows; row++) {
      const r = ev.table.row(row);
      const kind = ev.kind(row);
      const conditions: EventCondition[] = [];
      for (const [field, off] of [[0x4b, 0x00], [0x4c, 0x04]] as const) {
        const type = r[field]!;
        if (!type) continue;
        const value = u32(r, off);
        conditions.push({ field, type, value, text: describeCondition(conds.get(type), type, value) });
      }
      const entry: EventEntry = {
        dungeon,
        row,
        kind,
        slot: ev.slot(row),
        model: ev.model(row),
        raw: r.slice(),
        conditions,
        messages: (EVENT_KINDS[kind]?.messages ?? []).map((off) => ({ off, id: u32(r, off) })).filter((m) => m.id),
        places: places.get(row) ?? [],
        scripts: [],
      };
      out.push(entry);
      if (!SCRIPT_KINDS.has(kind)) continue;
      const used = new Set<number>();
      for (const p of entry.places) {
        const f = makeFunction(p.section, p.recordKind ?? 0);
        if (f !== null) used.add(f);
      }
      for (const make of used.size ? used : MAKE_FUNCTIONS) {
        const built = buildAction(code, make, dungeon, row, r, kind);
        if (built) pending.push({ entry, built });
      }
    }
  }
  const classes = describeClasses(
    code,
    pending.map((p) => p.built),
  );
  for (const { entry, built } of pending) entry.scripts.push({ make: built.make, cls: classes.get(built.vtable)! });
  return out;
}

/** Rows that complete a row (FUN_0031AA2C(row) in their script): "dungeon.row" -> the rows that do it. */
export function completedBy(entries: EventEntry[]): Map<string, EventEntry[]> {
  const out = new Map<string, EventEntry[]>();
  for (const e of entries)
    for (const s of e.scripts)
      for (const row of s.cls.completes) {
        const k = `${e.dungeon}.${row}`;
        out.set(k, [...(out.get(k) ?? []).filter((x) => x !== e), e]);
      }
  return out;
}
