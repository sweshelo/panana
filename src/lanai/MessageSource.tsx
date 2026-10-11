// RPG FREE!'s table strings as a MessageSource of the shared message editor (ui/message.tsx MessageEditor): one string
// column of a table, by row. The text is lanaiText's form ({ruby:…}, {page}, {ins:…}, {tag:…}); writing it rebuilds
// the table's pool (table.ts setString), and 元の文に戻す points the field back at the string as read.
import { u32 } from '../util/bytes';
import { hex8 } from '../util/bytes';
import type { MessageSource } from '../ui/message';
import { encodeLanaiMessage, lanaiMessageBytes, parseLanaiText } from './message';
import { LanaiMessage } from './MessageView';
import type { LanaiSession } from './session';
import type { LanaiTable } from './table';

const sources = new WeakMap<LanaiTable, Map<number, MessageSource>>();

/** Puts the string field at `offset` of row `row` back as it was read (an added row's string stays). */
export function revertLanaiString(t: LanaiTable, row: number, offset: number): void {
  const o = t.originalRow(row);
  if (o) t.setString(row, offset, lanaiMessageBytes(t.original, u32(o, offset)));
}

/** The strings of the column at `offset` (named `name`) of a table, by row. */
export function lanaiMessageSource(session: LanaiSession, t: LanaiTable, offset: number, name = t.fieldName(offset) ?? `+${offset.toString(16).toUpperCase()}`): MessageSource {
  let m = sources.get(t);
  if (!m) sources.set(t, (m = new Map()));
  let s = m.get(offset);
  if (s) return s;
  s = {
    text: (row) => (row >= 0 && row < t.rows ? session.field(t, row, offset)?.text : undefined),
    label: (row) => `${hex8(t.rowId(row))} · ${t.name}.${name} (行 ${row})`,
    readOnly: () => (session.refOf(t) ? undefined : 'この表はまだ読み込まれていないため、書き換えられません。'),
    isEdited: (row) => t.stringChanged(row, offset),
    revert: (row) => revertLanaiString(t, row, offset),
    setText: (row, text) => session.setText(t, row, offset, text),
    preview: (row, text) => {
      const stored = session.field(t, row, offset);
      if (stored && stored.text === text) return <LanaiMessage session={session} tokens={stored.tokens} />;
      const tokens = parseLanaiText(text);
      encodeLanaiMessage(tokens); // throws on an argument that cannot be written
      return <LanaiMessage session={session} tokens={tokens} />;
    },
    missing: () => '(なし)',
  };
  m.set(offset, s);
  return s;
}
