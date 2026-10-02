// Picking an RPG2 item from their photos (the shop list, the chest contents of the map editor, a monster's drops).
import type { ReactNode } from 'react';
import type { Game } from '../game/game';
import { ITEM_CATEGORY, type Item, type ItemBook } from '../game/items';
import { itemRef } from '../pages/items';
import { GridPicker } from './GridPicker';
import { Photo } from './Photo';

/**
 * A dialog with every item as a photo, filtered by name, ID or category. `unavailable` greys out items that
 * cannot be picked (and says why in their tooltip); `current` is highlighted and scrolled into view.
 */
export function ItemPicker({ game, items, title = 'アイテムを選ぶ', current, unavailable, onPick, onClose }: {
  game: Game;
  items: ItemBook;
  title?: string;
  current?: number;
  unavailable?: (it: Item) => string | null;
  onPick: (id: number) => void;
  onClose: () => void;
}): ReactNode {
  const entries = items.items.map((it) => ({
    id: it.id,
    name: it.name,
    icon: <Photo model={itemRef(game, it)} className="photo photo-lg" />,
    sub: it.price ? `${it.price} G` : '0 G',
    title: `#${it.id} ${it.category}${it.price ? `・${it.price} G` : '・買値 0'}`,
    unavailable: unavailable?.(it) ?? null,
    category: it.categoryByte & 0xf,
  }));
  return <GridPicker title={title} entries={entries} current={current} categories={ITEM_CATEGORY} placeholder="名前か ID で絞り込み" onPick={onPick} onClose={onClose} />;
}
