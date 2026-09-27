def rep(s,a,b):
    assert a in s, a[:70]
    return s.replace(a,b)
p='src/game/eventkinds.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""export const KIND_SWITCH = 0x30; // generic switch (elpulse mod/build_code.py)
""","""import { KIND_BOSS } from './boss';

export const KIND_SWITCH = 0x30; // generic switch (elpulse mod/build_code.py)
""")
s=rep(s,"""  [KIND_SWITCH]: { name: '汎用スイッチ (MOD)', note: '踏むと対象の行 (同じマップの扉・門) を開ける。土台の MOD に汎用スイッチの code.ips が要る' },
""","""  [KIND_SWITCH]: { name: '汎用スイッチ (MOD)', note: '踏むと対象の行 (同じマップの扉・門) を開ける。土台の MOD に汎用スイッチの code.ips が要る' },
  [KIND_BOSS]: { name: 'ボス戦 (MOD)', note: '区画 8 の範囲に入ると、メッセージのあと決まった敵と戦う。Panana が code.ips にパッチ「ボス戦」を入れる' },
""")
open(p,'w',encoding='utf-8').write(s)

p='src/game/boss.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""/** The boss patch in the game's patch list (added once; its source is kept up to date). */""","""/** Saved patches with the boss patch's source brought up to date (it is Panana's own, not the user's). */
export function refreshBossPatch(patches: CodePatch[]): CodePatch[] {
  return patches.map((p) => (p.id === BOSS_PATCH_ID ? { ...p, title: BOSS_PATCH_TITLE, source: BOSS_PATCH_SOURCE } : p));
}

/** The boss patch in the game's patch list (added once, enabled; its source is kept up to date). */""")
open(p,'w',encoding='utf-8').write(s)

p='src/session.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""    if (edits.patches) game.codePatches = edits.patches;""","""    if (edits.patches) game.codePatches = refreshBossPatch(edits.patches);""")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/inspector.tsx'
s=open(p,encoding='utf-8').read()
s=rep(s,"""      {(evRow || k === 4 || k === 5 || k === 8) && ev?.has(evRow) ? <EventPanel st={st} row={evRow} /> : null}""","""      {k === 8 && ev?.has(evRow) && ev.kind(evRow) === KIND_BOSS && <BossPanel session={editor.session} row={evRow} />}
      {(evRow || k === 4 || k === 5 || k === 8) && ev?.has(evRow) ? <EventPanel st={st} row={evRow} /> : null}""")
s=rep(s,"""import { EventListDialog, EventPanel } from './events';
""","""import { EventListDialog, EventPanel } from './events';
import { BossPanel } from './boss';
import { KIND_BOSS } from '../game/boss';
""")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/events.tsx'
s=open(p,encoding='utf-8').read()
s=rep(s,"""        <select value={kind} onChange={(e) => apply(() => (ev.table.row(row)[0x4d] = Number(e.target.value)))}>""","""        <select value={kind} onChange={(e) => apply(() => {
          const k = Number(e.target.value);
          ev.table.row(row)[0x4d] = k;
          if (k === KIND_BOSS) game.codePatches = ensureBossPatch(game.codePatches);
        })}>""")
s=rep(s,"""import { EVENT_KINDS, KIND_SWITCH, SCRIPT_LINKS, SWITCH_PRESETS, kindName } from '../game/eventkinds';
""","""import { EVENT_KINDS, KIND_SWITCH, SCRIPT_LINKS, SWITCH_PRESETS, kindName } from '../game/eventkinds';
import { ensureBossPatch, KIND_BOSS } from '../game/boss';
""")
open(p,'w',encoding='utf-8').write(s)
