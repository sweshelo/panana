// Human-friendly labels shared by the inspector, the header and the validation messages.
import type { Game } from '../game/game';
import { mapShortTitle, mapTitle } from '../game/names';
import { P3, pointKindLabel, type MapDoc } from '../game/sections';
import { hex8 } from '../util/bytes';
import { h } from './dom';

export function mapLabel(game: Game, hash: number): string {
  const info = game.code.byHash(hash);
  if (info) return mapTitle(info, game.code.maps, game.master);
  const w = game.code.world(hash);
  return w ? worldLabel(w.code) : hex8(hash);
}

export const worldLabel = (code: string): string => `ワールドマップ ${code}`;
/** #/world/W01 or #/world/W01.XXXXXXXX (an entrance ID). */
export const worldHref = (code: string, id?: number): string => `#/world/${code}${id === undefined ? '' : `.${hex8(id)}`}`;

/** <select> of maps grouped by dungeon, with friendly names (the code stays in the title). */
export function fillMapSelect(select: HTMLSelectElement, game: Game, selected: number, withNone = false, full = false): void {
  if (withNone) select.append(h('option', { value: 0, selected: selected === 0 }, '(なし)'));
  const groups = new Map<number, HTMLOptGroupElement>();
  const all = game.code.maps;
  for (const m of game.editableMaps()) {
    let g = groups.get(m.dungeon);
    if (!g) {
      g = h('optgroup', { label: `${game.master.dungeonName(m.dungeon) || m.dungeonCode}  (${m.dungeonCode})` });
      groups.set(m.dungeon, g);
      select.append(g);
    }
    g.append(h('option', { value: m.hash, selected: m.hash === selected, title: m.name }, full ? `${mapTitle(m, all, game.master)}  ${m.name}` : mapShortTitle(m, all)));
  }
  const worlds = game.worldMaps();
  if (worlds.length) {
    const g = h('optgroup', { label: 'ワールドマップ' });
    for (const w of worlds) g.append(h('option', { value: w.hash, selected: w.hash === selected, title: hex8(w.hash) }, worldLabel(w.code)));
    select.append(g);
  }
  if (selected && !game.code.byHash(selected) && !worlds.some((w) => w.hash === selected)) select.append(h('option', { value: selected, selected: true }, `${hex8(selected)} (表にないマップ)`));
}

/** "上り階段 (14, 14)" */
export function pointLabel(raw: Uint8Array, x: number, y: number): string {
  return `${pointKindLabel(P3.kind(raw))} (${x}, ${y})`;
}

/** Label of a section 3 point of a map, found by its ID. */
export function pointLabelById(doc: MapDoc | null, id: number): string | null {
  const p = doc?.recs[3]?.find((r) => P3.id(r.raw) === id);
  return p ? pointLabel(p.raw, p.x, p.y) : null;
}
