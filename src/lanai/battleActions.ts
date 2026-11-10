// RPG FREE!'s battle actions (ActionData, 0x2C bytes a row, with row IDs) for the action book (#/actions/<row>): every
// row with its two texts (MessageAction of +0x0C: what is done, of +0x10: the result) and system (+0x14 bit4-11), who
// uses it (the monsters' ability rows by ID, the tools' UseItemInfo +0x04 and the equipment's automatic effects by row:
// naauao lanai/actions.md, monsters.md §3, equipment.md §4), and making an action: a copy of a row at the end of the
// table with texts of its own. The map objects' action types are another thing (actions.ts).
import { isAutoEffect, lanaiEffects, lanaiEquipRow, LANAI_AUTO_EFFECTS } from './equipment';
import { lanaiItems } from './items';
import { lanaiActionText, lanaiMonsterIndex, type LanaiActionUse } from './monsterBook';
import { lanaiAction, lanaiActionMessageAt, type LanaiAction } from './monsterStats';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

/** The two texts of an action: the offset of its MessageAction ID. */
export const ACTION_TEXTS = [
  { key: 'message', offset: 0x0c, label: '使ったときの文' },
  { key: 'result', offset: 0x10, label: '結果の文' },
] as const;
export type ActionTextKey = (typeof ACTION_TEXTS)[number]['key'];
const textOffset = (key: ActionTextKey): number => ACTION_TEXTS.find((x) => x.key === key)!.offset;

/** UseItemInfo +0x04: the ActionData row a tool does (0 = none: the boosts, the keys, ヒロビーロ). */
export const USE_ITEM_ACTION = 0x04;

/**
 * The kinds whose UseItemInfo +0x04 is an action: the tools 0x1x. 0x02 (ふくぶくろ) and 0x37 have UseItemInfo rows too
 * (naauao lanai/items.md §4), but their +0x04 is something else (おしょうがつぶくろ has 707, the row of キズぐすり).
 */
export const usesItemInfo = (kind: number): boolean => (kind & 0xf0) === 0x10;

/** An action of the book. */
export interface LanaiBattleAction extends LanaiAction {
  /** The name it is listed by: its text without the user, else the item using it, else "アクション N". */
  name: string;
  /** Whether the name is its own text (not taken from an item or the row). */
  named: boolean;
}

/** An item that uses the action: a tool (UseItemInfo) or an equipment's automatic effect. */
export interface LanaiActionItem {
  /** ItemData row. */
  item: number;
  name: string;
  /** "使う", "装備・ターン開始時" … */
  how: string;
}

export interface LanaiActionRefs {
  /** ActionData row → the monsters (and slots) using it. */
  monsters: Map<number, LanaiActionUse[]>;
  /** ActionData row → the items using it. */
  items: Map<number, LanaiActionItem[]>;
}

const books = new WeakMap<LanaiSession, { revision: number; list: LanaiBattleAction[]; refs: LanaiActionRefs }>();

function build(session: LanaiSession): { list: LanaiBattleAction[]; refs: LanaiActionRefs } {
  const have = books.get(session);
  if (have && have.revision === session.revision) return have;
  const t = session.need('ActionData');
  const monsters = new Map<number, LanaiActionUse[]>();
  for (const [id, uses] of lanaiMonsterIndex(session).users) {
    const row = t.find(id);
    if (row > 0) monsters.set(row, uses);
  }
  const items = new Map<number, LanaiActionItem[]>();
  const add = (row: number, x: LanaiActionItem): void => {
    if (row > 0 && row < t.rows) items.set(row, [...(items.get(row) ?? []), x]);
  };
  const use = session.table('UseItemInfo');
  const core = session.need('ItemDataCore');
  for (const it of lanaiItems(session)) {
    const ref = lanaiEquipRow(session, it);
    if (ref) {
      for (const e of lanaiEffects(ref)) if (isAutoEffect(e.kind)) add(e.value, { item: it.row, name: it.name, how: `装備・${LANAI_AUTO_EFFECTS[e.kind]}` });
      continue;
    }
    const u = use && usesItemInfo(it.kind) ? use.find(core.u32(it.core, 0x00)) : -1;
    if (use && u > 0) add(use.u32(u, USE_ITEM_ACTION), { item: it.row, name: it.name, how: '使う' });
  }
  const list: LanaiBattleAction[] = [];
  for (let r = 0; r < t.rows; r++) {
    const a = lanaiAction(session, t.rowId(r));
    if (!a) continue;
    const own = r === 0 ? 'なし' : lanaiActionText(a);
    const item = items.get(r)?.[0];
    list.push({ ...a, name: own || (item ? `${item.name} の効果` : `アクション ${r}`), named: !!own });
  }
  const out = { revision: session.revision, list, refs: { monsters, items } };
  books.set(session, out);
  return out;
}

/** Every row of ActionData (row 0 is "なし"). */
export const lanaiBattleActions = (session: LanaiSession): LanaiBattleAction[] => build(session).list;

/** Who uses each action (read again after every edit). */
export const lanaiActionRefs = (session: LanaiSession): LanaiActionRefs => build(session).refs;

/** The ActionData row a tool does (UseItemInfo +0x04), or 0. */
export function lanaiItemUseAction(session: LanaiSession, it: { kind: number; core: number }): number {
  const use = session.table('UseItemInfo');
  const u = use && usesItemInfo(it.kind) ? use.find(session.need('ItemDataCore').u32(it.core, 0x00)) : -1;
  return use && u > 0 ? use.u32(u, USE_ITEM_ACTION) : 0;
}

/** The monsters using an action row (each once). */
export function lanaiActionMonsterRows(session: LanaiSession, row: number): number[] {
  return [...new Set((lanaiActionRefs(session).monsters.get(row) ?? []).map((u) => u.monster))];
}

export const lanaiActionAdded = (session: LanaiSession, row: number): boolean => row >= session.need('ActionData').originalRows;

/** The other rows with the same text: editing it changes them too. */
export function lanaiActionsWithText(session: LanaiSession, row: number, key: ActionTextKey): number[] {
  const t = session.need('ActionData');
  const o = textOffset(key);
  const id = t.u32(row, o);
  if (!lanaiActionMessageAt(session, id)) return [];
  const out: number[] = [];
  for (let r = 1; r < t.rows; r++) if (r !== row && t.u32(r, o) === id) out.push(r);
  return out;
}

/** The MessageAction row of one of an action's texts (null when it has none). */
export function lanaiActionMessageRow(session: LanaiSession, row: number, key: ActionTextKey = 'message'): { table: LanaiTable; row: number } | null {
  return lanaiActionMessageAt(session, session.need('ActionData').u32(row, textOffset(key)));
}

/** Gives an action a text of its own: a copy of its MessageAction row (same text) at the end of that table. */
export function lanaiOwnActionText(session: LanaiSession, row: number, key: ActionTextKey = 'message'): void {
  const msg = lanaiActionMessageRow(session, row, key);
  if (!msg) throw new Error('このアクションにはその文がありません');
  const copy = msg.table.addRow(msg.row);
  session.need('ActionData').setU32(row, textOffset(key), msg.table.rowId(copy));
}

/**
 * Makes a new action: a copy of row `from` at the end of ActionData (a new row ID). The text of +0x0C gets a row of its
 * own (the result's text, shared by many actions like "〈name〉に　〈value〉ダメージ与えた", stays shared). Returns the new row.
 */
export function lanaiCopyAction(session: LanaiSession, from: number): number {
  const t = session.need('ActionData');
  if (from <= 0 || from >= t.rows) throw new Error(`ActionData に行 ${from} がありません`);
  const row = t.addRow(from);
  // "〈name〉" alone (0x80000016, 396 rows) is a text no action owns: it stays shared
  if (lanaiActionMessageRow(session, row) && lanaiActionsWithText(session, row, 'message').length < 50) lanaiOwnActionText(session, row);
  return row;
}

/** Why an action cannot be removed ('' when it can): only the last added row. */
export function lanaiActionRemoveBlock(session: LanaiSession, row: number): string {
  if (!lanaiActionAdded(session, row)) return '元のゲームのアクションは消せません';
  if (row !== session.need('ActionData').rows - 1) return '消せるのは最後に追加したアクションだけです';
  return '';
}

/** What still uses an action (names for the remove button). */
export function lanaiActionUsedBy(session: LanaiSession, row: number): string[] {
  const p = session.need('MonsterParameter');
  const names = lanaiActionMonsterRows(session, row).map((m) => session.plain(p, m, 'name') || `モンスター #${m}`);
  return [...names, ...(lanaiActionRefs(session).items.get(row) ?? []).map((e) => e.name)];
}

/** Removes the last added action, and its own texts when they are the last added MessageAction rows and nothing else uses them. */
export function lanaiRemoveAction(session: LanaiSession, row: number): void {
  const why = lanaiActionRemoveBlock(session, row);
  if (why) throw new Error(why);
  const own = ACTION_TEXTS.map((x) => lanaiActionsWithText(session, row, x.key).length ? null : lanaiActionMessageRow(session, row, x.key));
  session.need('ActionData').removeLastRow();
  for (const msg of own) if (msg && msg.row === msg.table.rows - 1 && msg.row >= msg.table.originalRows) msg.table.removeLastRow();
}

/** Puts an action of the game back as read, with the texts of the game it names. */
export function lanaiRevertAction(session: LanaiSession, row: number): void {
  for (const x of ACTION_TEXTS) {
    const msg = lanaiActionMessageRow(session, row, x.key);
    if (msg && msg.row < msg.table.originalRows && msg.table.rowChanged(msg.row)) msg.table.revertRow(msg.row);
  }
  session.need('ActionData').revertRow(row);
}

/** Whether an action (or one of its texts) was changed. */
export function lanaiActionChanged(session: LanaiSession, row: number): boolean {
  if (lanaiActionAdded(session, row) || session.need('ActionData').rowChanged(row)) return true;
  return ACTION_TEXTS.some((x) => {
    const msg = lanaiActionMessageRow(session, row, x.key);
    return !!msg && msg.table.rowChanged(msg.row);
  });
}
