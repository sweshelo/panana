// RPG3's performances of the actions: the same system as RPG2 (game/performance.ts), with the tables in 402F0000 and
// the rows laid out a little differently. actionData +0x1E〜+0x28 are rows of directData.bin (985 × 0x16, read by
// FUN_0032AFB0); a row names a motion (animData row), an effect (effectData row, CGFX in A4070000), a sound effect and
// their timing. The monsters' skill motions are in a BCH of their own (monsterDesign +0x14; monsterModels.ts).
import { findByName, parseArchive } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { EffectTable, effectModelNames, type EffectLayout, type EffectModel, type Performance } from '../game/performance';
import type { Dump } from '../rom/dump';
import { s16, u16 } from '../util/bytes';

export const OAHU_PERF_ARCHIVE = '402F0000';
/** The effects of almost all effectData rows (a few name 1AD40000 or F9270000). */
export const OAHU_EFFECT_ARCHIVE = 'A4070000';

/** directDataAddEffect: up to 5 effectData rows, the count at +0x0A; the late test reads effectData +0x2B & 0x27. */
const OAHU_EFFECT_LAYOUT: EffectLayout = { addCount: 0x0a, addSlots: 5, lateMask: 0x27 };

/** A slot of actionData that names a directData row, and on whom the battle plays it. */
export interface OahuPerfSlot {
  key: string;
  offset: number;
  label: string;
  /** user: the one who acts; target: each target; field: once for the targets' side. */
  on: 'user' | 'target' | 'field' | 'second';
  info: string;
}

export const OAHU_PERF_SLOTS: OahuPerfSlot[] = [
  { key: 'perfUser', offset: 0x1e, label: '使用者', on: 'user', info: '+0x1E。使う側の演出 (モーション・エフェクト・SE)。0 なら使う側は何もしない (@0x2199F0)。' },
  { key: 'perfUser2', offset: 0x20, label: '使用者 2', on: 'user', info: '+0x20。+0x1E と同時に使う側に重ねる演出 (@0x219A54)。' },
  { key: 'perfTarget', offset: 0x22, label: '対象', on: 'target', info: '+0x22。対象ごとの演出 (被弾のモーションと着弾のエフェクト、@0x21903C)。' },
  { key: 'perfTarget2', offset: 0x24, label: '対象 2', on: 'target', info: '+0x24。+0x22 と同時に対象に重ねる演出 (@0x219058)。' },
  { key: 'perfField', offset: 0x26, label: '場', on: 'field', info: '+0x26。対象の側に 1 回だけ出す演出 (ファイアビームの帯など、@0x218FF8)。' },
  { key: 'perfSecond', offset: 0x28, label: '2 回目の対象', on: 'second', info: '+0x28。戦闘の +0x408 が立っているときに、別の対象の並びへ +0x22・+0x24 の代わりに出す演出 (@0x21DD6C)。いつ立つかは未確認。' },
];

/** A directData row of RPG3, with the fields of RPG2's Performance at their RPG3 places. */
export interface OahuPerformance extends Performance {
  /** +0x00: the row played instead on a unit of the other side (a monster's hit for a 電波人間's, and back). */
  counterpart: number;
  /** +0x0E: the motion after this one (animData row; assumed). */
  next: number;
}

/** The first animData row of the monsters' motions (92 = 001_ wait); the rows before are the 電波人間's. */
export const OAHU_MONSTER_ANIMS = 92;

export function decodeOahuPerformance(r: Uint8Array, row: number): OahuPerformance {
  const s8 = (o: number): number => (r[o]! << 24) >> 24;
  return {
    row,
    design: 0,
    counterpart: u16(r, 0x00),
    length: s16(r, 0x04),
    effect: u16(r, 0x06),
    se: u16(r, 0x08),
    addLength: !!(r[0x0b]! & 1),
    anim: r[0x0c]!,
    face: r[0x0d]!,
    next: r[0x0e]!,
    motionStart: r[0x0f]!,
    addEffect: r[0x10]!,
    shake: r[0x11]!,
    timing: [s8(0x14), s8(0x15)],
    raw: r,
  };
}

/** directData, effectData and directDataAddEffect of 402F0000, and the names of the effects; read when first used. */
export class OahuPerformances {
  private loaded: Promise<{ direct: GsTable; effects: EffectTable } | null> | null = null;
  private names: Promise<Map<number, EffectModel>> | null = null;

  constructor(private readonly dump: Dump) {}

  tables(): Promise<{ direct: GsTable; effects: EffectTable } | null> {
    this.loaded ??= this.dump.readRomfs(OAHU_PERF_ARCHIVE).then((b) => {
      const arc = parseArchive(b);
      const table = (name: string): GsTable | null => {
        const f = findByName(arc, name);
        return f ? new GsTable(f.body) : null;
      };
      const direct = table('directData.bin');
      return direct ? { direct, effects: new EffectTable(table('effectData.bin'), table('directDataAddEffect.bin'), OAHU_EFFECT_LAYOUT) } : null;
    }, () => null);
    return this.loaded;
  }

  /** Names of the effect models of A4070000 (by entry). */
  effectNames(): Promise<Map<number, EffectModel>> {
    this.names ??= this.dump.readRomfs(OAHU_EFFECT_ARCHIVE).then(effectModelNames, () => new Map());
    return this.names;
  }

  /**
   * The row as played on a unit: a monster plays the counterpart row (+0x00) of a row made for the 電波人間 (its motion
   * is one of theirs) and the other way round, when there is one (@0x32B2DC).
   */
  static forUnit(direct: GsTable, row: number, monster: boolean): OahuPerformance | null {
    if (row <= 0 || row >= direct.rows) return null;
    const p = decodeOahuPerformance(direct.row(row), row);
    const other = p.anim && (p.anim >= OAHU_MONSTER_ANIMS) !== monster && p.counterpart > 0 && p.counterpart < direct.rows;
    if (!other) return p;
    const c = decodeOahuPerformance(direct.row(p.counterpart), p.counterpart);
    return { ...p, anim: c.anim, face: c.face, next: c.next };
  }
}
