// The sound picker's "ほかの作品から移植" tab (RPG2): the BGM / ME streams of the other opened games, each playable;
// picking one asks which of RPG2's rows 1-255 should play it from now on (port/bgm.ts). A BGM ported before is reused,
// and the rows already playing it are offered first.
import { useState, type ReactNode } from 'react';
import { bgmCandidates, portBgm, rendererOf, rowsPlaying, titleName, type BgmCandidate } from '../port/bgm';
import { SOUND_KIND, type SoundKind, type SoundNames } from '../game/sound';
import type { Session } from '../session';
import { soundPlayer, usePlayer } from '../sound/player';
import { useAsync } from './useAsync';
import type { Opened } from './workspace';

const BGM_SECONDS = 300;

/** ▶ for a sound of another opened game. */
function CandidatePlay({ opened, c }: { opened: Opened; c: BgmCandidate }): ReactNode {
  const st = usePlayer();
  const key = `port:${c.title}:${c.index}`;
  const on = st.key === key;
  const error = st.error?.key === key ? st.error.message : null;
  return (
    <button type="button" className={`play-button${on ? ' on' : ''}${error ? ' failed' : ''}`} title={error ? `再生できません: ${error}` : on ? '止める' : `${c.name} を試聴`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void soundPlayer.toggle(key, async () => (await rendererOf(opened, c.title)!).render(c.index, BGM_SECONDS, true));
      }}>
      {on ? (st.loading ? '…' : '■') : '▶'}
    </button>
  );
}

export function BgmPortTab({ opened, session, sounds, query, max, usage, onPicked }: {
  opened: Opened;
  /** RPG2's session. */
  session: Session;
  sounds: SoundNames;
  /** The picker's filter (name or row). */
  query: string;
  /** Largest row the field holds. */
  max: number;
  usage?: (row: number) => string;
  /** The row that plays the ported BGM now. */
  onPicked: (row: number) => void;
}): ReactNode {
  const list = useAsync(() => bgmCandidates(opened), [opened]);
  const [chosen, setChosen] = useState<BgmCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<SoundKind | ''>('bgm');
  const playing = useAsync(() => (chosen ? rowsPlaying(session, chosen) : Promise.resolve([])), [chosen, session]);

  if (list === undefined) return <div className="muted">ほかの作品の音を読んでいます…</div>;
  if (list instanceof Error) return <div className="error">{`ほかの作品の音を読めません: ${list.message}`}</div>;
  if (!list.length) return <div className="muted">ほかの作品を開いていないか、移植できるストリームの曲がありません。上のバーの「ROM」から、ほかの作品の CIA を追加してください。</div>;

  const port = async (row: number): Promise<void> => {
    if (!chosen) return;
    const old = sounds.name(row) || `サウンド ${row}`;
    const u = usage?.(row);
    if (!confirm(`行 ${row} (${old}) が鳴らす曲を、${titleName(chosen.title)} の ${chosen.name} に差し替えます。${u ? `\nこの行を使う ${u} の曲がすべて変わります。` : ''}\n元の曲は sound.bcsar に残り、BGM・効果音のページで戻せます。`)) return;
    setBusy(true);
    setError(null);
    try {
      await portBgm(opened, session, chosen, row);
      session.scheduleSave();
      onPicked(row);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!chosen) {
    const q = query.trim().toUpperCase();
    const shown = list.filter((c) => !q || c.name.includes(q));
    return (
      <>
        <p className="muted small">開いているほかの作品の BGM・ME (ストリームの曲) です。選ぶと、電波人間のRPG2 のどの番号 (soundData の行) で鳴らすかを聞きます。</p>
        {[...new Set(shown.map((c) => c.title))].map((t) => (
          <div key={t}>
            <h3>{titleName(t)}</h3>
            <div className="sound-grid">
              {shown.filter((c) => c.title === t).map((c) => (
                <div key={c.index} role="button" tabIndex={0} className="sound-cell" title={`${c.name} を移植する`}
                  onClick={() => setChosen(c)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setChosen(c))}>
                  <CandidatePlay opened={opened} c={c} />
                  <span className="sound-cell-text">
                    <span className="mono sound-name">{c.name}</span>
                    <span className="muted small">{c.kind === 'bgm' ? 'BGM' : 'ME (短い曲)'}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!shown.length && <div className="muted">見つかりません</div>}
      </>
    );
  }

  const top = Math.min(max, sounds.rows - 1);
  const rows: number[] = [];
  for (let r = 1; r <= top; r++) if (!kind || sounds.kind(r) === kind) rows.push(r);
  const already = Array.isArray(playing) ? playing.filter((r) => r <= max) : [];
  return (
    <>
      <div className="row">
        <button type="button" className="small" disabled={busy} onClick={() => setChosen(null)}>← 曲を選び直す</button>
        <CandidatePlay opened={opened} c={chosen} />
        <strong className="mono">{chosen.name}</strong>
        <span className="muted">{`(${titleName(chosen.title)})`}</span>
      </div>
      {already.length > 0 && (
        <div className="row">
          <span>すでに移植して、次の行で鳴らしています:</span>
          {already.map((r) => <button key={r} type="button" className="small" disabled={busy} onClick={() => onPicked(r)}>{`#${r} を使う`}</button>)}
        </div>
      )}
      <p className="muted small">
        {`この曲を鳴らす行を選んでください。電波人間のRPG2 のマップ・ボス戦の BGM は行 ${max} までしか指せず、その行はすべてゲームの音で埋まっているので、選んだ行の曲が差し替わります (その行を使うほかの場所も変わります)。`}
      </p>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as SoundKind | '')}>
          <option value="">すべて</option>
          {Object.entries(SOUND_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {busy && <span className="muted">移植しています…</span>}
      </div>
      {error && <p className="error small">{`移植できませんでした: ${error}`}</p>}
      <div className="sound-grid">
        {rows.map((r) => (
          <div key={r} role="button" tabIndex={0} aria-disabled={busy} className="sound-cell" title={`行 ${r} で鳴らす`}
            onClick={() => !busy && void port(r)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !busy && void port(r))}>
            <span className="sound-cell-text">
              <span className="mono sound-name">{sounds.name(r) || `サウンド ${r}`}</span>
              <span className="muted small">{`#${r}・${SOUND_KIND[sounds.kind(r)]}`}</span>
              {usage?.(r) && <span className="muted small">{usage(r)}</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
