// What RPG FREE!'s equipment gives (naauao lanai/equipment.md): an equipment's ItemDataCore +0x00 is a row ID of the
// EquipInfo table of its slot (equipInfo_neck/hand/foot/back/cloth/face, 0x3C bytes), whose two effects ({value s16,
// kind u8, number u8} at +0x04 / +0x08) go into the unit's ability list. FUN_00165F60 turns an effect into the
// ConditionData row of its state: its name on the equipment screen (msg_equip), how the value is shown (msg_value),
// the base value, the range and how effects of the same state add up (+0x23). Kinds 0x40〜0x44 are automatic actions:
// the value is an ActionData row and the number the condition byte of the monsters' automatic actions.
import { parseLanaiMessage } from './message';
import { lanaiActionName } from './monsterBook';
import { lanaiConditionLabel } from './monsterStats';
import type { LanaiItem } from './items';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** The EquipInfo table of each slot, by the item kind's high nibble (FUN_002CE478). */
export const LANAI_EQUIP_SLOTS: Record<number, { file: string; label: string }> = {
  0x90: { file: 'equipInfo_neck', label: '首' },
  0xa0: { file: 'equipInfo_hand', label: '手' },
  0xb0: { file: 'equipInfo_foot', label: '足' },
  0xc0: { file: 'equipInfo_back', label: '背中' },
  0xd0: { file: 'equipInfo_cloth', label: 'ふく' },
  0x80: { file: 'equipInfo_face', label: '顔' },
};

export const isLanaiEquipment = (kind: number): boolean => (kind & 0xf0) in LANAI_EQUIP_SLOTS;

/** Offsets of the two effects of an EquipInfo row. */
export const LANAI_EFFECT_OFFSETS = [0x04, 0x08] as const;

/** Kinds 0x40〜0x44: an automatic action (the value is an ActionData row, the number its condition). */
export const LANAI_AUTO_EFFECTS: Record<number, string> = { 0x40: '戦闘開始時', 0x41: 'ターン開始時', 0x42: 'ターン終了時', 0x43: '攻撃時', 0x44: '被弾時' };
export const isAutoEffect = (kind: number): boolean => kind >= 0x40 && kind <= 0x44;

// ---- FUN_00165F60 (kind, number, value) -> ConditionData row

const SIMPLE: Record<number, number> = {
  0x01: 38, 0x02: 79, 0x03: 78, 0x04: 80, 0x05: 81, 0x06: 82, 0x07: 84, 0x08: 83, 0x0b: 97, 0x0c: 39,
  0x0d: 53, 0x0e: 54, 0x0f: 55, 0x10: 56, 0x11: 57, 0x12: 58, 0x13: 59, 0x14: 62, 0x15: 63, 0x16: 64,
  0x17: 65, 0x18: 66, 0x19: 67, 0x1a: 68, 0x1b: 69, 0x1c: 60, 0x1d: 61, 0x1e: 99, 0x1f: 100, 0x20: 101,
  0x24: 139, 0x25: 140, 0x26: 141, 0x27: 142, 0x33: 143, 0x35: 151, 0x36: 152, 0x37: 28, 0x38: 32, 0x39: 33, 0x3a: 35,
  0x3b: 70, 0x3c: 71, 0x3d: 72, 0x3e: 73, 0x3f: 74, 0x45: 189, 0x46: 190, 0x47: 186, 0x48: 187, 0x49: 76,
  0x4a: 188, 0x4b: 191, 0x4c: 98, 0x56: 154, 0x57: 155, 0x58: 156, 0x59: 157, 0x5a: 158, 0x5b: 159, 0x5c: 160,
  0x5d: 161, 0x5e: 162, 0x5f: 163, 0x60: 164, 0x61: 165, 0x62: 166, 0x63: 37, 0x64: 175,
};
for (let k = 0x28; k <= 0x32; k++) SIMPLE[k] = 42 + (k - 0x28);
for (let k = 0x4d; k <= 0x54; k++) SIMPLE[k] = 167 + (k - 0x4d);
for (let k = 0x6f; k <= 0x76; k++) SIMPLE[k] = 167 + (k - 0x6f);
for (let k = 0x65; k <= 0x6e; k++) SIMPLE[k] = 176 + (k - 0x65);
for (let k = 0x40; k <= 0x44; k++) SIMPLE[k] = 153;

/** The elements of kinds 0x09 (by the value) and 0x21 (by the number), and their rows. */
export const LANAI_EFFECT_ELEMENTS: Record<number, string> = { 1: '火', 2: '氷', 3: '風', 4: '土', 5: '電気', 6: '水', 7: '光', 8: '闇' };
const K09: Record<number, number> = { 1: 86, 2: 87, 3: 88, 4: 89, 5: 90, 6: 91, 7: 93, 8: 92 };
const K21: Record<number, number> = { 1: 103, 2: 104, 3: 105, 4: 106, 5: 107, 6: 108, 7: 110, 8: 109 };
/** Kind 0x22 (ailment resistance): number = the state (12 ふうかく is not in 100 = all ailments). */
const K22: Record<number, number> = { 1: 112, 2: 113, 7: 114, 4: 115, 5: 116, 8: 117, 6: 118, 3: 119, 9: 120, 10: 121, 0x15: 122, 11: 123, 0x17: 124, 100: 125, 12: 127 };
/** Kind 0x23 (element resistance): number 1〜8 = the element, 9 = all; kind 0x34 (stats): number 0〜5. */
const K34: Record<number, number> = { 0: 145, 1: 146, 2: 147, 3: 148, 4: 149, 5: 150 };

/** The ConditionData row (its index) of an effect: FUN_00165F60. 0 = none. */
export function lanaiEffectCondition(kind: number, number: number, value: number): number {
  switch (kind) {
    case 0x09: return K09[value] ?? 85;
    case 0x0a: return value === 3 ? 95 : value === 4 ? 96 : 94;
    case 0x21: return K21[number] ?? 102;
    case 0x22: return K22[number] ?? 111;
    case 0x23: return number >= 1 && number <= 9 ? 0x80 + number : 0x80;
    case 0x34: return K34[number] ?? 144;
    default: return SIMPLE[kind] ?? 0;
  }
}

/** Kinds whose number picks the state, with the numbers that have a row (in the game's order of the rows). */
export const LANAI_EFFECT_NUMBERS: Record<number, number[]> = {
  0x21: [1, 2, 3, 4, 5, 6, 7, 8],
  0x22: Object.entries(K22).sort((a, b) => a[1] - b[1]).map(([n]) => Number(n)),
  0x23: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  0x34: [0, 1, 2, 3, 4, 5],
};

/** The kinds an equipment can have: those whose state has a name on the equipment screen, and the automatic actions. */
export function lanaiEffectKinds(session: LanaiSession): number[] {
  const out: number[] = [];
  for (let k = 1; k < 0x100; k++) {
    if (isAutoEffect(k)) out.push(k);
    else if (lanaiEffectCondition(k, LANAI_EFFECT_NUMBERS[k]?.[0] ?? 0, k === 0x09 ? 1 : k === 0x0a ? 3 : 0) && kindLabel(session, k)) out.push(k);
  }
  return out;
}

// ---- reading and writing

export interface LanaiEquipRef {
  table: LanaiTable;
  row: number;
}

/** The EquipInfo row of an equipment (null for other items, or when the row is not found). */
export function lanaiEquipRow(session: LanaiSession, it: Pick<LanaiItem, 'kind' | 'core'>): LanaiEquipRef | null {
  const slot = LANAI_EQUIP_SLOTS[it.kind & 0xf0];
  if (!slot) return null;
  const ref = session.tables.find((t) => t.file?.replace(/\.bin$/, '') === slot.file || t.table.name === slot.file);
  if (!ref) return null;
  const row = ref.table.find(session.need('ItemDataCore').u32(it.core, 0x00));
  return row >= 0 ? { table: ref.table, row } : null;
}

export interface LanaiEffect {
  /** 0 or 1. */
  slot: number;
  kind: number;
  /** +0x07: the state's number, or the condition of an automatic action. */
  number: number;
  value: number;
}

export function lanaiEffects(ref: LanaiEquipRef): LanaiEffect[] {
  return LANAI_EFFECT_OFFSETS.map((o, slot) => ({
    slot,
    value: (ref.table.u16(ref.row, o) << 16) >> 16,
    kind: ref.table.u8(ref.row, o + 2),
    number: ref.table.u8(ref.row, o + 3),
  }));
}

/** Writes an effect (call session.edited() after). */
export function lanaiSetEffect(ref: LanaiEquipRef, e: LanaiEffect): void {
  const o = LANAI_EFFECT_OFFSETS[e.slot]!;
  ref.table.setU16(ref.row, o, e.value & 0xffff);
  ref.table.setU8(ref.row, o + 2, e.kind);
  ref.table.setU8(ref.row, o + 3, e.number);
}

/** The face pattern of glasses (kind 0x82; +0x00 bit0-4) and the chance of dropping the equipment (bit5-16, /4096; 推定). */
export const LANAI_GLASSES = { offset: 0x00, shift: 0, count: 5 } as const;
export const LANAI_EQUIP_DROP = { offset: 0x00, shift: 5, count: 12 } as const;

// ---- names and values

export interface LanaiConditionInfo {
  row: number;
  name: string;
  base: number;
  min: number;
  max: number;
  /** +0x23 low 4 bits: 1 / 5 add, 2 old + (new − base), 3 product, 4 old × new ÷ 100, 7 overwrite, 9 the larger … */
  merge: number;
}

export function lanaiCondition(session: LanaiSession, row: number): LanaiConditionInfo | null {
  const t = session.table('ConditionData');
  if (!t || row <= 0 || row >= t.rows) return null;
  const s16 = (o: number): number => (t.u16(row, o) << 16) >> 16;
  return { row, name: session.plain(t, row, 'msg_equip'), base: s16(0x18), min: s16(0x1c), max: s16(0x1e), merge: t.u8(row, 0x23) & 0xf };
}

/** The name of a kind on its own (the state of its first number), '' when the game shows none. */
function kindLabel(session: LanaiSession, kind: number): string {
  if (isAutoEffect(kind)) return `アクション (${LANAI_AUTO_EFFECTS[kind]})`;
  if (kind === 0x09) return '攻撃の属性';
  if (kind === 0x0a) return 'こうげきの範囲';
  if (kind === 0x21) return '属性のターゲット';
  if (kind === 0x22) return '状態異常のたいせい';
  if (kind === 0x23) return '属性のたいせい';
  if (kind === 0x34) return '能力値';
  return lanaiCondition(session, lanaiEffectCondition(kind, 0, 0))?.name ?? '';
}

export function lanaiEffectKindLabel(session: LanaiSession, kind: number): string {
  return kindLabel(session, kind) || `種類 0x${kind.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** The name of a number of kinds 0x21 / 0x22 / 0x23 / 0x34 (the state's name). */
export function lanaiEffectNumberLabel(session: LanaiSession, kind: number, number: number): string {
  return lanaiCondition(session, lanaiEffectCondition(kind, number, 0))?.name || `番号 ${number}`;
}

/** The range of the value (the state's [min, max]; an ActionData row for the automatic actions). */
export function lanaiEffectRange(session: LanaiSession, e: Pick<LanaiEffect, 'kind' | 'number'>): [number, number] {
  if (isAutoEffect(e.kind)) return [0, session.need('ActionData').rows - 1];
  const c = lanaiCondition(session, lanaiEffectCondition(e.kind, e.number, 0));
  return c ? [c.min, c.max] : [-32768, 32767];
}

/** A value as the msg_value of its state shows it (the tag replaced; merge 2 shows the value minus the base). */
function formatValue(session: LanaiSession, row: number, value: number): string {
  const t = session.table('ConditionData');
  if (!t) return String(value);
  const o = t.named(row, 'msg_value');
  if (o < 0) return '';
  const signed = (v: number): string => (v < 0 ? `${v}` : `+${v}`);
  return parseLanaiMessage(t.data, o).tokens.map((x) => {
    switch (x.t) {
      case 'text': return x.s;
      case 'ruby': return x.base;
      case 'tag':
        if (x.code === 0x103 || x.code === 0x105) return signed(value);
        if (x.code === 0x106 || x.code === 0x107) return String(Math.round(value) / 100);
        return String(value);
      default: return '';
    }
  }).join('');
}

/** "こうげき +0.4倍", "毒たいせい +2", "ターン終了時: HP自動回復 +4% (ハートのブローチ…)". '' for an empty effect. */
export function lanaiEffectText(session: LanaiSession, e: LanaiEffect): string {
  if (!e.kind) return '';
  if (isAutoEffect(e.kind)) {
    const a = session.need('ActionData');
    const head = `${LANAI_AUTO_EFFECTS[e.kind]}${e.number ? ` (${lanaiConditionLabel(e.number)})` : ''}`;
    if (e.value <= 0 || e.value >= a.rows) return `${head}: アクション ${e.value} (表にない)`;
    const shown = a.u8(e.value, 0x26);
    const row = lanaiEffectCondition(shown, 0, 0);
    const c = lanaiCondition(session, row);
    if (c?.name) {
      const v = shown === 0x56 || shown === 0x57 ? formatValue(session, row, a.u16(e.value, 0x16)) : '';
      return `${head}: ${c.name}${v ? ` ${v}` : ''}`;
    }
    return `${head}: ${lanaiActionName(session, a.rowId(e.value))}`;
  }
  const row = lanaiEffectCondition(e.kind, e.number, e.value);
  const c = lanaiCondition(session, row);
  if (!c?.name) {
    const n = e.number ? `/${e.number}` : '';
    return `${lanaiEffectKindLabel(session, e.kind)}${n} (名前なし) ${e.value}`;
  }
  // kinds 9 / 10 pick the row by the value, which then is the element / the number of targets
  if (e.kind === 0x09 || e.kind === 0x0a) return c.name;
  const v = formatValue(session, row, c.merge === 2 ? e.value - c.base : e.value);
  return v ? `${c.name} ${v}` : c.max <= 1 && e.value === 1 ? c.name : `${c.name} (${e.value})`;
}

/** The effects of an item as text ([] for other items). */
export function lanaiItemEffects(session: LanaiSession, it: Pick<LanaiItem, 'kind' | 'core'>): string[] {
  const ref = lanaiEquipRow(session, it);
  return ref ? lanaiEffects(ref).filter((e) => e.kind).map((e) => lanaiEffectText(session, e)) : [];
}
