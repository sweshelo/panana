// RPG3's BGM and sound effects (#/sounds/<row>, #80): RPG2's list and play buttons (pages/sounds SoundView), with RPG3's
// uses: the mapData rows (and the dungeons that point at them), the fixed battles, and the BGMs written in the code.
import { useMemo, type ReactNode } from 'react';
import type { SoundNames } from '../game/sound';
import { SoundView } from '../pages/sounds';
import { useSticky } from '../ui/book';
import { InfoTip } from '../ui/InfoTip';
import { useAsync } from '../ui/useAsync';
import { OAHU_SECTIONS } from './code';
import type { OahuSession } from './session';
import { OAHU_SOUND_USE_KIND, oahuSoundUses, type OahuSoundUse } from './sound';

export const oahuSoundHref = (row: number): string => `#/sounds/${row}`;

const TEXT_END = OAHU_SECTIONS.text[0] + OAHU_SECTIONS.text[1];

export function OahuSoundPage({ session, arg }: { session: OahuSession; arg: string | undefined }): ReactNode {
  const sounds = useAsync(() => session.sounds(), [session]);
  if (sounds instanceof Error) return <div className="book"><p className="muted">{`音の表を読めませんでした: ${sounds.message}`}</p></div>;
  if (!sounds) return <div className="book"><p className="muted">読み込み中…</p></div>;
  return <OahuSoundBook session={session} sounds={sounds} arg={arg} />;
}

export function OahuSoundBook({ session, sounds, arg }: { session: OahuSession; sounds: SoundNames; arg: string | undefined }): ReactNode {
  const uses = useMemo(() => oahuSoundUses(session.master, session.battle, session.code, TEXT_END), [session]);
  const selected = useSticky(arg ? Number(arg) : undefined, (r) => r >= 1 && r < sounds.rows, () => 1);
  return (
    <div className="book">
      <SoundView game={session} sounds={sounds} selected={selected} href={oahuSoundHref} uses={(r) => uses.get(r)?.length ?? 0}
        usesTitle="この音を使う場所の数 (mapData の欄・決まった戦闘・コード)" usedLabel="使われている">
        <OahuSoundUses use={uses.get(selected) ?? []} hasCode={!!session.code} />
      </SoundView>
    </div>
  );
}

const USES_INFO = [
  'マップ: mapData の [4] フィールドの BGM・[5] 戦闘の BGM・[6] 足音。マップがどの行を使うかはマップのキーで決まります (マップとの対応は #66)。ダンジョン名は、mapGroup +0x2E (+0x2F) がその行のダンジョンです。',
  '戦闘の BGM は、マップの行ではなくダンジョンの行 (mapGroup +0x2E) の [5] が鳴ります。ダンジョンが指していない行の [5] は鳴らないかもしれません (推定)。',
  'モンスターごとの BGM はありません。決まった戦闘 (ボス戦など) を BGM 指定なしで始めると、群れの +0x32 bit2 が立っていれば BGM_BATTLE_2、なければ BGM_BATTLE_1 です。',
  'コード: Update の code.bin で、BGM の行を定数で渡している呼び出し。',
].join('\n');

function OahuSoundUses({ use, hasCode }: { use: OahuSoundUse[]; hasCode: boolean }): ReactNode {
  return (
    <>
      <h3 className="with-info">{`使われている場所 (${use.length})`}<InfoTip text={USES_INFO} /></h3>
      {use.length ? (
        <table className="enc-table">
          <tbody>
            <tr><th>種類</th><th>欄・場面</th><th>どこ</th><th>名前</th></tr>
            {use.map((u, i) => (
              <tr key={i} className={u.unsure ? 'muted' : ''}>
                <td>{OAHU_SOUND_USE_KIND[u.kind]}</td>
                <td>{u.what}{u.unsure ? ' (推定)' : ''}</td>
                <td className="mono small">{u.where}</td>
                <td>
                  {u.links?.map((l, j) => <span key={j}>{j ? '、' : ''}{l.href ? <a href={l.href}>{l.label}</a> : l.label}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">マップの設定・決まった戦闘・コードのどこにも見つかりません (イベントのスクリプトから鳴らす音は、まだ数えていません)。</div>
      )}
      {!hasCode && <p className="muted small">Update を追加すると、code.bin の中で決まった BGM (ボス戦・エンディングなど) も表示します。</p>}
    </>
  );
}
