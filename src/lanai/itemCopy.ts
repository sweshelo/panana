// New items of RPG FREE! (naauao lanai/items.md §2〜§4): an ItemData row the game has no item in (+0x0C = 0; 611 of
// them, each with an item ID of its own) gets a copy of another item: a new ItemDataCore row (the prices, kind, rarity,
// description and model) and, for an equipment, a new EquipInfo row, so the copy changes alone. Its name is the row's
// string. Removing one puts the ItemData row back as read and drops the added rows when they are the last ones.
import { lanaiEquipRow } from './equipment';
import { lanaiItems, type LanaiItem } from './items';
import type { LanaiSession } from './session';

/** Item numbers from here on are counted in another save value (0x5C, FUN_00312B4C); new items stay below. */
const SAVE_SPLIT = 3000;

/** An ItemData row without an item that can take one (its name field is a string), or -1. */
export function lanaiFreeItemRow(session: LanaiSession): number {
  const data = session.need('ItemData');
  for (let r = 1; r < data.rows; r++) {
    if (!data.originalRow(r) || data.u16(r, 0x0c) || !data.isString(r, 0x00)) continue;
    if ((data.rowId(r) & 0x7fffffff) < SAVE_SPLIT) return r;
  }
  return -1;
}

/** Whether an item was made by lanaiCopyItem (a row without an item in the ROM that has one now). */
export function lanaiItemAdded(session: LanaiSession, row: number): boolean {
  const data = session.need('ItemData');
  const o = data.originalRow(row);
  return !!o && !(o[0x0c]! | (o[0x0d]! << 8)) && !!data.u16(row, 0x0c);
}

/** Copies item `from` (an ItemData row) into a free row; returns that row. */
export function lanaiCopyItem(session: LanaiSession, from: number): number {
  const it = lanaiItems(session).find((x) => x.row === from);
  if (!it) throw new Error(`ItemData の行 ${from} はアイテムではありません`);
  const r = lanaiFreeItemRow(session);
  if (r < 0) throw new Error('アイテムの空きの行がありません');
  const data = session.need('ItemData');
  const core = session.need('ItemDataCore');
  const c = core.addRow(it.core);
  if (c > 0xffff) throw new Error('ItemDataCore の行番号が +0x0C (u16) に入りません');
  const equip = lanaiEquipRow(session, it);
  if (equip) core.setU32(c, 0x00, equip.table.rowId(equip.table.addRow(equip.row)));
  data.setU16(r, 0x08, data.u16(from, 0x08));
  data.setU16(r, 0x0c, c);
  for (const o of [0x00, 0x04]) if (data.isString(from, o) && data.isString(r, o)) session.setText(data, r, o, session.stringAt(data, data.u32(from, o)).text);
  session.edited();
  return r;
}

/** Puts an added item's row back as read, and drops its ItemDataCore (and EquipInfo) row when it is the last added one. */
export function lanaiRemoveItem(session: LanaiSession, it: LanaiItem): void {
  if (!lanaiItemAdded(session, it.row)) throw new Error('消せるのは追加したアイテムだけです');
  const data = session.need('ItemData');
  const core = session.need('ItemDataCore');
  const equip = lanaiEquipRow(session, it);
  data.revertRow(it.row);
  const used = (c: number): boolean => Array.from({ length: data.rows }, (_, r) => data.u16(r, 0x0c)).includes(c);
  if (it.core === core.rows - 1 && it.core >= core.originalRows && !used(it.core)) {
    core.removeLastRow();
    if (equip && equip.row === equip.table.rows - 1 && equip.row >= equip.table.originalRows) equip.table.removeLastRow();
  }
  session.edited();
}
