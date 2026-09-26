// Gimmick templates: one existing record (+ its EventObject row) per kind of object found in the game,
// to copy into another map. A copy gets its own EventObject row and state slot.
import type { Game } from './game';
import { mapTitle } from './names';
import { isIndoor, objectCategory, recordObjectRow, OBJ_INVISIBLE } from './objects';
import { P3, pointKindLabel } from './sections';
import { u32 } from '../util/bytes';

export interface GimmickTemplate {
  key: string;
  section: 3 | 5;
  /** mapObject row of its model (0 = none / invisible). */
  objectRow: number;
  label: string;
  source: string;
  dungeon: number;
  /** Section record bytes (x / y are replaced when placed). */
  record: Uint8Array;
  /** EventObject row bytes (null when the record has none). */
  event: Uint8Array | null;
}

/** Templates, those of `preferDungeon` first (their event rows fit that dungeon best). */
export async function gimmickTemplates(game: Game, preferDungeon: number): Promise<GimmickTemplate[]> {
  const maps = [...game.editableMaps()].sort((a, b) => (a.dungeon === preferDungeon ? -1 : 0) - (b.dungeon === preferDungeon ? -1 : 0));
  const out = new Map<string, GimmickTemplate>();
  for (const info of maps) {
    const events = await game.eventTable(info.dungeon);
    if (!events) continue;
    const doc = game.doc(info);
    const ctx = { master: game.master, events, indoor: isIndoor(doc) };
    for (const section of [5, 3] as const) {
      for (const rec of doc.recs[section] ?? []) {
        const r = rec.raw;
        let evRow: number;
        let label: string;
        let key: string;
        const objectRow = recordObjectRow(section, rec, ctx);
        if (section === 5) {
          if (r[8] === 0) continue; // characters
          evRow = u32(r, 0);
          if (!events.has(evRow)) continue;
          key = `5/${objectRow}/${r[8]}/${events.kind(evRow)}`;
          label = objectRow && objectRow !== OBJ_INVISIBLE ? objectCategory(objectRow) : `見えないギミック (種類 ${events.kind(evRow)})`;
        } else {
          evRow = P3.door(r);
          if (evRow && !events.has(evRow)) continue;
          key = `3/${objectRow}/${P3.kind(r)}`;
          label = `${pointKindLabel(P3.kind(r))}${objectRow && objectRow !== OBJ_INVISIBLE ? ` (${objectCategory(objectRow)})` : ''}`;
        }
        if (out.has(key)) continue;
        out.set(key, {
          key,
          section,
          objectRow: objectRow === OBJ_INVISIBLE ? 0 : objectRow,
          label,
          source: mapTitle(info, game.code.maps, game.master),
          dungeon: info.dungeon,
          record: r.slice(),
          event: evRow && events.has(evRow) ? events.table.row(evRow).slice() : null,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.section - b.section || a.label.localeCompare(b.label, 'ja'));
}
