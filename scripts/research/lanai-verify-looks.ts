// A stage to check in the game what the map page's new event parts assume (eventParts.ts, LookField.tsx, the switch
// trigger and openDoor of eventScript.ts), written as a LayeredFS MOD zip for lanai-custom-stages (HTTP) or Azahar.
// A clone of content 1 whose D01001B01 is entered from the south through the open door 3 at (7, 14) into a small room;
// its doorway (7, 12) leads by a corridor to the doorway (7, 9) of the large room (3〜10, 4〜9).
// Checked by the user in Azahar (2026-11-14):
// - 1st: a button whose look is a prop runs its function and lifts when stepped off (on button); a monster of a new
//   MapChara row is drawn, talked to, and battle() fights.
// - 2nd: on switch stays down (then stepping on it again darkened the lower screen: fixed with
//   GimmickKeepPushButtonCommon::GetMenuMask).
// - 3rd: on switch stays down and does nothing more; an NPC of a new MapChara row is drawn and talked to; new doors
//   (kind 12 on a doorway tile, looks 0 and #53) block the way, and SetDoorOpenFlag takes the block away but does not
//   show the door opening. (6, 13) was outside the small room.
// Left to see (this version): openDoor() as the game shows it (DOOR_SHOW: the camera to each door, the unlocking
// sound, the opening sound and motion 0x80000073, then the jingle and the camera back), on both looks.
//   bun scripts/research/lanai-verify-looks.ts [out.zip]   (default out/lanai-verify-looks.zip)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tileAt } from '../../src/editor/model';
import { lanaiContents } from '../../src/lanai/contents';
import { LANAI_NEW_EVENT_CATEGORY } from '../../src/lanai/eventParts';
import { lanaiEditState, lanaiRecEventRow, type LanaiTemplate } from '../../src/lanai/mapedit';
import { lanaiMaps } from '../../src/lanai/maps';
import { LanaiSession } from '../../src/lanai/session';
import { cloneLanaiContent } from '../../src/lanai/stageEdit';
import { checkStageScript } from '../../src/lanai/stageScript';
import { openImages } from '../../src/rom/dump';
import { u32 } from '../../src/util/bytes';
import { LANAI_BASE, LANAI_UPDATE } from '../../test/env';

const OUT = process.argv[2] ?? 'out/lanai-verify-looks.zip';
const MAP = 'D01001B01';

const dump = await openImages(
  [Bun.file(LANAI_BASE), Bun.file(LANAI_UPDATE)],
  (f) => (f as unknown as { name: string }).name,
);
const s = await LanaiSession.open(dump, { fresh: true });
const index = await cloneLanaiContent(s, lanaiContents(s)[1]!, '見た目の検証', { script: 'empty' });
const c = lanaiContents(s)[index]!;
const maps = await lanaiMaps(s, c);
const st = lanaiEditState(maps);
const info = maps.mapByName(MAP)!;
st.open(info);
const events = maps.eventTable(info.dungeon)!;

const fresh = st.templates().filter((t) => t.category === LANAI_NEW_EVENT_CATEGORY);
const part = (f: (t: LanaiTemplate) => boolean): LanaiTemplate => fresh.find(f)!;
const report: string[] = [];
const place = (t: LanaiTemplate, x: number, y: number, what: string): number => {
  const tile = tileAt(st.current!, x, y);
  let at: [number, number] = [0, 0];
  st.edit((d) => {
    at = st.placeStamp(d, { type: 'template', t }, x, y);
  });
  const raw = st.current!.recs[at[0]]![at[1]]!.raw;
  const ev = lanaiRecEventRow(at[0], raw);
  const facing = at[0] === 3 ? `、向き ${raw[0x14]}` : '';
  report.push(`(${x}, ${y}) イベント ${ev}: ${what} [タイル ${tile?.kind} 回転 ${tile?.rot}${facing}]`);
  return ev;
};

// the small room: a button that stays down; its doorway and the large room's: a new door each
const keep = place(
  part((t) => t.section === 5 && u32(t.raw, 0) === 4),
  8,
  13,
  'ボタン (on switch: 押したまま、見た目 #75) → 扉 A・B を順に開ける',
);
events.setU16(keep, 0x5a, 75);
const door = part((t) => t.section === 3);
const doorA = place(door, 7, 12, '扉 A (見た目 0)');
const doorB = place(door, 7, 9, '扉 B (見た目 MapObject #53)');
events.setU16(doorB, 0x5a, 53);

const g = info.dungeon;
const source = `
function open_doors() {
  follow(0)
  openDoor(${doorA})
  openDoor(${doorB})
  follow(1)
}
on switch(${g}, ${keep}) open_doors
`;
s.setStageScript(c.archive, source);
const check = await checkStageScript(s, c, source);
if (check.problems.length) throw new Error(check.problems.join('\n'));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, await s.modZip());
console.log(`${OUT}: コンテンツ ${index}「見た目の検証」 (${c.archive})、${MAP}`);
for (const line of report) console.log(`  ${line}`);
console.log(`確かめること (ボタンを踏んだあと):
  1. カメラが扉 A へ → 解錠の音 → 開く音と扉 A が開くアニメ
  2. カメラが扉 B へ → 解錠の音 → 開く音と扉 B が開くアニメ
  3. ギミックの音 (BGM が一度止まる) → カメラがパーティへ戻る
  4. 扉 A・B を通れる`);
for (const n of check.notes) console.log(`  メモ: ${n}`);
