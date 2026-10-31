// The sound picker's "ほかの作品から移植" tab (RPG2): the BGM / ME streams of the other opened games, each playable;
// picking one ports it into a soundData row after the game's and picks that row (port/bgm.ts). A BGM ported before
// is reused.
import { useState, type ReactNode } from 'react';
import { bgmCandidates, portBgm, portedRows, rendererOf, titleName, type BgmCandidate } from '../port/bgm';
import { BGM_EXT_SLOTS } from '../game/bgmext';
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

export function BgmPortTab({ opened, session, query, onPicked }: {
  opened: Opened;
  /** RPG2's session. */
  session: Session;
  /** The picker's filter (name). */
  query: string;
  /** The soundData row that plays the ported BGM. */
  onPicked: (row: number) => void;
}): ReactNode {
  const list = useAsync(() => bgmCandidates(opened), [opened]);
  const ported = useAsync(() => portedRows(session), [session]);
  const [busy, setBusy] = useState<BgmCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (list === undefined) return <div className="muted">ほかの作品の音を読んでいます…</div>;
  if (list instanceof Error) return <div className="error">{`ほかの作品の音を読めません: ${list.message}`}</div>;
  if (!list.length) return <div className="muted">ほかの作品を開いていないか、移植できるストリームの曲がありません。上のバーの「ROM」から、ほかの作品の CIA を追加してください。</div>;
  const rows = ported instanceof Map ? ported : new Map<string, number>();

  const port = async (c: BgmCandidate): Promise<void> => {
    if (busy) return;
    setBusy(c);
    setError(null);
    try {
      const row = await portBgm(opened, session, c);
      session.scheduleSave();
      onPicked(row);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const q = query.trim().toUpperCase();
  const shown = list.filter((c) => !q || c.name.includes(q));
  return (
    <>
      <p className="muted small">
        {`開いているほかの作品の BGM・ME (ストリームの曲) です。選ぶと 電波人間のRPG2 の sound.bcsar に入れて soundData に行を足し、この欄に選びます。足した行は BGM の欄で 0x80〜 の値になり、書き出しにコードのパッチ「BGM の追加枠」が入ります (${BGM_EXT_SLOTS} 曲まで)。`}
      </p>
      {busy && <p className="muted small">{`${busy.name} を移植しています…`}</p>}
      {error && <p className="error small">{`移植できませんでした: ${error}`}</p>}
      {[...new Set(shown.map((c) => c.title))].map((t) => (
        <div key={t}>
          <h3>{titleName(t)}</h3>
          <div className="sound-grid">
            {shown.filter((c) => c.title === t).map((c) => {
              const row = rows.get(`${c.title}/${c.name}`);
              return (
                <div key={c.index} role="button" tabIndex={0} aria-disabled={!!busy} className="sound-cell" title={row === undefined ? `${c.name} を移植して選ぶ` : `移植済みの行 ${row} を選ぶ`}
                  onClick={() => void port(c)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), void port(c))}>
                  <CandidatePlay opened={opened} c={c} />
                  <span className="sound-cell-text">
                    <span className="mono sound-name">{c.name}</span>
                    <span className="muted small">{`${c.kind === 'bgm' ? 'BGM' : 'ME (短い曲)'}${row === undefined ? '' : `・移植済み (#${row})`}`}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!shown.length && <div className="muted">見つかりません</div>}
    </>
  );
}
