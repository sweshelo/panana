// The event script of an added stage (eventScript.ts), edited on the stage's page: the variables as a table, one text
// per function (one function = one event), and which function a map's start runs. What a function is given to is set
// on the map's page, at the record (EventScriptBinding.tsx). What is applied here is built into the stage's CRO when
// the MOD is written (stageScript.ts).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { talkMessageOffset } from './actions';
import type { LanaiContent } from './contents';
import {
  isScriptName,
  scriptDocFromSource,
  ScriptDocError,
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
import { lineIdText, scriptFunctionProblem, type ScriptAssist } from './scriptAssist';
import { ScriptCodeEditor } from './ScriptCodeEditor';
import {
  docBound,
  docUnbound,
  SCRIPT_SAMPLES,
  SCRIPT_WORDS,
  scriptLineRefs,
  startBinding,
  type ScriptSample,
} from './scriptDoc';
import type { LanaiSession } from './session';
import { checkStageScript, eventRecords, recordTrigger, type StageScriptCheck } from './stageScript';

export { STAGE_SCRIPT_EXAMPLE } from './scriptDoc';

/** A function as it is being edited: `was` is its name in the applied script (what its bindings name). */
interface DraftFunction {
  id: number;
  was: string | null;
  name: string;
  body: string;
}
interface Draft {
  vars: ScriptDoc['vars'];
  functions: DraftFunction[];
}
let nextId = 1;
const draftOf = (doc: ScriptDoc | undefined): Draft => ({
  vars: (doc?.vars ?? []).map((v) => ({ ...v })),
  functions: (doc?.functions ?? []).map((f) => ({ id: nextId++, was: f.name, name: f.name, body: f.body })),
});
/** The document of a draft: the applied bindings follow their functions' new names; those of a deleted function go. */
function docOfDraft(draft: Draft, bindings: ScriptBinding[]): ScriptDoc {
  return {
    vars: draft.vars.map((v) => ({ ...v })),
    functions: draft.functions.map((f) => ({ name: f.name, body: f.body })),
    bindings: bindings.flatMap((b) => {
      const f = draft.functions.find((x) => x.was === b.fn);
      return f ? [{ ...b, fn: f.name }] : [];
    }),
  };
}
const sameText = (a: Draft, doc: ScriptDoc | undefined): boolean =>
  JSON.stringify([a.vars, a.functions.map((f) => [f.name, f.body])]) ===
  JSON.stringify([doc?.vars ?? [], (doc?.functions ?? []).map((f) => [f.name, f.body])]);
/** A name not taken yet: stem, stem2, stem3 … */
const freshName = (stem: string, taken: string[]): string => {
  let name = stem;
  for (let k = 2; taken.includes(name); k++) name = `${stem}${k}`;
  return name;
};

const bindingLabel = (b: ScriptBinding): string =>
  `MapGroup ${b.group}${triggerHasRow(b.trigger) ? ` のイベント ${b.row}` : ''} (${SCRIPT_TRIGGER_LABEL[b.trigger]})`;

/** The lines of a group's talk table: the ID the script names each by (the row ID without its high bit) and its text. */
export function talkLines(
  session: LanaiSession,
  maps: LanaiMaps,
  group: number,
): { id: number; text: string }[] | undefined {
  const t = maps.talkTable(group);
  const message = t ? talkMessageOffset(t) : undefined;
  if (!t || message === undefined) return undefined;
  return Array.from({ length: t.rows }, (_, r) => ({
    id: t.rowId(r) & 0x7fffffff,
    text: t.isString(r, message) ? session.plainAt(t, t.u32(r, message)).replace(/\s+/g, ' ').trim() : '',
  }));
}

/** What the lines a function's text names say: the text beside each ID, so the author need not look them up. */
function BodyLines({
  session,
  maps,
  group,
  body,
}: {
  session: LanaiSession;
  maps: LanaiMaps;
  group: number;
  body: string;
}): ReactNode {
  const lines = useMemo(() => talkLines(session, maps, group), [session, maps, group]);
  const ids = scriptLineRefs(body);
  if (!ids.length || !lines) return null;
  return (
    <ul className="muted small">
      {ids.map((id) => {
        const line = lines.find((l) => l.id === id);
        return (
          <li key={id}>
            <span className="mono">{lineIdText(id)}</span>
            {line ? ` ${line.text}` : ` (MapGroup ${group} の台詞の表にこの行 ID はありません)`}
          </li>
        );
      })}
    </ul>
  );
}

const SECTION_LABEL: Record<number, string> = { 3: '扉', 5: 'キャラ・物', 8: '範囲' };
/** The events of a group's records, as the editor offers them where a statement names an event's row. */
function recordChoices(maps: LanaiMaps, group: number): ScriptAssist['records'] {
  return [...eventRecords(maps, group)]
    .sort(([a], [b]) => a - b)
    .map(([row, recs]) => ({
      row,
      label: [
        ...new Set(
          recs.map((r) => {
            const t = recordTrigger(r);
            return `${SECTION_LABEL[r.section] ?? `区画 ${r.section}`}${r.section === 5 ? ` 種類 ${r.kind}` : ''}${t ? ` (${SCRIPT_TRIGGER_LABEL[t]})` : ''}`;
          }),
        ),
      ].join('、'),
    }));
}

/** A function's text in the editor, with what the editor is told of the stage and where the text is wrong. */
function FunctionText({
  session,
  maps,
  group,
  revision,
  vars,
  name,
  body,
  applyError,
  onChange,
}: {
  session: LanaiSession;
  maps: LanaiMaps | null;
  /** The MapGroup whose lines and records are offered: the one the function is given to, or the first. */
  group: number | undefined;
  revision: number;
  vars: ScriptDoc['vars'];
  name: string;
  body: string;
  /** What applying the script said of this function, shown while the text itself is not found wrong. */
  applyError: string | null;
  onChange: (body: string) => void;
}): ReactNode {
  const lines = useMemo(
    () => (maps && group !== undefined ? (talkLines(session, maps, group) ?? []) : []),
    // the lines are read again when something of the session changes
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [session, maps, group, revision],
  );
  const records = useMemo(
    () => (maps && group !== undefined ? recordChoices(maps, group) : []),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [maps, group, revision],
  );
  const varNames = vars.map((v) => v.name).join(' ');
  const assist = useMemo<ScriptAssist>(
    () => ({ vars: varNames ? varNames.split(' ') : [], lines, records }),
    [varNames, lines, records],
  );
  const problem = useMemo(() => scriptFunctionProblem(vars, body), [vars, body]);
  const problems = useMemo(() => (problem ? [{ ...problem, severity: 'error' as const }] : []), [problem]);
  return (
    <>
      <ScriptCodeEditor
        label={`関数 ${name} の本文`}
        value={body}
        onChange={onChange}
        assist={assist}
        problems={problems}
      />
      {problem ? (
        <div className="error small">{`${problem.line} 行目: ${problem.message}`}</div>
      ) : (
        applyError && <div className="error">{applyError}</div>
      )}
    </>
  );
}

/** The lines of a group's talk table with the IDs the script names them by. */
function TalkLines({ session, maps, group }: { session: LanaiSession; maps: LanaiMaps; group: number }): ReactNode {
  const [filter, setFilter] = useState('');
  const lines = useMemo(() => talkLines(session, maps, group), [session, maps, group]);
  const t = maps.talkTable(group);
  if (!t || !lines) return <p className="muted small">{`MapGroup ${group}: 台詞の表がありません。`}</p>;
  const q = filter.trim();
  const shown = q ? lines.filter((l) => l.text.includes(q)) : lines;
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
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => (
            <tr key={l.id}>
              <td className="mono">{lineIdText(l.id)}</td>
              <td className="small">{l.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** The content's MonsterGroup by row number: what battle() takes (not the row ID). */
function BattleGroups({ session, maps }: { session: LanaiSession; maps: LanaiMaps }): ReactNode {
  const groups = useMemo(() => maps.monsterGroups(), [maps]);
  const mp = session.table('MonsterParameter');
  if (!groups.length) return <p className="muted small">MonsterGroup の表がありません (battle() は使えません)。</p>;
  const name = (id: number): string => {
    const r = mp?.find(id) ?? -1;
    return r < 0 ? hexId(id) : lanaiMonsterName(session, r);
  };
  return (
    <details>
      <summary className="small">{`モンスターの群れ (MonsterGroup、${groups.length} 行): battle() に書く行番号`}</summary>
      <table className="book-table">
        <thead>
          <tr>
            <th>battle(行番号)</th>
            <th>行 ID</th>
            <th>モンスター</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.row}>
              <td className="mono">{`battle(${g.row})`}</td>
              <td className="mono small">{hexId(g.id)}</td>
              <td className="small">{[...new Set(g.monsters)].map(name).join('、') || '(空)'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        行 ID (マップのページ・群れのページで出る 0x800000NN) は行番号と同じとは限りません。battle()
        には左の行番号を書きます。
      </p>
    </details>
  );
}
const hexId = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase()}`;

/** The Script API functions a script can call by name, searched by a part of the name. */
function ScriptApiList(): ReactNode {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = q ? SCRIPT_API_ROWS.filter((r) => `${r[0]}.${r[1]}`.toLowerCase().includes(q)) : SCRIPT_API_ROWS;
    return rows.slice(0, 80);
  }, [filter]);
  return (
    <details>
      <summary className="small">{`名前で呼べる Script API (${SCRIPT_API_ROWS.length} 個)`}</summary>
      <p className="muted small">
        ゲームの関数をそのまま呼びます: ScriptSound.Play(0x84, 0)。ScriptChara / ScriptPlayer
        の関数はキャラに付けて書きます: hero.SetVisible(0)、chara(3).StartAnimation(0x8000006E, 0, 1, 0)。const
        GSvec&amp; は vec(x, y, z)、キャラ (ScriptChara&amp; / ChrObject*) は hero / self / chara(イベント)、const
        ScriptMessageParam&amp; は書きません。引数の意味はゲームの解析によります (待つ関数は自分で呼ぶ必要があります)。
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
              <td className="small">{r[0] === 'ScriptPlayer' ? 'hero だけ' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 80 && <p className="muted small">先頭の 80 個を表示しています。名前で絞り込んでください。</p>}
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
  const revision = useLanaiRevision(session);
  const stored = session.stageScripts.get(archive);
  const [draft, setDraft] = useState<Draft>(() => draftOf(stored?.doc));
  const [error, setError] = useState<{ fn: string | null; message: string } | null>(null);
  const [check, setCheck] = useState<StageScriptCheck | null>(null);
  const [maps, setMaps] = useState<LanaiMaps | null>(null);
  const [sample, setSample] = useState<ScriptSample | null>(null);
  useEffect(() => {
    let live = true;
    void lanaiMaps(session, content).then((m) => live && setMaps(m));
    return () => {
      live = false;
    };
  }, [session, content]);
  // the applied script is checked against the maps again whenever something of the session changes
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

  const dirty = !sameText(draft, stored?.doc);
  const bindings = stored?.doc.bindings ?? [];
  const names = [...draft.vars.map((v) => v.name), ...draft.functions.map((f) => f.name)];
  const setDoc = (doc: ScriptDoc): boolean => {
    try {
      session.setStageScriptDoc(archive, doc);
      session.edited();
      setError(null);
      return true;
    } catch (e) {
      setError(
        e instanceof ScriptDocError ? { fn: e.fn, message: e.message } : { fn: null, message: (e as Error).message },
      );
      return false;
    }
  };
  const apply = (): void => {
    if (setDoc(docOfDraft(draft, bindings))) setDraft(draftOf(session.stageScripts.get(archive)?.doc));
  };
  const setVar = (k: number, v: Partial<ScriptDoc['vars'][number]>): void =>
    setDraft({ ...draft, vars: draft.vars.map((x, j) => (j === k ? { ...x, ...v } : x)) });
  const setFn = (id: number, v: Partial<DraftFunction>): void =>
    setDraft({ ...draft, functions: draft.functions.map((x) => (x.id === id ? { ...x, ...v } : x)) });
  const insertSample = (s: ScriptSample): void => {
    const doc = scriptDocFromSource(s.source);
    setDraft({
      vars: [...draft.vars, ...doc.vars.filter((v) => !names.includes(v.name))],
      functions: [
        ...draft.functions,
        ...doc.functions
          .filter((f) => !names.includes(f.name))
          .map((f) => ({ id: nextId++, was: null, name: f.name, body: f.body })),
      ],
    });
    setSample(s);
  };
  const flagOf = (k: number): number => {
    const v = draft.vars[k]!;
    const before = draft.vars.slice(0, k).filter((x) => x.kind === v.kind).length;
    return (v.kind === 'byte' ? STAGE_BYTE_FLAGS : STAGE_BIT_FLAGS).first + before;
  };
  const groups = maps ? maps.groups.flatMap((g, k) => (g && maps.eventTable(k) ? [k] : [])) : [];
  const appliedFns = stored?.doc.functions ?? [];

  return (
    <>
      <h3>イベントのスクリプト</h3>
      <p className="muted small">
        関数 1 つが 1
        つのイベントです。関数を書いて「スクリプトを反映」し、マップのページでキャラ・範囲・ボタンのレコードに割り当てます
        (マップの始まりのイベントは下で選びます)。MOD を書き出すときにステージの CRO (ネイティブコード)
        に組み込まれます。CRO は「イベントなし」のもの (コンテンツ 99) を土台に作り直すので、複製元の CRO
        にあったイベント (開始の演出、読み込み時のキャラの配置の調整など) は無くなります。
      </p>

      <h4>変数</h4>
      <table className="book-table">
        <thead>
          <tr>
            <th>名前</th>
            <th>種類</th>
            <th>離れるとき 0 に戻す</th>
            <th>ゲームのフラグ番号</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.vars.map((v, k) => (
            <tr key={k}>
              <td>
                <input
                  aria-label={`変数 ${k + 1} の名前`}
                  className="mono"
                  value={v.name}
                  onChange={(e) => setVar(k, { name: e.target.value })}
                />
                {!isScriptName(v.name) && <span className="error small"> 名前にできません</span>}
              </td>
              <td>
                <select
                  aria-label={`変数 ${k + 1} の種類`}
                  value={v.kind}
                  onChange={(e) => setVar(k, { kind: e.target.value as 'byte' | 'bit' })}
                >
                  <option value="byte">数値 (0〜255)</option>
                  <option value="bit">フラグ (0 / 1)</option>
                </select>
              </td>
              <td>
                <input
                  aria-label={`変数 ${k + 1} を離れるとき 0 に戻す`}
                  type="checkbox"
                  checked={v.reset}
                  onChange={(e) => setVar(k, { reset: e.target.checked })}
                />
              </td>
              <td className="num">{flagOf(k)}</td>
              <td>
                <button onClick={() => setDraft({ ...draft, vars: draft.vars.filter((_, j) => j !== k) })}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button
          onClick={() =>
            setDraft({ ...draft, vars: [...draft.vars, { name: freshName('VAR', names), kind: 'byte', reset: false }] })
          }
        >
          変数を足す
        </button>
      </div>
      <p className="muted small">
        {`番号は表の順に決まります (数値 ${STAGE_BYTE_FLAGS.first}〜、フラグ ${STAGE_BIT_FLAGS.first}〜)。出る条件・消える条件やボス戦 (動作の型 0C の引数 2) には、この番号を書きます。配布したあとで変数を足すときは末尾に足してください (途中に足したり消したりすると番号がずれます)。`}
      </p>

      <h4>関数</h4>
      {draft.functions.map((f) => {
        const given = bindings.filter((b) => b.fn === f.was);
        return (
          <div key={f.id} className="script-function">
            <div className="row">
              <span className="mono">function</span>
              <input
                aria-label="関数の名前"
                className="mono"
                value={f.name}
                onChange={(e) => setFn(f.id, { name: e.target.value })}
              />
              <span className="mono">()</span>
              <button onClick={() => setDraft({ ...draft, functions: draft.functions.filter((x) => x.id !== f.id) })}>
                関数を削除
              </button>
              {!isScriptName(f.name) && <span className="error small">名前にできません</span>}
            </div>
            <FunctionText
              session={session}
              maps={maps}
              group={given[0]?.group ?? groups[0]}
              revision={revision}
              vars={draft.vars}
              name={f.name}
              body={f.body}
              applyError={error?.fn === f.name ? error.message : null}
              onChange={(body) => setFn(f.id, { body })}
            />
            {maps && groups.length > 0 && (
              <BodyLines session={session} maps={maps} group={given[0]?.group ?? groups[0]!} body={f.body} />
            )}
            <p className="muted small">
              {given.length
                ? `割り当て: ${given.map(bindingLabel).join('、')}`
                : f.was
                  ? '割り当てなし (キャラ・範囲・ボタンにはマップのページでレコードの「スクリプトの関数」から、マップが始まるときには下のチェックで割り当てます)'
                  : '未反映 (反映すると割り当てられます)'}
            </p>
            {stored && f.was && f.was === f.name && groups.length > 0 && (
              <div className="row">
                {groups.map((g) => {
                  const cur = startBinding(stored.doc, g);
                  return (
                    <label
                      key={g}
                      className="layer"
                      title="戦闘から戻ったときにも実行されます (battle() の続きはここに書きます)"
                    >
                      <input
                        type="checkbox"
                        aria-label={`関数 ${f.name} を MapGroup ${g} が始まるときに実行する`}
                        checked={cur?.fn === f.was}
                        onChange={(e) =>
                          setDoc(
                            e.target.checked
                              ? docBound(stored.doc, { trigger: 'start', group: g, row: 0, fn: f.was! })
                              : docUnbound(stored.doc, { trigger: 'start', group: g, row: 0 }),
                          )
                        }
                      />
                      {`MapGroup ${g} が始まるとき (戦闘のあとも)${cur && cur.fn !== f.was ? ` ※いまは ${cur.fn}` : ''}`}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="row">
        <button
          onClick={() =>
            setDraft({
              ...draft,
              functions: [...draft.functions, { id: nextId++, was: null, name: freshName('event', names), body: '' }],
            })
          }
        >
          関数を足す
        </button>
        {SCRIPT_SAMPLES.map((s) => (
          <button key={s.name} onClick={() => insertSample(s)}>{`例: ${s.name}`}</button>
        ))}
      </div>
      {sample && (
        <p className="muted small">
          {`例「${sample.name}」を入れました。${sample.about} 割り当て: ${sample.give.join('、')}。`}
        </p>
      )}

      <div className="row">
        <button onClick={apply} disabled={!dirty}>
          スクリプトを反映
        </button>
        {dirty && <button onClick={() => setDraft(draftOf(stored?.doc))}>変更を捨てる</button>}
        {dirty && <span className="muted small">未反映の変更があります</span>}
        {stored && !dirty && <span className="muted small mono">{`stageKey ${stored.key}`}</span>}
      </div>
      {error && error.fn === null && <div className="error">{error.message}</div>}
      {error && error.fn !== null && !draft.functions.some((f) => f.name === error.fn) && (
        <div className="error">{error.message}</div>
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

      {stored && (
        <details>
          <summary className="small">反映済みのスクリプト (文字列)</summary>
          <pre className="mono small">{stored.source}</pre>
        </details>
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

      <details>
        <summary className="small">書けること</summary>
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
        <p className="muted small">
          台詞は、その MapGroup の台詞の表の「行 ID」で指します (行番号ではありません)。battle()
          のあとは戦闘に移り、勝つとマップの読み込みからやり直しになるため、「勝ったら」の処理は続きに書けません
          (変数を書いておき、「マップが始まるとき」の関数や出る条件・消える条件で見ます)。
        </p>
      </details>
      <ScriptApiList />
      {maps && <BattleGroups session={session} maps={maps} />}
      {maps && groups.map((g) => <TalkLines key={g} session={session} maps={maps} group={g} />)}
    </>
  );
}
