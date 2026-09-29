// Performances of the actions (naauao docs/action-performance.md): an action (actionData) refers to rows of
// directData (2713402F) for its user, its targets and the rest; a directData row is a motion (animData number) +
// an effect (effectData row, drawn from the CGFX of 8756A407) + a sound effect (soundData row) + more effects
// (directDataAddEffect) + timing. The battle loads the effects of the rows an action refers to (FUN_002871ec), so a
// new skill can be put together from the performances of any monster.
import { findByName, parseArchive, unpackEntry, type Archive } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { cgfxDictNames } from '../cgfx/cgfx';
import { cstr, f32, s16, u16, u32 } from '../util/bytes';
import type { Game } from './game';
import type { Master } from './master';

/** RomFS file with the effect models (effectData +0x00 names it by its hash). */
export const EFFECT_ARCHIVE = '8756A407';

/** A performance slot of an action: the offset of its u16 (a directData row) in actionData. */
export interface ActionSlot {
  offset: number;
  label: string;
  info: string;
  /** Shown first (the others are unknown or only used in some cases). */
  main: boolean;
}

export const ACTION_SLOTS: ActionSlot[] = [
  { offset: 0x1e, label: '使用者', info: 'ワザを使う側の演出 (+0x1E)。使う側のモデルでモーションを再生し、エフェクトと SE を出します。', main: true },
  { offset: 0x20, label: '対象', info: '対象ごとの演出 (+0x20)。被弾のモーションと着弾のエフェクト。モーションは対象の側 (モンスターなら 0x49 など、電波人間なら 0x0C など) の番号です。', main: true },
  { offset: 0x22, label: '追加', info: '追加の演出 (+0x22)。全体攻撃で場に 1 回出す着弾など。', main: true },
  { offset: 0x24, label: 'その他 1', info: '+0x24。戦闘の前に読み込まれるが、どの場面で再生するかは未確認です。', main: false },
  { offset: 0x26, label: 'その他 2', info: '+0x26。戦闘の前に読み込まれるが、どの場面で再生するかは未確認です。', main: false },
  { offset: 0x28, label: 'その他 3', info: '+0x28。戦闘の前に読み込まれるが、どの場面で再生するかは未確認です (+0x20 と同じ行のことが多い)。', main: false },
  { offset: 0x2a, label: 'その他 4', info: '+0x2A。戦闘の前に読み込まれるが、どの場面で再生するかは未確認です。', main: false },
  { offset: 0x2c, label: '使用者 (別の組)', info: '+0x2C。電波人間のワザ・アイテムにだけある別の組 (対象が電波人間の側のときと推定)。戦闘の前には読み込まれません。', main: false },
  { offset: 0x2e, label: '対象 (別の組)', info: '+0x2E。+0x2C と組になる対象の演出。', main: false },
];

/** The performance slots of an actionData row: offset -> directData row (0 = none). */
export function actionSlots(r: Uint8Array): Map<number, number> {
  return new Map(ACTION_SLOTS.filter((s) => r.length >= s.offset + 2).map((s) => [s.offset, u16(r, s.offset)]));
}

/**
 * actionData +0x1C: the progression of the performance (camera work, stepping forward …; docs/action-performance.md
 * §2.2). The battle picks the function by it from one table for monsters (FUN_0022e480, 15) and another for 電波人間
 * (FUN_0024db24, 28): the same number means different things on each side.
 */
export const ACTION_DIRECTION = 0x1c;

/** +0x1C when the user is a monster (values past the table become 0). */
export const MONSTER_DIRECTIONS: string[] = [
  '0: (モンスターのワザでは未使用)',
  '1: 自分への行動 (ためる・モード切り替え・セリフ)',
  '2: 防御・動けない',
  '3: にげる',
  '4: 近接・単体 (走って前に出て戻る)',
  '5: 近接・全体 (前に出てなぎはらう)',
  '6: 回復・補助 (カメラ: 自分 → 対象)',
  '7: 味方全体の強化',
  '8: 遠隔・単体 (カメラ: 使う側 → 対象)',
  '9: 遠隔・全体 (カメラ: 使う側 → 対象の陣営全体)',
  '10: シールド',
  '11: なかまをよぶ',
  '12: 補助 (まじない・ダンス)',
  '13: ぬすむ (走って前に出る)',
  '14: 段取りなし',
];

/** +0x1C when the user is a 電波人間 (values past the table become 0). */
export const ALLY_DIRECTIONS: string[] = [
  '0: 段取りなし', '1: 総攻撃 (みんなで前に出る)', '2: 防御・動けない', '3: アイテム・単体の回復', '4: アイテム・全体の回復',
  '5: 単体の補助', '6: 全体の補助', '7: 段取りなし', '8: 段取りなし', '9: 単体の状態異常', '10: 全体の状態異常',
  '11: 単体の攻撃', '12: 全体の攻撃', '13: ふっかつ', '14: みんなふっかつ', '15: おたからチャンス', '16: ゴールドチャンス',
  '17: アイテムを使った 1', '18: アイテムを使った 2', '19: アイテムを使った 3', '20: アイテムを使った 4', '21: アイテムを使った 5',
  '22: アイテムを使った 6', '23: アイテムを使った 7', '24: 段取りなし', '25: にげる', '26: 段取りなし', '27: (未使用)',
];

/** "4: 近接・単体 …" for a side; a value past the table is read as 0 by the game. */
export function directionLabel(v: number, monster: boolean): string {
  const t = monster ? MONSTER_DIRECTIONS : ALLY_DIRECTIONS;
  return t[v] ?? `${v}: (表の外。0 として扱われる)`;
}

/** Byte ranges of an actionData row that are its effect ("アビリティ"), i.e. everything but the name and the performance. */
export const ABILITY_RANGES: [number, number][] = [[0x00, 0x04], [0x08, 0x1c], [0x30, 0x3c]];

/**
 * Names of the animation numbers (animData.bin of the master, +0 = the name as a file offset): "001_" .. The game
 * plays the animation of the model whose name starts with it (docs/monster-motion.md §1.3). '' = none.
 */
export function animKeys(master: Master): string[] {
  let t: GsTable;
  try {
    t = master.table('animData.bin');
  } catch {
    return [];
  }
  return Array.from({ length: t.rows }, (_, i) => {
    const p = u32(t.row(i), 0);
    return i && p && p < t.offset ? cstr(t.data, p) : '';
  });
}

/** A directData row (20 bytes; FUN_002f46bc). */
export interface Performance {
  row: number;
  /** +0x00: the MonsterDesign row it was made for (not read by the game). */
  design: number;
  /** +0x02: length in frames (0 = from the motion). */
  length: number;
  /** +0x04: effectData row (0 = none). */
  effect: number;
  /** +0x06: soundData row of the sound effect (0 = none). */
  se: number;
  /** +0x0A: animation number (animData row; 0 = no motion). */
  anim: number;
  /** +0x0B: face (0〜6, assumed). */
  face: number;
  /** +0x0E: directDataAddEffect row (0 = none). */
  addEffect: number;
  /** +0x12 / +0x13: timing (frames, s8): the shake / the sound effect, from the start of the effect. */
  timing: [number, number];
  /** +0x0D: start of the motion (frames). */
  motionStart: number;
  /** +0x09 bit0: +0x02 is added to the length found from the motion (else +0x02 is the length when not 0). */
  addLength: boolean;
  /** +0x0F: the shake (0 = none; FUN_0020a0ec, assumed). */
  shake: number;
  raw: Uint8Array;
}

/** Offsets of the fields of a performance that the editor changes. */
export const PERF = { length: 0x02, effect: 0x04, se: 0x06, anim: 0x0a, motionStart: 0x0d, addEffect: 0x0e, shakeDelay: 0x12, seDelay: 0x13 } as const;
export type PerfField = keyof typeof PERF;
/** Fields held in one byte (the others are u16); s8 ones are written as their low byte. */
const PERF_BYTE: Record<PerfField, boolean> = { length: false, effect: false, se: false, anim: true, motionStart: true, addEffect: true, shakeDelay: true, seDelay: true };
/** Range of each field. */
export const PERF_RANGE: Record<PerfField, [number, number]> = {
  length: [-32768, 32767], effect: [0, 0xffff], se: [0, 0xffff], anim: [0, 255], motionStart: [0, 255], addEffect: [0, 255], shakeDelay: [-128, 127], seDelay: [-128, 127],
};

export function decodePerformance(r: Uint8Array, row: number): Performance {
  const s8 = (o: number): number => (r[o]! << 24) >> 24;
  return {
    row,
    design: u16(r, 0),
    length: s16(r, 0x02),
    effect: u16(r, 0x04),
    se: u16(r, 0x06),
    anim: r[0x0a]!,
    face: r[0x0b]!,
    addEffect: r[0x0e]!,
    timing: [s8(0x12), s8(0x13)],
    motionStart: r[0x0d]!,
    addLength: !!(r[0x09]! & 1),
    shake: r[0x0f]!,
    raw: r,
  };
}

/** Write a field of a directData row (in place). */
export function writePerfField(r: Uint8Array, field: PerfField, v: number): void {
  const o = PERF[field];
  if (PERF_BYTE[field]) r[o] = v & 0xff;
  else {
    r[o] = v & 0xff;
    r[o + 1] = (v >>> 8) & 0xff;
  }
}

/** An effectData row (48 bytes; FUN_002e8d6c). */
export interface Effect {
  row: number;
  /** +0x00: RomFS file (hash of its name, always 8756A407). */
  archive: number;
  /** +0x04: entry of the effect model (CGFX with particle emitters). */
  model: number;
  /** +0x08: entry of its textures (0 = none). */
  texture: number;
  /** +0x0C: bone it is put on ('' = the position of the unit). */
  bone: string;
  /** +0x10 */
  scale: number;
  /** +0x14〜+0x1C (degrees, assumed). */
  rotation: [number, number, number];
  /** +0x20: start (frames, assumed). */
  delay: number;
  /** +0x22〜+0x26: offset (x, y, z). */
  offset: [number, number, number];
  /** +0x28: length (frames, assumed). */
  length: number;
  /** +0x2A bit0: the start is put after the motion (the motion's length is added). */
  afterMotion: boolean;
  /** Every frame of the slot is put 3 later (+0x2A bit4, +0x28, +0x2B bit4 / bit0-2 or +0x2C; @0x2F48A4). */
  late: boolean;
}

/** effectData and directDataAddEffect of 2713402F (read only: the editor picks existing effects). */
export class EffectTable {
  readonly effects: Effect[] = [];
  private readonly adds: number[][] = [];

  constructor(effectData: GsTable | null, addEffect: GsTable | null) {
    if (effectData && effectData.rowSize >= 0x2a) {
      const d = effectData.data;
      for (let i = 0; i < effectData.rows; i++) {
        const r = effectData.row(i);
        const bone = u32(r, 0x0c);
        this.effects.push({
          row: i,
          archive: u32(r, 0),
          model: u32(r, 4),
          texture: u32(r, 8),
          // A file offset (the game relocates it to a pointer when it reads the table).
          bone: bone && bone < effectData.offset ? cstr(d, bone) : '',
          scale: f32(r, 0x10),
          rotation: [f32(r, 0x14), f32(r, 0x18), f32(r, 0x1c)],
          delay: s16(r, 0x20),
          offset: [s16(r, 0x22), s16(r, 0x24), s16(r, 0x26)],
          length: u16(r, 0x28),
          afterMotion: !!(r[0x2a]! & 1),
          late: !!(r[0x2a]! & 0x10) || !!u16(r, 0x28) || !!(r[0x2b]! & 0x17) || !!r[0x2c],
        });
      }
    }
    if (addEffect && addEffect.rowSize >= 7) {
      for (let i = 0; i < addEffect.rows; i++) {
        const r = addEffect.row(i);
        const n = Math.min(r[6]!, 3);
        this.adds.push([0, 2, 4].slice(0, n).map((o) => u16(r, o)).filter(Boolean));
      }
    }
  }

  effect(row: number): Effect | undefined {
    return row > 0 ? this.effects[row] : undefined;
  }

  /** Rows of directDataAddEffect. */
  get addRows(): number {
    return this.adds.length;
  }

  /** The effectData rows of a directDataAddEffect row. */
  addEffects(row: number): number[] {
    return row > 0 ? this.adds[row] ?? [] : [];
  }
}

/**
 * When things happen in a performance slot, in frames since it started (FUN_002f46bc sets them up, FUN_0025af90 runs
 * them once each; naauao docs/action-performance.md §3.1).
 */
export interface SlotTimeline {
  /** The effects (the main one and the added ones, all at once). */
  effect: number;
  /** The sound effect (null: none). */
  se: number | null;
  /** The motion starts (and the face changes). */
  motion: number;
  /** The hit mark (no action of its own; the progression may wait for it). */
  hit: number;
  /** The shake (null: none). */
  shake: number | null;
  /** Length of the slot. */
  length: number;
  /** false: the motion's length was not known, so `length` may be short. */
  exact: boolean;
}

/**
 * The timeline of a performance row. `motionFrames`: length of the motion on the user's model (null = not known);
 * `skillLead`: MonsterDesign +0x6A〜+0x6D of the user (added to the hit of the skill motions 0x45〜0x48).
 */
export function slotTimeline(p: Performance, effects: EffectTable, motionFrames: number | null, skillLead: number[] = []): SlotTimeline {
  const main = effects.effect(p.effect);
  const mf = p.anim ? motionFrames ?? 0 : 0;
  let e = main?.delay ?? 0;
  if (main?.afterMotion) e += mf;
  let m = p.motionStart;
  // A negative start puts the effect at 0 and the motion that much later (the motion start is replaced).
  if (e < 0) {
    m = -e;
    e = 0;
  }
  let se = p.timing[1] + e;
  if (se < 0) {
    m -= se;
    e -= se;
    se = 0;
  }
  let shake = p.timing[0] + e;
  if (shake < 0) {
    m -= shake;
    e -= shake;
    se -= shake;
    shake = 0;
  }
  if (main?.late) {
    m += 3;
    e += 3;
    se += 3;
    shake += 3;
  }
  const skill = p.anim >= 0x45 && p.anim <= 0x48 ? skillLead[p.anim - 0x45] ?? 0 : 0;
  // Length (@0x2F4B7C): +0x02 when not 0 (unless it is added), else the motion's end (or 60), plus +0x02 when added.
  // (the game reads 0 for a motion it cannot find; while the motion's length is not known, 60 stands for it)
  const found = p.anim && motionFrames === null ? Math.max(60, m) : mf + m || 60;
  const length = p.addLength ? found + p.length : p.length || found;
  return {
    effect: e,
    se: p.se ? se : null,
    motion: m,
    hit: m + skill,
    shake: p.shake ? shake : null,
    length: Math.max(length, 1),
    exact: !p.anim || motionFrames !== null || (!p.addLength && p.length > 0),
  };
}

/** Reads effectData and directDataAddEffect from 2713402F. */
export function effectTable(designArchive: Archive): EffectTable {
  const e = findByName(designArchive, 'effectData.bin');
  const a = findByName(designArchive, 'directDataAddEffect.bin');
  return new EffectTable(e ? new GsTable(e.body) : null, a ? new GsTable(a.body) : null);
}

/** What an effect entry of 8756A407 holds: the model's name and its particle emitters. */
export interface EffectModel {
  name: string;
  emitters: string[];
}

const effectModels = new WeakMap<Game, Promise<Map<number, EffectModel>>>();

/** Names of the effect models in 8756A407 by entry hash (read once per game; empty when the file is missing). */
export function loadEffectModels(game: Game): Promise<Map<number, EffectModel>> {
  let p = effectModels.get(game);
  if (!p) {
    p = game.dump.readRomfs(EFFECT_ARCHIVE).then((bytes) => effectModelNames(bytes)).catch(() => new Map());
    effectModels.set(game, p);
  }
  return p;
}

export function effectModelNames(bytes: Uint8Array): Map<number, EffectModel> {
  const arc = parseArchive(bytes);
  const out = new Map<number, EffectModel>();
  for (const e of arc.entries) {
    try {
      const b = unpackEntry(arc, e).body;
      const name = cgfxDictNames(b, 0)[0];
      if (name) out.set(e.hash, { name, emitters: cgfxDictNames(b, 15) });
    } catch {
      // not a CGFX with a model (texture sets)
    }
  }
  return out;
}

/** "fx_btl_atk_fire_s_01@head", or the row number while the names are not read. */
export function effectLabel(e: Effect | undefined, models: Map<number, EffectModel> | null): string {
  if (!e) return 'なし';
  const name = models?.get(e.model)?.name ?? `エフェクト ${e.row}`;
  return e.bone ? `${name} @${e.bone}` : name;
}

/** Where a performance row is used. */
export type PerformanceUse = { kind: 'action'; action: number; slot: number } | { kind: 'transform'; monster: number };

/** Uses of every directData row: the slots of the actions and the transformations of the monsters (MonsterParameter +0x36). */
export function performanceUses(master: Master): Map<number, PerformanceUse[]> {
  const out = new Map<number, PerformanceUse[]>();
  const add = (row: number, u: PerformanceUse): void => {
    if (!row) return;
    let l = out.get(row);
    if (!l) out.set(row, (l = []));
    l.push(u);
  };
  const acts = master.table('actionData.bin');
  for (let a = 0; a < acts.rows; a++) for (const [slot, row] of actionSlots(acts.row(a))) add(row, { kind: 'action', action: a, slot });
  const mp = master.table('monsterParameter.bin');
  for (let m = 1; m < mp.rows; m++) if (mp.rowSize >= 0x38) add(u16(mp.row(m), 0x36), { kind: 'transform', monster: m });
  return out;
}
