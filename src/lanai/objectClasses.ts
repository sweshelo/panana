// What a MapObject row is for, for the add panel's props (装飾): a category told by the model's file name, and the
// differences a thumbnail does not show (roms/tmpmap/parts-props-findings.md, 2026-11-23):
// - +0x20 f32 is the opacity: the NPC rows 447〜480 are rows 409〜442's models at 0.4 (the "ghost" ちていじん of the
//   game), 379〜381 (obj_invisible) are 0. The Update code reads it at 0x23D134.
// - +0x24 low 16 bits are an effect attached to the model (an EffectData row): 0x23 fx_bg_f_torch (a torch's flame),
//   0x24 fx_bg_bonfire. Rows 520 / 530 are the same lamp with and without the flame.
// The file name is the ZIP entry's (read from its local header, nothing inflated). ちていじん and the fairies are NPC
// models like the others: they are not told apart here.
import { entryBlob, findEntry } from '../archive/gsarc';
import { zipEntryName } from '../archive/zip';
import { f32, hex8 } from '../util/bytes';
import { lanaiObjectRef } from './mapObjects';
import type { LanaiSession } from './session';

export const LANAI_OBJECT_OPACITY = 0x20;
export const LANAI_OBJECT_EFFECT = 0x24;
const EFFECT_NAMES: Record<number, string> = { 0x23: '松明の炎', 0x24: 'かがり火' };

export interface LanaiObjectInfo {
  /** The model's file name ("gimk_09_lamp_09.bch"), '' when it is not known. */
  file: string;
  /** The add panel's category of the prop. */
  category: string;
  /** What the thumbnail does not show: 半透明, 透明, the effect. */
  marks: string[];
}

/** File name patterns, first match wins. */
const RULES: [RegExp, string][] = [
  [/^gimk_(01_stair|03_gate|06_hole|11_warp|17_raft|18_ship|19_raftgate)/u, '置物・移動'],
  [/^gimk_02_door/u, '置物・ドア'],
  [/^gimk_12_switch/u, '置物・スイッチ'],
  [/^gimk_05_trebox/u, '置物・宝箱'],
  [/fairy/u, '置物・妖精'],
  [/^npc/u, '置物・人物'],
  [/flower|tree|plant|grass|mushroom|stump/u, '置物・植物'],
  [/^gimk_/u, '置物・ギミック'],
  [/^(inside_|int_)/u, '置物・インテリア'],
  [/^wld_|^bgpt_wld/u, '置物・ワールドマップ'],
  [/^(twn_|ex_|obj_)/u, '置物・エクステリア'],
];
export const LANAI_OBJECT_CATEGORIES = [...new Set(RULES.map(([, c]) => c)), '置物・その他'];

export function lanaiObjectCategory(file: string): string {
  const name = file.toLowerCase();
  if (name.startsWith('obj_invisible')) return '置物・その他';
  return RULES.find(([re]) => re.test(name))?.[1] ?? '置物・その他';
}

/** Rows the file name sorts wrongly (seen by the user). */
const ROW_CATEGORIES: Record<number, string> = {
  // a green warp hole, the shipped stages' entrance to the fairies' village (its file is named fairy)
  540: '置物・移動',
};

const cache = new WeakMap<LanaiSession, Promise<Map<number, LanaiObjectInfo>>>();

/** Every MapObject row with a model (read once per session). */
export function lanaiObjectInfo(session: LanaiSession): Promise<Map<number, LanaiObjectInfo>> {
  let p = cache.get(session);
  if (!p) {
    p = readInfo(session);
    p.catch(() => cache.delete(session));
    cache.set(session, p);
  }
  return p;
}

async function readInfo(session: LanaiSession): Promise<Map<number, LanaiObjectInfo>> {
  const table = session.table('MapObject');
  const out = new Map<number, LanaiObjectInfo>();
  if (!table) return out;
  for (let row = 1; row < table.rows; row++) {
    const ref = lanaiObjectRef(table, row);
    if (!ref) continue;
    let file = '';
    try {
      const arc = await session.archive(hex8(ref.archive));
      const e = findEntry(arc, ref.entry);
      if (e && e.comp === 1) file = zipEntryName(entryBlob(arc, e)) ?? '';
    } catch {
      // the category falls back to その他
    }
    const raw = table.row(row);
    const opacity = f32(raw, LANAI_OBJECT_OPACITY);
    const effect = table.u32(row, LANAI_OBJECT_EFFECT) & 0xffff;
    const marks = [
      opacity <= 0 ? '透明' : opacity < 1 ? `半透明 (${Math.round(opacity * 100)}%)` : '',
      effect ? (EFFECT_NAMES[effect] ?? `エフェクト #${effect}`) : '',
    ].filter(Boolean);
    out.set(row, { file, category: ROW_CATEGORIES[row] ?? lanaiObjectCategory(file), marks });
  }
  return out;
}
