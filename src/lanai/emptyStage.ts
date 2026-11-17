// An empty stage to build from nothing (lanai-custom-stages 3ds/research/stage-intro.md): content 99 「あみだクジ（仮）」,
// an unused stage of one 3×3 room (tileset MapPartsCaveA), no events, no messages, no monsters placed, copied as a new
// content, with a gate added as the shipped stages have one so that the game's opening plays:
// - the room's bottom middle tile becomes the opening and a corridor of two tiles and a dead end follows it (tiles
//   copied from the start of content 1, CaveA as well: 3×3 room, the gate on its bottom middle, 11 / 11 / 43 below);
// - the start point (MapGroup +0x18, a record of section 3) moves onto the opening as a gate: content 1's record (kind
//   12, facing 1, …) with the point's ID kept, naming a new EventObject row "opened from outside" (0x80000017, row 0
//   otherwise, a state slot of its own: the shipped gates' rows are that);
// - the start group gets `on intro(1) {}` (the walk in through the gate, the stage's name, the gate closing).
// The bytes are read from the person's ROM at the time; nothing of the ROM is in Panana.
import { cloneLanaiContent, LANAI_EMPTY_SCRIPT_CONTENT } from './stageEdit';
import { lanaiContents } from './contents';
import { lanaiMaps, type LanaiMaps } from './maps';
import type { LanaiSession } from './session';
import type { MapDoc, Rec, Tile } from '../game/sections';
import { u32, w32 } from '../util/bytes';

/** The stage whose start gives the gate's tiles and record (same tileset as content 99). */
export const LANAI_GATE_DONOR = 1;
/** The action of a gate's row: a door opened from outside (actions.ts 0x17). */
const ACTION_OUTSIDE_DOOR = 0x80000017;
/** Kind (+0x15) of a section 3 record that is a gate. */
const GATE_KIND = 12;
/** Tiles below the gate in the donor: the corridor and its dead end. */
const CORRIDOR = 3;

const cell = (t: { x: number; y: number }): string => `${t.x},${t.y}`;
const copyTile = (t: Tile, x: number, y: number): Tile => ({ ...t, x, y, raw: t.raw?.slice() });

interface Start {
  maps: LanaiMaps;
  doc: MapDoc;
  rec: Rec;
}
async function startOf(
  s: LanaiSession,
  index: number,
  original: boolean,
): Promise<Start & { info: ReturnType<LanaiMaps['map']> }> {
  const c = lanaiContents(s)[index];
  if (!c) throw new Error(`コンテンツ ${index} がありません`);
  const maps = await lanaiMaps(s, c);
  const g = maps.groups[1];
  const info = g && maps.map(g.firstMap);
  if (!g || !info) throw new Error(`コンテンツ ${index} の MapGroup 1 に最初のマップがありません`);
  const doc = original ? maps.originalDoc(info) : maps.doc(info);
  const rec = (doc.recs[3] ?? []).find((r) => u32(r.raw, 0) === g.firstPoint);
  if (!rec) throw new Error(`コンテンツ ${index} の開始地点が出入口 (区画 3) にありません`);
  return { maps, doc, rec, info };
}

/**
 * Adds an empty stage (a copy of content 99 with a gate at its start and the game's opening) titled `title`.
 * Returns the new content's number.
 */
export async function addLanaiEmptyStage(s: LanaiSession, title: string): Promise<number> {
  const template = lanaiContents(s)[LANAI_EMPTY_SCRIPT_CONTENT];
  if (!template) throw new Error(`空のステージのひな形 (コンテンツ ${LANAI_EMPTY_SCRIPT_CONTENT}) がありません`);
  // the donor first: nothing is added when it cannot give the gate
  const donor = await startOf(s, LANAI_GATE_DONOR, true);
  if (donor.rec.raw[0x15] !== GATE_KIND) throw new Error(`コンテンツ ${LANAI_GATE_DONOR} の開始地点が門ではありません`);
  const dTiles = new Map(donor.doc.tiles.map((t) => [cell(t), t]));
  const below = Array.from({ length: CORRIDOR + 1 }, (_, k) => dTiles.get(`${donor.rec.x},${donor.rec.y + k}`));
  if (below.some((t) => !t)) throw new Error(`コンテンツ ${LANAI_GATE_DONOR} の門の下の通路が見つかりません`);

  const index = await cloneLanaiContent(s, template, title, { script: 'empty', intro: false, resetStage: true });
  try {
    const { maps, doc, rec, info } = await startOf(s, index, false);
    const a = maps.tileSource(info!, doc),
      b = donor.maps.tileSource(donor.info!, donor.doc);
    if (a.partsName !== b.partsName) throw new Error(`タイルセットが違います (${a.partsName} / ${b.partsName})`);
    // the gate on the bottom middle of the start's column; the corridor below it must be free
    const column = doc.tiles.filter((t) => t.x === rec.x);
    if (!column.length) throw new Error('開始地点の列にタイルがありません');
    const gy = Math.max(...column.map((t) => t.y));
    const used = new Set(doc.tiles.map(cell));
    for (let k = 1; k <= CORRIDOR; k++) if (used.has(`${rec.x},${gy + k}`)) throw new Error('門の下にタイルがあります');
    const next = structuredClone(doc);
    next.tiles = next.tiles.filter((t) => !(t.x === rec.x && t.y === gy));
    below.forEach((t, k) => next.tiles.push(copyTile(t!, rec.x, gy + k)));
    // the start point becomes the gate: the donor's record with the point's ID and a door row of its own
    const row = maps.addNewEventRow(1, ACTION_OUTSIDE_DOOR, 0);
    const raw = donor.rec.raw.slice();
    w32(raw, 0, u32(rec.raw, 0));
    w32(raw, 4, row);
    const at = next.recs[3]!.findIndex((r) => u32(r.raw, 0) === u32(rec.raw, 0));
    next.recs[3]![at] = { raw, x: rec.x, y: gy };
    maps.setDoc(info!, next);
    s.setStageScriptDoc(lanaiContents(s)[index]!.archive, {
      vars: [],
      functions: [],
      bindings: [{ trigger: 'intro', group: 1, row: 0, fn: '' }],
    });
    s.edited();
    return index;
  } catch (e) {
    throw new Error(`コンテンツ ${index} を追加しましたが、門を置けませんでした: ${(e as Error).message}`);
  }
}
