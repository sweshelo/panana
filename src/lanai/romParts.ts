// Every kind of record the ROM's stages place, as parts for any map (the add panel's "ROM のギミック"): one sample of
// each section / kind / first action and, for exits, each 3D look over the maps of all the ROM's contents.
// The copy is a record as the sample's and a new EventObject row like its own, with what names the
// sample's content left out (mapedit.ts lanaiRomTemplate): its destination, its lines (copied as new lines of the
// group), its rows of other tables. Left out of the catalog: the script (0x2D, the sample's CRO does what it does),
// the chests (their contents are rows of the content: eventParts.ts makes them) and the world map's records.
import { parseLanaiMessage, lanaiText } from './message';
import { LANAI_ACTION_NONE, LANAI_ACTION_SCRIPT, LANAI_ACTIONS } from './actions';
import { lanaiContents } from './contents';
import { lanaiMaps, lanaiExitKind, LANAI_EVENT_ACTIONS, LANAI_EVENT_ARGS, LANAI_EVENT_ROW } from './maps';
import { lanaiCharaKind, lanaiCharaObject } from './mapObjects';
import { talkColumns, TALK_SPEAKER } from './talk';
import type { LanaiSession } from './session';
import { u32 } from '../util/bytes';

/** EventObject +0x5A: the look. */
const EO_LOOK = 0x5a;
/** The sections whose records the catalog takes (1 floor gimmicks, 3 exits, 5 characters / objects, 8 ranges, 9 points). */
const ROM_PART_SECTIONS = [1, 3, 5, 8, 9] as const;
/** The record's EventObject row (+0x04 of sections 3 / 5 / 8; map.md §5). */
const EVENT_FIELD = 4;
const HAS_EVENT: readonly number[] = [3, 5, 8];
const LANAI_ACTION_TO_WORLD = 0x8000000d;

export interface LanaiRomPart {
  section: number;
  kind: number;
  /** The first action of its EventObject row (-1: the record has none). */
  action: number;
  /** EventObject +0x5A: a distinct 3D appearance for an exit (0 uses the kind's default). */
  look: number;
  /** The sample's record (its EventObject row is the sample's: replaced when placed). */
  raw: Uint8Array;
  /** The sample's EventObject row (100 bytes), or null. */
  event: Uint8Array | null;
  /** The lines its actions name (by stage 0〜2 and argument): the text form of message.ts and the speaker kind. */
  lines: { stage: number; arg: number; text: string; speaker: number }[];
  /** A character (section 5 kinds 0〜2): its MapChara row's kind and model (a MapObject or MonsterDesign row). */
  chara: { kind: number; model: number } | null;
  /** How many records of the ROM are of this combination, and where the sample is ("12: D01001F01"). */
  count: number;
  source: string;
}

export const romPartKey = (section: number, kind: number, action: number, look?: number): string =>
  `${section}/${kind}/${action >>> 0}${look === undefined ? '' : `/${look}`}`;

/** The kind a record is told by in its section (the exit kind of section 3, the floor's of 1, else +0x00). */
export const lanaiRecKind = (section: number, raw: Uint8Array): number =>
  section === 3 ? lanaiExitKind(raw) : section === 1 ? raw[0x0d]! : u32(raw, 0);

const cache = new WeakMap<LanaiSession, Promise<LanaiRomPart[]>>();

/** The catalog (read once per session, from the contents of the ROM; the stages added in the editor are not read). */
export function lanaiRomParts(session: LanaiSession): Promise<LanaiRomPart[]> {
  let p = cache.get(session);
  if (!p) {
    p = readRomParts(session);
    p.catch(() => cache.delete(session));
    cache.set(session, p);
  }
  return p;
}

async function readRomParts(session: LanaiSession): Promise<LanaiRomPart[]> {
  const out = new Map<string, LanaiRomPart>();
  for (const c of lanaiContents(session)) {
    if (session.createdFiles.has(c.archive.toUpperCase())) continue;
    let maps;
    try {
      maps = await lanaiMaps(session, c);
    } catch {
      continue;
    }
    const mapChara = maps.contentTable('MapChara');
    for (const m of maps.maps) {
      if (m.world) continue;
      const events = maps.eventTable(m.dungeon);
      const talk = maps.talkTable(m.dungeon);
      const message = talk ? talkColumns({ table: talk })?.message : undefined;
      const doc = maps.doc(m);
      for (const section of ROM_PART_SECTIONS)
        for (const r of doc.recs[section] ?? []) {
          const ev = HAS_EVENT.includes(section) ? u32(r.raw, EVENT_FIELD) : 0;
          const has = !!ev && !!events && ev < events.rows;
          const action = has ? events!.u32(ev, LANAI_EVENT_ACTIONS[0]) : -1;
          // a script is the sample's CRO; 0x0D moves to a world map's entrance, which the destination picker does not list
          if (action === LANAI_ACTION_SCRIPT || action === LANAI_ACTION_TO_WORLD) continue;
          const kind = lanaiRecKind(section, r.raw);
          const look = has ? events!.u16(ev, EO_LOOK) : 0;
          // An exit's model changes with its EventObject look. Keep each appearance selectable.
          const key = romPartKey(section, kind, action, section === 3 ? look : undefined);
          const seen = out.get(key);
          if (seen) {
            seen.count++;
            continue;
          }
          const lines: LanaiRomPart['lines'] = [];
          if (has && talk && message !== undefined)
            LANAI_EVENT_ACTIONS.forEach((offset, stage) => {
              const info = LANAI_ACTIONS[events!.u32(ev, offset)];
              for (const arg of info?.talk ?? []) {
                const v = events!.u32(ev, offset + 4 + 4 * arg);
                if ((info!.zeroIsNone && !v) || v >= talk.rows || !talk.isString(v, message)) continue;
                const text = lanaiText(parseLanaiMessage(talk.data, talk.u32(v, message)).tokens);
                lines.push({ stage, arg, text, speaker: talk.u8(v, TALK_SPEAKER) });
              }
            });
          const charaKind = section === 5 && kind <= 2 && look ? lanaiCharaKind(mapChara, look) : -1;
          const model = charaKind >= 0 ? lanaiCharaObject(mapChara, look) : 0;
          out.set(key, {
            section,
            kind,
            action,
            look,
            raw: r.raw.slice(),
            event: has ? events!.row(ev).slice(0, LANAI_EVENT_ROW) : null,
            lines,
            chara: model ? { kind: charaKind, model } : null,
            count: 1,
            source: `${c.index}: ${m.name}`,
          });
        }
    }
  }
  return [...out.values()];
}

/** Whether an argument of an action names something of the sample's content (cleared in the copy). */
export function romArgIsLocal(action: number, arg: number): boolean {
  const info = LANAI_ACTIONS[action];
  if (!info) return false;
  if (info.talk?.includes(arg)) return true;
  if (info.pick?.[arg] === 'monsterGroupRow' || info.pick?.[arg] === 'shop') return true;
  const label = info.args?.[arg] ?? '';
  return /行き先|イベント番号|TreasureGroup|MonsterGroup|キャラ \(区画 5/u.test(label);
}

/**
 * The sample's EventObject row as a new record of another content takes it: the appear / disappear conditions cleared
 * (they name the sample's flags and rows), the arguments that name the sample's content cleared (romArgIsLocal), a
 * content to clear set to `content`. The state slot and the look are set when it is placed.
 */
export function romEventRow(part: LanaiRomPart, content: number): Uint8Array | null {
  if (!part.event) return null;
  const row = part.event.slice();
  const v = new DataView(row.buffer);
  // +0x00〜+0x0F the conditions' values, +0x5F / +0x60 their kinds (map.md §7.1)
  for (let o = 0; o < 0x10; o += 4) v.setUint32(o, 0, true);
  row[0x5f] = 0;
  row[0x60] = 0;
  for (const offset of LANAI_EVENT_ACTIONS) {
    const action = v.getUint32(offset, true);
    if (action === LANAI_ACTION_NONE || !action) continue;
    for (let arg = 0; arg < LANAI_EVENT_ARGS; arg++) {
      const at = offset + 4 + 4 * arg;
      if (LANAI_ACTIONS[action]?.pick?.[arg] === 'content') v.setUint32(at, content, true);
      else if (romArgIsLocal(action, arg)) v.setUint32(at, 0, true);
    }
  }
  return row;
}
