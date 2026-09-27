// Code patches of an event: write (or have the AI write) assembly, assemble and check it with the interpreter,
// and keep it for the export (code.ips). game/patch.ts, game/patchcheck.ts.
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { askClaude, errorText, getApiKey } from '../ai/claude';
import { GAME_CONTEXT } from '../game/aiprompt';
import type { EventEntry } from '../game/eventlist';
import { applyRecords, blockDiff, buildPatches, PATCH_FORMAT, patchRecords, type BuiltPatch, type CodePatch } from '../game/patch';
import { checkPatch, type PatchCheck } from '../game/patchcheck';
import type { Session } from '../session';
import { AiSettings } from './AskAi';

const TEMPLATE = `; 何をするパッチかをここに書く
@0x00000000
  nop
`;

/** The last ```patch (or ```asm) block of an answer. */
export function extractPatch(answer: string): string | null {
  const blocks = [...answer.matchAll(/```(?:patch|asm|arm)?\s*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks[blocks.length - 1]![1]!.trimEnd() + '\n' : null;
}

interface Checked {
  built: BuiltPatch;
  check: PatchCheck | null;
}

export function PatchPanel({ session, entry, eventRow, allVtables, eventText }: {
  session: Session;
  entry: EventEntry;
  eventRow: Uint8Array | null;
  allVtables: number[];
  /** The event as text for the AI (built when asked). */
  eventText: () => string;
}): ReactNode {
  const { game } = session;
  const key = `${entry.dungeon}.${entry.row}`;
  const [, redraw] = useState(0);
  const [editing, setEditing] = useState<string | null>(null); // patch id, or '' for a new one
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(TEMPLATE);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [request, setRequest] = useState('');
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [settings, setSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mine = game.codePatches.filter((p) => p.event === key);
  const others = game.codePatches.length - mine.length;

  const save = (): void => {
    session.scheduleSave();
    redraw((n) => n + 1);
  };
  const open = (p: CodePatch | null): void => {
    setEditing(p?.id ?? '');
    setTitle(p?.title ?? '');
    setSource(p?.source ?? TEMPLATE);
    setChecked(null);
  };
  /** Assemble the draft after the other enabled patches (so the cave is shared as in the export), and check it. */
  const check = (src = source): Checked => {
    const draft: CodePatch = { id: '__draft', title: title || '(新しいパッチ)', source: src, enabled: true, event: key };
    const list = [...game.codePatches.filter((p) => p.enabled && p.id !== editing), draft];
    const all = buildPatches(game.dump.code, list);
    const built = all.get('__draft')!;
    let result: PatchCheck | null = null;
    if (!built.errors.length) {
      const patched = applyRecords(game.dump.code, patchRecords(all.values()));
      result = checkPatch(patched, built, entry, eventRow ?? undefined, allVtables);
    }
    const c = { built, check: result };
    setChecked(c);
    return c;
  };
  const keep = (): void => {
    const t = title.trim() || '(名前なし)';
    if (editing) {
      const p = game.codePatches.find((x) => x.id === editing);
      if (p) Object.assign(p, { title: t, source });
    } else game.codePatches.push({ id: `p${Date.now().toString(36)}`, title: t, source, enabled: true, event: key });
    setEditing(null);
    setChecked(null);
    save();
  };
  const askAi = async (): Promise<void> => {
    if (!getApiKey()) {
      setSettings(true);
      return;
    }
    setAiBusy(true);
    setAiText('');
    setAiError('');
    abort.current = new AbortController();
    try {
      const current = editing !== null ? `\n\n# 今のパッチの下書き\n\`\`\`patch\n${source}\`\`\`` : '';
      const r = await askClaude({
        system: `${GAME_CONTEXT}\n\n${PATCH_FORMAT}`,
        prompt: `${eventText()}${current}\n\n# したいこと\n${request}\n\n方針を短く説明してから、答えの最後にパッチを \`\`\`patch のコードブロック 1 つで書いてください。上書きする所は、元の命令を上のアセンブラで確かめてから選んでください。`,
        onText: (d) => setAiText((a) => a + d),
        signal: abort.current.signal,
      });
      setAiText(r.text);
      const p = extractPatch(r.text);
      if (!p) setAiError('答えにパッチのコードブロックがありませんでした');
      else {
        if (editing === null) setEditing('');
        if (!title) setTitle(request.slice(0, 30));
        setSource(p);
        check(p);
      }
    } catch (e) {
      setAiError(errorText(e));
    } finally {
      setAiBusy(false);
    }
  };

  const before = entry.scripts[0]?.cls;
  const after = checked?.check?.classes?.[0];
  return (
    <div className="patch-panel">
      {mine.length > 0 && (
        <ul>
          {mine.map((p) => {
            const err = buildPatches(game.dump.code, [p]).get(p.id)!.errors.length;
            return (
              <li key={p.id}>
                <label><input type="checkbox" checked={p.enabled} onChange={(e) => { p.enabled = e.target.checked; save(); }} /> {p.title}</label>
                {err > 0 && <span className="error-text small"> 誤りあり</span>}
                {' '}<button onClick={() => open(p)}>編集</button>
                {' '}<button onClick={() => { if (confirm(`パッチ「${p.title}」を消しますか?`)) { game.codePatches = game.codePatches.filter((x) => x !== p); save(); } }}>消す</button>
              </li>
            );
          })}
        </ul>
      )}
      {others > 0 && <div className="muted small">{`ほかのイベントのパッチが ${others} 個あります。`}</div>}
      {editing === null && <div className="row"><button onClick={() => open(null)}>パッチを書く</button></div>}

      <div className="ai-box">
        <textarea className="ai-question" rows={2} placeholder="AI にしてほしい変更 (例: このスイッチを踏んだら行 11 の扉も開くようにして)" value={request} onChange={(e) => setRequest(e.target.value)} />
        <div className="row">
          {aiBusy
            ? <button onClick={() => abort.current?.abort()}>止める</button>
            : <button className="primary" disabled={!request.trim()} onClick={askAi}>AI にパッチを書かせる</button>}
          {aiBusy && <span className="muted small">書いています…</span>}
          <button onClick={() => setSettings(!settings)}>{getApiKey() ? 'AI の設定' : 'API キーを設定'}</button>
        </div>
        {settings && <AiSettings onClose={() => setSettings(false)} />}
        {aiError && <div className="error">{aiError}</div>}
        {aiText && <details open={aiBusy}><summary className="small">AI の答え</summary><div className="ai-answer">{aiText}</div></details>}
      </div>

      {editing !== null && (
        <div className="patch-editor">
          <div className="row">
            <input type="text" placeholder="パッチの名前" size={40} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <textarea className="asm-edit" rows={14} spellCheck={false} value={source} onChange={(e) => { setSource(e.target.value); setChecked(null); }} />
          <div className="row">
            <button onClick={() => check()}>組み立てて確かめる</button>
            <button className="primary" disabled={!checked || checked.built.errors.length > 0} onClick={keep}>{editing ? 'パッチを更新' : 'パッチに加える'}</button>
            <button onClick={() => { setEditing(null); setChecked(null); }}>やめる</button>
          </div>
          <details><summary className="muted small">書式</summary><pre className="small patch-help">{PATCH_FORMAT}</pre></details>
          {checked && (
            <div className="patch-result">
              {checked.built.errors.length > 0 && (
                <div className="error">{checked.built.errors.map((e, i) => <div key={i}>{`${e.line} 行目: ${e.message}`}</div>)}</div>
              )}
              {checked.built.blocks.map((b, i) => (
                <Fragment key={i}>
                  <div className="small"><b>{b.kind === 'cave' ? `code cave 0x${b.addr.toString(16).toUpperCase()}${b.label ? ` (${b.label})` : ''}` : `0x${b.addr.toString(16).toUpperCase()} を上書き`}</b></div>
                  <pre className="asm">
                    {blockDiff(b).map((d) => `${d.addr.toString(16).toUpperCase().padStart(8, '0')}  ${b.kind === 'at' ? `${d.before.padEnd(30)} → ` : ''}${d.after}\n`).join('')}
                  </pre>
                </Fragment>
              ))}
              {checked.check && (
                <>
                  <div className="small"><b>実行器で動かした結果</b></div>
                  <ul className="small">
                    {checked.check.runs.map((r, i) => (
                      <li key={i} className={r.result === 'stack' ? 'error-text' : ''}>
                        {`${r.why} (0x${r.entry.toString(16).toUpperCase()}): ${r.detail}`}
                      </li>
                    ))}
                    {before && after && (
                      <li>{`完了させる行: ${before.completes.join(', ') || 'なし'} → ${after.completes.join(', ') || 'なし'}、メッセージ ${before.messages.length} → ${after.messages.length} 個`}</li>
                    )}
                    {before && checked.check.classes && !after && <li className="error-text">パッチの後、この行のクラスが作られなくなりました</li>}
                  </ul>
                  <div className="muted small">実行器は作り物のデータで動かすので、「迷った」は誤りとは限りません。スタックが崩れる (push / pop が対でない) ときは直してください。最後はエミュレータで確かめてください。</div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
