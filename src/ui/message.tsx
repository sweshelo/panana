// A message (GMSG text) as a reader sees it, and its editor: shared by the message page, the shop page and
// the map inspector.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hexId } from '../editor/message';
import type { MessageStore } from '../game/gmsg';
import { MESSAGE_KINDS, parseBody, textToUnits } from '../game/msgtext';

/**
 * The message as a reader sees it: ruby as <ruby>, page breaks as ▼ and a rule, references and fixed names expanded
 * (links to the message), run-time names and numbers as 〈placeholders〉, voice / emotion as small badges, the
 * coloured dot as a grey ●, colours dropped.
 */
export function MessagePreview({ texts, units, depth = 0 }: { texts: MessageStore; units: Uint16Array; depth?: number }): ReactNode {
  const syn = texts.syntax;
  const tokens = parseBody(units, syn).tokens;
  const nested = (key: number, id: number, title: string): ReactNode => {
    const u = depth < 2 ? texts.units(id) : undefined;
    return (
      <a key={key} className="msg-ref" href={`#/messages/${hexId(id)}`} title={title}>
        {u ? <MessagePreview texts={texts} units={u} depth={depth + 1} /> : `メッセージ ${hexId(id)}`}
      </a>
    );
  };
  return (
    <span className="msg-render">
      {tokens.map((t, i): ReactNode => {
        const prev = tokens[i - 1];
        if (t.t === 'text') return t.s;
        if (t.t === 'br') return prev?.t === 'tag' && prev.x === syn.page ? null : <br key={i} />; // the page break eats it
        if (t.t === 'ruby') return <ruby key={i}>{t.base}<rp>(</rp><rt>{t.reading}</rt><rp>)</rp></ruby>;
        if (t.t === 'ref') return nested(i, t.id, `メッセージ ${hexId(t.id)} の差し込み`);
        if (t.t === 'raw') return <span key={i} className="msg-ctl" title="制御コード (意味は未解析)">{hexId(t.c)}</span>;
        const k = syn.kind(t.x);
        const label = syn.label(t.x);
        const title = `タグ ${hexId(t.x)}: ${label}`;
        if (k === 'page') return [<span key={`${i}p`} className="msg-page" title={title}>▼</span>, <hr key={`${i}r`} className="msg-page-rule" />];
        if (k === 'fixed') return nested(i, syn.fixedNames[t.x]!, `${title} (メッセージ ${hexId(syn.fixedNames[t.x]!)})`);
        if (k === 'deco') return <span key={i} className="msg-dot" title={`${title} (色はアイテムで決まる)`}>●</span>;
        if (k === 'name' || k === 'number') return <span key={i} className="msg-ph" title={title}>{label}</span>;
        if (k === 'voice' || k === 'emotion') return depth ? null : <span key={i} className="msg-kind" title={`${title} (画面には出ない)`}>{label}</span>;
        if (k === 'other') return <span key={i} className="msg-ctl" title={title}>{hexId(t.x)}</span>;
        return null; // colour: not drawn
      })}
    </span>
  );
}

/**
 * A message shown as its preview (ruby drawn); a click opens the editor: the text box (with the kind) next to the
 * preview, until 閉じる. Edits are applied when the box loses focus, through `apply` (so the caller can record an undo
 * point and save); a bad {XXXX} code is reported and not applied. `compact` leaves out the ID line and the kind (the
 * books' message fields).
 */
export function MessageEditor({ texts, id, apply, compact = false }: { texts: MessageStore; id: number; apply: (f: () => void) => void; compact?: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  /** Focus the box once, when it is opened (not when it is remade after an edit). */
  const opening = useRef(false);
  useEffect(() => { opening.current = false; });
  const file = texts.file(id);
  const t = texts.text(id);
  if (!file || !t) return <div className="msg-edit"><div className="muted">{id ? `${hexId(id)}: 見つからない ID` : '(なし)'}</div></div>;
  const head = !compact && (
    <div className="muted small">
      {`${hexId(id)} (${id}) · ${file.name}`}
      {texts.isEdited(id) && <b className="edited"> · 変更あり</b>}
    </div>
  );
  const revert = texts.isEdited(id) && <button className="small" onClick={() => apply(() => texts.revert(id))}>元の文に戻す</button>;
  if (!open) {
    return (
      <div className="msg-edit">
        {head}
        <div className={`msg-preview msg-preview-closed${compact && texts.isEdited(id) ? ' edited' : ''}`} role="button" tabIndex={0}
          title={file.editable ? 'クリックで編集' : 'クリックで本文 (タグつき) を表示'}
          onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) { opening.current = true; setOpen(true); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { opening.current = true; setOpen(true); } }}>
          <MessagePreview texts={texts} units={texts.units(id)!} />
          {!t.text && <span className="muted">(空)</span>}
        </div>
        {revert}
      </div>
    );
  }
  const close = <button className="small" onClick={() => setOpen(false)}>閉じる</button>;
  if (!file.editable) {
    return (
      <div className="msg-edit msg-edit-open">
        {head}
        <textarea className="msg-text" rows={Math.min(8, t.text.split('\n').length + 1)} value={t.text} readOnly />
        <div className="msg-preview"><MessagePreview texts={texts} units={texts.units(id)!} /></div>
        <div className="muted small">このファイルは作り直すと元と同じにならないため、書き換えられません。 {close}</div>
      </div>
    );
  }
  const kinds = [...new Set([...Object.keys(MESSAGE_KINDS).map(Number), t.kind])].sort((a, b) => a - b);
  return (
    <div className="msg-edit msg-edit-open">
      {head}
      {!compact && (
        <label className="field">
          <span>種別 (先頭の 1 文字、表示されない)</span>
          <select title="先頭の種別コード。ゲームは表示するときにこの 1 文字を読み飛ばします" value={t.kind} onChange={(e) => apply(() => texts.setKind(id, Number(e.target.value)))}>
            {kinds.map((k) => <option key={k} value={k}>{`${hexId(k)} ${MESSAGE_KINDS[k] ?? ''}`}</option>)}
          </select>
        </label>
      )}
      {/* keyed by the stored text: an edit elsewhere (undo, revert) starts the box over */}
      <MessageText key={`${id}\n${t.text}`} texts={texts} id={id} apply={apply} focus={opening.current} />
      <div className="row">{close}{revert}</div>
    </div>
  );
}

function MessageText({ texts, id, apply, focus }: { texts: MessageStore; id: number; apply: (f: () => void) => void; focus: boolean }): ReactNode {
  const stored = texts.text(id)!;
  const [draft, setDraft] = useState(stored.text);
  let units: Uint16Array = texts.units(id)!;
  let error = '';
  try {
    if (draft !== stored.text) units = textToUnits({ ...stored, text: draft }, texts.syntax);
  } catch (e) {
    error = (e as Error).message;
  }
  const commit = (): void => {
    const cur = texts.text(id)!;
    if (draft === cur.text || error) return;
    apply(() => texts.setText(id, draft));
  };
  return (
    <>
      <textarea
        className="msg-text"
        autoFocus={focus}
        rows={Math.min(8, stored.text.split('\n').length + 1)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {error && <div className="error small">{error}</div>}
      <div className="msg-preview"><MessagePreview texts={texts} units={units} /></div>
    </>
  );
}
