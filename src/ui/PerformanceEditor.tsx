// The performance of an action (naauao docs/action-performance.md): its slots (user / target / extra …), each a
// directData row = motion + effect + sound effect; picking an existing performance of any monster for a slot, changing
// one field of it (a copy of the row is made when others use it), copying the effect or the performance of another
// action, and a preview that plays the slots on the monsters.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActionBook, ActionEdits } from '../game/actions';
import type { Game } from '../game/game';
import { SKILL_MOTION, type Monster, type MonsterBook } from '../game/monsters';
import {
  ACTION_DIRECTION, ACTION_SLOTS, ALLY_DIRECTIONS, animKeys, directionLabel, MONSTER_DIRECTIONS, decodePerformance, effectLabel, loadEffectModels, performanceUses,
  type EffectModel, type EffectTable, type Performance, type PerformanceUse,
} from '../game/performance';
import type { SoundNames } from '../game/sound';
import { monsterRef } from '../pages/monsters';
import { PerformanceViewer, type PreviewEffect, type PreviewPhase } from '../pages/perfview';
import type { Session } from '../session';
import { soundPlayer } from '../sound/player';
import { ActionPicker } from './ActionPicker';
import { Dialog } from './Dialog';
import { InfoTip } from './InfoTip';
import { Dom } from './mount';
import { SoundButton } from './SoundPicker';
import { u16 } from '../util/bytes';

/** Names of the effect models (8756A407), null while they are read. */
export function useEffectModels(game: Game): Map<number, EffectModel> | null {
  const [models, setModels] = useState<Map<number, EffectModel> | null>(null);
  useEffect(() => {
    let live = true;
    loadEffectModels(game).then((m) => live && setModels(m));
    return () => {
      live = false;
    };
  }, [game]);
  return models;
}

/** "0x45 ワザ A (005_)", "0x0B (011_・電波人間)". */
export function animLabel(anim: number, keys: string[]): string {
  if (!anim) return 'なし';
  const hex = `0x${anim.toString(16).toUpperCase().padStart(2, '0')}`;
  const m = SKILL_MOTION[anim];
  if (m) return `${hex} ${m[0]} (${m[1]})`;
  if (anim === 0x41) return `${hex} 待機 (001_)`;
  const key = keys[anim] ?? '';
  const side = anim < 0x41 ? '電波人間' : 'モンスター';
  return `${hex} (${key ? `${key}・` : ''}${side})`;
}

/** Everything the slot editor and the pickers need, built once per render. */
interface Ctx {
  session: Session;
  book: MonsterBook;
  actions: ActionBook;
  edits: ActionEdits;
  effects: EffectTable;
  models: Map<number, EffectModel> | null;
  sounds: SoundNames | null;
  keys: string[];
  uses: Map<number, PerformanceUse[]>;
}

/** "#660 スベテノオワリ (じゃあくのまじょ) の対象", "まおう の変身". */
function placeLabel(c: Ctx, u: PerformanceUse): string {
  if (u.kind === 'transform') return `${c.book.monster(u.monster)?.name ?? `#${u.monster}`} の変身`;
  const a = c.actions.action(u.action);
  const users = c.actions.refsOf(u.action).monsters.map((m) => m.name);
  const slot = ACTION_SLOTS.find((s) => s.offset === u.slot)?.label ?? '';
  return `#${u.action} ${a?.name || '(名前なし)'}${users.length ? ` (${[...new Set(users)].slice(0, 2).join('・')})` : ''} の${slot}`;
}

function perfEffects(c: Ctx, p: Performance): string {
  const list = [p.effect, ...c.effects.addEffects(p.addEffect)].filter(Boolean);
  return list.length ? list.map((e) => effectLabel(c.effects.effect(e), c.models)).join(' + ') : 'なし';
}

const DIRECTION_INFO = [
  'actionData +0x1C: 演出の進行 (カメラの動き、前に出るかなど、行動の段取り) の番号です (naauao docs/action-performance.md §2.2)。',
  'ゲームは使う側がモンスターなら 15 個、電波人間なら 28 個の別々の表から処理を引きます。同じ番号でも意味が違うので、電波人間のワザの値をモンスターのワザに写すと別の段取りになります。表の外の値は 0 として扱われます。',
  'モンスターの主な値: 4 = 近接・単体 (走って前に出て戻る)、5 = 近接・全体、8 = 遠隔・単体 (カメラが使う側 → 対象)、9 = 遠隔・全体 (使う側 → 対象の陣営全体)。',
  '段取りは演出の枠の使い方も決めるので、演出を借りる元のワザと同じ値にしておくのが安全です。',
].join('\n');

const SLOT_INFO = [
  'アクションの演出は、演出の表 (2713402F の directData) の行を枠ごとに指します。1 行 = モーション + エフェクト + SE (+ 追加のエフェクト・タイミング)。',
  '「演出を選ぶ」で、ほかのモンスターのワザや変身の演出をそのまま使えます。戦闘の前に、ワザが指す演出のエフェクトが読み込まれるので、どのモンスターのものでも出せます。',
  'モーション・エフェクト・SE を変えると、同じ行をほかのアクションが使っているときは行を複製して書き換えます (ほかは変わりません)。',
  'モーションは使う側のモデルのものが再生されます (0x45〜0x48 はそのモンスター自身のワザ A〜D)。ボーンに付くエフェクトは、付け先のモデルに同じボーンがないと既定の位置に出ます。',
].join('\n');

/** The performance slots of an action, with the copy buttons. `onChange` after every edit. */
export function PerformanceSlots({ session, actions, edits, row, onChange }: {
  session: Session;
  actions: ActionBook;
  edits: ActionEdits;
  row: number;
  onChange: () => void;
}): ReactNode {
  const { game, book, sounds } = session;
  const models = useEffectModels(game);
  const keys = useMemo(() => animKeys(game.master), [game]);
  const [all, setAll] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [copying, setCopying] = useState<'ability' | 'performance' | null>(null);
  const [side, setSide] = useState<'monster' | 'ally' | null>(null);
  useEffect(() => setSide(null), [row]);
  const a = actions.action(row);
  if (!book?.directData || !a) return <div className="muted">演出の表 (2713402F) を読めませんでした。</div>;
  const c: Ctx = { session, book, actions, edits, effects: book.effects, models, sounds, keys, uses: performanceUses(game.master) };
  const dd = book.directData;
  const apply = (f: () => void): void => {
    try {
      f();
    } catch (err) {
      alert((err as Error).message);
      return;
    }
    book.reload();
    onChange();
  };
  const slots = ACTION_SLOTS.filter((s) => a.raw.length >= s.offset + 2 && (all || s.main || actions.slot(row, s.offset)));
  const hidden = ACTION_SLOTS.filter((s) => !s.main && a.raw.length >= s.offset + 2 && !actions.slot(row, s.offset)).length;
  const direction = a.raw.length >= ACTION_DIRECTION + 2 ? u16(a.raw, ACTION_DIRECTION) : 0;
  const refs = actions.refsOf(row);
  // Whose table +0x1C is read from: the monsters' unless items use the action (a copied skill has no users yet).
  const monsterSide = side ? side === 'monster' : refs.monsters.length > 0 || (!refs.items.length && a.kind !== 2);
  const mixed = refs.monsters.length > 0 && refs.items.length > 0;
  return (
    <div className="perf-slots">
      <table className="enc-table perf-table">
        <thead>
          <tr><th>枠<InfoTip text={SLOT_INFO} /></th><th>演出の行</th><th>モーション</th><th>エフェクト</th><th>SE</th><th>追加のエフェクト</th><th></th></tr>
        </thead>
        <tbody>
          {slots.map((s) => {
            const p = actions.slot(row, s.offset);
            const perf = p > 0 && p < dd.rows ? decodePerformance(dd.row(p), p) : null;
            const editable = edits.canEditSlot(row, s.offset);
            const others = (c.uses.get(p) ?? []).filter((u) => !(u.kind === 'action' && u.action === row && u.slot === s.offset));
            const set = (field: 'anim' | 'effect' | 'se' | 'addEffect', v: number): void => apply(() => edits.setSlotField(row, s.offset, field, v));
            return (
              <tr key={s.offset}>
                <td className="with-info">{s.label}<InfoTip text={s.info} /></td>
                <td>
                  {perf ? <span title={others.length ? `ほかに使っている所:\n${others.slice(0, 8).map((u) => placeLabel(c, u)).join('\n')}` : 'この枠だけが使う行'}>{`D${p}`}{others.length ? <span className="muted small">{` (共有 ${others.length})`}</span> : null}</span> : <span className="muted">なし</span>}
                </td>
                <td>
                  {perf && editable
                    ? <MotionSelect value={perf.anim} keys={keys} onChange={(v) => set('anim', v)} />
                    : <span className="muted">{perf ? animLabel(perf.anim, keys) : ''}</span>}
                </td>
                <td>{perf && <EffectButton c={c} value={perf.effect} disabled={!editable} onChange={(v) => set('effect', v)} />}</td>
                <td>{perf && sounds && (editable
                  ? <SoundButton game={game} sounds={sounds} value={perf.se} kind="se" title="演出の SE を選ぶ" onChange={(v) => set('se', v)} />
                  : <span className="muted">{sounds.label(perf.se)}</span>)}</td>
                <td>
                  {perf && (editable
                    ? (
                        <select value={perf.addEffect} title={perfEffects(c, { ...perf, effect: 0 })} onChange={(e) => set('addEffect', Number(e.target.value))}>
                          {Array.from({ length: Math.max(c.effects.addRows, perf.addEffect + 1) }, (_, i) => (
                            <option key={i} value={i}>{i ? `${i}: ${c.effects.addEffects(i).map((x) => effectLabel(c.effects.effect(x), models)).join(' + ')}` : 'なし'}</option>
                          ))}
                        </select>
                      )
                    : <span className="muted">{perf.addEffect || ''}</span>)}
                </td>
                <td className="nowrap">
                  <button className="small" title="ほかのワザ・変身の演出からこの枠の演出を選びます" onClick={() => setPicking(s.offset)}>演出を選ぶ…</button>
                  {p > 0 && <button className="small" title="この枠を空にします" onClick={() => apply(() => edits.setSlot(row, s.offset, 0))}>×</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row small">
        {hidden > 0 && <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{`空の枠も出す (${hidden})`}</label>}
        <span className="with-info">
          {'演出の進行 (+0x1C)'}
          <InfoTip text={DIRECTION_INFO} />
        </span>
        <select value={monsterSide ? 'm' : 'a'} title="+0x1C の意味は、使う側がモンスターか電波人間かで変わります" onChange={(e) => setSide(e.target.value === 'm' ? 'monster' : 'ally')}>
          <option value="m">モンスターが使う</option>
          <option value="a">電波人間が使う</option>
        </select>
        <select value={direction} className={direction >= (monsterSide ? MONSTER_DIRECTIONS : ALLY_DIRECTIONS).length ? 'invalid' : ''}
          onChange={(e) => apply(() => edits.setDirection(row, Number(e.target.value)))}>
          {(monsterSide ? MONSTER_DIRECTIONS : ALLY_DIRECTIONS).map((label, i) => <option key={i} value={i}>{label}</option>)}
          {direction >= (monsterSide ? MONSTER_DIRECTIONS : ALLY_DIRECTIONS).length && <option value={direction}>{directionLabel(direction, monsterSide)}</option>}
        </select>
        <button title="ほかのアクションの効果 (種類・範囲・属性・量・状態・威力・結果のメッセージ) をこのアクションに写します。名前と演出はそのままです" onClick={() => setCopying('ability')}>効果を写す…</button>
        <button title="ほかのアクションの演出 (すべての枠と +0x1C) をこのアクションに写します" onClick={() => setCopying('performance')}>演出を写す…</button>
      </div>
      {mixed && <div className="issue warn">⚠ モンスターとアイテムの両方が使うアクションです。+0x1C は使う側ごとに別の意味で読まれます。</div>}
      {picking !== null && (
        <PerformancePicker c={c} current={actions.slot(row, picking)} title={`${ACTION_SLOTS.find((s) => s.offset === picking)?.label ?? ''}の演出を選ぶ`}
          onClose={() => setPicking(null)} onPick={(p) => { const o = picking; setPicking(null); apply(() => edits.setSlot(row, o, p)); }} />
      )}
      {copying && (
        <ActionPicker actions={actions} title={copying === 'ability' ? '効果を写す元のアクション' : '演出を写す元のアクション'}
          onClose={() => setCopying(null)}
          onPick={(from) => { const k = copying; setCopying(null); apply(() => (k === 'ability' ? edits.copyAbility(row, from) : edits.copyPerformance(row, from))); }} />
      )}
    </div>
  );
}

function MotionSelect({ value, keys, onChange }: { value: number; keys: string[]; onChange: (v: number) => void }): ReactNode {
  const rows = Math.max(keys.length, value + 1, 0x51);
  const opt = (n: number): ReactNode => <option key={n} value={n}>{animLabel(n, keys)}</option>;
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {opt(0)}
      <optgroup label="モンスター">{Array.from({ length: rows }, (_, i) => i).filter((i) => i >= 0x41).map(opt)}</optgroup>
      <optgroup label="電波人間">{Array.from({ length: 0x41 }, (_, i) => i).filter((i) => i > 0).map(opt)}</optgroup>
    </select>
  );
}

function EffectButton({ c, value, disabled, onChange }: { c: Ctx; value: number; disabled: boolean; onChange: (v: number) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const label = effectLabel(c.effects.effect(value), c.models);
  if (disabled) return <span className="muted">{label}</span>;
  return (
    <>
      <button type="button" className="map-button" title="クリックでエフェクトを選ぶ" onClick={() => setOpen(true)}>{label}<span className="muted"> ▾</span></button>
      {open && <EffectPicker c={c} current={value} onClose={() => setOpen(false)} onPick={(v) => { setOpen(false); if (v !== value) onChange(v); }} />}
    </>
  );
}

/** Every directData row, searchable by what uses it (actions, their monsters, transformations) and what it plays. */
export function PerformancePicker({ c, current, title, onPick, onClose }: {
  c: Ctx;
  current: number;
  title: string;
  onPick: (row: number) => void;
  onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [used, setUsed] = useState(true);
  const dd = c.book.directData!;
  const q = query.trim();
  const shown: { p: Performance; uses: string[]; fx: string; se: string }[] = [];
  for (let r = 1; r < dd.rows; r++) {
    const list = c.uses.get(r) ?? [];
    if (used && !list.length && r !== current) continue;
    const p = decodePerformance(dd.row(r), r);
    // the uses that match the search first
    const uses = list.map((u) => placeLabel(c, u)).sort((x, y) => Number(!!q && y.includes(q)) - Number(!!q && x.includes(q)));
    const fx = perfEffects(c, p);
    const se = c.sounds?.name(p.se) ?? '';
    if (q && String(r) !== q && !uses.some((u) => u.includes(q)) && !fx.includes(q) && !se.includes(q.toUpperCase())) continue;
    shown.push({ p, uses, fx, se });
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="row">
        <input type="search" className="picker-search" autoFocus placeholder="ワザ・モンスター・エフェクト・SE の名前、行番号で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label><input type="checkbox" checked={used} onChange={(e) => setUsed(e.target.checked)} />使われている行だけ</label>
      </div>
      <div className="picker-list">
        <table className="book-table perf-pick">
          <thead><tr><th>#</th><th>使っている所</th><th>モーション</th><th>エフェクト</th><th>SE</th></tr></thead>
          <tbody>
            {shown.slice(0, 400).map(({ p, uses, fx, se }) => (
              <tr key={p.row} className={p.row === current ? 'active current' : ''} onClick={() => onPick(p.row)}>
                <td className="num muted">{`D${p.row}`}</td>
                <td className="small">{uses.slice(0, 3).join(' / ') || <span className="muted">(なし)</span>}{uses.length > 3 ? <span className="muted">{` ほか ${uses.length - 3}`}</span> : null}</td>
                <td className="small">{animLabel(p.anim, c.keys)}</td>
                <td className="small mono">{fx}</td>
                <td className="small mono">{se}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 400 && <div className="muted small">{`ほか ${shown.length - 400} 件 (絞り込んでください)`}</div>}
        {!shown.length && <div className="muted">見つかりません</div>}
      </div>
    </Dialog>
  );
}

/** Every effectData row: the effect model's name (8756A407), the bone, and the performances that use it. */
function EffectPicker({ c, current, onPick, onClose }: { c: Ctx; current: number; onPick: (row: number) => void; onClose: () => void }): ReactNode {
  const [query, setQuery] = useState('');
  const dd = c.book.directData!;
  const users = useMemo(() => {
    const m = new Map<number, number[]>();
    for (let r = 1; r < dd.rows; r++) {
      const p = decodePerformance(dd.row(r), r);
      for (const e of [p.effect, ...c.effects.addEffects(p.addEffect)]) if (e) m.set(e, [...(m.get(e) ?? []), r]);
    }
    return m;
  }, [c, dd]);
  const q = query.trim();
  const shown = c.effects.effects.filter((e) => {
    if (!e.row) return false;
    const label = effectLabel(e, c.models);
    const acts = (users.get(e.row) ?? []).flatMap((p) => (c.uses.get(p) ?? []).map((u) => placeLabel(c, u)));
    return !q || String(e.row) === q || label.includes(q) || acts.some((a) => a.includes(q));
  });
  return (
    <Dialog title="エフェクトを選ぶ" onClose={onClose}>
      <div className="row">
        <input type="search" className="picker-search" autoFocus placeholder="エフェクト名 (fx_…)・ボーン・使うワザで絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} />
        <InfoTip text="effectData の行です。見た目 (パーティクル) はまだ表示できません。名前と、使っているワザで選んでください。" />
      </div>
      <div className="picker-list">
        <table className="book-table">
          <thead><tr><th>#</th><th>エフェクト</th><th>エミッター</th><th>使うワザ</th></tr></thead>
          <tbody>
            <tr className={current === 0 ? 'active current' : ''} onClick={() => onPick(0)}><td className="num muted">0</td><td className="muted">なし</td><td /><td /></tr>
            {shown.slice(0, 400).map((e) => {
              const acts = (users.get(e.row) ?? []).flatMap((p) => (c.uses.get(p) ?? []).map((u) => placeLabel(c, u)));
              return (
                <tr key={e.row} className={e.row === current ? 'active current' : ''} onClick={() => onPick(e.row)}>
                  <td className="num muted">{e.row}</td>
                  <td className="mono small">{effectLabel(e, c.models)}</td>
                  <td className="num muted">{c.models?.get(e.model)?.emitters.length ?? ''}</td>
                  <td className="small muted">{acts.slice(0, 2).join(' / ')}{acts.length > 2 ? ` ほか ${acts.length - 2}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length > 400 && <div className="muted small">{`ほか ${shown.length - 400} 件 (絞り込んでください)`}</div>}
      </div>
    </Dialog>
  );
}

/** The phases of an action's performance: the user's slot on the user, then the target's and the extra on the target. */
export function previewPhases(session: Session, actions: ActionBook, row: number, user: Monster | null, target: Monster | null,
  models: Map<number, EffectModel> | null): PreviewPhase[] {
  const { game, book, sounds } = session;
  if (!book?.directData) return [];
  const dd = book.directData;
  const keys = animKeys(game.master);
  const out: PreviewPhase[] = [];
  const phase = (offset: number, who: Monster | null, whoName: string): void => {
    const p = actions.slot(row, offset);
    if (!p || p >= dd.rows) return;
    const d = decodePerformance(dd.row(p), p);
    const effects: PreviewEffect[] = [d.effect, ...book.effects.addEffects(d.addEffect)].map((e) => book.effects.effect(e)).filter((e) => !!e).map((e) => ({
      label: effectLabel(e, models), bone: e.bone, offset: e.offset, start: Math.max(0, e.delay), length: e.length || 60,
    }));
    const index = sounds?.index(d.se) ?? null;
    const slot = ACTION_SLOTS.find((s) => s.offset === offset)!.label;
    out.push({
      title: `${slot}: ${whoName} — D${p} ${animLabel(d.anim, keys)}${sounds && d.se ? ` ${sounds.name(d.se)}` : ''}`,
      model: who ? monsterRef(game, book, who) : null,
      anim: keys[d.anim] ?? '',
      length: d.length,
      addLength: !!(d.raw[9]! & 1),
      effects,
      sound: index === null ? null : () => void soundPlayer.play(`perf-se:${index}`, async () => (await game.soundRenderer()).render(index)),
    });
  };
  phase(0x1e, user, user?.name ?? '電波人間');
  phase(0x20, target, target?.name ?? '電波人間');
  phase(0x22, target, target?.name ?? '電波人間');
  return out;
}

const PREVIEW_INFO = [
  '使用者 → 対象 → 追加 の順に、各枠の演出を再生します (ゲームでも、使う側の演出のあとにカメラが対象へ移ります)。',
  'モーションと SE は実際のデータで再生します。エフェクトはパーティクルの形式が未解析なので、出る位置 (ボーン) と時間を印で示します。',
  '電波人間のモデルは読めていないので、仮の姿 (枠線) で示します。',
].join('\n');

/** Preview of an action's performance on the chosen monsters. */
export function ActionPreview({ session, actions, row, users }: { session: Session; actions: ActionBook; row: number; users: Monster[] }): ReactNode {
  const book = session.book;
  const models = useEffectModels(session.game);
  const viewer = useMemo(() => new PerformanceViewer(), []);
  const monsters = book?.monsters ?? [];
  const [userRow, setUserRow] = useState<number>(users[0]?.row ?? 0);
  const [targetRow, setTargetRow] = useState(0);
  useEffect(() => setUserRow(users[0]?.row ?? 0), [row]); // eslint-disable-line react-hooks/exhaustive-deps -- a new action starts with its first user
  const user = book?.monster(userRow) ?? null;
  const target = targetRow ? book?.monster(targetRow) ?? null : null;
  const dd = book?.directData;
  // Reload when the action's slots or their rows change.
  const sig = [row, userRow, targetRow, !!models, ...ACTION_SLOTS.map((s) => actions.slot(row, s.offset)),
    ...[0x1e, 0x20, 0x22].map((o) => { const p = actions.slot(row, o); return dd && p && p < dd.rows ? [...dd.row(p)].join('.') : ''; })].join(',');
  useEffect(() => {
    void viewer.show(previewPhases(session, actions, row, user, target, models));
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- `sig` holds what the phases depend on
  const option = (m: Monster): ReactNode => <option key={m.row} value={m.row}>{`${m.name} #${m.row}`}</option>;
  return (
    <div className="perf-preview">
      <div className="row small">
        <span className="with-info">{'プレビュー'}<InfoTip text={PREVIEW_INFO} /></span>
        <label>{'使う側 '}
          <select value={userRow} onChange={(e) => setUserRow(Number(e.target.value))}>
            <option value={0}>電波人間 (仮の姿)</option>
            {users.length > 0 && <optgroup label="このワザを持つモンスター">{users.map(option)}</optgroup>}
            <optgroup label="すべて">{monsters.map(option)}</optgroup>
          </select>
        </label>
        <label>{'対象 '}
          <select value={targetRow} onChange={(e) => setTargetRow(Number(e.target.value))}>
            <option value={0}>電波人間 (仮の姿)</option>
            <optgroup label="モンスター">{monsters.map(option)}</optgroup>
          </select>
        </label>
      </div>
      <Dom node={viewer.el} />
    </div>
  );
}
