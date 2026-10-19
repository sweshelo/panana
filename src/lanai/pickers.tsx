// RPG FREE!'s monsters, items and actions in the boards and pickers shared with RPG2 / RPG3 (ui/MonsterSlots,
// ui/GridPicker, ui/ActionPicker): the photos of the monsters' models, a badge for the items (their models are not
// read yet) and the actions (no model). The game has no item or action page yet, so their boards are not linked.
import { useMemo, type ReactNode } from 'react';
import { ActionTablePicker, type ActionEntry } from '../ui/ActionPicker';
import { GridPicker, type PickerChoice } from '../ui/GridPicker';
import { ActionBadge, type BoardEntry } from '../ui/MonsterSlots';
import { Photo } from '../ui/Photo';
import { lanaiActionName, lanaiActionUsers, lanaiItemName, lanaiMonsterIndex, lanaiMonsterName, lanaiMonsterStats } from './monsterBook';
import { lanaiItemRef } from './items';
import { lanaiMonsterModel } from './monsterModels';
import { isTransform, lanaiAction } from './monsterStats';
import { lanaiMonsterDesign, lanaiMonsterHref, lanaiMonsters } from './monsters';
import type { LanaiSession } from './session';

/** The photo of a monster's model (empty without a MonsterDesign row). */
export function lanaiMonsterIcon(session: LanaiSession, row: number, large = false): ReactNode {
  const m = lanaiMonsters(session)[row];
  const d = m && m.designRow >= 0 ? lanaiMonsterDesign(session, m.designRow) : null;
  return <Photo model={d ? lanaiMonsterModel(session, d, false) : null} className={`photo${large ? ' photo-lg' : ''}`} title={m?.name} />;
}

export function lanaiMonsterEntry(session: LanaiSession, row: number): BoardEntry {
  return { icon: lanaiMonsterIcon(session, row, true), name: lanaiMonsterName(session, row), href: lanaiMonsterHref(row) };
}

/** An item's picture: the photo of its model (ItemDataCore +0x18 / +0x1C), or a badge with the first letter of its name. */
export function lanaiItemIcon(session: LanaiSession, row: number, name: string, large = false): ReactNode {
  const data = session.need('ItemData');
  const core = session.need('ItemDataCore');
  const c = row > 0 && row < data.rows ? data.u16(row, 0x0c) : 0;
  const model = c && c < core.rows ? lanaiItemRef(session, { archive: core.u32(c, 0x18), model: core.u32(c, 0x1c) }) : null;
  const className = `photo${large ? ' photo-lg' : ''}`;
  if (model) return <Photo model={model} className={className} title={name} />;
  return <span className={`${className} item-badge item-kind-0`}>{name.slice(0, 1) || '?'}</span>;
}

export function lanaiItemEntry(session: LanaiSession, id: number): BoardEntry {
  const name = lanaiItemName(session, id);
  return { icon: lanaiItemIcon(session, session.need('ItemData').find(id), name), name };
}

/** An action's badge: "変" for a transformation, else its system number. */
function actionIcon(session: LanaiSession, id: number): ReactNode {
  const a = lanaiAction(session, id);
  return <ActionBadge element={0} label={!a ? '?' : isTransform(a) ? '変' : String(a.system)} />;
}

export function lanaiActionEntry(session: LanaiSession, id: number): BoardEntry {
  return { icon: actionIcon(session, id), name: lanaiActionName(session, id) };
}

/** The second line of an action's board: its system, and the monster a transformation makes. */
export function lanaiActionSub(session: LanaiSession, id: number): string | undefined {
  const a = lanaiAction(session, id);
  if (!a || a.row === 0) return undefined;
  if (!isTransform(a)) return `系統 ${a.system}`;
  const to = session.need('MonsterParameter').find(a.target);
  return `系統 ${a.system}・→ ${to >= 0 ? `${lanaiMonsterName(session, to)} #${to}` : '(表にない行)'} に変身`;
}

/** Picks a monster from the photos of its model (`choices` before them, e.g. "なし"). */
export function LanaiMonsterPicker({ session, current, title = 'モンスターを選ぶ', choices = [], onPick, onClose }: {
  session: LanaiSession; current: number; title?: string; choices?: PickerChoice[]; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => lanaiMonsters(session).filter((m) => m.name).map((m) => {
    const s = lanaiMonsterStats(session, m.row);
    return { id: m.row, name: m.name, sub: `#${m.row}${s ? ` Lv${s.level}` : ''}`, icon: lanaiMonsterIcon(session, m.row, true) };
  }), [session]);
  return <GridPicker title={title} entries={entries} current={current} choices={choices} placeholder="名前か番号で絞り込み" onPick={onPick} onClose={onClose} />;
}

/** Picks an item (ItemData row; the pick is the row number), or one of `choices` before them. */
export function LanaiItemPicker({ session, current, title = 'アイテムを選ぶ', choices = [], choicesLabel, onPick, onClose }: {
  session: LanaiSession; current: number; title?: string; choices?: PickerChoice[]; choicesLabel?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => {
    const t = session.need('ItemData');
    const out = [];
    for (let r = 1; r < t.rows; r++) {
      const name = session.plain(t, r, 'name');
      if (name) out.push({ id: r, name, sub: `#${r}`, icon: lanaiItemIcon(session, r, name, true) });
    }
    return out;
  }, [session]);
  return <GridPicker title={title} entries={entries} current={current} choices={choices} choicesLabel={choicesLabel} placeholder="名前か番号で絞り込み" onPick={onPick} onClose={onClose} />;
}

/** Picks an action (ActionData row; the pick is the row number) from the table of their texts and users. */
export function LanaiActionPicker({ session, current, title = 'ワザを選ぶ', onPick, onClose }: {
  session: LanaiSession; current?: number; title?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => {
    const t = session.need('ActionData');
    lanaiMonsterIndex(session);
    const out: ActionEntry[] = [];
    for (let r = 1; r < t.rows; r++) {
      const a = lanaiAction(session, t.rowId(r))!;
      const users = lanaiActionUsers(session, a.id).map((m) => lanaiMonsterName(session, m));
      out.push({
        row: r,
        name: lanaiActionName(session, a.id),
        note: isTransform(a) ? ` → 変身 #${session.need('MonsterParameter').find(a.target)}` : undefined,
        kind: `系統 ${a.system}`,
        element: '',
        users,
        tags: [...(users.length ? ['skill'] : []), ...(isTransform(a) ? ['transform'] : [])],
      });
    }
    return out;
  }, [session]);
  return <ActionTablePicker title={title} entries={entries} filters={[['skill', 'モンスターが使うもの'], ['transform', '変身 (系統 29 / 30)'], ['all', 'すべて']]} current={current} onPick={onPick} onClose={onClose} />;
}
