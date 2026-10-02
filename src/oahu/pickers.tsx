// RPG3's monsters, items and actions in the pickers and boards shared with RPG2 (ui/GridPicker, ui/ActionPicker,
// ui/MonsterSlots, ui/GroupDetail), with the photos of their models (src/bch, #64).
import { useMemo, type ReactNode } from 'react';
import { ActionTablePicker, type ActionEntry } from '../ui/ActionPicker';
import type { GroupMonster } from '../ui/GroupDetail';
import { GridPicker } from '../ui/GridPicker';
import { ActionBadge, type BoardEntry } from '../ui/MonsterSlots';
import { Photo } from '../ui/Photo';
import { ItemPhoto } from './ItemPage';
import type { OahuBattle } from './battle';
import type { OahuItem } from './items';
import { OAHU_ACTION_CATEGORY, OAHU_ELEMENT_NAMES, OAHU_ITEM_KIND } from './tables';

export const oahuMonsterHref = (row: number): string => `#/monsters/${row}`;
export const oahuGroupHref = (row: number): string => `#/groups/${row}`;
export const oahuActionHref = (row: number): string => `#/actions/${row}`;

/** The photo of a monster's model. */
export function oahuMonsterIcon(battle: OahuBattle, row: number, large = false): ReactNode {
  return <Photo model={battle.monsterModel(row)} className={`photo${large ? ' photo-lg' : ''}`} title={battle.monsterName(row)} />;
}

/** The photo of an item's model, or the first letter of its main category. */
export function oahuItemIcon(battle: OahuBattle, item: OahuItem | undefined, large = false): ReactNode {
  const className = `photo${large ? ' photo-lg' : ''}`;
  if (item && battle.itemModels) return <ItemPhoto models={battle.itemModels} item={item} className={className} />;
  const label = item ? OAHU_ITEM_KIND[item.kind] ?? '?' : '?';
  return <span className={`${className} item-badge item-kind-${item?.kind ?? 0}`} title={item?.category}>{label[0]}</span>;
}

/** An action's badge: the first letter of its element, or of its category. */
export function oahuActionIcon(battle: OahuBattle, row: number): ReactNode {
  const element = row > 0 && row < battle.actions.rows ? battle.actions.get(row, 'element') : 0;
  const category = row > 0 && row < battle.actions.rows ? battle.actions.get(row, 'category') : 0;
  const label = element ? OAHU_ELEMENT_NAMES[element] ?? '?' : (OAHU_ACTION_CATEGORY[category] ?? '?').slice(0, 1);
  return <ActionBadge element={element} label={label} />;
}

export function oahuItemEntry(battle: OahuBattle, id: number): BoardEntry {
  return { icon: oahuItemIcon(battle, battle.items.item(id)), name: battle.itemName(id), href: `#/items/${id}` };
}

export function oahuActionEntry(battle: OahuBattle, row: number): BoardEntry {
  return { icon: oahuActionIcon(battle, row), name: battle.actionName(row) || `#${row}`, href: oahuActionHref(row) };
}

/** A monster for the group parts. */
export function oahuGroupMonster(battle: OahuBattle): (row: number) => GroupMonster | undefined {
  return (row) => {
    if (row <= 0 || row >= battle.monsters.rows || !battle.monsters.get(row, 'name')) return undefined;
    const name = battle.monsterName(row);
    return { name, sub: `Lv${battle.monsters.get(row, 'level')}`, icon: oahuMonsterIcon(battle, row) };
  };
}

export function OahuMonsterPicker({ battle, current, title = 'モンスターを選ぶ', onPick, onClose }: {
  battle: OahuBattle; current: number; title?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => battle.monsterList().map((m) => ({ id: m.id, name: m.name, sub: `#${m.id} Lv${m.level}`, icon: oahuMonsterIcon(battle, m.id, true) })), [battle]);
  return <GridPicker title={title} entries={entries} current={current} onPick={onPick} onClose={onClose} />;
}

export function OahuItemPicker({ battle, current, title = 'アイテムを選ぶ', unavailable, onPick, onClose }: {
  battle: OahuBattle; current: number; title?: string; unavailable?: (it: OahuItem) => string | null; onPick: (id: number) => void; onClose: () => void;
}): ReactNode {
  const entries = battle.items.items.map((it) => ({
    id: it.id, name: it.name, icon: oahuItemIcon(battle, it, true), sub: `${it.price} G`, title: `#${it.id} ${it.category}`, unavailable: unavailable?.(it) ?? null, category: it.kind,
  }));
  return <GridPicker title={title} entries={entries} current={current} categories={OAHU_ITEM_KIND} placeholder="名前か ID で絞り込み" onPick={onPick} onClose={onClose} />;
}

export function OahuActionPicker({ battle, current, title = 'ワザを選ぶ', onPick, onClose }: {
  battle: OahuBattle; current?: number; title?: string; onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = useMemo(() => {
    const users = battle.skillUsers();
    return battle.actionList().map((a): ActionEntry => {
      const names = (users.get(a.row) ?? []).map((m) => battle.monsterName(m));
      return {
        row: a.row,
        name: a.name,
        kind: OAHU_ACTION_CATEGORY[a.category] ?? `系統 ${a.category}`,
        element: a.element ? OAHU_ELEMENT_NAMES[a.element] ?? String(a.element) : '',
        users: names,
        tags: names.length ? ['skill'] : [],
      };
    });
  }, [battle]);
  return <ActionTablePicker title={title} entries={entries} filters={[['skill', 'モンスターのワザ'], ['all', 'すべて']]} current={current} onPick={onPick} onClose={onClose} />;
}
