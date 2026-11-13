// The event script of an added stage (eventScript.ts), edited as text on the stage's page: what is written here is
// built into the stage's CRO when the MOD is written (stageScript.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { talkMessageOffset } from './actions';
import type { LanaiContent } from './contents';
import { ScriptError, STAGE_BIT_FLAGS, STAGE_BYTE_FLAGS } from './eventScript';
import { lanaiMaps, type LanaiMaps } from './maps';
import type { LanaiSession } from './session';
import { checkStageScript, type StageScriptCheck } from './stageScript';

export const STAGE_SCRIPT_EXAMPLE = `// 変数: byte = 数値 (0〜255)、bit = フラグ (0 / 1)。reset を付けると、ステージを離れるたびに 0 に戻る
var STATE_A: byte

// MapGroup 1 のイベント 5 のキャラに話しかけたとき
on talk(1, 5) {
  switch (STATE_A) {
    case 0: talk(0x60)
    case 1: talk(0x61)
    case 2: talk(0x62); return
  }
  if (ask(0x63)) {
    popup(11); se(0x84)
    talk(0x64)
    STATE_A = 2
  } else {
    STATE_A = 1
    talk(0x65)
  }
}
`;

const HELP: [string, string][] = [
  ['var 名前: byte / bit [reset]', '変数。reset を付けると、ステージを離れるたびに 0 に戻る (訪問ごとの状態)'],
  ['on talk(MapGroup, イベント) { … }', 'キャラ (区画 5) に話しかけたとき。キャラは主人公のほうを向く'],
  ['on area(MapGroup, イベント) { … }', '範囲 (区画 8) に入ったとき'],
  ['talk(行 ID)', '台詞。on talk の中では話している間キャラの口が動く'],
  ['say(行 ID)', '台詞 (口は動かさない)。話者が主人公の行は、先頭の電波人間の性格の行に替わる'],
  ['ask(行 ID)', '「はい / いいえ」を聞く。if (ask(…)) { はい } else { いいえ }'],
  ['名前 = 値', '変数に書く'],
  [
    'if (条件) { … } else { … }',
    '条件: 名前、!名前、名前 == 値 (!= < <= > >=)、item(ID) >= 個数、state(イベント) >= 値、ask(行 ID)',
  ],
  ['switch (名前) { case 値: … default: … }', '値で分ける。case は下へ続かない (break は書かなくてよい)'],
  ['return', 'イベントをそこで終える'],
  ['popup(アイコン)', '先頭の電波人間の頭の上にアイコンを出す (11 = 汗)'],
  ['se(音)', '音を鳴らす (SoundData の行)'],
  ['addItem(ID, 個数) / getItem(ID, 個数)', 'アイテムを増やす (負の数で減らす)。getItem は「手に入れた」の文を出す'],
  ['addGold(金額)', 'お金を増やす (負の数で減らす)'],
  ['openDoor(イベント) / closeDoor(イベント)', '「外から開ける扉」(動作の型 17) を開ける / 閉める'],
  ['wait(秒)', '待つ'],
  ['disable()', 'on area の中で: この範囲をもう働かなくする'],
  ['collision(イベント, 0 / 1)', '範囲を働かなくする / 働くようにする'],
];

/** The lines of a group's talk table with the IDs the script names them by. */
function TalkLines({ session, maps, group }: { session: LanaiSession; maps: LanaiMaps; group: number }): ReactNode {
  const t = maps.talkTable(group);
  const message = t ? talkMessageOffset(t) : undefined;
  if (!t || message === undefined) return <p className="muted small">{`MapGroup ${group}: 台詞の表がありません。`}</p>;
  return (
    <details>
      <summary className="small">{`MapGroup ${group} の台詞 (${t.name}、${t.rows} 行)`}</summary>
      <table className="book-table">
        <thead>
          <tr>
            <th>行 ID</th>
            <th>台詞</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: t.rows }, (_, r) => (
            <tr key={r}>
              <td className="mono">{`0x${(t.rowId(r) & 0x7fffffff).toString(16).toUpperCase()}`}</td>
              <td className="small">
                {t.isString(r, message) ? session.plainAt(t, t.u32(r, message)).replace(/\s+/g, ' ').trim() : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function LanaiStageScriptEditor({
  session,
  content,
}: {
  session: LanaiSession;
  content: LanaiContent;
}): ReactNode {
  const archive = content.archive.toUpperCase();
  const stored = session.stageScripts.get(archive);
  const [source, setSource] = useState(stored?.source ?? '');
  const [error, setError] = useState('');
  const [check, setCheck] = useState<StageScriptCheck | null>(null);
  const [maps, setMaps] = useState<LanaiMaps | null>(null);
  const run = (text: string): void => {
    if (!text.trim()) {
      setCheck(null);
      setError('');
      return;
    }
    checkStageScript(session, content, text).then(
      (c) => {
        setCheck(c);
        setError('');
      },
      (e: Error) => {
        setCheck(null);
        setError(e instanceof ScriptError ? e.message : `確認できません: ${e.message}`);
      },
    );
  };
  useEffect(() => {
    let live = true;
    void lanaiMaps(session, content).then((m) => live && setMaps(m));
    if (stored) run(stored.source);
    return () => {
      live = false;
    };
    // the stage's own script is read once; edits stay in the text until applied
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, archive]);
  const dirty = source !== (stored?.source ?? '');
  const apply = (): void => {
    try {
      session.setStageScript(archive, source);
      session.edited();
      run(source);
    } catch (e) {
      setCheck(null);
      setError((e as Error).message);
    }
  };
  const groups = maps ? maps.groups.flatMap((g, k) => (g && maps.eventTable(k) ? [k] : [])) : [];
  return (
    <>
      <h3>イベントのスクリプト</h3>
      <p className="muted small">
        このステージのイベントを書くと、MOD を書き出すときにステージの CRO (ネイティブコード) に組み込まれます。CRO
        は「イベントなし」のもの (コンテンツ 99) を土台に作り直すので、複製元の CRO にあったイベント
        (開始の演出、読み込み時のキャラの配置の調整など)
        は無くなります。スクリプトで扱うレコードは、マップのページで動作 1 の型を「2D: スクリプト (CRO)」に、動作 2・3
        を「動作なし」にしてください。
      </p>
      <textarea
        aria-label="イベントのスクリプト"
        className="mono"
        rows={Math.min(40, Math.max(12, source.split('\n').length + 1))}
        style={{ width: '100%' }}
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <div className="row">
        <button onClick={apply} disabled={!dirty}>
          {source.trim() || !stored ? 'スクリプトを反映' : 'スクリプトを削除'}
        </button>
        {!source.trim() && !stored && <button onClick={() => setSource(STAGE_SCRIPT_EXAMPLE)}>例を入れる</button>}
        {dirty && <span className="muted small">未反映の変更があります</span>}
        {stored && !dirty && <span className="muted small mono">{`stageKey ${stored.key}`}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {check && (
        <>
          {check.problems.map((p) => (
            <div key={p} className="error">
              {p}
            </div>
          ))}
          {check.notes.map((n) => (
            <p key={n} className="muted small">
              {n}
            </p>
          ))}
          <p className="small">
            {`イベント ${check.script.events.length} 個`}
            {check.problems.length ? '。上の問題を直すまで MOD は書き出せません' : ''}
          </p>
          {check.script.vars.length > 0 && (
            <table className="book-table">
              <thead>
                <tr>
                  <th>変数</th>
                  <th>種類</th>
                  <th>ゲームのフラグ番号</th>
                  <th>離れるとき</th>
                </tr>
              </thead>
              <tbody>
                {check.script.vars.map((v) => (
                  <tr key={v.name}>
                    <td className="mono">{v.name}</td>
                    <td>{v.kind === 'byte' ? '数値 (0x52)' : 'フラグ (0x51)'}</td>
                    <td className="num">{v.flag}</td>
                    <td>{v.reset ? '0 に戻す' : '残す'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {check.resets.length > 0 && (
            <p className="muted small">{`ボス戦の数値フラグ ${check.resets.map((r) => r.flag).join(', ')} は、ステージを離れるときに 0 に戻します (負けたあとに「倒した」が残らないように)。`}</p>
          )}
        </>
      )}
      <p className="muted small">
        {`変数の番号は宣言の順に決まります (数値 ${STAGE_BYTE_FLAGS.first}〜、フラグ ${STAGE_BIT_FLAGS.first}〜)。出る条件・消える条件やボス戦 (動作の型 0C の引数 2) には、この番号を書きます。配布したあとで変数を足すときは末尾に足してください (途中に足すと番号がずれます)。`}
      </p>
      <details>
        <summary className="small">書けること</summary>
        <table className="book-table">
          <tbody>
            {HELP.map(([a, b]) => (
              <tr key={a}>
                <td className="mono small">{a}</td>
                <td className="small">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          台詞は、その MapGroup の台詞の表の「行 ID」で指します (行番号ではありません)。ボス戦は文にはありません:
          範囲の動作の型 0C (ボス戦)
          を使います。戦いのあとはマップの読み込みからやり直しになるため、「勝ったら」の処理は続きに書けません
          (ボス戦の数値フラグが 2 かどうかを、出る条件・消える条件や if で見ます)。
        </p>
      </details>
      {maps && groups.map((g) => <TalkLines key={g} session={session} maps={maps} group={g} />)}
    </>
  );
}
