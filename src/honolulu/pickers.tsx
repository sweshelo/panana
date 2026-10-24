// 初代's monsters, items and skills in the boards and pickers shared with the other games (ui/MonsterSlots,
// ui/GridPicker, ui/ActionPicker): the photos of the monsters' models, a badge for the items (they have no model) and
// for the skills (monsterAttackSkill, no model).
import { useMemo, type ReactNode } from 'react';
import { ActionTablePicker, type ActionEntry } from '../ui/ActionPicker';
import { GridPicker, type PickerChoice } from '../ui/GridPicker';
import { ActionBadge, type BoardEntry } from '../ui/MonsterSlots';
import { Photo } from '../ui/Photo';
import { honoluluItemHref } from './ItemPage';
import { categoryName, honoluluItemRows, honoluluItems } from './items';
import { attackName, battleRows, honoluluMonsterHref, honoluluMonsterModel, honoluluMonsters, monsterName, SKILL_SLOTS, skillRows } from './monsters';
import type { HonoluluSession } from './session';
import { HONOLULU_ITEM_CATEGORY } from './tables';

/** The photo of a monster's model. */
export function honoluluMonsterIcon(session: HonoluluSession, row: number, large = false): ReactNode {
  const t = battleRows(session);
  const design = row > 0 && row < t.rows ? t.get(row, 'design') : 0;
  return <Photo model={honoluluMonsterModel(session, design)} className={`photo${large ? ' photo-lg' : ''}`} title={monsterName(session, row)} />;
}

export function honoluluMonsterEntry(session: HonoluluSession, row: number): BoardEntry {
  return { icon: honoluluMonsterIcon(session, row, true), name: monsterName(session, row) || `#${row}`, href: honoluluMonsterHref(row) };
}

/** An item's badge: the first letter of its name, coloured by its category. */
function itemIcon(name: string, category: number, large = false): ReactNode {
  return <span className={`photo${large ? ' photo-lg' : ''} item-badge item-kind-${category}`}>{name.slice(0, 1) || '?'}</span>;
}

export function honoluluItemEntry(session: HonoluluSession, row: number): BoardEntry {
  const t = honoluluItemRows(session);
  const name = row > 0 && row < t.rows ? session.messages.texts.preview(t.get(row, 'name'), true) ?? '' : '';
  return { icon: itemIcon(name, row < t.rows ? t.get(row, 'category') : 0, true), name: name || `#${row}`, href: honoluluItemHref(row) };
}

export function honoluluSkillEntry(session: HonoluluSession, row: number): BoardEntry {
  return { icon: <ActionBadge element={0} label="ワ" />, name: attackName(session, row) || `#${row}` };
}

/** The second line of a skill's board: its amount (min〜max) when it has one. */
export function honoluluSkillSub(session: HonoluluSession, row: number): string | undefined {
  const t = skillRows(session);
  if (row <= 0 || row >= t.rows) return undefined;
  const [min, max] = [t.get(row, 'min'), t.get(row, 'max')];
  return min || max ? `量 ${min}${max !== min ? `〜${max}` : ''}` : undefined;
}

/** Picks a monster (monsterBattleParameter's row) from the photos of their models. */
export function HonoluluMonsterPicker({ session, current, title = 'モンスターを選ぶ', choices = [], onPick, onClose }: {
  session: HonoluluSession; current: number; title?: string; choices?: PickerChoice[]; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => honoluluMonsters(session).map((m) => ({ id: m.row, name: m.name, sub: `#${m.row} Lv${m.level}`, icon: honoluluMonsterIcon(session, m.row, true) })), [session]);
  return <GridPicker title={title} entries={entries} current={current} choices={choices} placeholder="名前か番号で絞り込み" onPick={onPick} onClose={onClose} />;
}

/** Picks an item (itemData's row) of those that hold one, filtered by category. */
export function HonoluluItemPicker({ session, current, title = 'アイテムを選ぶ', onPick, onClose }: {
  session: HonoluluSession; current: number; title?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => honoluluItems(session).map((it) => ({
    id: it.row, name: it.name, sub: it.price ? `${it.price} G` : categoryName(it.category), icon: itemIcon(it.name, it.category, true), category: it.category,
  })), [session]);
  return <GridPicker title={title} entries={entries} current={current} categories={HONOLULU_ITEM_CATEGORY} placeholder="名前か番号で絞り込み" onPick={onPick} onClose={onClose} />;
}

/** The monsters that have each skill in a slot (skill row -> monster names). */
function skillUsers(session: HonoluluSession): Map<number, string[]> {
  const t = battleRows(session);
  const out = new Map<number, string[]>();
  for (let r = 1; r < t.rows; r++) {
    for (const k of SKILL_SLOTS) {
      const s = t.get(r, k);
      if (!s) continue;
      const list = out.get(s) ?? out.set(s, []).get(s)!;
      const name = monsterName(session, r);
      if (!list.includes(name)) list.push(name);
    }
  }
  return out;
}

/** Picks a skill (monsterAttackSkill's row) from the table of their names and users. */
export function HonoluluSkillPicker({ session, current, title = 'ワザを選ぶ', onPick, onClose }: {
  session: HonoluluSession; current?: number; title?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => {
    const users = skillUsers(session);
    const out: ActionEntry[] = [];
    for (let r = 1; r < skillRows(session).rows; r++) {
      const u = users.get(r) ?? [];
      out.push({ row: r, name: attackName(session, r), kind: honoluluSkillSub(session, r) ?? '', element: '', users: u, tags: u.length ? ['skill'] : [] });
    }
    return out;
  }, [session]);
  return <ActionTablePicker title={title} entries={entries} filters={[['skill', 'モンスターが使うもの'], ['all', 'すべて']]} current={current} onPick={onPick} onClose={onClose} />;
}
