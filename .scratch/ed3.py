def rep(s,a,b):
    assert a in s, a[:70]
    return s.replace(a,b)
p='src/editor/validate.ts'
s=open(p,encoding='utf-8').read()
s=rep(s,"""    for (const [slot, rows] of slots) {""","""    // boss battles (game/boss.ts)
    for (const k of EVENT_SECTIONS) {
      (doc.recs[k] ?? []).forEach((r, i) => {
        const row = recEventRow(k, r.raw);
        if (!events.has(row) || events.kind(row) !== KIND_BOSS) return;
        const target: Selection = { type: 'rec', section: k, index: i };
        const name = `ボス戦 (イベント #${row})`;
        if (k !== 8) out.push({ level: 'error', msg: `${name} は区画 8 (イベントの範囲) に置いてください`, target, key: `bosssec/${row}` });
        if (!game.codePatches.some((p) => p.id === BOSS_PATCH_ID && p.enabled))
          out.push({ level: 'error', msg: `${name} がありますが、コードのパッチ「ボス戦」が入っていません`, target, key: `bosspatch/${row}` });
        if (row >= 0x2000) out.push({ level: 'error', msg: `${name}: 行番号は 0x2000 未満にしてください`, target, key: `bossrow/${row}` });
        readStages(events.table.row(row)).forEach((s, n) => {
          const g = fixGroup(game.master, s.fix);
          if (!g) out.push({ level: 'error', msg: `${name} の段階 ${n + 1}: monsterFixGroup の行 ${s.fix} がありません`, target, key: `bossfix/${row}/${n}` });
          else if (!g.slots.length) out.push({ level: 'error', msg: `${name} の段階 ${n + 1}: 敵がいません`, target, key: `bossnone/${row}/${n}` });
          for (const id of s.messages)
            if (id && game.master.message(id) === undefined)
              out.push({ level: 'warn', msg: `${name} の段階 ${n + 1}: メッセージ ${hex8(id)} が見つかりません`, target, key: `bossmsg/${row}/${n}/${id}` });
        });
      });
    }
    for (const [slot, rows] of slots) {""")
s=rep(s,"""import { GATE_KINDS, KIND_SWITCH } from '../game/eventkinds';
""","""import { GATE_KINDS, KIND_SWITCH } from '../game/eventkinds';
import { BOSS_PATCH_ID, fixGroup, KIND_BOSS, readStages } from '../game/boss';
""")
open(p,'w',encoding='utf-8').write(s)

p='src/editor/addpanel.tsx'
s=open(p,encoding='utf-8').read()
s=rep(s,"""      {active && <div className="place-hint">""","""      <h4>ボス戦</h4>
      <BossStamp editor={editor} active={active?.type === 'boss'} disabled={room < 1} use={use} />
      {active && <div className="place-hint">""")
s=rep(s,"""/** A collapsible grid of thumbnails;""","""/** The boss battle stamp: the monster to fight (it can be changed and more added in the inspector). */
function BossStamp({ editor, active, disabled, use }: { editor: MapEditor; active: boolean; disabled: boolean; use: (s: Stamp) => void }): ReactNode {
  const book = editor.session.book;
  const [monster, setMonster] = useState(() => book?.monsters.find((m) => m.boss)?.row ?? book?.monsters[0]?.row ?? 1);
  return (
    <>
      <div className="row">
        <select value={monster} title="戦う敵" onChange={(e) => {
          const m = Number(e.target.value);
          setMonster(m);
          if (active) use({ type: 'boss', monster: m });
        }}>
          {(book?.monsters ?? []).map((m) => <option key={m.row} value={m.row}>{`${m.name} Lv${m.level} (#${m.row})`}</option>)}
          {!book && <option value={monster}>{`#${monster}`}</option>}
        </select>
        <button className={active ? 'active' : ''} disabled={disabled} onClick={() => use({ type: 'boss', monster })}>ボス戦を置く</button>
      </div>
      <div className="muted small">
        イベントの範囲 (区画 8) に入ると、メッセージのあと決まった敵と戦います。一度きり・何度でも・勝つたびに強くなる (段階) を右ペインで選べます。
        書き出すと、そのためのコードのパッチ「ボス戦」も code.ips に入ります。
      </div>
    </>
  );
}

/** A collapsible grid of thumbnails;""")
open(p,'w',encoding='utf-8').write(s)
