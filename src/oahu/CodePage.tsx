// RPG3's code page (#/code, #65): code patches assembled against the Update's code.bin and exported as
// exefs/code.ips, a disassembly view of the Update's code.bin, and the addresses Panana knows. Without the Update
// the page only asks for it (the Base's code.bin has other addresses and is never used).
import { Fragment, useState, type ReactNode } from 'react';
import { BASE } from '../game/codeconst';
import { disassemble } from '../game/disasm';
import { blockDiff, caveFreeStart, PATCH_FORMAT, type BuiltPatch, type CodePatch } from '../game/patch';
import { OAHU_CODE, OAHU_LAYOUT, OAHU_SECTIONS, type OahuCode } from './code';
import type { OahuSession } from './session';

const TEMPLATE = `; 何をするパッチかをここに書く
@0x00000000
  nop
`;

const hex = (n: number, w = 8): string => n.toString(16).toUpperCase().padStart(w, '0');

/** What a page that uses code.bin shows when the dump has no (usable) Update. */
export function NeedsUpdate({ session, onAddUpdate }: { session: OahuSession; onAddUpdate: () => void }): ReactNode {
  return (
    <div className="needs-update">
      {session.codeError
        ? <p className="error">{session.codeError}</p>
        : <p>この機能は code.bin を使うので、Update の CIA も選んでください。アドレスは Update (v4096) の code.bin のものを使い、Base の code.bin は使いません。</p>}
      <div className="row"><button className="primary" onClick={onAddUpdate}>Update の CIA を選ぶ…</button></div>
    </div>
  );
}

export function OahuCodePage({ session, onAddUpdate }: { session: OahuSession; onAddUpdate: () => void }): ReactNode {
  const { code } = session;
  if (!code) return <div className="book-detail code-page"><h2>コード</h2><NeedsUpdate session={session} onAddUpdate={onAddUpdate} /></div>;
  return (
    <div className="book-detail code-page">
      <h2>コード</h2>
      <p className="muted small">{`Update v${session.dump.update?.titleVersion ?? '?'} の code.bin。パッチは書き出しの zip の exefs/code.ips になります。`}</p>
      <Patches session={session} code={code} />
      <Disassembly code={code} />
      <Addresses />
    </div>
  );
}

function Patches({ session, code }: { session: OahuSession; code: OahuCode }): ReactNode {
  const [, redraw] = useState(0);
  const [editing, setEditing] = useState<string | null>(null); // patch id, or '' for a new one
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(TEMPLATE);
  const [checked, setChecked] = useState<BuiltPatch | null>(null);
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
  /** Assembles the draft after the other enabled patches, so the cave is shared as in the export. */
  const check = (): void => {
    const draft: CodePatch = { id: '__draft', title: title || '(新しいパッチ)', source, enabled: true };
    setChecked(session.buildPatches([...session.enabledPatches().filter((p) => p.id !== editing), draft]).get('__draft')!);
  };
  const keep = (): void => {
    const t = title.trim() || '(名前なし)';
    if (editing) {
      const p = session.codePatches.find((x) => x.id === editing);
      if (p) Object.assign(p, { title: t, source });
    } else session.codePatches.push({ id: `p${Date.now().toString(36)}`, title: t, source, enabled: true });
    setEditing(null);
    setChecked(null);
    save();
  };
  const built = session.buildPatches();
  const free = OAHU_LAYOUT.caveEnd - caveFreeStart(code.code, OAHU_LAYOUT);
  const used = [...built.values()].reduce((n, b) => n + (b.cave ? b.cave[1] - b.cave[0] : 0), 0);
  return (
    <section>
      <h3>パッチ (code.ips)</h3>
      <p className="muted small">{`code cave: 0x${hex(OAHU_LAYOUT.caveStart)}〜0x${hex(OAHU_LAYOUT.caveEnd)} (.text の末尾の空き)。使用 ${used} / ${free} バイト。`}</p>
      {session.codePatches.length > 0 && (
        <ul className="patch-list">
          {session.codePatches.map((p) => {
            const err = session.buildPatches([p]).get(p.id)!.errors.length;
            return (
              <li key={p.id}>
                <label><input type="checkbox" checked={p.enabled} onChange={(e) => { p.enabled = e.target.checked; save(); }} /> {p.title}</label>
                {err > 0 && <span className="error-text small"> 誤りあり (書き出されません)</span>}
                {' '}<button onClick={() => open(p)}>編集</button>
                {' '}<button onClick={() => { if (confirm(`パッチ「${p.title}」を消しますか?`)) { session.codePatches = session.codePatches.filter((x) => x !== p); save(); } }}>消す</button>
              </li>
            );
          })}
        </ul>
      )}
      {editing === null && <div className="row"><button onClick={() => open(null)}>パッチを書く</button></div>}
      {editing !== null && (
        <div className="patch-editor">
          <div className="row">
            <input type="text" placeholder="パッチの名前" size={40} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <textarea className="asm-edit" rows={14} spellCheck={false} value={source} onChange={(e) => { setSource(e.target.value); setChecked(null); }} />
          <div className="row">
            <button onClick={check}>組み立てる</button>
            <button className="primary" disabled={!checked || checked.errors.length > 0} onClick={keep}>{editing ? 'パッチを更新' : 'パッチに加える'}</button>
            <button onClick={() => { setEditing(null); setChecked(null); }}>やめる</button>
          </div>
          <details><summary className="muted small">書式</summary><pre className="small patch-help">{PATCH_FORMAT}</pre></details>
          {checked && (
            <div className="patch-result">
              {checked.errors.length > 0 && <div className="error">{checked.errors.map((e, i) => <div key={i}>{`${e.line} 行目: ${e.message}`}</div>)}</div>}
              {checked.blocks.map((b, i) => (
                <Fragment key={i}>
                  <div className="small"><b>{b.kind === 'cave' ? `code cave 0x${hex(b.addr)}${b.label ? ` (${b.label})` : ''}` : `0x${hex(b.addr)} を上書き`}</b></div>
                  <pre className="asm">
                    {blockDiff(b).map((d) => `${hex(d.addr)}  ${b.kind === 'at' ? `${d.before.padEnd(30)} → ` : ''}${d.after}\n`).join('')}
                  </pre>
                </Fragment>
              ))}
              <div className="muted small">RPG3 のイベント実行器はまだないので、動きはエミュレータで確かめてください。</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** End of .rodata. */
const END = OAHU_SECTIONS.data[0];

function Disassembly({ code }: { code: OahuCode }): ReactNode {
  const [text, setText] = useState(hex(OAHU_CODE.effectCondition));
  const [count, setCount] = useState(32);
  const v = parseInt(text.replace(/^(0x|FUN_)/i, ''), 16);
  const addr = Number.isFinite(v) ? v & ~3 : NaN;
  const ok = addr >= BASE && addr < END;
  const lines: string[] = [];
  if (ok) for (let a = addr; a < Math.min(addr + count * 4, END); a += 4) {
    const w = code.word(a);
    lines.push(`${hex(a)}  ${hex(w)}  ${disassemble(w, a).text}`);
  }
  return (
    <section>
      <h3>逆アセンブル</h3>
      <div className="row">
        <label>アドレス <input type="text" size={14} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <label>命令の数 <input type="number" min={1} max={512} value={count} onChange={(e) => setCount(Math.max(1, Math.min(512, Number(e.target.value) || 1)))} /></label>
      </div>
      {ok ? <pre className="asm">{lines.join('\n')}</pre> : <div className="muted small">{`0x${hex(BASE)}〜0x${hex(END)} (.text と .rodata) のアドレスを 16 進で入れてください。`}</div>}
    </section>
  );
}

const ADDRESS_NOTES: [keyof typeof OAHU_CODE, string][] = [
  ['startup', '起動時の初期化 (patchList → master の読み込み)'],
  ['readPatchList', 'patch:/patchList.bin を読む'],
  ['rootPath', 'ルートファイルのパス (rom:/ か patch:/) を作る'],
  ['openArchive', 'ハッシュでアーカイブを開く'],
  ['effectCondition', '装備の効果の種類 → conditionData の行'],
  ['resources', 'リソース管理のポインタ (+0x80 / +0x84 = patchList)'],
  ['romPath', 'L"rom:/XXXXXXXX" のバッファ'],
  ['patchPath', 'L"patch:/XXXXXXXX" のバッファ'],
];

function Addresses(): ReactNode {
  return (
    <section>
      <h3>分かっているアドレス</h3>
      <table className="small">
        <tbody>
          {ADDRESS_NOTES.map(([k, note]) => (
            <tr key={k}><td><code>{`0x${hex(OAHU_CODE[k])}`}</code></td><td>{note}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">解析の資料: naauao oahu/analysis.md §7。</p>
    </section>
  );
}
