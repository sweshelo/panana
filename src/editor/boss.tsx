// Inspector block of a boss battle (EventObject kind 0x31, game/boss.ts): its stages, each with the monsters
// (a monsterFixGroup row), the battle BGM, what a win does, and the messages shown before the battle.
import { useState, type ReactNode } from 'react';
import { addBossChara, addFixGroup, bossCharaRows, clearState, newBossCharaRecord, syncBossCharas, BOSS_BGM_DEFAULT, FIX_FLAGS_BOSS, FIX_SLOTS, FIX_TABLE, fixGroup, KIND_BOSS, MAX_STAGES, readStages, setFixGroup, writeStages, type BossStage, type FixGroup } from '../game/boss';
import { countLabel, type MonsterBook } from '../game/monsters';
import { MAX_MAP_SOUND } from '../game/sound';
import { MonsterPicker } from '../ui/MonsterPicker';
import { monsterRef } from '../pages/monsters';
import { LAYOUTS, recCellPos, recEventRow, setRecCellPos } from '../game/sections';
import type { Session } from '../session';
import { MessageEditor } from '../ui/message';
import { Photo } from '../ui/Photo';
import { SoundButton } from '../ui/SoundPicker';
import { Field, Num } from './fields';
import { hexId, MESSAGE_HELP } from './message';
import { MessagePicker } from '../ui/MessagePicker';

/** Boss rows of the loaded event tables that use a monsterFixGroup row ("dungeon.row"). */
function fixUsers(session: Session, fix: number): string[] {
  const out: string[] = [];
  for (const [d, ev] of session.st.events)
    for (let row = 0; row < ev.rows; row++)
      if (ev.kind(row) === KIND_BOSS && readStages(ev.table.row(row)).some((s) => s.fix === fix)) out.push(`${d}.${row}`);
  return out;
}

export function BossPanel({ session, row }: { session: Session; row: number }): ReactNode {
  const { st, game, book } = session;
  const ev = st.currentEvents!;
  const stages = readStages(ev.table.row(row));
  /** An edit that keeps the boss's characters (its look on the map) in step with the stages. */
  const apply = (f: () => void): void => st.editTables(() => {
    f();
    syncBossCharas(game.master, ev, row);
  });
  const charas = bossCharaRows(game.master, ev, row);
  /** The range record on this map, for placing the boss's character at it. */
  const range = (st.current?.recs[8] ?? []).find((r) => recEventRow(8, r.raw) === row);
  const addChara = (): void => {
    if (!range || !st.current) return;
    const first = stages[0] && fixGroup(game.master, stages[0].fix)?.slots[0]?.monster;
    if (!first) return;
    st.checkpoint();
    const [cx, cy] = recCellPos(range, LAYOUTS[8]!);
    const rec = { raw: newBossCharaRecord(addBossChara(game.master, ev, row, first)), x: 0, y: 0 };
    setRecCellPos(rec, LAYOUTS[5]!, cx, cy);
    st.touch((doc) => (doc.recs[5] ??= []).push(rec));
  };
  const setStages = (next: BossStage[]): void => apply(() => writeStages(ev.table.row(row), next));
  const setStage = (n: number, s: Partial<BossStage>): void => setStages(stages.map((x, i) => (i === n ? { ...x, ...s } : x)));
  const addStage = (): void => {
    const last = stages[stages.length - 1]!;
    apply(() => {
      const g = fixGroup(game.master, last.fix) ?? { flags: FIX_FLAGS_BOSS, slots: [] };
      const fix = addFixGroup(game.master, g);
      writeStages(ev.table.row(row), [...stages, { ...last, fix, messages: [0, 0, 0] }]);
    });
  };
  return (
    <div className="event-box boss-box">
      <h3>ボス戦</h3>
      <div className="muted small">
        範囲に入ると、メッセージのあとに決まった敵との戦闘になります。勝つとイベントの状態が進み、次に入ったときは次の段階の戦闘 (なければ何も起きない) になります。
        負けたとき・逃げたときは進みません。「何度でも」の段階は勝っても進まず、入るたびに戦闘になります。
      </div>
      {stages.map((s, n) => (
        <StageFields key={n} session={session} book={book} row={row} n={n} s={s} last={n === stages.length - 1}
          set={(x) => setStage(n, x)} remove={n > 0 && n === stages.length - 1 ? () => setStages(stages.slice(0, -1)) : null} />
      ))}
      {stages.length < MAX_STAGES && (
        <button onClick={addStage} title="勝つたびに強くなる戦い (ポーンのような) を作ります">{`段階を足す (${stages.length} / ${MAX_STAGES})`}</button>
      )}
      <div className="muted small">
        段階 n は、イベントの状態が n − 1 のときの戦闘です (+0x4D / +0x4E / +0x4F の種類 0x31、引数は +0x08 / +0x1C / +0x30)。
        ストーリーの進行で出し分けるには、出現条件 (+0x4B / +0x4C) を使ってください。
      </div>
      <h4>マップでの姿</h4>
      {charas.length
        ? <div className="muted small">{`段階 1 の最初の敵を、キャラ (区画 5、イベント #${charas.join(', #')}) としてマップに出します。${clearState(stages) ? '最後の段階に勝つと消えます。' : '最後の段階が「進まない」なので消えません。'} 位置は区画 5 のキャラを動かして変えられます。`}</div>
        : (
          <div className="row">
            <span className="muted small">ゲームでは範囲は見えないので、敵の姿のキャラを置くと分かりやすくなります。</span>
            <button className="small" disabled={!range || ev.roomLeft() < 1} onClick={addChara}>姿を置く</button>
          </div>
        )}
      {!book && <div className="error">モンスターの表を読めなかったため、敵の名前と姿を出せません。</div>}
    </div>
  );
}

function StageFields({ session, book, row, n, s, last, set, remove }: {
  session: Session; book: MonsterBook | null; row: number; n: number; s: BossStage; last: boolean;
  set: (s: Partial<BossStage>) => void; remove: (() => void) | null;
}): ReactNode {
  const { st, game, sounds } = session;
  const master = game.master;
  const ev = st.currentEvents!;
  const apply = (f: () => void): void => st.editTables(() => {
    f();
    syncBossCharas(master, ev, row);
  });
  const g = fixGroup(master, s.fix);
  const rows = master.table(FIX_TABLE).rows;
  const shared = fixUsers(session, s.fix).filter((u) => u !== `${st.current!.dungeon}.${row}`);
  const setGroup = (next: FixGroup): void => apply(() => setFixGroup(master, s.fix, next));
  /** The monster picker: what to do with the picked row, and the row to show as current. */
  const [picking, setPicking] = useState<{ current: number; onPick: (row: number) => void } | null>(null);
  const [pickingMsg, setPickingMsg] = useState<{ current: number; onPick: (id: number) => void } | null>(null);
  const setSlot = (k: number, x: Partial<FixGroup['slots'][number]>): void => setGroup({ ...g!, slots: g!.slots.map((y, i) => (i === k ? { ...y, ...x } : y)) });
  return (
    <div className="boss-stage">
      <h4>
        {`段階 ${n + 1}`}
        <span className="muted small">{` (状態 ${n})`}</span>
        {remove && <button className="small danger" onClick={remove}>この段階を消す</button>}
      </h4>
      <Field label={`敵 (monsterFixGroup の行、1〜${rows - 1})`}>
        <span className="row">
          <Num value={s.fix} min={1} max={Math.min(255, rows - 1)} onChange={(v) => set({ fix: v })} />
          <button className="small" title="今の敵を写した新しい行にします (ほかと共有しない)"
            onClick={() => apply(() => set({ fix: addFixGroup(master, g ?? { flags: FIX_FLAGS_BOSS, slots: [] }) }))}>新しい行にする</button>
        </span>
      </Field>
      {shared.length > 0 && <div className="muted small">{`この行はほかのボス戦 (${shared.join('、')}) も使っています。敵を変えると両方が変わります。`}</div>}
      {g ? (
        <table className="boss-fix">
          <tbody>
            {g.slots.map((slot, k) => {
              const m = book?.monster(slot.monster);
              return (
                <tr key={k}>
                  <td className="photo-cell">{m && book && <Photo model={monsterRef(game, book, m)} title={m.name} />}</td>
                  <td>
                    <button className="small" disabled={!book} title="敵を選ぶ" onClick={() => setPicking({ current: slot.monster, onPick: (r) => setSlot(k, { monster: r }) })}>
                      {m ? `${m.name} Lv${m.level}` : `#${slot.monster}`}
                    </button>
                    {m && <a href={`#/monsters/${m.row}`} title="モンスター図鑑で開く"> ↗</a>}
                  </td>
                  <td>
                    <select value={slot.count} title="数" onChange={(e) => setSlot(k, { count: Number(e.target.value) })}>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => <option key={c} value={c}>{`${countLabel(c)} 体`}</option>)}
                    </select>
                  </td>
                  <td>
                    {g.slots.length > 1 && <button className="small" title="外す" onClick={() => setGroup({ ...g, slots: g.slots.filter((_, i) => i !== k) })}>×</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <div className="error">{`monsterFixGroup の行 ${s.fix} がありません`}</div>}
      {g && g.slots.length < FIX_SLOTS && (
        <button className="small" disabled={!book} onClick={() => setPicking({ current: g.slots[0]?.monster ?? 0, onPick: (r) => setGroup({ ...g, slots: [...g.slots, { monster: r, count: 0 }] }) })}>敵を足す</button>
      )}
      {g && !g.slots.length && <div className="error">敵がいません (戦闘になりません)</div>}
      <div className="field">
        <span>戦闘の BGM</span>
        {sounds
          ? <SoundButton game={game} sounds={sounds} value={s.bgm || BOSS_BGM_DEFAULT} kind="bgm" max={MAX_MAP_SOUND} title="戦闘の BGM を選ぶ" onChange={(v) => set({ bgm: v })} />
          : <Num value={s.bgm || BOSS_BGM_DEFAULT} min={1} max={255} onChange={(v) => set({ bgm: v })} />}
      </div>
      <Field label="勝ったら">
        <select value={s.repeat ? 1 : 0} onChange={(e) => set({ repeat: e.target.value === '1' })}>
          <option value={0}>{last ? 'おしまい (二度と起きない)' : `段階 ${n + 2} へ進む`}</option>
          <option value={1}>進まない (入るたびに戦闘)</option>
        </select>
      </Field>
      {s.messages.map((id, i) => {
        const setMsg = (v: number): void => set({ messages: s.messages.map((x, j) => (j === i ? v : x)) as BossStage['messages'] });
        return (
          <div key={i} className="boss-msg">
            <Field label={`戦闘の前のメッセージ ${i + 1}`}>
              <span className="row">
                <button className="small" title="本文から選ぶ" onClick={() => setPickingMsg({ current: id, onPick: setMsg })}>
                  {id ? (master.texts.preview(id, true)?.slice(0, 24) || hexId(id)) : 'なし (選ぶ)'}
                </button>
                {!!id && <button className="small" title="このメッセージを出さない" onClick={() => setMsg(0)}>×</button>}
              </span>
            </Field>
            {!!id && <MessageEditor texts={master.texts} id={id} apply={apply} />}
          </div>
        );
      })}
      <div className="muted small">{`${MESSAGE_HELP} 「選ぶ」で本文から探せます。新しい ID は作れないので、使われていないメッセージを選んで書き換えてください。`}</div>
      {pickingMsg && (
        <MessagePicker session={session} current={pickingMsg.current} onClose={() => setPickingMsg(null)}
          onPick={(id) => { setPickingMsg(null); pickingMsg.onPick(id); }} />
      )}
      {picking && book && (
        <MonsterPicker session={session} book={book} current={picking.current} onClose={() => setPicking(null)}
          onPick={(r) => { setPicking(null); picking.onPick(r); }} />
      )}
    </div>
  );
}
