// The performance of an RPG3 action (#93): its slots (actionData +0x1E〜+0x28, rows of directData in 402F0000) picked
// again from the other actions' rows and their fields edited as RPG2's (ui/PerformanceEditor.tsx), and the preview with
// the same viewer (pages/perfview.ts): the user's slots (+0x1E with +0x20), then the target's (+0x22 with +0x24), then
// the one for the target's side (+0x26), with the timeline of the rows under it. The monsters play their skill
// motions (the motion BCH of monsterDesign +0x14), the effects are marked where they come out, and the sound effects
// play. 電波人間 are shown as the stand-in.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GsTable } from '../archive/gstable';
import { animKeys, effectLabel, slotTimeline, type EffectModel, type EffectTable, type PerfField } from '../game/performance';
import type { SoundNames } from '../game/sound';
import { PerformanceViewer, type PhaseTiming, type PreviewEffect, type PreviewPhase } from '../pages/perfview';
import { soundPlayer } from '../sound/player';
import { InfoTip } from '../ui/InfoTip';
import { Dom } from '../ui/mount';
import { Photo } from '../ui/Photo';
import { AddEffectSelect, EffectButton, MotionSelect, PerformancePicker, perfEffects, SlotTimelines, type PerfSource, type TimelineSlot } from '../ui/PerformanceEditor';
import { SoundButton } from '../ui/SoundPicker';
import { decodeOahuPerformance, OAHU_MONSTER_ANIMS, OAHU_PERF, OAHU_PERF_SLOTS, OahuPerfEdits, OahuPerformances, oahuPerformanceUses, type OahuPerfUse } from './performance';
import { OahuActionPicker, OahuMonsterPicker } from './pickers';
import type { OahuSession } from './session';

const PREVIEW_INFO = [
  '使用者 (+0x1E と、同時に重ねる +0x20) → 対象 (+0x22 と +0x24) → 場 (+0x26) の順に、演出の表 (402F0000 の directData) の行を再生します。',
  'モンスターのワザのモーションは、モデルとは別の BCH (monsterDesign +0x14) から読みます。SE も実際のデータで鳴らします。',
  'エフェクトはパーティクルの形式が未解析なので、出る位置 (ボーン) と時間を印で示します。電波人間のモデルは読めていないので、仮の姿 (枠線) で示します。',
  '種別 22 の変身では、対象の段 (使う側自身) を「変身の見た目」(+0x62) のモデルで示します。',
  '+0x28 (2 回目の対象) は、いつ使われるか未確認なので再生しません。',
  '下のタイムラインで、各行の SE・揺れ・モーションの開始をドラッグや数値で変えられます。',
].join('\n');

export interface Loaded {
  direct: GsTable;
  effects: EffectTable;
  names: Map<number, EffectModel>;
  sounds: SoundNames | null;
}

export function useLoaded(session: OahuSession): Loaded | null | 'none' {
  const [out, setOut] = useState<Loaded | null | 'none'>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([session.performances.tables(), session.performances.effectNames(), session.sounds().catch(() => null)]).then(([t, names, sounds]) => {
      if (live) setOut(t ? { ...t, names, sounds } : 'none');
    });
    return () => {
      live = false;
    };
  }, [session]);
  return out;
}

/** One phase: the rows of the slots played together on one unit (the first one sets the motion and the timing). */
function phase(session: OahuSession, l: Loaded, keys: string[], rows: number[], who: number, place: string, model: number = who): PreviewPhase | null {
  const { battle } = session;
  const perfs = rows.map((r) => OahuPerformances.forUnit(l.direct, r, who > 0)).filter((p) => !!p);
  const main = perfs[0];
  if (!main) return null;
  const effects: PreviewEffect[] = perfs.flatMap((p) => [p.effect, ...l.effects.addEffects(p.addEffect)])
    .map((e) => l.effects.effect(e)).filter((e) => !!e)
    .map((e) => ({ label: effectLabel(e, l.names), bone: e.bone, offset: e.offset, length: e.length || 60 }));
  const se = perfs.find((p) => p.se)?.se ?? 0;
  const index = se ? l.sounds?.index(se) ?? null : null;
  const name = who ? battle.monsterName(who) : '電波人間';
  return {
    title: `${place}: ${name} — D${perfs.map((p) => p.row).join('+')} ${keys[main.anim] ? `(${keys[main.anim]})` : ''}${l.sounds && se ? ` ${l.sounds.name(se)}` : ''}`,
    model: model ? battle.monsterModel(model, true) : null,
    anim: keys[main.anim] ?? '',
    timeline: (mf) => slotTimeline(main, l.effects, mf),
    effects,
    sound: index === null ? null : () => void soundPlayer.play(`oahu-perf-se:${index}`, async () => (await session.soundRenderer()).render(index)),
  };
}

/** The phases of the action for a user and a target (0 = a 電波人間). */
export function oahuPreviewPhases(session: OahuSession, l: Loaded, row: number, user: number, target: number): PreviewPhase[] {
  const a = session.battle.actions;
  const keys = animKeys(session.master);
  const slot = (key: string): number => a.get(row, key);
  const label = (key: string): string => OAHU_PERF_SLOTS.find((s) => s.key === key)!.label;
  // A transform with the look (category 22) swaps the model before the target's step (@0x219F98), the target being the user.
  const formed = a.get(row, 'category') === 22 && target === user && user ? session.battle.monsters.get(user, 'formModel') || user : target;
  return [
    phase(session, l, keys, [slot('perfUser'), slot('perfUser2')], user, label('perfUser')),
    phase(session, l, keys, [slot('perfTarget'), slot('perfTarget2')], target, label('perfTarget'), formed),
    phase(session, l, keys, [slot('perfField')], target, label('perfField'), formed),
  ].filter((p) => !!p);
}

/** "0x5D 005_ (モンスター)". */
function oahuAnimLabel(anim: number, keys: string[]): string {
  if (!anim) return 'なし';
  const hex = `0x${anim.toString(16).toUpperCase().padStart(2, '0')}`;
  return `${hex} ${keys[anim] ?? ''} (${anim >= OAHU_MONSTER_ANIMS ? 'モンスター' : '電波人間'})`;
}

/** "#526 ファイアビーム の使用者". */
function useLabel(session: OahuSession, u: OahuPerfUse): string {
  return `#${u.action} ${session.battle.actionName(u.action) || '(名前なし)'} の${OAHU_PERF_SLOTS.find((s) => s.key === u.key)!.label}`;
}

/** The pickers' view of RPG3's directData: rows, the actions' slots that use them, the effects and the names. */
function oahuSource(session: OahuSession, l: Loaded, keys: string[], uses: Map<number, OahuPerfUse[]>): PerfSource {
  return {
    rows: l.direct.rows,
    perf: (r) => decodeOahuPerformance(l.direct.row(r), r),
    uses: (r) => (uses.get(r) ?? []).map((u) => useLabel(session, u)),
    effects: l.effects, models: l.names, sounds: l.sounds,
    anim: (a) => oahuAnimLabel(a, keys),
  };
}

const SLOT_INFO = [
  'アクションの演出は、演出の表 (402F0000 の directData) の行を枠ごとに指します。1 行 = モーション + エフェクト + SE (+ 追加のエフェクト・タイミング)。',
  '「演出を選ぶ」で、ほかのアクションの演出の行をそのまま使えます。',
  'モーション・エフェクト・SE を変えると、同じ行をほかのアクションが使っているときは行を複製して書き換えます (ほかは変わりません)。',
  'モーションは、行が電波人間のものかモンスターのものかで、反対側のユニットには +0x00 の行のモーションが使われます。',
].join('\n');

/** The performance slots of an action: the directData row of each, its motion, effect, sound effect and added effects. */
export function OahuPerformanceSlots({ session, row, onEdit }: { session: OahuSession; row: number; onEdit: () => void }): ReactNode {
  const { battle } = session;
  const loaded = useLoaded(session);
  const keys = useMemo(() => animKeys(session.master), [session]);
  const edits = useMemo(() => new OahuPerfEdits(battle.actions, session.performances), [battle, session]);
  const [all, setAll] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  if (loaded === 'none') return <div className="muted">演出の表 (402F0000 の directData) を読めませんでした。</div>;
  if (!loaded) return null;
  const a = battle.actions;
  const uses = oahuPerformanceUses(a);
  const src = oahuSource(session, loaded, keys, uses);
  const apply = (f: () => void): void => {
    try {
      f();
    } catch (err) {
      alert((err as Error).message);
      return;
    }
    onEdit();
  };
  const slots = OAHU_PERF_SLOTS.filter((s) => all || a.get(row, s.key) || s.key === 'perfUser' || s.key === 'perfTarget');
  const hidden = OAHU_PERF_SLOTS.length - OAHU_PERF_SLOTS.filter((s) => a.get(row, s.key) || s.key === 'perfUser' || s.key === 'perfTarget').length;
  const motions = [
    { label: 'モンスター', rows: Array.from({ length: Math.max(0, keys.length - OAHU_MONSTER_ANIMS) }, (_, i) => OAHU_MONSTER_ANIMS + i) },
    { label: '電波人間', rows: Array.from({ length: OAHU_MONSTER_ANIMS - 1 }, (_, i) => i + 1) },
  ];
  return (
    <div className="perf-slots">
      <table className="enc-table perf-table">
        <thead>
          <tr><th>枠<InfoTip text={SLOT_INFO} /></th><th>演出の行</th><th>モーション</th><th>エフェクト</th><th>SE</th><th>追加のエフェクト</th><th></th></tr>
        </thead>
        <tbody>
          {slots.map((s) => {
            const p = a.get(row, s.key);
            const perf = p > 0 && p < loaded.direct.rows ? decodeOahuPerformance(loaded.direct.row(p), p) : null;
            const editable = edits.canEditSlot(row, s.key);
            const others = (uses.get(p) ?? []).filter((u) => !(u.action === row && u.key === s.key)).map((u) => useLabel(session, u));
            const set = (field: PerfField, v: number): void => apply(() => edits.setSlotField(row, s.key, field, v));
            return (
              <tr key={s.key}>
                <td className="with-info">{s.label}<InfoTip text={s.info} /></td>
                <td>
                  {perf
                    ? <span title={others.length ? `ほかに使っている所:\n${others.slice(0, 8).join('\n')}` : 'この枠だけが使う行'}>{`D${p}`}{others.length ? <span className="muted small">{` (共有 ${others.length})`}</span> : null}</span>
                    : <span className="muted">なし</span>}
                </td>
                <td>
                  {perf && editable
                    ? <MotionSelect value={perf.anim} groups={motions} label={src.anim} onChange={(v) => set('anim', v)} />
                    : <span className="muted">{perf ? src.anim(perf.anim) : ''}</span>}
                  {perf && perf.counterpart > 0 && perf.anim > 0 && (
                    <span className="muted small" title={`反対側のユニット (${perf.anim >= OAHU_MONSTER_ANIMS ? '電波人間' : 'モンスター'}) には D${perf.counterpart} のモーションが使われます (+0x00)`}>{` ⇄ D${perf.counterpart}`}</span>
                  )}
                </td>
                <td>{perf && <EffectButton src={src} value={perf.effect} disabled={!editable} onChange={(v) => set('effect', v)} />}</td>
                <td>{perf && loaded.sounds && (editable
                  ? <SoundButton game={session} sounds={loaded.sounds} value={perf.se} kind="se" title="演出の SE を選ぶ" onChange={(v) => set('se', v)} />
                  : <span className="muted">{loaded.sounds.label(perf.se)}</span>)}</td>
                <td>
                  {perf && (editable
                    ? <AddEffectSelect src={src} value={perf.addEffect} onChange={(v) => set('addEffect', v)} />
                    : <span className="muted">{perf.addEffect ? perfEffects(src, { ...perf, effect: 0 }) : ''}</span>)}
                </td>
                <td className="nowrap">
                  <button className="small" title="ほかのアクションの演出からこの枠の演出を選びます" onClick={() => setPicking(s.key)}>演出を選ぶ…</button>
                  {p > 0 && <button className="small" title="この枠を空にします" onClick={() => apply(() => edits.setSlot(row, s.key, 0))}>×</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row small">
        {hidden > 0 && <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{`空の枠も出す (${hidden})`}</label>}
        <button title="ほかのアクションの演出 (すべての枠) をこのアクションに写します" onClick={() => setCopying(true)}>演出を写す…</button>
      </div>
      {picking !== null && (
        <PerformancePicker src={src} current={a.get(row, picking)} title={`${OAHU_PERF_SLOTS.find((s) => s.key === picking)!.label}の演出を選ぶ`}
          onClose={() => setPicking(null)} onPick={(p) => { const k = picking; setPicking(null); apply(() => edits.setSlot(row, k, p)); }} />
      )}
      {copying && (
        <OahuActionPicker battle={battle} title="演出を写す元のアクション" current={row} onClose={() => setCopying(false)}
          onPick={(from) => { setCopying(false); apply(() => edits.copyPerformance(row, from)); }} />
      )}
    </div>
  );
}

/** The rows the preview plays, each with its phase (the slots played together share one). */
function previewTracks(session: OahuSession, l: Loaded, row: number, timings: PhaseTiming[], user: number, target: number): TimelineSlot[] {
  const a = session.battle.actions;
  const groups: [string[], number][] = [[['perfUser', 'perfUser2'], user], [['perfTarget', 'perfTarget2'], target], [['perfField'], target]];
  const out: TimelineSlot[] = [];
  let phase = 0;
  for (const [keys, who] of groups) {
    const rows = keys.map((k) => [k, a.get(row, k)] as const).filter(([, r]) => r > 0 && r < l.direct.rows);
    if (!rows.length) continue;
    const timing = timings[phase];
    for (const [k, r] of rows) {
      const perf = OahuPerformances.forUnit(l.direct, r, who > 0)!;
      out.push({
        key: k, label: OAHU_PERF_SLOTS.find((s) => s.key === k)!.label, row: r, perf, phase,
        // Each row runs on its own timeline; the slot played first decides the motion (its length from the viewer).
        timeline: slotTimeline(perf, l.effects, timing?.motionFrames ?? null),
        motionFrames: timing?.motionFrames ?? null,
        editable: true,
        effects: [perf.effect, ...l.effects.addEffects(perf.addEffect)].filter(Boolean).map((e) => effectLabel(l.effects.effect(e), l.names)).join(' + '),
        se: l.sounds?.name(perf.se) ?? '',
        hit: false,
      });
    }
    phase++;
  }
  return out;
}

/** The preview on the action page: who uses it and who is hit, picked from the monsters (or a 電波人間). */
export function OahuActionPreview({ session, row, users, onEdit }: { session: OahuSession; row: number; users: number[]; onEdit: () => void }): ReactNode {
  const { battle } = session;
  const loaded = useLoaded(session);
  // Made after the first render: the viewer is DOM (none while rendering on the server, e.g. in the tests).
  const [viewer, setViewer] = useState<PerformanceViewer | null>(null);
  const [timings, setTimings] = useState<PhaseTiming[]>([]);
  const [at, setAt] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const v = new PerformanceViewer();
    v.onTimelines = setTimings;
    v.onFrame = (p, f) => setAt([p, f]);
    setViewer(v);
  }, []);
  const edits = useMemo(() => new OahuPerfEdits(battle.actions, session.performances), [battle, session]);
  const self = battle.actions.get(row, 'side') === 1;
  const [user, setUser] = useState(users[0] ?? 0);
  const [target, setTarget] = useState(self ? users[0] ?? 0 : users.length ? 0 : 1);
  const [picking, setPicking] = useState<'user' | 'target' | null>(null);
  const a = battle.actions;
  const direct = loaded && loaded !== 'none' ? loaded.direct : null;
  // Reload when the slots or their rows change.
  const sig = [row, user, target, loaded ? 1 : 0, ...OAHU_PERF_SLOTS.map((s) => a.get(row, s.key)), a.get(row, 'category'), user ? battle.monsters.get(user, 'formModel') : 0,
    ...OAHU_PERF_SLOTS.map((s) => { const p = a.get(row, s.key); return direct && p > 0 && p < direct.rows ? [...direct.row(p)].join('.') : ''; })].join(',');
  const phases = useMemo(() => (loaded && loaded !== 'none' ? oahuPreviewPhases(session, loaded, row, user, target) : []), [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- `sig` holds what the phases depend on
  useEffect(() => {
    setTimings([]);
    void viewer?.show(phases);
  }, [phases, viewer]);
  if (loaded === 'none') return <div className="muted small">演出の表 (402F0000 の directData) を読めませんでした。</div>;
  if (!OAHU_PERF_SLOTS.some((s) => a.get(row, s.key))) return null;
  const ally = [{ value: 0, label: '電波人間', sub: '仮の姿' }];
  const who = (m: number, onClick: () => void, label: string): ReactNode => (
    <button className="small perf-who" title={`${label}を選ぶ`} onClick={onClick}>
      {m ? <Photo model={battle.monsterModel(m)} /> : <span className="photo picker-none" />}
      <span>{m ? `${battle.monsterName(m)} #${m}` : '電波人間 (仮の姿)'}</span>
    </button>
  );
  return (
    <div className="perf-preview">
      <div className="row small">
        <span className="with-info">{'プレビュー'}<InfoTip text={PREVIEW_INFO} /></span>
        <label>{'使う側 '}{who(user, () => setPicking('user'), '使う側')}</label>
        <label>{'対象 '}{who(target, () => setPicking('target'), '対象')}</label>
      </div>
      {picking && (
        <OahuMonsterPicker battle={battle} current={picking === 'user' ? user : target} title={picking === 'user' ? '使う側を選ぶ' : '対象を選ぶ'}
          choices={ally} groups={picking === 'user' && users.length ? [{ label: 'このワザを持つモンスター', rows: users }] : []}
          onClose={() => setPicking(null)} onPick={(m) => { if (picking === 'user') setUser(m); else setTarget(m); setPicking(null); }} />
      )}
      {viewer && <Dom node={viewer.el} />}
      {loaded && <div className="muted small">{phases.map((p) => p.title).join(' → ')}</div>}
      {loaded && (
        <SlotTimelines slots={previewTracks(session, loaded, row, timings, user, target)} effects={loaded.effects} layout={OAHU_PERF} at={at}
          onSeek={(p, f) => viewer?.showAt(p, f)}
          onEdit={(t, field, v) => {
            try {
              edits.setSlotField(row, t.key as string, field, v);
            } catch (err) {
              alert((err as Error).message);
              return;
            }
            onEdit();
          }} />
      )}
    </div>
  );
}
