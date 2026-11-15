// RPG FREE!'s BGM and sound effects (#/sounds/<row>): the list, play buttons and row of the shared SoundView
// (pages/sounds.tsx, RPG2's page), with the places of RPG FREE!'s data that name a row (sound.ts): the battle fields,
// the maps' sounds and the doors' opening sounds of every content. The contents' archives are read for them, so the
// uses come a moment after the list.
import { useEffect, useState, type ReactNode } from 'react';
import type { SoundNames } from '../game/sound';
import { SoundView } from '../pages/sounds';
import { useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { useAsync } from '../ui/useAsync';
import { lanaiSoundHref } from './hrefs';
import { useLanaiRevision } from './MonsterEditor';
import type { LanaiSession } from './session';
import { LANAI_SOUND_USE_KIND, lanaiMasterSoundUses, lanaiSoundUses, type LanaiSoundUse } from './sound';

export { lanaiSoundHref };

export function LanaiSoundPage({ session, arg }: { session: LanaiSession; arg: string | undefined }): ReactNode {
  const revision = useLanaiRevision(session);
  // again after an edit (a BGM ported from another game adds a row and changes sound.bcsar)
  const sounds = useAsync(() => session.sounds(), [session, revision]);
  // the list stays while the names are read again
  const [shown, setShown] = useState<SoundNames | null>(null);
  useEffect(() => {
    if (sounds && !(sounds instanceof Error)) setShown(sounds);
  }, [sounds]);
  if (sounds instanceof Error)
    return (
      <div className="book">
        <p className="muted">{`音の表を読めませんでした: ${sounds.message}`}</p>
      </div>
    );
  if (!shown)
    return (
      <div className="book">
        <p className="muted">読み込み中…</p>
      </div>
    );
  return <LanaiSoundBook session={session} sounds={shown} arg={arg} />;
}

export function LanaiSoundBook({
  session,
  sounds,
  arg,
  uses: given,
}: {
  session: LanaiSession;
  sounds: SoundNames;
  arg: string | undefined;
  /** The uses when they were read already (the tests); else they are read from every content. */
  uses?: Map<number, LanaiSoundUse[]>;
}): ReactNode {
  const [progress, setProgress] = useState<[number, number] | null>(null);
  // read once: the tables are the session's own, so the list is made again from them when the page is asked to
  const [round, setRound] = useState(0);
  const read = useAsync(
    () => (given ? Promise.resolve(given) : lanaiSoundUses(session, (done, total) => setProgress([done, total]))),
    [session, given, round],
  );
  const ready = read && !(read instanceof Error) ? read : null;
  // until the contents are read: the master's uses
  const uses = ready ?? given ?? lanaiMasterSoundUses(session);
  const selected = useSticky(
    arg ? Number(arg) : undefined,
    (r) => r >= 1 && r < sounds.rows,
    () => 1,
  );
  return (
    <div className="book">
      <SoundView
        game={session}
        sounds={sounds}
        selected={selected}
        href={lanaiSoundHref}
        uses={(r) => uses.get(r)?.length ?? 0}
        usesTitle="この音を使う場所の数 (戦闘の背景・マップの音・扉の開く音)"
        usedLabel="使われている"
      >
        <LanaiSoundUses use={uses.get(selected) ?? []} />
        <p className="muted small">
          {read instanceof Error
            ? `コンテンツの表を読めませんでした: ${read.message}`
            : ready
              ? '全コンテンツの表を調べました。'
              : `コンテンツの表を調べています${progress ? ` (${progress[0]} / ${progress[1]})` : ''}… 今は master の分だけを表示しています。`}{' '}
          {ready && !given && (
            <button
              type="button"
              title="マップや戦闘の背景を編集した後に、使われている場所を数え直します"
              onClick={() => setRound(round + 1)}
            >
              数え直す
            </button>
          )}
        </p>
      </SoundView>
    </div>
  );
}

const USES_INFO = [
  '戦闘の背景: master の BattleField と各コンテンツの BattleFieldContents の +0x08 (戦闘の BGM)。群れ (MonsterGroup +0x00) がその行を選びます。',
  'マップ: 各コンテンツの MapData の +0x04 フィールドの BGM・+0x06 戦闘の前の曲・+0x08 エンカウントの効果音。マップのページの「音・戦闘背景」で変えられます。',
  '扉: 鍵つきの扉などの動作 (EventObject) の引数「開く音」。',
  'コードやステージのスクリプト (CRO、ScriptSound.Play など) から鳴らす音は数えていません。',
].join('\n');

function LanaiSoundUses({ use }: { use: LanaiSoundUse[] }): ReactNode {
  return (
    <>
      <h3 className="with-info">
        {`使われている場所 (${use.length})`}
        <InfoTip text={USES_INFO} />
      </h3>
      {use.length ? (
        <table className="enc-table">
          <tbody>
            <tr>
              <th>種類</th>
              <th>欄</th>
              <th>どこ</th>
              <th>コンテンツ</th>
            </tr>
            {use.map((u, i) => (
              <tr key={i}>
                <td>{LANAI_SOUND_USE_KIND[u.kind]}</td>
                <td>{u.what}</td>
                <td className="mono small">{u.where}</td>
                <td>
                  {u.content ? <a href={u.content.href}>{u.content.label}</a> : <span className="muted">master</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">
          分かっている表 (戦闘の背景・マップの音・扉の開く音) には見つかりません。コードやスクリプトから鳴らす音は、
          まだ数えていません。
        </div>
      )}
    </>
  );
}
