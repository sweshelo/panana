// 電波人間のRPG3's event list (naauao oahu/map.md §5): every EventObject row of every dungeon, where the maps place it,
// when it appears and goes (§5.2), where an exit leads, and for scripts the class the Update's code builds with the
// messages it shows (oahu/scripts.ts). The same entry shape as RPG2's list (game/eventlist.ts) where it fits.
import { describeClasses, type BuiltAction, type ScriptClass } from '../game/scripts';
import type { FieldDef, TableDef } from '../game/tabledef';
import { recCellPos } from '../game/sections';
import { u32 } from '../util/bytes';
import { OAHU_EVENT_SECTIONS, OAHU_LAYOUTS, oahuRecEventRow, type OahuMapInfo, type OahuMaps } from './maps';
import { OAHU_MAKE_FUNCTIONS, oahuBuildAction, oahuCodeProfile, oahuMakeFunction, OAHU_SCRIPT_KIND } from './scripts';

/** EventObject offsets (§5.1). */
export const EO = { appear1: 0x00, appear2: 0x04, gone1: 0x08, gone2: 0x0c, args: 0x10, slot: 0x4c, model: 0x4e, flags: 0x50, arg52: 0x52, appear: 0x53, gone: 0x54, kind: 0x55, done1: 0x56, done2: 0x57 } as const;
export const OAHU_EVENT_ROW = 0x58;

/** Kinds that FUN_004BC7C8 (the exits' make function) handles (§5.3). */
const EXIT_KINDS = new Set([0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1f, 0x20, 0x21]);
/** Kinds whose +0x10 / +0x14 are the destination map / point (§5.1). */
const DEST_KINDS = new Set([0x13, 0x15, 0x16, 0x18, 0x1b, 0x1e, 0x1f, 0x21, OAHU_SCRIPT_KIND]);

export function oahuKindName(kind: number): string {
  const h = `0x${kind.toString(16).toUpperCase().padStart(2, '0')}`;
  if (kind === 0) return 'なし';
  if (kind === OAHU_SCRIPT_KIND) return `スクリプト (${h})`;
  if (EXIT_KINDS.has(kind)) return `出入口・扉 (${h})`;
  return `種類 ${h}`;
}

/** What a condition (kind, value 1, value 2) checks (§5.2). */
export function oahuConditionText(kind: number, v1: number, v2: number): string {
  if (kind === 0x01) return `進行の条件 ${v1}`;
  if (kind === 0x02 || kind === 0x03) return `ダンジョン ${v1} のフラグ ${v2} が${kind === 0x02 ? '立っている' : '立っていない'}`;
  if (kind >= 0x04 && kind <= 0x06) return `今のダンジョンの値 ${v1} ${['=', '≥', '≤'][kind - 4]} ${v2}`;
  if (kind >= 0x07 && kind <= 0x11) return `ダンジョン ${v1} の値 ${v2} = ${kind - 7}`;
  if (kind === 0x12 || kind === 0x13) return `フラグ 0xFA[${v1}] が${kind === 0x12 ? '立っている' : '立っていない'}`;
  if (kind >= 0x14 && kind <= 0x16) return `値 0xF9[${v1}] ${['=', '≥', '≤'][kind - 0x14]} ${v2}`;
  if (kind === 0x17 || kind === 0x18) return `セーブ 0x49 の ${v1} が${kind === 0x17 ? '真' : '偽'}`;
  if (kind === 0x19 || kind === 0x1a) return `FUN_004EF1A4(${v1}) ${kind === 0x19 ? '=' : '≠'} ${v2} (未解析)`;
  if (kind === 0x1b || kind === 0x1c) return `判定 ${v1}${kind === 0x1c ? ' の否定' : ''} (未解析)`;
  if (kind === 0x1d || kind === 0x1e) return `今のダンジョンの数 ${kind === 0x1d ? '≥' : '≤'} ${v2} (未解析)`;
  if (kind >= 0x1f && kind <= 0x21) return `表の値 ${v1} ${['=', '≥', '≤'][kind - 0x1f]} ${v2}`;
  if (kind === 0x22) return `FUN_0021152C(${v1}) がこの行`;
  return `条件 0x${kind.toString(16).toUpperCase()} (${v1}, ${v2})`;
}

export interface OahuEventPlace {
  map: OahuMapInfo;
  section: number;
  index: number;
  x: number;
  y: number;
}

export interface OahuEventCondition {
  field: typeof EO.appear | typeof EO.gone;
  kind: number;
  v1: number;
  v2: number;
  text: string;
}

export interface OahuEventEntry {
  dungeon: number;
  row: number;
  kind: number;
  /** A copy of the row. */
  raw: Uint8Array;
  conditions: OahuEventCondition[];
  places: OahuEventPlace[];
  /** Exits: the destination map (+0x10) and point (+0x14). */
  dest?: { map: OahuMapInfo; point: number };
  /** Scripts (and the other kinds whose class could be built): one per make function that builds something. */
  scripts: { make: number; cls: ScriptClass }[];
}

export const oahuEventKey = (e: { dungeon: number; row: number }): string => `${e.dungeon}.${e.row}`;

export function oahuConditions(r: Uint8Array): OahuEventCondition[] {
  const out: OahuEventCondition[] = [];
  for (const [field, o] of [[EO.appear, EO.appear1], [EO.gone, EO.gone1]] as const) {
    const kind = r[field]!;
    if (!kind) continue;
    const v1 = u32(r, o), v2 = u32(r, o + 4);
    out.push({ field, kind, v1, v2, text: oahuConditionText(kind, v1, v2) });
  }
  return out;
}

/**
 * Every row of every dungeon's EventObject table. With the Update's code.bin (`code`), the classes of the rows are
 * built (`fieldMessages` = MessageField_JP's ID range, the messages the scripts' code names).
 */
export async function oahuEventEntries(maps: OahuMaps, code: Uint8Array | null, fieldMessages: [number, number]): Promise<OahuEventEntry[]> {
  const byDungeon = new Map<number, OahuMapInfo[]>();
  for (const m of maps.maps) if (!m.world) byDungeon.set(m.dungeon, [...(byDungeon.get(m.dungeon) ?? []), m]);
  const out: OahuEventEntry[] = [];
  const pending: { entry: OahuEventEntry; built: BuiltAction }[] = [];
  for (const d of maps.dungeons) {
    const t = await maps.eventTable(d).catch(() => null);
    if (!t) continue;
    const places = new Map<number, (OahuEventPlace & { make: number | null })[]>();
    for (const m of byDungeon.get(d.row) ?? []) {
      const doc = maps.doc(m);
      for (const section of OAHU_EVENT_SECTIONS)
        (doc.recs[section] ?? []).forEach((rec, index) => {
          const row = oahuRecEventRow(section, rec.raw);
          if (section === 8 && u32(rec.raw, 0) >= 100) return;
          const [x, y] = recCellPos(rec, OAHU_LAYOUTS[section]!);
          places.set(row, [...(places.get(row) ?? []), { map: m, section, index, x, y, make: oahuMakeFunction(section, rec.raw) }]);
        });
    }
    for (let row = 0; row < t.rows; row++) {
      const r = t.row(row);
      const kind = r[EO.kind]!;
      const p = places.get(row) ?? [];
      const destMap = DEST_KINDS.has(kind) ? maps.map(u32(r, 0x10)) : undefined;
      const entry: OahuEventEntry = {
        dungeon: d.row,
        row,
        kind,
        raw: r.slice(),
        conditions: oahuConditions(r),
        places: p.map(({ make: _, ...q }) => q),
        dest: destMap ? { map: destMap, point: u32(r, 0x14) } : undefined,
        scripts: [],
      };
      out.push(entry);
      if (!code || !kind) continue;
      const used = new Set(p.map((q) => q.make).filter((f): f is number => f !== null));
      for (const make of used.size ? used : OAHU_MAKE_FUNCTIONS) {
        const built = oahuBuildAction(code, make, d.row, row, r);
        if (built) {
          pending.push({ entry, built });
          if (!used.size) break;
        }
      }
    }
  }
  if (code) {
    const classes = describeClasses(code, pending.map((p) => p.built), [], oahuCodeProfile(...fieldMessages));
    for (const { entry, built } of pending) entry.scripts.push({ make: built.make, cls: classes.get(built.vtable)! });
  }
  return out;
}

/** The fields of an EventObject row (§5.1) for the inspector and the event page. */
export const OAHU_EVENT_OBJECT: TableDef = {
  file: 'EventObject.bin',
  rowSize: OAHU_EVENT_ROW,
  fields: [
    { key: 'kind', offset: EO.kind, type: 'u8', label: '種類', hex: true },
    { key: 'appear', offset: EO.appear, type: 'u8', label: '出る条件の種類', hex: true, note: '0 = いつも出る (§5.2)' },
    { key: 'appear1', offset: EO.appear1, type: 'u32', label: '出る条件の値 1' },
    { key: 'appear2', offset: EO.appear2, type: 'u32', label: '出る条件の値 2' },
    { key: 'gone', offset: EO.gone, type: 'u8', label: '消える条件の種類', hex: true, note: '0 = 消えない (§5.2)' },
    { key: 'gone1', offset: EO.gone1, type: 'u32', label: '消える条件の値 1' },
    { key: 'gone2', offset: EO.gone2, type: 'u32', label: '消える条件の値 2' },
    { key: 'arg0', offset: 0x10, type: 'u32', label: '引数 +0x10 (出入口: 行き先のマップ)', hex: true },
    { key: 'arg1', offset: 0x14, type: 'u32', label: '引数 +0x14 (出入口: 行き先の地点)' },
    ...Array.from({ length: 14 }, (_, i): FieldDef => ({ key: `arg${i + 2}`, offset: 0x18 + i * 4, type: 'u32', label: `引数 +0x${(0x18 + i * 4).toString(16).toUpperCase()}`, unsure: true })),
    { key: 'slot', offset: EO.slot, type: 'u16', label: '状態の枠', note: '0xFFFF = 行番号 (推定)' },
    { key: 'model', offset: EO.model, type: 'u16', label: 'モデル (mapObject の行) / 範囲の半径' },
    { key: 'flags', offset: EO.flags, type: 'u16', label: '範囲の登録に渡す値', hex: true, unsure: true },
    { key: 'arg52', offset: EO.arg52, type: 'u8', label: '種類ごとの引数 +0x52', unsure: true },
    { key: 'done1', offset: EO.done1, type: 'u8', label: '完了時の状態の値 1', unsure: true },
    { key: 'done2', offset: EO.done2, type: 'u8', label: '完了時の状態の値 2', unsure: true },
  ],
};
