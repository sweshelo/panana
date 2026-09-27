// Monsters (MonsterParameter + MonsterDesign), encounter groups (monsterGroup) and the map's encounters
// (section 6). Field positions: elpulse docs/battle.md §2〜§4 and docs/encounters.md.
import { GsTable } from '../archive/gstable';
import { findByName, parseArchive } from '../archive/gsarc';
import { u16, u32, w16, w32 } from '../util/bytes';
import { cleanActionName } from './actions';
import type { Master } from './master';
import type { MapDoc } from './sections';

/** Archive of MonsterDesign (names, descriptions). */
export const MONSTER_DESIGN_ARCHIVE = '2713402F';
/** Archive of the monster models (MonsterDesign +0x10 model, +0x14 textures). */
export const MONSTER_MODEL_ARCHIVE = '470D2848';
/**
 * What the game plays each monster motion for (key = first 4 characters of the animation name). The numbers
 * are rows of animData.bin (master, table hash B3314000); docs/monster-motion.md.
 */
export const MONSTER_MOTIONS: Record<string, string> = {
  '001_': '0x41 ミュージアム・戦闘の待機',
  '002_': '0x42 戦闘の待機 (+0x4A bit3 の個体)',
  '003_': '0x43 歩く',
  '004_': '0x44 走る',
  '005_': '0x45 ワザ A',
  '006_': '0x46 ワザ B',
  '007_': '0x47 ワザ C',
  '010_': '0x48 ワザ D',
  '008_': '0x49 攻撃を受けた',
  '009_': '0x4A 倒れた',
};

/** Motion of a skill by animation number (actionData +0x1E → performance row +0x0A); the prefix of the CANM name. */
export const SKILL_MOTION: Record<number, [string, string]> = {
  0x43: ['歩く', '003_'], 0x44: ['走る', '004_'], 0x45: ['ワザ A', '005_'], 0x46: ['ワザ B', '006_'], 0x47: ['ワザ C', '007_'], 0x48: ['ワザ D', '010_'],
  0x49: ['被弾', '008_'], 0x4a: ['倒れる', '009_'],
};

/**
 * Drop classes by the 4-bit rate value: which party bonus (conditionData 80〜82, a percentage, 100 = none)
 * applies to it (FUN_00199c00 sorts the drops into 3 × 3 unit slots by rate; FUN_00283e68 rolls them).
 */
export const DROP_CLASS: [number, string, number][] = [[0, 'おたから', 80], [10, 'レア', 81], [13, '激レア', 82]];
export const dropClass = (rate: number): [number, string, number] => [...DROP_CLASS].reverse().find(([lo]) => rate >= lo)!;

const bits = (w: number, lo: number, n: number, signed = false): number => {
  const v = Math.floor(w / 2 ** lo) % 2 ** n;
  return signed && v >= 2 ** (n - 1) ? v - 2 ** n : v;
};

// Resistances in the order FUN_00199c00 stores them: (word, low bit) -> conditionData IDs 51..77.
const RESIST_FIELDS: [number, number][] = [
  ...[0, 5, 10, 15, 20, 25].map((b) => [5, b] as [number, number]), [6, 0], [6, 5],
  ...[0, 5, 10, 15, 20, 25].map((b) => [7, b] as [number, number]), ...[0, 5, 10, 15, 20].map((b) => [8, b] as [number, number]),
  [9, 20], [8, 25], [9, 0], [9, 5], [9, 10], [9, 15],
];
const RESIST_IDS = [51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 73, 74, 75, 76, 77];
/** Resistances range: -9..+9 in the tables; an element at +10 (or more) is void. The field is 5-bit signed. */
export const RESIST_MIN = -9;
export const RESIST_MAX = 10;
export const RESIST_IMMUNE = 10;

export type ResistKind = 'element' | 'ailment' | 'down' | 'death';
/** Groups of the resistance list (for the UI): elements, ailments, stat downs, instant death. */
export const RESIST_GROUPS: [string, ResistKind, number, number][] = [['属性', 'element', 0, 8], ['状態異常', 'ailment', 8, 20], ['能力ダウン', 'down', 20, 24], ['突然死', 'death', 24, 25]];

/**
 * BattleParameter (1 row x 0x154): +0x08 f32 x 19 = element damage multiplier by resistance -9..+9
 * (FUN_001924ac); byte [0x60 + level] = base infliction rate /32 of a skill (w0 bit13-15); byte
 * [0x67 + r + 9] = infliction coefficient % by resistance r (FUN_0030f110). elpulse docs/battle.md §6.
 */
export class BattleParams {
  readonly elementMul: number[];
  readonly baseRate: number[];
  readonly coef: number[];
  /** u16 [0x10C + rate × 2]: a drop of that rate value comes 1 in this many battles (0 or 1 = always). */
  readonly dropBase: number[];
  constructor(t: GsTable) {
    const r = t.row(0);
    const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
    this.elementMul = Array.from({ length: 19 }, (_, i) => Math.round(dv.getFloat32(8 + i * 4, true) * 1000) / 1000);
    this.baseRate = Array.from({ length: 7 }, (_, i) => r[0x60 + i]!);
    this.coef = Array.from({ length: 19 }, (_, i) => r[0x67 + i]!);
    this.dropBase = Array.from({ length: 16 }, (_, i) => dv.getUint16(0x10c + i * 2, true));
  }
  /**
   * "1 in N" of a drop with rate value `rate` when the party's bonus of its class is `bonus` % (100 = none):
   * N = trunc(1 / (1 − (1 − 1/B)^(bonus/100))), at least 1; a negative bonus always drops. Each filled slot
   * is rolled on its own (rand × N < 2^32, i.e. 1/N). FUN_00283e68 (after the battle).
   */
  dropOdds(rate: number, bonus = 100): number {
    const b = this.dropBase[rate & 15]!;
    if (bonus < 0 || b <= 1) return 1;
    const p = 1 - Math.pow(1 - 1 / b, bonus * 0.01);
    return p > 0 ? Math.max(1, Math.trunc(1 / p)) : Infinity;
  }
  private idx(v: number): number {
    return Math.max(-9, Math.min(9, v)) + 9;
  }
  /**
   * Damage multiplier of an element for a monster's resistance v. 10 or more makes the element void:
   * FUN_00199c00 sets unit +0x808 + element when the field is > 9, and FUN_00199248 then returns 0.0.
   */
  multiplier(v: number): number {
    return v >= RESIST_IMMUNE ? 0 : this.elementMul[this.idx(v)]!;
  }
  /** Infliction coefficient (%) for resistance v (FUN_0030fd78 clamps to -9..+9, so +10 = +9 = 0%). */
  coefficient(v: number): number {
    return this.coef[this.idx(v)]!;
  }
  /** Chance (%) that a skill of base level `level` inflicts the condition, for resistance v. */
  chance(level: number, v: number): number {
    return Math.min(100, Math.floor((this.baseRate[level]! * this.coefficient(v)) / 32));
  }
}
export const AI_MODE = ['均等', '前の枠ほど重い', '先頭優先', '順番', '2枠ずつ順番', '5', '6', '7'];
/** How each AI mode picks among the usable skills (FUN_00412fb8; elpulse docs/battle.md §4). */
export const AI_MODE_NOTE = [
  '使えるワザから均等に選ぶ。同じワザを複数の枠に入れると、その数だけ出やすくなる',
  '前の枠ほど重い三角形の重みで選ぶ',
  '先頭の枠を確率 20/(19+n) で優先し、外れたら残りから均等に選ぶ',
  '枠を順番に使う',
  '2 枠ずつの組 (1-2, 3-4, 5-6) を順番に回し、組の中は均等に選ぶ',
  '未確認', '未確認', '未確認',
];
/** Target mode (w10 bit27-28). */
export const TARGET_MODE = ['0', '1', '2 (集中攻撃のとき HP 最小を狙う)', '3'];

/**
 * Boss special numbers (w10 bit8-11): what makes the monster turn into its next form (+0x50), checked by
 * FUN_0030fa18 after every damage calculation (elpulse docs/battle.md §3.1).
 */
export const BOSS_CONDITION: Record<number, string> = {
  0: 'なし',
  1: '倒される一撃を受けたとき (HP 最大−1 で生き残って変身)',
  2: '火の攻撃が当たったとき (倒されない一撃)',
  3: '氷の攻撃が当たったとき (倒されない一撃)',
  4: '風の攻撃が当たったとき (倒されない一撃)',
  5: '土の攻撃が当たったとき (倒されない一撃)',
  6: '電気の攻撃が当たったとき (倒されない一撃)',
  7: '水の攻撃が当たったとき (倒されない一撃)',
  8: '光の攻撃が当たったとき (倒されない一撃)',
  9: '闇の攻撃が当たったとき (倒されない一撃)',
  10: '固定ダメージ系の攻撃が当たったとき (倒されない一撃)',
  11: '経路 0 の結果 (BattleParameter +0x139、未確認)',
  12: '経路 0 の結果 (BattleParameter +0x13A、未確認)',
  13: '経路 0 の結果 (BattleParameter +0x13B、未確認)',
};

/** A bit field of a MonsterParameter row: u32 word `w` (at w × 4), bits lo .. lo + n − 1. */
export interface ParamField {
  w: number;
  lo: number;
  n: number;
}

/** Editable fields of a MonsterParameter row (elpulse docs/battle.md §2). Bytes and u16 are words' bits too. */
export const PARAM = {
  level: { w: 0, lo: 8, n: 7 },
  hpMax: { w: 0, lo: 15, n: 15 },
  hpMin: { w: 11, lo: 0, n: 15 },
  attackMax: { w: 1, lo: 0, n: 14 },
  attackMin: { w: 11, lo: 15, n: 14 },
  defenseMax: { w: 1, lo: 14, n: 14 },
  defenseMin: { w: 12, lo: 0, n: 14 },
  speedMax: { w: 2, lo: 0, n: 14 },
  speedMin: { w: 12, lo: 14, n: 14 },
  evasion: { w: 13, lo: 0, n: 7 },
  gold: { w: 2, lo: 14, n: 16 },
  exp: { w: 3, lo: 0, n: 16 },
  drop0: { w: 3, lo: 16, n: 10 },
  rate0: { w: 3, lo: 26, n: 4 },
  drop1: { w: 4, lo: 0, n: 10 },
  rate1: { w: 4, lo: 10, n: 4 },
  drop2: { w: 4, lo: 14, n: 10 },
  rate2: { w: 4, lo: 24, n: 4 },
  ghost: { w: 10, lo: 0, n: 1 },
  regen: { w: 10, lo: 1, n: 7 },
  boss: { w: 10, lo: 8, n: 4 },
  startCondition: { w: 10, lo: 12, n: 5 },
  startPower: { w: 10, lo: 17, n: 4 },
  ai: { w: 10, lo: 24, n: 3 },
  target: { w: 10, lo: 27, n: 2 },
  actions: { w: 13, lo: 7, n: 3 },
  focus: { w: 13, lo: 10, n: 1 },
  /** +0x36 u16: effect played when the form changes. */
  effect: { w: 13, lo: 16, n: 16 },
  /** +0x38 u16: line (message ID) shown when this row appears. */
  line: { w: 14, lo: 0, n: 16 },
  /** +0x3A: turns of the start condition. */
  startTurns: { w: 14, lo: 16, n: 16 },
  /** +0x50 byte: next form. */
  nextForm: { w: 20, lo: 0, n: 8 },
} satisfies Record<string, ParamField>;
export type ParamKey = keyof typeof PARAM;

/** Largest value of a field. */
export const fieldMax = (f: ParamField): number => 2 ** f.n - 1;

/** Value of a bit field of a row. */
export function getField(r: Uint8Array, f: ParamField): number {
  return bits(u32(r, f.w * 4), f.lo, f.n);
}

/** Write a bit field of a row (the value is clamped to the field; other bits are kept). */
export function setField(r: Uint8Array, f: ParamField, value: number): void {
  const v = Math.max(0, Math.min(fieldMax(f), Math.round(value)));
  const w = u32(r, f.w * 4);
  w32(r, f.w * 4, (w - bits(w, f.lo, f.n) * 2 ** f.lo + v * 2 ** f.lo) >>> 0);
}

/** Skill slots (+0x3C, 6 × u16). */
export const SKILL_SLOTS = 6;
const SKILLS_OFFSET = 0x3c;

/** Skills of a row, empty slots (0) left out. */
export function decodeSkills(r: Uint8Array): number[] {
  return Array.from({ length: SKILL_SLOTS }, (_, k) => u16(r, SKILLS_OFFSET + k * 2)).filter((a) => a);
}

/** Write the skills of a row packed to the front; the rest of the slots are zeroed. */
export function encodeSkills(r: Uint8Array, skills: number[]): void {
  if (skills.length > SKILL_SLOTS) throw new Error(`ワザは ${SKILL_SLOTS} 個までです`);
  for (let k = 0; k < SKILL_SLOTS; k++) w16(r, SKILLS_OFFSET + k * 2, skills[k] ?? 0);
}

/** Share (0..1) of each skill slot under AI mode 0 (equal per slot, so duplicates add up). */
export function skillShares(skills: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of skills) out.set(a, (out.get(a) ?? 0) + 1 / skills.length);
  return out;
}

export interface Range {
  min: number;
  max: number;
}

export interface Monster {
  /** MonsterParameter row. */
  row: number;
  /** Species (w0 bit0-7): key of the museum, drops and appearances. */
  species: number;
  name: string;
  description: string;
  /** MonsterDesign row (+0x4C). */
  design: number;
  level: number;
  hp: Range;
  attack: Range;
  defense: Range;
  speed: Range;
  evasion: number;
  exp: number;
  gold: number;
  drops: { item: number; name: string; rate: number }[];
  /** The 3 drop slots as they are (item 0 = empty). */
  dropSlots: { item: number; rate: number }[];
  skills: { action: number; name: string }[];
  /** Museum number (+0x4A bit4-11). */
  museum: number;
  resist: { id: number; name: string; value: number }[];
  /** Boss special number (w10 bit8-11) and next form (+0x50, 0 = none). */
  boss: number;
  nextForm: number;
  /** Line shown when this form appears (+0x38). */
  line: string;
  ai: string;
  aiMode: number;
  target: number;
  ghost: boolean;
  /** HP regeneration (w10 bit1-7, condition 27). */
  regen: number;
  /** Condition at the start of the battle (w10 bit12-16, 0 = none), its strength (bit17-20) and turns (+0x3A). */
  start: { condition: number; power: number; turns: number };
  actions: number;
  focus: boolean;
}

/** One candidate of an encounter group: monster row, weight, count code (FUN_0030f4c0). */
export interface GroupSlot {
  monster: number;
  weight: number;
  count: number;
}

export interface MonsterGroup {
  row: number;
  hash: number;
  /** Candidates of the lead (the monster seen on the map) and of the 3rd monster (+0x00). */
  leads: GroupSlot[];
  /** Candidates of the 2nd and 4th monsters (+0x14). */
  mates: GroupSlot[];
  /** +0x28..+0x2D (not analysed: maybe weights of the party size). */
  extra: number[];
}

/** Count of a group slot's count code (FUN_0030f4c0): 0-3 = 1-4, 4 = 8, 5 = 1-2, 6 = 1-3, ... */
export function countLabel(code: number): string {
  return ['1', '2', '3', '4', '8', '1〜2', '1〜3', '1〜4'][code] ?? `コード ${code}`;
}

/** Candidates per side of a group row (5 x {u16 monster, u8 weight, u8 count}). */
export const GROUP_SLOTS = 5;
const MATES_OFFSET = 0x14;

/** Slots of a monsterGroup row: leads (+0x00) and mates (+0x14); empty slots (no monster or weight 0) are left out. */
export function decodeGroupSlots(r: Uint8Array): { leads: GroupSlot[]; mates: GroupSlot[] } {
  const slots = (o: number): GroupSlot[] =>
    Array.from({ length: GROUP_SLOTS }, (_, k) => ({ monster: u16(r, o + k * 4), weight: r[o + k * 4 + 2]!, count: r[o + k * 4 + 3]! })).filter((s) => s.monster && s.weight);
  return { leads: slots(0), mates: slots(MATES_OFFSET) };
}

/** Write the slots of a monsterGroup row (packed to the front, the rest zeroed); other bytes are kept. */
export function encodeGroupSlots(r: Uint8Array, leads: GroupSlot[], mates: GroupSlot[]): void {
  if (leads.length > GROUP_SLOTS || mates.length > GROUP_SLOTS) throw new Error(`群れの候補は ${GROUP_SLOTS} 個までです`);
  const put = (o: number, slots: GroupSlot[]): void => {
    for (let k = 0; k < GROUP_SLOTS; k++) {
      const s = slots[k];
      w16(r, o + k * 4, s?.monster ?? 0);
      r[o + k * 4 + 2] = s ? Math.max(0, Math.min(255, s.weight)) : 0;
      r[o + k * 4 + 3] = s ? s.count & 0xff : 0;
    }
  };
  put(0, leads);
  put(MATES_OFFSET, mates);
}

/** Plain text of a message: color placeholder, actor placeholders. */
function clean(s: string): string {
  return s.replace(/Ē/g, '(色)');
}

export class MonsterBook {
  monsters: Monster[] = [];
  readonly groups: MonsterGroup[] = [];
  private readonly groupByHash = new Map<number, MonsterGroup>();
  private readonly design: GsTable;
  /** directData.bin of the same archive: the performance of each action (actionData +0x1E; actions.ts). */
  readonly directData: GsTable | null;
  readonly battle: BattleParams;
  /** conditionData names (+0x14) by ID. */
  readonly conditions: string[];

  constructor(private readonly master: Master, designArchive: Uint8Array) {
    const f = findByName(parseArchive(designArchive), 'monsterDesign.bin');
    if (!f) throw new Error(`${MONSTER_DESIGN_ARCHIVE} に monsterDesign.bin がありません`);
    this.design = new GsTable(f.body);
    const dd = findByName(parseArchive(designArchive), 'directData.bin');
    this.directData = dd ? new GsTable(dd.body) : null;
    this.battle = new BattleParams(master.table('battleParameter.bin'));
    const cond = master.table('conditionData.bin');
    this.conditions = Array.from({ length: cond.rows }, (_, i) => clean(master.message(u16(cond.row(i), 0x14)) ?? ''));
    this.reload();
  }

  /** Decode every MonsterParameter and monsterGroup row again (after edits or restoring saved edits). */
  reload(): void {
    const master = this.master;
    const design = this.design;
    this.monsters = [];
    const mp = master.table('monsterParameter.bin');
    const actions = master.table('actionData.bin');
    const cond = master.table('conditionData.bin');
    const msg = (id: number): string => (id ? clean(master.message(id) ?? '') : '');
    const condShort = Array.from({ length: cond.rows }, (_, i) => msg(u16(cond.row(i), 0x14)).replace('たいせい', ''));
    const skillName = (a: number): string => {
      return (a < actions.rows ? cleanActionName(msg(u32(actions.row(a), 4))) : '') || `#${a}`;
    };
    for (let i = 1; i < mp.rows; i++) {
      const r = mp.row(i);
      const w = Array.from({ length: 21 }, (_, k) => u32(r, k * 4));
      const des = w[19]! & 0xff;
      const d = des < design.rows ? design.row(des) : null;
      const f = (k: ParamKey): number => getField(r, PARAM[k]);
      const dropSlots = ([['drop0', 'rate0'], ['drop1', 'rate1'], ['drop2', 'rate2']] as const).map(([d, rt]) => ({ item: f(d), rate: f(rt) }));
      const drops = dropSlots.filter((d) => d.item).map((d) => ({ ...d, name: master.itemName(d.item) || `#${d.item}` }));
      const skills = decodeSkills(r).map((a) => ({ action: a, name: skillName(a) }));
      this.monsters.push({
        row: i,
        species: w[0]! & 0xff,
        name: d ? msg(u32(d, 0)) : '?',
        description: d ? msg(u32(d, 4)) : '',
        design: des,
        level: bits(w[0]!, 8, 7),
        hp: { min: bits(w[11]!, 0, 15), max: bits(w[0]!, 15, 15) },
        attack: { min: bits(w[11]!, 15, 14), max: bits(w[1]!, 0, 14) },
        defense: { min: bits(w[12]!, 0, 14), max: bits(w[1]!, 14, 14) },
        speed: { min: bits(w[12]!, 14, 14), max: bits(w[2]!, 0, 14) },
        evasion: bits(w[13]!, 0, 7),
        exp: bits(w[3]!, 0, 16),
        gold: bits(w[2]!, 14, 16),
        drops,
        dropSlots,
        skills,
        museum: bits(u16(r, 0x4a), 4, 8),
        resist: RESIST_FIELDS.map(([wi, b], k) => ({ id: RESIST_IDS[k]!, name: condShort[RESIST_IDS[k]!] ?? '?', value: bits(w[wi]!, b, 5, true) })),
        boss: bits(w[10]!, 8, 4),
        nextForm: r[0x50]!,
        line: msg(u16(r, 0x38)),
        ai: AI_MODE[f('ai')]!,
        aiMode: f('ai'),
        target: f('target'),
        ghost: f('ghost') === 1,
        regen: f('regen'),
        start: { condition: f('startCondition'), power: f('startPower'), turns: f('startTurns') },
        actions: bits(w[13]!, 7, 3),
        focus: bits(w[13]!, 10, 1) === 1,
      });
    }
    this.loadGroups();
  }

  private loadGroups(): void {
    const mg = this.master.table('monsterGroup.bin');
    const hashOf = new Map<number, number>();
    for (const [h, row] of mg.hashIndex()) hashOf.set(row, h);
    this.groups.length = 0;
    this.groupByHash.clear();
    for (let i = 0; i < mg.rows; i++) {
      const r = mg.row(i);
      const g: MonsterGroup = { row: i, hash: hashOf.get(i) ?? 0, ...decodeGroupSlots(r), extra: [...r.subarray(0x28, 0x2e)] };
      this.groups.push(g);
      if (g.hash) this.groupByHash.set(g.hash, g);
    }
  }

  /** Replace the candidates of a monsterGroup row. */
  setGroupSlots(row: number, leads: GroupSlot[], mates: GroupSlot[]): void {
    encodeGroupSlots(this.master.table('monsterGroup.bin').row(row), leads, mates);
    this.loadGroups();
  }

  /** Append a copy of a group as a new row (with a new hash in the index). Returns the new row number. */
  copyGroup(row: number): number {
    const t = this.master.table('monsterGroup.bin');
    const used = t.hashes();
    let hash = (0x6d470000 + t.rows) >>> 0;
    while (used.has(hash)) hash = (hash + 0x10001) >>> 0;
    const n = t.append(t.row(row).slice(), hash);
    this.loadGroups();
    return n;
  }

  /** Whether a group row was added by an edit (copyGroup). */
  groupAdded(row: number): boolean {
    return row >= this.master.originalRows('monsterGroup.bin');
  }

  /** Whether a group row differs from the archive (added rows always do). */
  groupChanged(row: number): boolean {
    if (this.groupAdded(row)) return true;
    const o = this.master.originalRow('monsterGroup.bin', row);
    return this.master.table('monsterGroup.bin').row(row).some((v, i) => v !== o[i]);
  }

  /** Put an original group row back as in the archive (added rows are kept). */
  revertGroup(row: number): void {
    if (this.groupAdded(row)) return;
    this.master.table('monsterGroup.bin').row(row).set(this.master.originalRow('monsterGroup.bin', row));
    this.loadGroups();
  }

  /** A field of a row (as edited). */
  get(row: number, key: ParamKey): number {
    return getField(this.master.table('monsterParameter.bin').row(row), PARAM[key]);
  }

  /** Set a field of a row. */
  set(row: number, key: ParamKey, value: number): void {
    setField(this.master.table('monsterParameter.bin').row(row), PARAM[key], value);
    this.reload();
  }

  /** A field of a row as in the archive. */
  original(row: number, key: ParamKey): number {
    return getField(this.master.originalRow('monsterParameter.bin', row), PARAM[key]);
  }

  /** Replace the skills of a row (up to 6 action rows; packed to the front). */
  setSkills(row: number, skills: number[]): void {
    encodeSkills(this.master.table('monsterParameter.bin').row(row), skills);
    this.reload();
  }

  /** Skills of a row as in the archive. */
  originalSkills(row: number): number[] {
    return decodeSkills(this.master.originalRow('monsterParameter.bin', row));
  }

  /** Set resistance k (index in Monster.resist) of a row (5-bit signed field). */
  setResist(row: number, k: number, value: number): void {
    const [wi, b] = RESIST_FIELDS[k]!;
    const r = this.master.table('monsterParameter.bin').row(row);
    const w = u32(r, wi * 4);
    const field = ((value < 0 ? value + 32 : value) & 31) * 2 ** b;
    w32(r, wi * 4, (w - (Math.floor(w / 2 ** b) % 32) * 2 ** b + field) >>> 0);
    this.reload();
  }

  /** Resistance k of a row as in the archive. */
  originalResist(row: number, k: number): number {
    const [wi, b] = RESIST_FIELDS[k]!;
    return bits(u32(this.master.originalRow('monsterParameter.bin', row), wi * 4), b, 5, true);
  }

  /** Whether a row differs from the archive, and putting it back. */
  changed(row: number): boolean {
    const t = this.master.table('monsterParameter.bin');
    const o = this.master.originalRow('monsterParameter.bin', row);
    return t.row(row).some((v, i) => v !== o[i]);
  }
  revert(row: number): void {
    this.master.table('monsterParameter.bin').row(row).set(this.master.originalRow('monsterParameter.bin', row));
    this.reload();
  }

  /** Model of a monster: MonsterDesign +0x10 = bcres with the model and its animations, +0x14 = textures. */
  modelOf(m: Monster): { model: number; texture: number } | null {
    if (m.design >= this.design.rows) return null;
    const r = this.design.row(m.design);
    const model = u32(r, 0x10);
    return model ? { model, texture: u32(r, 0x14) } : null;
  }

  monster(row: number): Monster | undefined {
    return this.monsters[row - 1];
  }

  group(hash: number): MonsterGroup | undefined {
    return this.groupByHash.get(hash);
  }

  /** Monster rows of a group (leads first), without duplicates. */
  groupMonsters(g: MonsterGroup): number[] {
    return [...new Set([...g.leads, ...g.mates].map((s) => s.monster))];
  }
}

/** Encounters of a map (section 6): the map's group, and cells with a group of their own. */
export interface MapEncounters {
  /** Map's group hash (header +0; 0 = none). */
  group: number;
  /** Listed cells by group hash. 0 = no enemies there; a hash = only that group appears there (elpulse docs/encounters.md §2). */
  cells: Map<number, [number, number][]>;
}

export function mapEncounters(doc: MapDoc): MapEncounters {
  const cells = new Map<number, [number, number][]>();
  for (const c of doc.cells6) cells.set(c.value, [...(cells.get(c.value) ?? []), [c.x, c.y]]);
  return { group: doc.sec6Header.length >= 4 ? u32(doc.sec6Header, 0) : 0, cells };
}
