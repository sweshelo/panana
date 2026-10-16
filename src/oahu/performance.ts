// RPG3's performances of the actions: the same system as RPG2 (game/performance.ts), with the tables in 402F0000 and
// the rows laid out a little differently. actionData +0x1E〜+0x28 are rows of directData.bin (985 × 0x16, read by
// FUN_0032AFB0); a row names a motion (animData row), an effect (effectData row, CGFX in A4070000), a sound effect and
// their timing. The monsters' skill motions are in a BCH of their own (monsterDesign +0x14; monsterModels.ts).
import { findByName, parseArchive, type ArcEntry } from '../archive/gsarc';
import { GsTable } from '../archive/gstable';
import { EffectTable, effectModelNames, writePerfField, type EffectLayout, type EffectModel, type PerfField, type PerfLayout, type Performance } from '../game/performance';
import type { Dump } from '../rom/dump';
import { equalBytes, s16, u16 } from '../util/bytes';
import type { OahuRows } from './rows';

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

/** Where RPG3's directData row holds the fields the editor changes (RPG2's are in game/performance.ts PERF). */
export const OAHU_PERF: PerfLayout = { length: 0x04, effect: 0x06, se: 0x08, anim: 0x0c, motionStart: 0x0f, addEffect: 0x10, shakeDelay: 0x14, seDelay: 0x15 };

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

/** The tables of 402F0000 the performances use: directData (editable) and the effects (read only). */
export interface OahuPerfTables {
  direct: GsTable;
  effects: EffectTable;
  /** directData's entry in 402F0000, and the table as it is there. */
  entry: ArcEntry;
  original: Uint8Array;
}

/** directData, effectData and directDataAddEffect of 402F0000, and the names of the effects; read when first used. */
export class OahuPerformances {
  private loaded: Promise<OahuPerfTables | null> | null = null;
  private names: Promise<Map<number, EffectModel>> | null = null;
  /** The tables once read (the edits need them at hand). */
  current: OahuPerfTables | null = null;
  /** A saved directData to put back once the tables are read. */
  private pending: Uint8Array | null = null;

  constructor(private readonly dump: Dump) {}

  tables(): Promise<OahuPerfTables | null> {
    this.loaded ??= this.dump.readRomfs(OAHU_PERF_ARCHIVE).then((b) => {
      const arc = parseArchive(b);
      const table = (name: string): GsTable | null => {
        const f = findByName(arc, name);
        return f ? new GsTable(f.body) : null;
      };
      const d = findByName(arc, 'directData.bin');
      if (!d) return null;
      const direct = new GsTable(d.body.slice());
      if (this.pending) direct.data = this.pending.slice();
      this.current = { direct, effects: new EffectTable(table('effectData.bin'), table('directDataAddEffect.bin'), OAHU_EFFECT_LAYOUT), entry: d.entry, original: d.body };
      return this.current;
    }, () => null);
    return this.loaded;
  }

  /** Names of the effect models of A4070000 (by entry). */
  effectNames(): Promise<Map<number, EffectModel>> {
    this.names ??= this.dump.readRomfs(OAHU_EFFECT_ARCHIVE).then(effectModelNames, () => new Map());
    return this.names;
  }

  /** Rows of directData in the archive (rows past them were added by edits). */
  get originalRows(): number {
    return this.current ? new GsTable(this.current.original).rows : 0;
  }

  /** Whether directData was edited. */
  get changed(): boolean {
    const t = this.current;
    return t ? !equalBytes(t.direct.data, t.original) : !!this.pending;
  }

  /** The edited directData (null when unchanged), for saving; and putting a saved one back. */
  saved(): Uint8Array | null {
    const t = this.current;
    if (!t) return this.pending;
    return this.changed ? t.direct.data.slice() : null;
  }
  async restore(bytes: Uint8Array): Promise<void> {
    this.pending = bytes;
    const t = await this.tables();
    if (t) t.direct.data = bytes.slice();
  }

  /** directData's entry of 402F0000 and its bytes, when edited (the export puts it in the archive). */
  async replacement(): Promise<[number, Uint8Array] | null> {
    const t = await this.tables();
    return t && this.changed ? [t.entry.index, t.direct.data] : null;
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

/** Where a directData row is used: a slot of an action. */
export interface OahuPerfUse {
  action: number;
  key: string;
}

/** The slots of every action that name each directData row. */
export function oahuPerformanceUses(actions: OahuRows): Map<number, OahuPerfUse[]> {
  const out = new Map<number, OahuPerfUse[]>();
  for (let a = 1; a < actions.rows; a++)
    for (const s of OAHU_PERF_SLOTS) {
      const p = actions.get(a, s.key);
      if (!p) continue;
      let l = out.get(p);
      if (!l) out.set(p, (l = []));
      l.push({ action: a, key: s.key });
    }
  return out;
}

/**
 * Edits of the performances of RPG3's actions (#93), as RPG2's ActionEdits: a slot is pointed at another directData
 * row, or a field of its row is changed. Rows of the archive are never changed in place (others may share them, and
 * code.bin may name some): the slot is pointed at a row with the wanted bytes, an existing one when there is one, the
 * slot's own added row when only it uses that, else a copy appended to directData.
 */
export class OahuPerfEdits {
  constructor(
    private readonly actions: OahuRows,
    private readonly perf: OahuPerformances,
  ) {}

  private get direct(): GsTable | null {
    return this.perf.current?.direct ?? null;
  }

  /** Point a slot (OAHU_PERF_SLOTS key) at a directData row (0 = none). */
  setSlot(row: number, key: string, p: number): void {
    const t = this.direct;
    if (p && (!t || p >= t.rows)) throw new Error(`演出の行 ${p} はありません`);
    this.actions.set(row, key, p);
  }

  /** Copy every slot of another action. */
  copyPerformance(row: number, from: number): void {
    for (const s of OAHU_PERF_SLOTS) this.actions.set(row, s.key, this.actions.get(from, s.key));
  }

  /** Whether a slot has a row whose fields can be changed. */
  canEditSlot(row: number, key: string): boolean {
    const t = this.direct;
    const p = this.actions.get(row, key);
    return !!t && p > 0 && p < t.rows;
  }

  /** Change a field of the row of a slot. Returns the row the slot then uses. */
  setSlotField(row: number, key: string, field: PerfField, v: number): number {
    const t = this.direct;
    if (!t || !this.canEditSlot(row, key)) throw new Error(`アクション #${row} のこの枠には演出の行がありません`);
    const p = this.actions.get(row, key);
    const want = t.row(p).slice();
    writePerfField(want, field, v, OAHU_PERF);
    if (equalBytes(want, t.row(p))) return p;
    for (let i = 1; i < t.rows; i++) {
      if (equalBytes(t.row(i), want)) {
        this.actions.set(row, key, i);
        return i;
      }
    }
    if (p >= this.perf.originalRows) {
      const uses = oahuPerformanceUses(this.actions).get(p) ?? [];
      if (uses.every((u) => u.action === row && u.key === key)) {
        t.row(p).set(want);
        return p;
      }
    }
    const n = t.append(want, t.indexOffset ? newHash(t) : 0);
    if (n > 0xffff) throw new Error('演出の表がいっぱいです');
    this.actions.set(row, key, n);
    return n;
  }
}

/** A hash for an added row of a table with a hash index. */
function newHash(t: GsTable): number {
  const used = t.hashes();
  let hash = (0x7e720000 + t.rows) >>> 0;
  while (used.has(hash)) hash = (hash + 0x10001) >>> 0;
  return hash;
}
