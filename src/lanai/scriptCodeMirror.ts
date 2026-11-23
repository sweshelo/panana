// The CodeMirror editor of a function's text. Loaded only when a script's text is shown (ScriptCodeEditor.tsx imports
// it dynamically); what it knows of the language is scriptAssist.ts.
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  foldService,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  hoverTooltip,
  keymap,
  lineNumbers,
  showTooltip,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  scriptBattleMarks,
  scriptCompletions,
  scriptFoldRange,
  scriptHoverInfo,
  scriptLineMarks,
  scriptSignatureAt,
  scriptWordKind,
  type ScriptAssist,
  type ScriptSignatureHelp,
  type ScriptWordKind,
} from './scriptAssist';

export interface ScriptProblem {
  /** The line in the text, from 1. */
  line: number;
  message: string;
  severity: 'error' | 'warning';
}
export interface ScriptEditorOptions {
  value: string;
  label: string;
  readOnly: boolean;
  assist: ScriptAssist;
  problems: ScriptProblem[];
  onChange: (value: string) => void;
}
export interface ScriptEditorHandle {
  setValue(value: string): void;
  setAssist(assist: ScriptAssist): void;
  setProblems(problems: ScriptProblem[]): void;
  setReadOnly(readOnly: boolean): void;
  /** Writes `text` in place of the selection (at the cursor), puts the cursor after it and focuses the editor. */
  insertAtCursor(text: string): void;
  destroy(): void;
}

/** The token names of the stream language (CodeMirror's legacy names, which map to the tags of STYLE). */
const TOKEN: Record<ScriptWordKind, string> = {
  keyword: 'keyword',
  atom: 'atom',
  who: 'variable-2',
  builtin: 'builtin',
  class: 'type',
};
interface StreamState {
  comment: boolean;
  depth: number;
  /** The token before was a dot: the word after it is a function of the API. */
  dot: boolean;
}
const language = StreamLanguage.define<StreamState>({
  name: 'lanai-event-script',
  startState: () => ({ comment: false, depth: 0, dot: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.comment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.comment = true;
      return 'comment';
    }
    const dot = state.dot;
    state.dot = false;
    if (stream.match(/^-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)/u)) return 'number';
    const word = stream.match(/^[A-Za-z_]\w*/u) as RegExpMatchArray | null;
    if (word) {
      if (dot) return 'property';
      const kind = scriptWordKind(word[0]);
      return kind ? TOKEN[kind] : 'variable';
    }
    if (stream.match(/^(?:&&|\|\||==|!=|<=|>=|[=<>!])/u)) return 'operator';
    const c = stream.next();
    if (c === '{') state.depth++;
    else if (c === '}') state.depth = Math.max(0, state.depth - 1);
    else if (c === '.') state.dot = true;
    return c && '(){},:;.'.includes(c) ? 'punctuation' : 'invalid';
  },
  indent(state, textAfter, cx) {
    if (state.comment) return null;
    return Math.max(0, state.depth - (/^\s*\}/u.test(textAfter) ? 1 : 0)) * cx.unit;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '{'] },
    indentOnInput: /^\s*\}$/u,
  },
});

// the colours are Panana's (style.css) where it has one
const STYLE = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.atom, color: '#f78c6c' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.standard(tags.variableName), color: '#82aaff' },
  { tag: tags.special(tags.variableName), color: '#ffcb6b' },
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.propertyName, color: '#82aaff' },
  { tag: tags.operator, color: 'var(--muted)' },
  { tag: tags.punctuation, color: 'var(--muted)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

const THEME = EditorView.theme(
  {
    '&': {
      color: 'var(--text)',
      backgroundColor: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      fontSize: '13px',
    },
    '&.cm-focused': { outline: '1px solid var(--accent)' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', maxHeight: '32em' },
    '.cm-content': { caretColor: 'var(--text)', minHeight: '5em' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(76, 141, 255, 0.3)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--panel)',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
    },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
    '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal' },
    '.cm-script-hover': { padding: '6px 9px', maxWidth: '36em', whiteSpace: 'pre-line' },
    '.cm-script-hover-signature': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
    '.cm-script-hover-about': { color: 'var(--muted)', marginTop: '4px' },
    '.cm-script-signature-active': { fontWeight: 'bold', color: 'var(--accent)', textDecoration: 'underline' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(76, 141, 255, 0.25)', outline: 'none' },
    '.cm-script-line': { color: 'var(--muted)', paddingLeft: '1em', fontStyle: 'italic' },
    '.cm-script-line-missing': { color: 'var(--warn)' },
  },
  { dark: true },
);

/** What a line of talk says, after the call that names it. */
class LineText extends WidgetType {
  constructor(
    readonly text: string,
    readonly missing: boolean,
  ) {
    super();
  }
  override eq(other: LineText): boolean {
    return other.text === this.text && other.missing === this.missing;
  }
  toDOM(): HTMLElement {
    const e = document.createElement('span');
    e.className = this.missing ? 'cm-script-line cm-script-line-missing' : 'cm-script-line';
    e.textContent = this.text.length > 40 ? `${this.text.slice(0, 40)}…` : this.text;
    e.title = this.text;
    e.setAttribute('aria-hidden', 'true');
    return e;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const assistChanged = StateEffect.define<null>();

/** The help of a call's arguments, as the editor shows it: each form, the argument being written in bold. */
function signatureDom(help: ScriptSignatureHelp): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-script-hover cm-script-signature';
  for (const form of help.forms) {
    const row = document.createElement('div');
    row.className = 'cm-script-hover-signature';
    row.append(`${form.head}(`);
    form.params.forEach((p, k) => {
      if (k) row.append(', ');
      const span = document.createElement('span');
      span.textContent = p;
      if (k === help.arg) span.className = 'cm-script-signature-active';
      row.append(span);
    });
    row.append(')');
    if (help.arg >= form.params.length && form.params.length) row.append(` — 引数は ${form.params.length} 個`);
    dom.append(row);
  }
  const abouts = [...new Set(help.forms.map((f) => f.about).filter(Boolean))];
  if (abouts.length) {
    const about = document.createElement('div');
    about.className = 'cm-script-hover-about';
    about.textContent = abouts.join('\n');
    dom.append(about);
  }
  return dom;
}

/** Escape hides the help of the arguments until the text changes. */
const hideSignature = StateEffect.define<null>();
interface SignatureState {
  tooltip: Tooltip | null;
  hidden: boolean;
}
const signatureTooltip = (state: EditorState, hidden: boolean): Tooltip | null => {
  const sel = state.selection.main;
  if (hidden || !sel.empty) return null;
  const doc = state.doc.toString();
  const help = scriptSignatureAt(doc.slice(0, sel.head), doc);
  if (!help) return null;
  return { pos: sel.head, above: true, strictSide: false, arrow: false, create: () => ({ dom: signatureDom(help) }) };
};
/** The help of the call whose arguments the cursor is among (VSCode's signature help). */
const signatureField = StateField.define<SignatureState>({
  create: (state) => ({ tooltip: signatureTooltip(state, false), hidden: false }),
  update(value, tr) {
    const hidden = tr.effects.some((e) => e.is(hideSignature)) || (value.hidden && !tr.docChanged);
    if (!tr.docChanged && !tr.selection && hidden === value.hidden) return value;
    return { tooltip: signatureTooltip(tr.state, hidden), hidden };
  },
  provide: (f) => showTooltip.from(f, (v) => v.tooltip),
});
const signatureKeymap = keymap.of([
  {
    key: 'Escape',
    run: (view) => {
      if (!view.state.field(signatureField).tooltip) return false;
      view.dispatch({ effects: hideSignature.of(null) });
      return true;
    },
  },
]);

/**
 * Runs `make` with the observers of the window `parent` is in. A page opened with window.open (the script tabs) is
 * rendered by this window's code, and CodeMirror makes its IntersectionObserver / ResizeObserver from the globals: one
 * of this window never sees the other tab's elements, so the editor takes itself for hidden and does not draw the
 * lines scrolled into view.
 */
function withObserversOf<T>(parent: HTMLElement, make: () => T): T {
  const win = parent.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!win || win === globalThis.window) return make();
  const g = globalThis as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  const saved = { IntersectionObserver: g.IntersectionObserver, ResizeObserver: g.ResizeObserver };
  g.IntersectionObserver = win.IntersectionObserver;
  g.ResizeObserver = win.ResizeObserver;
  try {
    return make();
  } finally {
    g.IntersectionObserver = saved.IntersectionObserver;
    g.ResizeObserver = saved.ResizeObserver;
  }
}

export function mountScriptEditor(parent: HTMLElement, options: ScriptEditorOptions): ScriptEditorHandle {
  let assist = options.assist;
  let problems = options.problems;
  /** A change the editor is told (setValue) is not told back. */
  let telling = false;
  const readOnly = new Compartment();

  const lineTexts = (view: EditorView): DecorationSet => {
    if (!assist.lines.length && !assist.groups?.length) return Decoration.none;
    const out: Range<Decoration>[] = [];
    const source = view.state.doc.toString();
    for (const m of scriptLineMarks(source)) {
      const line = assist.lines.find((l) => l.id === m.id);
      out.push(
        Decoration.widget({
          widget: new LineText(line ? line.text || '(本文なし)' : 'この行 ID は台詞の表にありません', !line),
          side: 1,
        }).range(m.at),
      );
    }
    for (const m of scriptBattleMarks(source)) {
      const group = assist.groups?.find((g) => g.row === m.row);
      out.push(
        Decoration.widget({
          widget: new LineText(
            group
              ? ` 群れ #${group.row}: ${group.label} (行 ID ${`0x${group.id.toString(16).toUpperCase()}`})`
              : ` 群れ #${m.row} は表にありません`,
            !group,
          ),
          side: 1,
        }).range(m.at),
      );
    }
    return Decoration.set(out, true);
  };
  const lineTextPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = lineTexts(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(assistChanged))))
          this.decorations = lineTexts(u.view);
      }
    },
    { decorations: (p) => p.decorations },
  );

  const complete = (cx: CompletionContext): CompletionResult | null => {
    const r = scriptCompletions(cx.state.sliceDoc(0, cx.pos), assist, cx.explicit);
    if (!r) return null;
    return {
      from: r.from,
      options: r.options.map((o) => ({
        label: o.label,
        detail: o.detail,
        info: o.info,
        type: o.type,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          const text = o.apply ?? o.label;
          // a call is written with its closing parenthesis (unless one is there), the cursor between the two
          const call = text.endsWith('(');
          const close = call && view.state.sliceDoc(to, to + 1) !== '(' ? ')' : '';
          const insert = call && view.state.sliceDoc(to, to + 1) === '(' ? text.slice(0, -1) : text + close;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length - close.length },
            userEvent: 'input.complete',
          });
          // what follows a call's parenthesis or a class's dot is offered at once
          if (call || text.endsWith('.')) startCompletion(view);
        },
      })),
      filter: r.filter,
    };
  };

  const diagnostics = (state: EditorState): Diagnostic[] =>
    problems.map((p) => {
      const line = state.doc.line(Math.max(1, Math.min(p.line, state.doc.lines)));
      const indent = /^\s*/u.exec(line.text)![0].length;
      return {
        from: Math.min(line.from + indent, line.to),
        to: line.to,
        severity: p.severity,
        message: p.message,
      };
    });

  const view = withObserversOf(
    parent,
    () =>
      new EditorView({
        parent,
        state: EditorState.create({
          doc: options.value,
          extensions: [
            lineNumbers(),
            foldGutter(),
            history(),
            drawSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            search({ top: true }),
            indentUnit.of('  '),
            EditorState.tabSize.of(2),
            language,
            syntaxHighlighting(STYLE),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            foldService.of((state, from, to) => scriptFoldRange(state.doc.toString(), from, to)),
            autocompletion({ override: [complete], icons: false }),
            hoverTooltip((view, pos) => {
              const word = view.state.wordAt(pos);
              if (!word) return null;
              const info = scriptHoverInfo(view.state.sliceDoc(0, word.from), view.state.sliceDoc(word.from, word.to));
              if (!info) return null;
              return {
                pos: word.from,
                end: word.to,
                create: () => {
                  const dom = document.createElement('div');
                  dom.className = 'cm-script-hover';
                  for (const signature of info.signatures) {
                    const row = document.createElement('div');
                    row.className = 'cm-script-hover-signature';
                    row.textContent = signature;
                    dom.append(row);
                  }
                  const about = document.createElement('div');
                  about.className = 'cm-script-hover-about';
                  about.textContent = info.about;
                  dom.append(about);
                  return { dom };
                },
              };
            }),
            lineTextPlugin,
            keymap.of([
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
              ...lintKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            signatureField,
            signatureKeymap,
            THEME,
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': options.label, spellcheck: 'false' }),
            readOnly.of([EditorState.readOnly.of(options.readOnly), EditorView.editable.of(!options.readOnly)]),
            EditorView.updateListener.of((u) => {
              if (u.docChanged && !telling) options.onChange(u.state.doc.toString());
            }),
          ],
        }),
      }),
  );
  const showProblems = (): void => view.dispatch(setDiagnostics(view.state, diagnostics(view.state)));
  showProblems();

  return {
    setValue(value) {
      if (value === view.state.doc.toString()) return;
      telling = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      } finally {
        telling = false;
      }
      showProblems();
    },
    setAssist(next) {
      assist = next;
      view.dispatch({ effects: assistChanged.of(null) });
    },
    setProblems(next) {
      problems = next;
      showProblems();
    },
    setReadOnly(value) {
      view.dispatch({
        effects: readOnly.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]),
      });
    },
    insertAtCursor(text) {
      view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
