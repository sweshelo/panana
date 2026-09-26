// Where messages are shown in the field: the EventObject rows whose kind takes message IDs (signs, characters;
// elpulse docs/events.md §4 / §6), with the maps that place them.
import type { MapInfo } from './codebin';
import { EVENT_KINDS } from './eventkinds';
import type { EventTable } from './events';
import type { Game } from './game';
import { LAYOUTS, P3, recCellPos, type MapDoc, type Rec } from './sections';
import { u32 } from '../util/bytes';

/** EventObject row a record refers to (0 = none); same as the editor's eventRowOf. */
function eventRow(section: number, rec: Rec): number {
  if (section === 3) return P3.door(rec.raw);
  if (section === 4 || section === 5 || section === 8) return u32(rec.raw, 0);
  return 0;
}

export interface MessagePlace {
  map: MapInfo;
  section: number;
  x: number;
  y: number;
}

export interface MessageUser {
  dungeon: number;
  row: number;
  kind: number;
  /** Offset -> message ID. */
  slots: { off: number; id: number }[];
  /** Model (+0x46: mapChara / mapObject row). */
  model: number;
  places: MessagePlace[];
}

export const userKey = (u: { dungeon: number; row: number }): string => `${u.dungeon}.${u.row}`;

export async function messageUsers(game: Game, docOf: (m: MapInfo) => MapDoc, events: (d: number) => Promise<EventTable | null>): Promise<MessageUser[]> {
  const maps = new Map<number, MapInfo[]>();
  for (const m of game.editableMaps()) maps.set(m.dungeon, [...(maps.get(m.dungeon) ?? []), m]);
  const out: MessageUser[] = [];
  for (const [dungeon, ms] of [...maps].sort((a, b) => a[0] - b[0])) {
    const ev = await events(dungeon);
    if (!ev) continue;
    const places = new Map<number, MessagePlace[]>();
    for (const m of ms) {
      const doc = docOf(m);
      for (const section of [3, 4, 5, 8])
        for (const rec of doc.recs[section] ?? []) {
          const row = eventRow(section, rec);
          if (!row) continue;
          const [x, y] = recCellPos(rec, LAYOUTS[section]!);
          places.set(row, [...(places.get(row) ?? []), { map: m, section, x, y }]);
        }
    }
    for (let row = 0; row < ev.rows; row++) {
      const kind = ev.kind(row);
      const offs = EVENT_KINDS[kind]?.messages;
      if (!offs) continue;
      const r = ev.table.row(row);
      out.push({ dungeon, row, kind, slots: offs.map((off) => ({ off, id: u32(r, off) })), model: ev.model(row), places: places.get(row) ?? [] });
    }
  }
  return out;
}

/** Message ID -> the rows that use it. */
export function usersById(users: MessageUser[]): Map<number, MessageUser[]> {
  const out = new Map<number, MessageUser[]>();
  for (const u of users)
    for (const id of new Set(u.slots.map((s) => s.id)))
      if (id) out.set(id, [...(out.get(id) ?? []), u]);
  return out;
}
