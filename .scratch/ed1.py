p='src/editor/place.ts'
s=open(p,encoding='utf-8').read()
def rep(s,a,b):
    assert a in s, a[:60]
    return s.replace(a,b)
s=rep(s,"""import { KIND_SWITCH, SWITCH_PRESETS } from '../game/eventkinds';
""","""import { KIND_SWITCH, SWITCH_PRESETS } from '../game/eventkinds';
import { addFixGroup, FIX_FLAGS_BOSS, newBossRecord, newBossRow } from '../game/boss';
""")
s=rep(s,"""  | { type: 'switchgate'; gate?: number };""","""  | { type: 'switchgate'; gate?: number }
  /** Boss battle (event range of kind 0x31) against `monster` (a new monsterFixGroup row). */
  | { type: 'boss'; monster: number };""")
s=rep(s,"""    case 'switchgate': return s.gate""","""    case 'boss': return 'ボス戦 (範囲に入ると戦闘)';
    case 'switchgate': return s.gate""")
s=rep(s,"""  const needsRow = stamp.type === 'chest' || stamp.type === 'switchgate' ||""","""  const needsRow = stamp.type === 'chest' || stamp.type === 'switchgate' || stamp.type === 'boss' ||""")
s=rep(s,"""    case 'switchgate': {
      const ev = events!;""","""    case 'boss': {
      // section 8 range + EventObject row of kind 0x31 (game/boss.ts) + its own monsterFixGroup row
      const ev = events!;
      const fix = addFixGroup(master, { flags: FIX_FLAGS_BOSS, slots: [{ monster: stamp.monster, count: 0 }] });
      return add(8, newBossRecord(ev.addRow(newBossRow(ev.table.rowSize, fix))));
    }
    case 'switchgate': {
      const ev = events!;""")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/controller.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""        if (placed) st.select({ type: 'rec', section: placed[0], index: placed[1] });
        return;""","""        if (stamp.type === 'boss') st.game.codePatches = ensureBossPatch(st.game.codePatches);
        if (placed) st.select({ type: 'rec', section: placed[0], index: placed[1] });
        return;""")
s=rep(s,"""import { duplicateRecord, placeStamp, type PlaceContext } from './place';""","""import { duplicateRecord, placeStamp, type PlaceContext } from './place';
import { ensureBossPatch } from '../game/boss';""")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/state.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""      mapData: this.game.master.mapData.data.slice(),
""","""      mapData: this.game.master.mapData.data.slice(),
      fix: this.game.master.table(FIX_TABLE).data.slice(),
""")
s=rep(s,"""    this.game.master.restoreTable('mapData.bin', s.mapData);
""","""    this.game.master.restoreTable('mapData.bin', s.mapData);
    this.game.master.restoreTable(FIX_TABLE, s.fix);
""")
s=rep(s,"""  mapData: Uint8Array;
  messages""","""  mapData: Uint8Array;
  /** monsterFixGroup (boss battles). */
  fix: Uint8Array;
  messages""")
s=rep(s,"""import type { MapRef } from '../game/master';
""","""import type { MapRef } from '../game/master';
import { FIX_TABLE } from '../game/boss';
""")
open(p,'w',encoding='utf-8').write(s)
p='src/session.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""'soundData.bin': '音' };""","""'soundData.bin': '音', 'monsterFixGroup.bin': 'ボス戦の敵 (固定の組)' };""")
open(p,'w',encoding='utf-8').write(s)
