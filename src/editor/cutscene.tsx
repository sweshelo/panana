// The script (演出) of a boss / event stage (game/cutscene.ts): a list of commands — lines with their speaker, walking,
// turning, animations, marks, the camera, fades, sounds and waits — run in order when the range is entered.
import { useState, type ReactNode } from 'react';
import { setStageCommands, stageCommands } from '../game/boss';
import { ACTOR_HERO, ACTOR_NONE, ACTOR_PARTY, OP, type Command } from '../game/cutscene';
import { recEventRow } from '../game/sections';
import type { Session } from '../session';
import { MessagePicker } from '../ui/MessagePicker';
import { MessageEditor } from '../ui/message';
import { Num } from './fields';
import { hexId } from './message';
import { eventChoices } from './events';
import { PlacedPickButton } from './objectpick';

const OPS: { op: number; label: string; help: string }[] = [
  { op: OP.MSG, label: 'セリフ', help: '話者に話すアニメをさせてメッセージを出します (ボタンで閉じる)。主人公の既定は話す 0x1F → 立ち 1。ほかのキャラは指定したときだけ (町の人: 話す 0x5B / 立ち 0x58)' },
  { op: OP.WALK, label: '歩く', help: '役者を位置へ動かします (主人公は歩くアニメつき)。パーティは先頭と同じだけ全員が動きます。時間 0 は距離から' },
  { op: OP.TURN, label: '向く', help: '役者の向きを変えます (パーティは先頭だけ)' },
  { op: OP.ANIM, label: 'アニメ', help: '主人公: 1 立ち、3 歩く、0x16、0x19、0x1F 話す、0x24 (驚く)。ボス: 0x41 立ち、0x45 / 0x47。町の人: 0x58 立ち、0x5B 話す (どれもゲームのスクリプトで使われている値)' },
  { op: OP.MARK, label: 'マーク', help: '役者の頭上にマークを出します (効果音 0x66、0.7 秒)。番号 0 / 1 / 2 / 4 がゲームで使われています' },
  { op: OP.CAMERA, label: 'カメラ', help: '役者 (なければ位置) を斜め上から映します。終わると主人公へ戻ります' },
  { op: OP.CAMERA_BACK, label: 'カメラを戻す', help: 'カメラを主人公へ戻します (時間 0 は 1.5 秒)' },
  { op: OP.PLACE, label: '置く', help: '役者をすぐ位置へ移します。主人公・パーティは隊列で並び、向きも変わります' },
  { op: OP.FADE, label: 'フェード', help: '画面を黒へフェードアウト / フェードインします (時間 0 は 0.5 秒)。暗いまま終わると最後にフェードインします' },
  { op: OP.SE, label: '効果音', help: 'soundData の行の効果音を鳴らします' },
  { op: OP.WAIT, label: '待つ', help: '時間だけ待ちます' },
];
const opLabel = (op: number): string => OPS.find((o) => o.op === op)?.label ?? `命令 ${op}`;
/** Ops that take an actor. */
const WITH_ACTOR = new Set<number>([OP.MSG, OP.WALK, OP.TURN, OP.ANIM, OP.MARK, OP.CAMERA, OP.PLACE]);
const DIRS = ['南', '東', '北', '西'];

function newCommand(op: number): Command {
  switch (op) {
    case OP.MSG: return { op, arg: 0, actor: ACTOR_HERO, p: 0, q: 0 };
    case OP.WALK: return { op, arg: 0, actor: ACTOR_HERO, p: 0, q: 0 };
    case OP.TURN: return { op, arg: 2, actor: ACTOR_HERO, p: 3, q: 0 };
    case OP.ANIM: return { op, arg: 1, actor: ACTOR_HERO, p: 1, q: 0 };
    case OP.MARK: return { op, arg: 0, actor: ACTOR_HERO, p: 0, q: 0 };
    case OP.CAMERA: return { op, arg: 15, actor: ACTOR_HERO, p: 0, q: 0 };
    case OP.CAMERA_BACK: return { op, arg: 15, actor: ACTOR_NONE, p: 0, q: 0 };
    case OP.FADE: return { op, arg: 0, actor: ACTOR_NONE, p: 5, q: 0 };
    case OP.WAIT: return { op, arg: 0, actor: ACTOR_NONE, p: 5, q: 0 };
    default: return { op, arg: 0, actor: ACTOR_NONE, p: 0, q: 0 };
  }
}

export function ScriptEditor({ session, row, n }: { session: Session; row: number; n: number }): ReactNode {
  const { st, game } = session;
  const ev = st.currentEvents!;
  const cmds = stageCommands(ev, row, n);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [adding, setAdding] = useState<number>(OP.MSG);
  const save = (next: Command[]): void => {
    try {
      st.editTables(() => setStageCommands(ev, row, n, next));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const set = (i: number, c: Partial<Command>): void => save(cmds.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const move = (i: number, d: number): void => {
    const next = cmds.slice();
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c!);
    save(next);
  };
  // actors: the characters (section 5) on this map, by their event row
  const doc = st.current;
  const actorRows = [...new Set((doc?.recs[5] ?? []).map((r) => recEventRow(5, r.raw)))].filter((r) => ev.has(r)).sort((a, b) => a - b);
  const actorChoices = doc ? eventChoices(st, actorRows, session.book) : [];
  const actorSelect = (c: Command, i: number, allowNone: boolean, allowParty: boolean): ReactNode => (
    <PlacedPickButton title="役者を選ぶ (このマップの区画 5 のキャラ)" value={c.actor} choices={actorChoices}
      extra={[
        ...(allowNone ? [{ value: ACTOR_NONE, label: c.op === OP.CAMERA ? '(位置を映す)' : '(話者なし)' }] : []),
        { value: ACTOR_HERO, label: '主人公' },
        ...(allowParty ? [{ value: ACTOR_PARTY, label: 'パーティ全員' }] : []),
      ]}
      missing={(v) => `イベント #${v} (このマップにいない)`}
      onChange={(v) => set(i, { actor: v })} />
  );
  const pos = (c: Command, i: number): ReactNode => (
    <span className="row" title="位置 (細かい単位: 1 = 1/5 セル、マップの x / y と同じ)">
      x <Num value={c.p} min={0} max={299} onChange={(v) => set(i, { p: v })} />
      y <Num value={c.q} min={0} max={299} onChange={(v) => set(i, { q: v })} />
      <span className="muted small">{`セル (${((50 + c.p * 100) / 500).toFixed(1)}, ${((50 + c.q * 100) / 500).toFixed(1)})`}</span>
    </span>
  );
  const time = (v: number, on: (v: number) => void, title: string): ReactNode => (
    <span className="row" title={title}>
      <Num value={v} min={0} max={255} onChange={on} />
      <span className="muted small">{`× 0.1 秒`}</span>
    </span>
  );
  const fields = (c: Command, i: number): ReactNode => {
    switch (c.op) {
      case OP.MSG:
        return (
          <>
            <span className="row">
              {actorSelect(c, i, true, false)}
              <button className="small" title="本文から選ぶ" onClick={() => setPicking(i)}>
                {c.p ? (game.master.texts.preview(c.p, true)?.slice(0, 24) || hexId(c.p)) : 'メッセージを選ぶ'}
              </button>
            </span>
            {c.actor !== ACTOR_NONE && (
              <span className="row" title="話している間のアニメ / 話したあとのアニメ (0 = 既定)">
                話す <Num value={c.arg} min={0} max={255} onChange={(v) => set(i, { arg: v })} />
                あと <Num value={c.q} min={0} max={0xffff} onChange={(v) => set(i, { q: v })} />
              </span>
            )}
            {!!c.p && <MessageEditor texts={game.master.texts} id={c.p} apply={(f) => st.editTables(f)} compact />}
          </>
        );
      case OP.WALK:
        return <>{actorSelect(c, i, false, true)}{pos(c, i)}{time(c.arg, (v) => set(i, { arg: v }), '時間 (0 = 距離から)')}</>;
      case OP.PLACE:
        return (
          <>
            {actorSelect(c, i, false, false)}
            {pos(c, i)}
            {c.actor === ACTOR_HERO && (
              <select value={c.arg} title="パーティの向き" onChange={(e) => set(i, { arg: Number(e.target.value) })}>
                {DIRS.map((d, k) => <option key={k} value={k}>{`${d}向き`}</option>)}
              </select>
            )}
          </>
        );
      case OP.TURN:
        return (
          <>
            {actorSelect(c, i, false, false)}
            <select value={c.arg} onChange={(e) => set(i, { arg: Number(e.target.value) })}>
              {DIRS.map((d, k) => <option key={k} value={k}>{`${d}を向く`}</option>)}
            </select>
            {time(c.p, (v) => set(i, { p: v }), '時間 (0 = 0.3 秒)')}
          </>
        );
      case OP.ANIM:
        return (
          <>
            {actorSelect(c, i, false, true)}
            <span className="row">アニメ <Num value={c.p} min={0} max={0xffff} onChange={(v) => set(i, { p: v })} /></span>
            <label><input type="checkbox" checked={!!c.arg} onChange={(e) => set(i, { arg: e.target.checked ? 1 : 0 })} />くり返す</label>
          </>
        );
      case OP.MARK:
        return <>{actorSelect(c, i, false, false)}<span className="row">番号 <Num value={c.arg} min={0} max={255} onChange={(v) => set(i, { arg: v })} /></span></>;
      case OP.CAMERA:
        return (
          <>
            {actorSelect(c, i, true, false)}
            {c.actor === ACTOR_NONE && pos(c, i)}
            {time(c.arg, (v) => set(i, { arg: v }), '時間 (0 = すぐ)')}
          </>
        );
      case OP.CAMERA_BACK:
        return time(c.arg, (v) => set(i, { arg: v }), '時間 (0 = 1.5 秒)');
      case OP.FADE:
        return (
          <>
            <select value={c.arg} onChange={(e) => set(i, { arg: Number(e.target.value) })}>
              <option value={0}>フェードアウト (黒へ)</option>
              <option value={1}>フェードイン</option>
            </select>
            {time(c.p, (v) => set(i, { p: v }), '時間 (0 = 0.5 秒)')}
          </>
        );
      case OP.SE:
        return <span className="row">soundData の行 <Num value={c.p} min={0} max={0xffff} onChange={(v) => set(i, { p: v })} /></span>;
      case OP.WAIT:
        return time(c.p, (v) => set(i, { p: v }), '待つ時間');
      default:
        return <span className="muted small">{`arg ${c.arg} / 役者 ${c.actor} / ${c.p} / ${c.q}`}</span>;
    }
  };
  return (
    <div className="scene-box">
      <div className="muted small">
        上から順に動きます。話者はゲームのセリフの関数には指定がないので、話者に話すアニメをさせ、必要ならカメラやマークで示します。
        役者に選べるのは、このマップの区画 5 に置いたキャラです。始めると操作が止まり、終わるとカメラ・フェード・操作が元に戻ります。
      </div>
      <ol className="scene-list">
        {cmds.map((c, i) => (
          <li key={i} className="scene-cmd">
            <span className="row">
              <b>{opLabel(c.op)}</b>
              <button className="small" disabled={i === 0} title="上へ" onClick={() => move(i, -1)}>↑</button>
              <button className="small" disabled={i === cmds.length - 1} title="下へ" onClick={() => move(i, 1)}>↓</button>
              <button className="small danger" title="消す" onClick={() => save(cmds.filter((_, j) => j !== i))}>×</button>
            </span>
            <div className="scene-fields" title={OPS.find((o) => o.op === c.op)?.help}>{fields(c, i)}</div>
          </li>
        ))}
      </ol>
      {!cmds.length && <div className="muted small">命令がありません (範囲に入っても何も起きずに終わります)。</div>}
      <div className="row">
        <select value={adding} onChange={(e) => setAdding(Number(e.target.value))}>
          {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
        <button className="small" onClick={() => save([...cmds, newCommand(adding)])}>命令を足す</button>
      </div>
      <div className="muted small">{OPS.find((o) => o.op === adding)?.help}</div>
      {cmds.some((c) => WITH_ACTOR.has(c.op) && c.actor !== ACTOR_NONE && c.actor !== ACTOR_HERO && c.actor !== ACTOR_PARTY && !actorRows.includes(c.actor)) && (
        <div className="error">このマップにいない役者の命令は何もしません。</div>
      )}
      {error && <div className="error">{error}</div>}
      {picking !== null && (
        <MessagePicker session={session} current={cmds[picking]?.p ?? 0} onClose={() => setPicking(null)}
          onPick={(id) => { const i = picking; setPicking(null); set(i, { p: id }); }} />
      )}
    </div>
  );
}
