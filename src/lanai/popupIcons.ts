// The icons だれに.SetPopup(2, icon, 1, 1, 0, vec(0, 0, 0)) shows over a character: ScriptChara::SetPopup (code.bin
// 0x2BD800). Kind 2 of the popup object (0x2040C0) loads the 13 entries a table of code.bin names (0x49AFCC) from
// the root archive
// D9010000 (type 4: a BCH with the model "status", one texture and a 60-frame animation of its own); ShowPopup
// (0x1A53E8 → 0x2B4474) shows the icon-th, and an icon past the 13th as the first. The names are what the textures
// look like (the animation moves and repeats them: two drops, three notes …), not the game's.
import { findEntry, unpackEntry } from '../archive/gsarc';
import { parseBch, unwrapBch } from '../bch/bch';
import type { CgfxFile } from '../cgfx/cgfx';
import type { LanaiSession } from './session';

export const POPUP_ARCHIVE = 'D9010000';
/** Where code.bin (the Update's) keeps the hashes of the icons. */
export const POPUP_TABLE = 0x49afcc;

export interface PopupIcon {
  icon: number;
  /** The entry of POPUP_ARCHIVE. */
  hash: number;
  label: string;
}

export const POPUP_ICONS: readonly PopupIcon[] = [
  { icon: 0, hash: 0x7bb64800, label: '! (びっくり)' },
  { icon: 1, hash: 0xdf15d000, label: '水色のしずく (汗)' },
  { icon: 2, hash: 0x3ebb4800, label: '? (はてな)' },
  { icon: 3, hash: 0x91d47400, label: '怒りマーク' },
  { icon: 4, hash: 0x4d31fc00, label: '泡' },
  { icon: 5, hash: 0x980fb400, label: '音符' },
  { icon: 6, hash: 0x7a0b8c00, label: 'ハート' },
  { icon: 7, hash: 0x89f6d400, label: '花' },
  { icon: 8, hash: 0xefd33c00, label: 'もやもや' },
  { icon: 9, hash: 0x1cac1400, label: 'Z (眠り)' },
  { icon: 10, hash: 0x959c8c00, label: 'キラッ (ひらめき)' },
  { icon: 11, hash: 0x9c7c0400, label: '青い線 (青ざめ・焦り)' },
  { icon: 12, hash: 0x04247000, label: '… の吹き出し' },
];

export const popupIconLabel = (icon: number): string =>
  POPUP_ICONS[icon]?.label ?? `表にない番号 (0〜${POPUP_ICONS.length - 1} の外: 0 の絵になります)`;

/** The BCH of an icon (its entry's bytes) and what it holds. */
export async function lanaiPopupIcon(
  session: LanaiSession,
  icon: number,
): Promise<{ body: Uint8Array; file: CgfxFile }> {
  const p = POPUP_ICONS[icon];
  if (!p) throw new Error(`アイコン ${icon} はありません`);
  const arc = await session.archive(POPUP_ARCHIVE);
  const e = findEntry(arc, p.hash);
  if (!e) throw new Error(`${POPUP_ARCHIVE} にアイコン ${icon} (0x${p.hash.toString(16).toUpperCase()}) がありません`);
  const body = unwrapBch(unpackEntry(arc, e).body);
  return { body, file: parseBch(body) };
}
