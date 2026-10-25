// The first game's BGM and sound effects (#/sounds/<row>, #176): the list, play buttons and row of the shared SoundView
// (pages/sounds.tsx), with the places the first game is known to use a row (sound.ts).
import { useMemo, type ReactNode } from 'react';
import type { SoundNames } from '../game/sound';
import { SoundView } from '../pages/sounds';
import { useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { useAsync } from '../ui/useAsync';
import { useHonoluluRevision } from './ItemPage';
import type { HonoluluSession } from './session';
import { honoluluSoundUses, type HonoluluSoundUse } from './sound';

export const honoluluSoundHref = (row: number): string => `#/sounds/${row}`;

export function HonoluluSoundPage({ session, arg }: { session: HonoluluSession; arg: string | undefined }): ReactNode {
  const sounds = useAsync(() => session.sounds(), [session]);
  if (sounds instanceof Error) return <div className="book"><p className="muted">{`音の表を読めませんでした: ${sounds.message}`}</p></div>;
  if (!sounds) return <div className="book"><p className="muted">読み込み中…</p></div>;
  return <HonoluluSoundBook session={session} sounds={sounds} arg={arg} />;
}

export function HonoluluSoundBook({ session, sounds, arg }: { session: HonoluluSession; sounds: SoundNames; arg: string | undefined }): ReactNode {
  const revision = useHonoluluRevision(session);
  const uses = useMemo(() => honoluluSoundUses(session.master), [session, revision]);
  const selected = useSticky(arg ? Number(arg) : undefined, (r) => r >= 1 && r < sounds.rows, () => 1);
  return (
    <div className="book">
      <SoundView game={session} sounds={sounds} selected={selected} href={honoluluSoundHref} uses={(r) => uses.get(r)?.length ?? 0}
        usesTitle="この音を使う場所の数 (mapData +0x07 の階の BGM、推定)" usedLabel="使われている">
        <HonoluluSoundUses use={uses.get(selected) ?? []} />
      </SoundView>
    </div>
  );
}

const USES_INFO = [
  '階の BGM: 階のタイルセット (mapData) の行の +0x07。全行がタイルセットに合う BGM_FLD_* を指し、コードが音の関数 (FUN_0020C2A0) に渡すので階の BGM と推定しています (実機では未確認)。ダンジョンは、dungeonData +0x16 がその行のものです (階の定義の頭で別の行を選ぶ階もあります)。',
  'ボス戦の BGM (bossBgm)・音の種類 (soundDataType)・コードの中で決まる BGM はまだ解析中です (sweshelo/naauao#55)。',
].join('\n');

function HonoluluSoundUses({ use }: { use: HonoluluSoundUse[] }): ReactNode {
  return (
    <>
      <h3 className="with-info">{`使われている場所 (${use.length})`}<InfoTip text={USES_INFO} /></h3>
      {use.length ? (
        <table className="enc-table">
          <tbody>
            <tr><th>欄</th><th>どこ</th><th>ダンジョン</th></tr>
            {use.map((u, i) => (
              <tr key={i} className={u.unsure ? 'muted' : ''}>
                <td>{u.what}{u.unsure ? ' (推定)' : ''}</td>
                <td className="mono small">{u.where}</td>
                <td>{u.dungeons.join('、') || <span className="muted">(なし)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">分かっている表 (mapData +0x07 の階の BGM) には見つかりません。ボス戦・イベント・コードから鳴らす音は、まだ数えていません。</div>
      )}
    </>
  );
}
