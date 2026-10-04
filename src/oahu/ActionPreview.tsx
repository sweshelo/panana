// Preview of an RPG3 action's performance with the same viewer as RPG2 (pages/perfview.ts): the user's slots (+0x1E
// with +0x20), then the target's (+0x22 with +0x24), then the one for the target's side (+0x26). The monsters play
// their skill motions (the motion BCH of monsterDesign +0x14), the effects are marked where they come out, and the
// sound effects play. 電波人間 are shown as the stand-in.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GsTable } from '../archive/gstable';
import { animKeys, effectLabel, slotTimeline, type EffectModel, type EffectTable } from '../game/performance';
import type { SoundNames } from '../game/sound';
import { PerformanceViewer, type PreviewEffect, type PreviewPhase } from '../pages/perfview';
import { soundPlayer } from '../sound/player';
import { InfoTip } from '../ui/InfoTip';
import { Dom } from '../ui/mount';
import { Photo } from '../ui/Photo';
import { OAHU_PERF_SLOTS, OahuPerformances } from './performance';
import { OahuMonsterPicker } from './pickers';
import type { OahuSession } from './session';

const PREVIEW_INFO = [
  '使用者 (+0x1E と、同時に重ねる +0x20) → 対象 (+0x22 と +0x24) → 場 (+0x26) の順に、演出の表 (402F0000 の directData) の行を再生します。',
  'モンスターのワザのモーションは、モデルとは別の BCH (monsterDesign +0x14) から読みます。SE も実際のデータで鳴らします。',
  'エフェクトはパーティクルの形式が未解析なので、出る位置 (ボーン) と時間を印で示します。電波人間のモデルは読めていないので、仮の姿 (枠線) で示します。',
  '種別 22 の変身では、対象の段 (使う側自身) を「変身の見た目」(+0x62) のモデルで示します。',
  '+0x28 (2 回目の対象) は、いつ使われるか未確認なので再生しません。',
].join('\n');

interface Loaded {
  direct: GsTable;
  effects: EffectTable;
  names: Map<number, EffectModel>;
  sounds: SoundNames | null;
}

function useLoaded(session: OahuSession): Loaded | null | 'none' {
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

/** The preview on the action page: who uses it and who is hit, picked from the monsters (or a 電波人間). */
export function OahuActionPreview({ session, row, users }: { session: OahuSession; row: number; users: number[] }): ReactNode {
  const { battle } = session;
  const loaded = useLoaded(session);
  // Made after the first render: the viewer is DOM (none while rendering on the server, e.g. in the tests).
  const [viewer, setViewer] = useState<PerformanceViewer | null>(null);
  useEffect(() => setViewer(new PerformanceViewer()), []);
  const self = battle.actions.get(row, 'side') === 1;
  const [user, setUser] = useState(users[0] ?? 0);
  const [target, setTarget] = useState(self ? users[0] ?? 0 : users.length ? 0 : 1);
  const [picking, setPicking] = useState<'user' | 'target' | null>(null);
  const a = battle.actions;
  const sig = [row, user, target, loaded ? 1 : 0, ...OAHU_PERF_SLOTS.map((s) => a.get(row, s.key)), a.get(row, 'category'), user ? battle.monsters.get(user, 'formModel') : 0].join(',');
  const phases = useMemo(() => (loaded && loaded !== 'none' ? oahuPreviewPhases(session, loaded, row, user, target) : []), [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- `sig` holds what the phases depend on
  useEffect(() => void viewer?.show(phases), [phases, viewer]);
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
    </div>
  );
}
