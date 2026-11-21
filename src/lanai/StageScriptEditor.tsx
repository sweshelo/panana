// The event script of an added stage (eventScript.ts) as the stage's page shows it: its variables (with the flag numbers
// the map's conditions name) and functions, read only, and what starts each function when a map opens. The variables
// and functions are written in the script editor (StageSourcePage.tsx, a tab of its own); what a function is given to
// is set on the map's page, at the record (EventScriptBinding.tsx). The script is built into the stage's CRO when the
// MOD is written (stageScript.ts).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { talkMessageOffset } from './actions';
import type { LanaiContent } from './contents';
import {
  emptyScriptDoc,
  SCRIPT_TRIGGER_LABEL,
  STAGE_BIT_FLAGS,
  STAGE_BYTE_FLAGS,
  triggerHasRow,
  type ScriptBinding,
  type ScriptDoc,
} from './eventScript';
import { lanaiMaps, type LanaiMaps } from './maps';
import { lanaiMonsterName } from './monsterBook';
import { useLanaiRevision } from './MonsterEditor';
import { SCRIPT_API_ROWS } from './scriptApiTable';
import { libraryForm, SCRIPT_LIBRARY, type ScriptLibraryFunction } from './scriptLibrary';
import { apiAbout, apiResultLabel, lineIdText, type ScriptAssist } from './scriptAssist';
import { scriptLineCall } from './ScriptLineDialog';
import { talkGroups } from './talk';
import { PopupIconList } from './PopupIconList';
import { docBound, docUnbound, SCRIPT_WORDS, introBinding, startBinding } from './scriptDoc';
import type { LanaiSession } from './session';
import { checkStageScript, groupOpening, type StageScriptCheck } from './stageScript';

export { STAGE_SCRIPT_EXAMPLE } from './scriptDoc';

function openSourceTab(session: LanaiSession, content: LanaiContent): void {
  const tab = window.open('', '_blank');
  if (!tab) return;
  tab.document.title = `${content.stages[0]?.name ?? 'ステージ'} — スクリプト`;
  tab.document.head.innerHTML = document.head.innerHTML;
  tab.document.body.innerHTML = '<div id="stage-source-root"></div>';
  void Promise.all([import('react-dom/client'), import('./StageSourcePage')]).then(([react, page]) => {
    if (tab.closed) return;
    const host = tab.document.getElementById('stage-source-root');
    if (!host) return;
    const root = react.createRoot(host);
    root.render(<page.LanaiStageSourcePage session={session} content={content} hostWindow={tab} />);
    tab.addEventListener('pagehide', () => root.unmount(), { once: true });
  });
}

export const bindingLabel = (b: ScriptBinding): string =>
  `MapGroup ${b.group}${triggerHasRow(b.trigger) ? ` のイベント ${b.row}` : ''} (${SCRIPT_TRIGGER_LABEL[b.trigger]})`;

/** The lines of a group's talk table: the ID the script names each by (the row ID, 0x800000NN) and its text. */
export function talkLines(
  session: LanaiSession,
  maps: LanaiMaps,
  group: number,
): { id: number; text: string }[] | undefined {
  const t = maps.talkTable(group);
  const message = t ? talkMessageOffset(t) : undefined;
  if (!t || message === undefined) return undefined;
  return Array.from({ length: t.rows }, (_, r) => ({
    id: (t.rowId(r) | 0x80000000) >>> 0,
    text: t.isString(r, message) ? session.plainAt(t, t.u32(r, message)).replace(/\s+/g, ' ').trim() : '',
  }));
}

/** What the script editor knows of a MapGroup: its lines of talk and the content's MonsterGroup rows. */
export function stageScriptAssist(
  session: LanaiSession,
  maps: LanaiMaps,
  group: number | undefined,
  vars: string[],
): ScriptAssist {
  const mp = session.table('MonsterParameter');
  const monster = (id: number): string => {
    const r = mp?.find(id) ?? -1;
    return r < 0 ? hexId(id) : lanaiMonsterName(session, r);
  };
  return {
    vars,
    lines: (group === undefined ? undefined : talkLines(session, maps, group)) ?? [],
    records: [],
    groups: maps.monsterGroups().map((g) => ({
      row: g.row,
      id: g.id,
      label: [...new Set(g.monsters)].map(monster).join('、') || '(空)',
    })),
  };
}

/** The first rows of the sets of eight tones of a group's talk table (shown with StartMessageAuto). */
const setFirsts = (maps: LanaiMaps, group: number): Set<number> => {
  const t = maps.talkTable(group);
  if (!t) return new Set();
  return new Set(
    talkGroups({ archive: '', entry: 0, index: 0, file: null, table: t })
      .filter((g) => g.kind === 'set')
      .map((g) => g.rows[0]!),
  );
};

/** The lines of a group's talk table with the IDs the script names them by. */
function TalkLines({
  session,
  maps,
  group,
  onInsert,
}: {
  session: LanaiSession;
  maps: LanaiMaps;
  group: number;
  /** Writes a call at the editor's cursor. */
  onInsert?: (text: string) => void;
}): ReactNode {
  const [filter, setFilter] = useState('');
  const lines = useMemo(() => talkLines(session, maps, group), [session, maps, group]);
  const t = maps.talkTable(group);
  if (!t || !lines) return <p className="muted small">{`MapGroup ${group}: 台詞の表がありません。`}</p>;
  const q = filter.trim();
  const shown = q ? lines.filter((l) => l.text.includes(q)) : lines;
  const sets = onInsert ? setFirsts(maps, group) : new Set<number>();
  return (
    <details>
      <summary className="small">{`MapGroup ${group} の台詞 (${t.name}、${t.rows} 行): 本文から行 ID を探す`}</summary>
      <input
        aria-label={`MapGroup ${group} の台詞を本文で探す`}
        placeholder="台詞の一部"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <table className="book-table">
        <thead>
          <tr>
            <th>行 ID</th>
            <th>台詞</th>
            {onInsert && <th />}
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => {
            const row = t.find(l.id);
            const call = scriptLineCall(sets.has(row) ? 'tones' : 'talk', l.id);
            return (
              <tr key={l.id}>
                <td className="mono">{lineIdText(l.id)}</td>
                <td className="small">{l.text}</td>
                {onInsert && (
                  <td>
                    <button
                      className="small"
                      title={`カーソルの位置に ${call} を書きます`}
                      onClick={() => onInsert(call)}
                    >
                      挿入
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

/** The content's MonsterGroup by row number: what ScriptMap.EncountBoss takes (not the row ID). */
function BattleGroups({ session, maps }: { session: LanaiSession; maps: LanaiMaps }): ReactNode {
  const groups = useMemo(() => maps.monsterGroups(), [maps]);
  const mp = session.table('MonsterParameter');
  if (!groups.length)
    return <p className="muted small">MonsterGroup の表がありません (ScriptMap.EncountBoss は使えません)。</p>;
  const name = (id: number): string => {
    const r = mp?.find(id) ?? -1;
    return r < 0 ? hexId(id) : lanaiMonsterName(session, r);
  };
  return (
    <details>
      <summary className="small">{`モンスターの群れ (MonsterGroup、${groups.length} 行): ScriptMap.EncountBoss(行番号, 0) に書く行番号`}</summary>
      <table className="book-table">
        <thead>
          <tr>
            <th>EncountBoss(行番号, 0)</th>
            <th>行 ID</th>
            <th>モンスター</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.row}>
              <td className="mono">{`ScriptMap.EncountBoss(${g.row}, 0)`}</td>
              <td className="mono small">{hexId(g.id)}</td>
              <td className="small">{[...new Set(g.monsters)].map(name).join('、') || '(空)'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        行番号は表の上から 0, 1, 2… と数えた位置です。行 ID はその行が持つ別の識別値です。
        この表では同じ群れを横一列に並べています。ScriptMap.EncountBoss の 1 つ目には左の行番号を書きます。
      </p>
    </details>
  );
}
const hexId = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase()}`;

/** The Script API functions a script can call by name, searched by a part of the name. */
export function ScriptApiList({ expanded = false }: { expanded?: boolean }): ReactNode {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = q ? SCRIPT_API_ROWS.filter((r) => `${r[0]}.${r[1]}`.toLowerCase().includes(q)) : SCRIPT_API_ROWS;
    return rows.slice(0, 80);
  }, [filter]);
  return (
    <details open={expanded}>
      <summary className="small">{`名前で呼べる Script API (${SCRIPT_API_ROWS.length} 個)`}</summary>
      <p className="muted small">
        ゲームの関数をそのまま呼びます: ScriptSound.Play(0x84, 0)。ScriptChara / ScriptPlayer
        の関数は物に付けて書きます: hero.SetVisible(0)、obj(3).StartAnimation(0x8000006E, 0, 1, 0)。const GSvec&amp; は
        vec(x, y, z)、キャラ (ScriptChara&amp; / ChrObject*) は hero / self / obj(イベント)、const
        ScriptMessageParam&amp; は書きません。引数の意味はゲームの解析によります
        (待つ関数は自分で呼ぶ必要があります)。「→」の後は戻り値の型です。if で比べられるのは整数を返す関数だけで、void
        と float は文として呼びます。
      </p>
      <input
        aria-label="Script API を探す"
        placeholder="名前の一部 (例: Camera, Fade)"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <table className="book-table">
        <tbody>
          {shown.map((r) => (
            <tr key={r[2]}>
              <td className="mono small">
                {r[0] === 'ScriptChara' || r[0] === 'ScriptPlayer' ? `だれに.${r[1]}` : `${r[0]}.${r[1]}`}
              </td>
              <td className="mono small">{`(${r[4]})`}</td>
              <td
                className="mono small"
                title="戻り値の型 (ゲームのコードから読んだもの)"
              >{`→ ${apiResultLabel(r[5])}`}</td>
              <td className="small">{r[0] === 'ScriptPlayer' ? 'hero だけ' : ''}</td>
              <td className="small" style={{ whiteSpace: 'pre-line' }}>
                {apiAbout(r)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 80 && <p className="muted small">先頭の 80 個を表示しています。名前で絞り込んでください。</p>}
    </details>
  );
}

/** The library's functions: each opens to its text, which can be copied (or put into the script, `onAdd`). */
export function ScriptLibraryList({ onAdd }: { onAdd?: (f: ScriptLibraryFunction) => void }): ReactNode {
  const [copied, setCopied] = useState('');
  return (
    <div className="script-library">
      {SCRIPT_LIBRARY.map((f) => (
        <details key={f.name}>
          <summary>
            <span className="mono">{libraryForm(f)}</span> <span className="small">{f.about}</span>
          </summary>
          <pre className="mono small">{f.source}</pre>
          <div className="row">
            <button
              onClick={() =>
                void navigator.clipboard.writeText(`${f.source}\n`).then(
                  () => setCopied(f.name),
                  () => setCopied(''),
                )
              }
            >
              コピー
            </button>
            {onAdd && <button onClick={() => onAdd(f)}>スクリプトに追加して改造</button>}
            {copied === f.name && <span className="muted small">コピーしました</span>}
          </div>
        </details>
      ))}
    </div>
  );
}

export function StageScriptDocs({
  session,
  content,
  onAdd,
  onInsert,
}: {
  session: LanaiSession;
  content: LanaiContent;
  /** Puts a library function into the script (the editor's text). */
  onAdd?: (f: ScriptLibraryFunction) => void;
  /** Writes a call at the editor's cursor. */
  onInsert?: (text: string) => void;
}): ReactNode {
  const [maps, setMaps] = useState<LanaiMaps | null>(null);
  useEffect(() => {
    let live = true;
    void lanaiMaps(session, content).then((m) => live && setMaps(m));
    return () => {
      live = false;
    };
  }, [session, content]);
  const groups = maps ? maps.groups.flatMap((g, k) => (g && maps.eventTable(k) ? [k] : [])) : [];
  return (
    <>
      <h3>書けること</h3>
      <table className="book-table">
        <tbody>
          {SCRIPT_WORDS.map((x) => (
            <tr key={x.form}>
              <td className="mono small">{x.form}</td>
              <td className="small">{x.about}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>ライブラリ</h3>
      <p className="muted small">
        スクリプトの言葉で書いた関数です。書かなくても呼べます。同じ名前の関数をスクリプトに書くと、そちらが使われます
        (コピーして改造できます)。中身はどれも Script API の呼び出しです。関数は引数を持てます: obj は物 (hero / self /
        obj(イベント)、またはイベント番号だけ)、num は数 (obj(イベント)
        を渡すとその番号)。呼んだところに中身が展開されるので、 引数には決まった値 (計算式も可) を書きます。1
        つ目の引数が obj か num の関数は obj(3).open() のようにも書けます。
      </p>
      <ScriptLibraryList onAdd={onAdd} />
      <p className="muted small">
        台詞は MapGroup の台詞の表の行 ID (0x800000NN) で指します。ScriptMap.EncountBoss(群れ, 0)
        のあとは戦闘に移り、勝つとマップの読み込みからやり直しになります。
      </p>
      <PopupIconList session={session} />
      <ScriptApiList expanded />
      {maps && <BattleGroups session={session} maps={maps} />}
      {maps && groups.map((g) => <TalkLines key={g} session={session} maps={maps} group={g} onInsert={onInsert} />)}
    </>
  );
}

/** The flag number of each variable: the variables of a kind take numbers in the order they are declared. */
const varFlags = (vars: ScriptDoc['vars']): number[] =>
  vars.map((v, k) => {
    const before = vars.slice(0, k).filter((x) => x.kind === v.kind).length;
    return (v.kind === 'byte' ? STAGE_BYTE_FLAGS : STAGE_BIT_FLAGS).first + before;
  });

export function LanaiStageScriptEditor({
  session,
  content,
}: {
  session: LanaiSession;
  content: LanaiContent;
}): ReactNode {
  const archive = content.archive.toUpperCase();
  const revision = useLanaiRevision(session);
  const stored = session.stageScripts.get(archive);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<StageScriptCheck | null>(null);
  const [maps, setMaps] = useState<LanaiMaps | null>(null);
  useEffect(() => {
    let live = true;
    void lanaiMaps(session, content).then((m) => live && setMaps(m));
    return () => {
      live = false;
    };
  }, [session, content]);
  // the script is checked against the maps again whenever something of the session changes
  const source = stored?.source;
  useEffect(() => {
    let live = true;
    if (!source) setCheck(null);
    else
      checkStageScript(session, content, source).then(
        (c) => live && setCheck(c),
        () => live && setCheck(null),
      );
    return () => {
      live = false;
    };
  }, [session, content, source, revision]);

  const setDoc = (doc: ScriptDoc): void => {
    try {
      session.setStageScriptDoc(archive, doc);
      session.edited();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const doc = stored?.doc ?? emptyScriptDoc();
  const flags = varFlags(doc.vars);
  const groups = maps ? maps.groups.flatMap((g, k) => (g && maps.eventTable(k) ? [k] : [])) : [];
  // a function with parameters is called by others, not given to an event
  const appliedFns = doc.functions.filter((f) => !f.params);

  return (
    <>
      <h3>イベントのスクリプト</h3>
      <div className="row">
        <button className="primary" onClick={() => openSourceTab(session, content)}>
          スクリプトを編集 ↗
        </button>
        {stored && <span className="muted small mono">{`stageKey ${stored.key}`}</span>}
      </div>
      <p className="muted small">
        関数 1 つが 1 つのイベントです。変数と関数はスクリプトのエディタ (別のタブ)
        で書いて保存し、マップのページでキャラ・範囲・ボタンのレコードに割り当てます
        (マップの始まりのイベントは下で選びます)。MOD を書き出すときにステージの CRO (ネイティブコード)
        に組み込まれます。CRO は「イベントなし」のもの (コンテンツ 99) を土台に作り直すので、複製元の CRO
        にあったイベント (開始の演出、読み込み時のキャラの配置の調整など) は無くなります。
      </p>

      <h4>変数</h4>
      {doc.vars.length ? (
        <table className="book-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>種類</th>
              <th>離れるとき 0 に戻す</th>
              <th>ゲームのフラグ番号</th>
            </tr>
          </thead>
          <tbody>
            {doc.vars.map((v, k) => (
              <tr key={v.name}>
                <td className="mono">{v.name}</td>
                <td>{v.kind === 'byte' ? '数値 (0〜255)' : 'フラグ (0 / 1)'}</td>
                <td>{v.reset ? '戻す' : ''}</td>
                <td className="num">{flags[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">ありません。</p>
      )}
      <p className="muted small">
        {`番号は書いた順に決まります (数値 ${STAGE_BYTE_FLAGS.first}〜、フラグ ${STAGE_BIT_FLAGS.first}〜)。出る条件・消える条件やボス戦 (動作の型 0C の引数 2) には、この番号を書きます。配布したあとで変数を足すときは末尾に足してください (途中に足したり消したりすると番号がずれます)。`}
      </p>

      <h4>関数</h4>
      {doc.functions.length ? (
        <table className="book-table">
          <thead>
            <tr>
              <th>関数</th>
              <th>割り当て</th>
            </tr>
          </thead>
          <tbody>
            {doc.functions.map((f) => {
              const given = doc.bindings.filter((b) => b.fn === f.name);
              return (
                <tr key={f.name}>
                  <td className="mono">{`${f.name}(${f.params ?? ''})`}</td>
                  <td className="small">
                    {f.params
                      ? '引数を持つ関数 (ほかの関数から呼びます)'
                      : given.length
                        ? given.map(bindingLabel).join('、')
                        : 'なし'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted small">まだありません。「スクリプトを編集」で書いてください。</p>
      )}
      {error && <div className="error">{error}</div>}

      {maps && groups.length > 0 && (
        <>
          <h4>ステージに入ったとき (入場の演出)</h4>
          {groups.map((g) => {
            const cur = introBinding(doc, g);
            const opening = groupOpening(maps, g);
            const off = { trigger: 'intro' as const, group: g, row: 0 };
            return (
              <div key={g}>
                <label className="field">
                  <span>{`MapGroup ${g}`}</span>
                  <select
                    aria-label={`MapGroup ${g} の入場の演出`}
                    value={cur ? `fn:${cur.fn}` : 'none'}
                    disabled={!opening}
                    onChange={(e) =>
                      setDoc(
                        e.target.value === 'none'
                          ? docUnbound(doc, off)
                          : docBound(doc, { ...off, fn: e.target.value.slice(3) }),
                      )
                    }
                  >
                    <option value="none">なし (演出なし。画面は明るくなるだけ)</option>
                    <option value="fn:">ゲームと同じ演出だけ</option>
                    {appliedFns.map((f) => (
                      <option key={f.name} value={`fn:${f.name}`}>
                        {`演出のあとに ${f.name}`}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small">
                  {!opening
                    ? 'このグループには最初のマップがありません'
                    : opening.gate
                      ? `${opening.mapName} の開始地点 (${opening.gate.x}, ${opening.gate.z}) の外から歩いて入り、ステージ名を出し${opening.gate.door ? `、門 (イベント ${opening.gate.door}) が閉まります` : 'ます'}。`
                      : `${opening.mapName} で画面を明るくしてステージ名を出します。`}
                  {opening?.note ? ` ${opening.note}` : ''}
                </p>
              </div>
            );
          })}
          <p className="muted small">
            ステージに入って最初のマップが読まれたとき、1 回の訪問で 1 回だけ実行されます (ゲームの D01Intro
            と同じ)。関数は演出のあと、仲間が隊列に戻る前に実行されます
            (主人公のひとりごとなど)。演出が出た回は下の「マップが始まるとき」は実行されません。
          </p>
        </>
      )}

      {stored && groups.length > 0 && (
        <>
          <h4>マップが始まるとき (戦闘のあとも)</h4>
          {groups.map((g) => (
            <label key={g} className="field">
              <span>{`MapGroup ${g}`}</span>
              <select
                aria-label={`MapGroup ${g} が始まるときの関数`}
                value={startBinding(stored.doc, g)?.fn ?? ''}
                onChange={(e) =>
                  setDoc(
                    e.target.value
                      ? docBound(stored.doc, { trigger: 'start', group: g, row: 0, fn: e.target.value })
                      : docUnbound(stored.doc, { trigger: 'start', group: g, row: 0 }),
                  )
                }
              >
                <option value="">なし (ゲームの既定)</option>
                {appliedFns.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="muted small">
            そのマップに入るたび (戦闘から戻ったときも) に実行されます。画面は暗い状態で始まり、本文に fadeIn
            が無ければ先頭で自動的に明るくします。1 回だけにする処理は、変数を if で見て書きます。
          </p>
        </>
      )}

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
            {`割り当てたイベント ${check.script.events.length} 個`}
            {check.problems.length ? '。上の問題を直すまで MOD は書き出せません' : ''}
          </p>
          {check.resets.length > 0 && (
            <p className="muted small">{`ボス戦の数値フラグ ${check.resets.map((r) => r.flag).join(', ')} は、ステージを離れるときに 0 に戻します (負けたあとに「倒した」が残らないように)。`}</p>
          )}
        </>
      )}
    </>
  );
}
