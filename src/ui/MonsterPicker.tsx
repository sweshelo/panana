// Picking an RPG2 monster from their photos (encounter groups, a monster's next form, the monsters of a preview).
import type { ReactNode } from 'react';
import type { MonsterBook } from '../game/monsters';
import { monsterRef } from '../pages/monsters';
import type { Session } from '../session';
import { GridPicker, type PickerChoice } from './GridPicker';
import { Photo } from './Photo';

export type { PickerChoice };

/** A section of the picker: a heading and its monster rows (e.g. "このワザを持つモンスター"). */
export interface MonsterGroup {
  label: string;
  rows: number[];
}

/**
 * Pick a monster from the photos (with the row and the level: forms of a boss share their name). `groups` come first,
 * each under its heading, then every monster under "すべて"; `choices` are other values before them.
 */
export function MonsterPicker({ session, book, current, title = 'モンスターを選ぶ', groups = [], choices = [], onPick, onClose }: {
  session: Session; book: MonsterBook; current: number; title?: string; groups?: MonsterGroup[]; choices?: PickerChoice[];
  onPick: (row: number) => void; onClose: () => void;
}): ReactNode {
  const entries = book.monsters.map((m) => ({
    id: m.row, name: m.name, sub: `#${m.row} Lv${m.level}`, icon: <Photo model={monsterRef(session.game, book, m)} className="photo photo-lg" />,
  }));
  return (
    <GridPicker title={title} entries={entries} current={current} sections={groups.map((g) => ({ label: g.label, ids: g.rows }))} choices={choices}
      placeholder="名前で絞り込み" onPick={onPick} onClose={onClose} />
  );
}
