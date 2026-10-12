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
 * What MessageEditor edits, by ID: GMSG messages (gmsgSource) or another game's strings (RPG FREE!'s table strings,
 * lanai/MessageSource.tsx). The text is the form with the tags in braces that the box shows.
 */
export interface MessageSource {
  /** The text with its tags, or undefined when there is no message `id`. */
  text(id: number): string | undefined;
  /** The ID line of the editor. */
  label(id: number): string;
  /** Why the message cannot be edited, or undefined when it can. */
  readOnly(id: number): string | undefined;
  isEdited(id: number): boolean;
  revert(id: number): void;
  /** Writes the text (one that preview accepted). */
  setText(id: number, text: string): void;
  /** The message as a reader sees it with `text` (the stored text or a draft); throws when the text cannot be written. */
  preview(id: number, text: string): ReactNode;
  /** A kind code in front of the text (GMSG's first unit): its value, the choices, and how to set it. */
  kind?: { get(id: number): number; options(id: number): [value: number, label: string][]; set(id: number, kind: number): void };
  /** The line for an ID that is not there. */
  missing?(id: number): string;
}

const gmsgSources = new WeakMap<MessageStore, MessageSource>();

/** The GMSG messages of a MessageStore as a MessageSource. */
export function gmsgSource(texts: MessageStore): MessageSource {
  let s = gmsgSources.get(texts);
  if (s) return s;
  s = {
    text: (id) => (texts.file(id) ? texts.text(id)?.text : undefined),
    label: (id) => `${hexId(id)} (${id}) · ${texts.file(id)?.name ?? ''}`,
    readOnly: (id) => (texts.file(id)?.editable ? undefined : 'このファイルは作り直すと元と同じにならないため、書き換えられません。'),
    isEdited: (id) => texts.isEdited(id),
    revert: (id) => texts.revert(id),
    setText: (id, text) => texts.setText(id, text),
    preview: (id, text) => {
      const stored = texts.text(id)!;
      return <MessagePreview texts={texts} units={text === stored.text ? texts.units(id)! : textToUnits({ ...stored, text }, texts.syntax)} />;
    },
    kind: {
      get: (id) => texts.text(id)!.kind,
      options: (id) => [...new Set([...Object.keys(MESSAGE_KINDS).map(Number), texts.text(id)!.kind])].sort((a, b) => a - b).map((k) => [k, `${hexId(k)} ${MESSAGE_KINDS[k] ?? ''}`]),
      set: (id, k) => texts.setKind(id, k),
    },
    missing: (id) => (id ? `${hexId(id)}: 見つからない ID` : '(なし)'),
  };
  gmsgSources.set(texts, s);
  return s;
}

/**
 * A message shown as its preview (ruby drawn); a click opens the editor: the text box (with the kind) next to the
 * preview, until 閉じる. Edits are applied when the box loses focus, through `apply` (so the caller can record an undo
 * point and save); a bad {XXXX} code is reported and not applied. `compact` leaves out the ID line and the kind (the
 * books' message fields). `texts` is a MessageStore (GMSG) or any MessageSource.
 */
export function MessageEditor({ texts, id, apply, compact = false, title }: {
  texts: MessageStore | MessageSource;
  id: number;
  apply: (f: () => void) => void;
  compact?: boolean;
  /** A line above the ID line (e.g. which version of a message this is). */
  title?: ReactNode;
}): ReactNode {
  const src = 'syntax' in texts ? gmsgSource(texts) : texts;
  const [open, setOpen] = useState(false);
  /** Focus the box once, when it is opened (not when it is remade after an edit). */
  const opening = useRef(false);
  useEffect(() => { opening.current = false; });
  const text = src.text(id);
  if (text === undefined) return <div className="msg-edit">{title}<div className="muted">{src.missing?.(id) ?? '(なし)'}</div></div>;
  const edited = src.isEdited(id);
  const readOnly = src.readOnly(id);
  const head = !compact && (
    <div className="muted small">
      {src.label(id)}
      {edited && <b className="edited"> · 変更あり</b>}
    </div>
  );
  const revert = edited && <button className="small" onClick={() => apply(() => src.revert(id))}>元の文に戻す</button>;
  if (!open) {
    return (
      <div className="msg-edit">
        {title}
        {head}
        <div className={`msg-preview msg-preview-closed${compact && edited ? ' edited' : ''}`} role="button" tabIndex={0}
          title={readOnly ? 'クリックで本文 (タグつき) を表示' : 'クリックで編集'}
          onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) { opening.current = true; setOpen(true); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { opening.current = true; setOpen(true); } }}>
          {src.preview(id, text)}
          {!text && <span className="muted">(空)</span>}
        </div>
        {revert}
      </div>
    );
  }
  const close = <button className="small" onClick={() => setOpen(false)}>閉じる</button>;
  if (readOnly) {
    return (
      <div className="msg-edit msg-edit-open">
        {title}
        {head}
        <ReadOnlyText text={text} preview={src.preview(id, text)} note={readOnly} close={close} />
      </div>
    );
  }
  const kind = !compact && src.kind;
  return (
    <div className="msg-edit msg-edit-open">
      {title}
      {head}
      {kind && (
        <label className="field">
          <span>種別 (先頭の 1 文字、表示されない)</span>
          <select title="先頭の種別コード。ゲームは表示するときにこの 1 文字を読み飛ばします" value={kind.get(id)} onChange={(e) => apply(() => kind.set(id, Number(e.target.value)))}>
            {kind.options(id).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      )}
      {/* keyed by the stored text: an edit elsewhere (undo, revert) starts the box over */}
      <MessageText key={`${id}\n${text}`} src={src} id={id} apply={apply} focus={opening.current} />
      <div className="row">{close}{revert}</div>
    </div>
  );
}

/** The open box of a message that is not edited here: its text with the tags (read only), the preview and why. */
function ReadOnlyText({ text, preview, note, close }: { text: string; preview: ReactNode; note: ReactNode; close: ReactNode }): ReactNode {
  return (
    <>
      <textarea className="msg-text" rows={Math.min(8, text.split('\n').length + 1)} value={text} readOnly />
      <div className="msg-preview">{preview}</div>
      <div className="muted small">{note} {close}</div>
    </>
  );
}

function MessageText({ src, id, apply, focus }: { src: MessageSource; id: number; apply: (f: () => void) => void; focus: boolean }): ReactNode {
  const stored = src.text(id)!;
  const [draft, setDraft] = useState(stored);
  let preview: ReactNode;
  let error = '';
  try {
    preview = src.preview(id, draft);
  } catch (e) {
    error = (e as Error).message;
    preview = src.preview(id, stored);
  }
  const commit = (): void => {
    if (draft === src.text(id) || error) return;
    apply(() => src.setText(id, draft));
  };
  return (
    <>
      <textarea
        className="msg-text"
        autoFocus={focus}
        rows={Math.min(8, stored.split('\n').length + 1)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {error && <div className="error small">{error}</div>}
      <div className="msg-preview">{preview}</div>
    </>
  );
}
