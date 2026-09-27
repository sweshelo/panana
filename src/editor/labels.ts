// Human-friendly labels shared by the inspector, the header and the validation messages.
import type { Game } from '../game/game';
import { mapTitle } from '../game/names';
import { P3, pointKindLabel, type MapDoc } from '../game/sections';
import { hex8 } from '../util/bytes';

export function mapLabel(game: Game, hash: number): string {
  const info = game.code.byHash(hash);
  if (info) return mapTitle(info, game.code.maps, game.master);
  const w = game.code.world(hash);
  return w ? worldLabel(w.code) : hex8(hash);
}

export const worldLabel = (code: string): string => `ワールドマップ ${code}`;
/** #/world/W01 or #/world/W01.XXXXXXXX (an entrance ID). */
export const worldHref = (code: string, id?: number): string => `#/world/${code}${id === undefined ? '' : `.${hex8(id)}`}`;

/** "上り階段 (14, 14)" */
export function pointLabel(raw: Uint8Array, x: number, y: number): string {
  return `${pointKindLabel(P3.kind(raw))} (${x}, ${y})`;
}

/** Label of a section 3 point of a map, found by its ID. */
export function pointLabelById(doc: MapDoc | null, id: number): string | null {
  const p = doc?.recs[3]?.find((r) => P3.id(r.raw) === id);
  return p ? pointLabel(p.raw, p.x, p.y) : null;
}
