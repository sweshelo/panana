// Picking an RPG2 mapObject row (the model of a world map entrance, +0x18) from photos of the models, the world
// map's own rows (237..262) and the rows the entrances already use first.
import type { ReactNode } from 'react';
import { loadObjectModels, objKey } from '../cgfx/loader';
import type { Game } from '../game/game';
import { objectCategory } from '../game/objects';
import type { ModelRef } from '../pages/modelview';
import { GridPicker } from './GridPicker';
import { Photo } from './Photo';

/** The model of a mapObject row as a photo / viewer reference (null when the row has no model). */
export function objectModelRef(game: Game, row: number): ModelRef | null {
  const ref = game.master.objectModel(row);
  if (!ref) return null;
  return {
    key: `kahara-object/${ref.archive.toString(16)}/${ref.entry.toString(16)}`,
    load: async () => {
      const set = (await loadObjectModels(game, [ref])).get(objKey(ref.archive, ref.entry));
      return set?.models.size ? { set, hash: ref.entry } : null;
    },
  };
}

const CATEGORIES = ['ワールドマップ', '町の建物', '置物', '屋外の置物', '屋内の置物', '壁の置物', 'そのほか'];

export function ObjectPicker({ game, title = 'モデルを選ぶ', current, used = [], zero, onPick, onClose }: {
  game: Game;
  title?: string;
  current?: number;
  /** Rows to show first (e.g. the models of the other entrances). */
  used?: number[];
  /** The choice of row 0 (e.g. "入口の種類のモデル"), if it can be picked. */
  zero?: string;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const { master } = game;
  const entries = [];
  for (let row = 1; row < master.mapObject.rows; row++) {
    const model = objectModelRef(game, row);
    if (!model) continue;
    const cat = objectCategory(row);
    const c = CATEGORIES.indexOf(cat);
    entries.push({ id: row, name: `#${row}`, icon: <Photo model={model} className="photo photo-lg" />, sub: cat, title: `mapObject #${row} (${cat})`, category: (c < 0 ? CATEGORIES.length - 1 : c) + 1 });
  }
  const ids = new Set(entries.map((e) => e.id));
  const usedRows = [...new Set(used)].filter((r) => ids.has(r)).sort((a, b) => a - b);
  return (
    <GridPicker title={title} entries={entries} current={current}
      sections={usedRows.length ? [{ label: 'ほかの入口が使っているモデル', ids: usedRows }] : []}
      choices={zero ? [{ value: 0, label: zero }] : []}
      categories={Object.fromEntries(CATEGORIES.map((n, i) => [i + 1, n]))}
      onPick={onPick} onClose={onClose} />
  );
}
