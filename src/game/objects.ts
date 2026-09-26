// Which model (mapObject row) the game places for a record of sections 1-5 (see README "オブジェクト").
import { u16, u32 } from '../util/bytes';
import type { EventTable } from './events';
import type { Master } from './master';
import type { MapDoc, Rec } from './sections';

export const OBJ_INVISIBLE = 0x134;

/** Section 3 kind (+0x14) -> cell +0x23 "gimmick" code (FUN_0021f9f4). */
export function gimmickCode(kind: number): number {
  switch (kind) {
    case 0: case 1: return 1;
    case 2: return 5;
    case 3: return 0x0d;
    case 4: case 5: return 2;
    case 6: return 3;
    case 7: return 4;
    case 8: return 6;
    case 9: return 7;
    case 10: return 8;
    case 0x0b: case 0x0c: case 0x0d: case 0x0e: case 0x0f: return 0;
    case 0x10: return 10;
    case 0x11: return 11;
    case 0x12: return 12;
    default: return kind >= 0x13 && kind < 0x2f ? kind : 1;
  }
}

/** Section 3 kind -> cell +0x22 lock code (keyed doors; kind 0x0F uses +0x16). */
export function lockCode(kind: number, value: number): number {
  if (kind >= 0x0b && kind <= 0x0e) return kind - 0x0a;
  if (kind !== 0x0f) return 0;
  const map: Record<number, number> = { 5: 5, 10: 6, 15: 7, 20: 8, 25: 9, 30: 10, 35: 11, 40: 12, 45: 13, 50: 14, 60: 15, 70: 16, 80: 17, 90: 18, 99: 19 };
  return map[value] ?? 0;
}

/** Section 3 kind -> cell +0x20: 1 = up, 2 = down. */
export function stairCode(kind: number): number {
  if (kind === 4 || (kind >= 0x13 && kind < 0x2f)) return 1;
  if (kind === 5) return 2;
  return 0;
}

const TOWN: Record<number, number> = {
  0x13: 0x7f, 0x14: 0x81, 0x15: 0x82, 0x16: 0x83, 0x17: 0x84, 0x18: 0x85, 0x19: 0x86, 0x1b: 0x88, 0x1c: 0x89,
  0x1d: 0x8a, 0x1e: 0x8b, 0x1f: 0x8c, 0x20: 0x8d, 0x21: 0x8f, 0x22: 0x90, 0x23: 0x92, 0x24: 0x93, 0x25: 0x94,
  0x26: 0x95, 0x27: 0x96, 0x28: 0x97, 0x29: 0x98, 0x2a: 0x99, 0x2b: 0x9a, 0x2c: 0x9b, 0x2d: 0x9c, 0x2e: 0x8e,
};

/** Model of an exit / door / stair record (FUN_002effa0; warp holes use FUN_001c9088). */
export function pointObjectRow(r: Uint8Array, events: EventTable | null): number {
  const evRow = u32(r, 0x0c);
  const m = evRow && events ? events.model(evRow) : 0;
  if (m) return m;
  const kind = r[0x14]!;
  if (kind === 8) return 59; // gimk_11_warp_01
  const g = gimmickCode(kind);
  const lock = lockCode(kind, r[0x16]!);
  const stair = stairCode(kind);
  if (g >= 0x13 && g < 0x2f) return TOWN[g] ?? 0x87;
  if (g === 5) return 0x3c;
  if (g === 10) return 0x0f;
  if (g === 11) return 0x10;
  if (g === 0 && lock) return lock <= 4 ? 9 + lock : 0x0e;
  if (g === 9) return 5;
  if (stair === 1) return 1;
  if (stair === 2) return 2;
  if (g === 7 || g === 4 || g === 8 || g === 0x0c) return OBJ_INVISIBLE;
  if (g === 3) return 0x28;
  return lock ? 4 : 9;
}

/** Indoor maps (tile kinds 15..27) use other chest models (FUN_001c8034, runtime +0xA8CD). */
export function isIndoor(doc: MapDoc): boolean {
  return doc.tiles.some((t) => t.kind + 1 >= 0x10 && t.kind + 1 <= 0x1c);
}

export interface ObjectContext {
  master: Master;
  events: EventTable | null;
  indoor: boolean;
}

/** mapObject row for a record, 0 = no model (or unknown). */
export function recordObjectRow(section: number, rec: Rec, ctx: ObjectContext): number {
  const r = rec.raw;
  switch (section) {
    case 1:
      return r[5] === 1 ? 0x44 : 0x2d; // frozen floor / damage floor
    case 2: {
      const id = u32(r, 0);
      return id > 0 && id < ctx.master.mapObject.rows ? id : 0;
    }
    case 3:
      return pointObjectRow(r, ctx.events);
    case 4: {
      const m = ctx.events?.model(u32(r, 0)) ?? 0;
      if (m) return m;
      const dir = r[8]!;
      const set = ctx.indoor ? [0x18, 0x1a, 0x19] : [0x15, 0x17, 0x16];
      return set[dir] ?? set[0]!;
    }
    case 5: {
      const m = ctx.events?.model(u32(r, 0)) ?? 0;
      if (!m) return 0;
      if (r[8] === 0) {
        // character: mapChara row; flags bit0-2 = 0 -> NPC model at +8 (others are monsters)
        if (m >= ctx.master.mapChara.rows) return 0;
        const c = ctx.master.mapChara.row(m);
        return (u32(c, 0) & 7) === 0 ? u16(c, 8) : 0;
      }
      return m;
    }
    default:
      return 0;
  }
}

/** Rotation (quarter turns) of a record's model. */
export function recordDirection(section: number, rec: Rec): number {
  const r = rec.raw;
  if (section === 2 || section === 4) return r[8]! & 3;
  if (section === 5) return r[9]! & 3;
  return 0;
}

export const SECTION1_KIND: Record<number, string> = { 0: 'ダメージ床', 1: '凍った床' };
export const section1Kind = (r: Uint8Array): number => r[5]!;

/** Rough category of a mapObject row (from the model names in v1.1.0). */
export function objectCategory(row: number): string {
  const ranges: [number, number, string][] = [
    [1, 3, '階段'], [4, 8, '扉'], [9, 19, '門'], [20, 20, '回復の泉'], [21, 26, '宝箱'], [27, 39, 'スイッチ'],
    [40, 44, '穴'], [45, 46, 'ダメージ床'], [47, 55, 'ランプ'], [56, 58, 'シンボル'], [59, 62, 'ワープホール'],
    [63, 63, '看板'], [64, 65, 'ローラー'], [66, 66, 'エサ'], [67, 68, '凍った床'], [69, 126, '置物'],
    [127, 157, '町の建物'], [158, 181, '壁の置物'], [182, 222, '屋内の置物'], [223, 236, '屋外の置物'],
    [237, 262, 'ワールドマップ'], [263, 307, 'NPC'], [308, 311, '見えない'], [313, 322, 'ランプ'],
  ];
  for (const [a, b, n] of ranges) if (row >= a && row <= b) return n;
  return row === OBJ_INVISIBLE ? '見えない' : 'オブジェクト';
}
