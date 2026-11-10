import { useState, type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';
import { GridPicker } from '../ui/GridPicker';
import { hex8 } from '../util/bytes';
import { LanaiItemPicker } from './pickers';
import type { LanaiSession } from './session';
/** Shared by all Lanai MessageSource users (stage text, item names and NPC conversations). */
export function LanaiMessageInsert({ session, onInsert }: { session: LanaiSession; onInsert: (text: string) => void }): ReactNode {
  const [mode, setMode] = useState<'item' | 'table' | 'row' | null>(null);
  const [table, setTable] = useState('ItemData'), [field, setField] = useState('name');
  const tables = session.tables.filter(r => r.table.fields.some(f => f.name !== 'voice' && r.table.stringOffsets().includes(f.offset)));
  const t = session.table(table);
  const fields = t?.fields.filter(f => f.name !== 'voice' && t.stringOffsets().includes(f.offset)) ?? [];
  const insert = (id: number): void => { onInsert(`{ins:${table}:0x${hex8(id)}:${field}}`); setMode(null); };
  return <>
    <div className="row"><button type="button" onClick={() => setMode('item')}>＋ アイテム名を挿入</button><button type="button" onClick={() => setMode('table')}>＋ 表の文字列を挿入</button></div>
    {mode === 'item' && <LanaiItemPicker session={session} current={-1} title="挿入するアイテム名" onClose={() => setMode(null)} onPick={row => { onInsert(`{ins:ItemData:0x${hex8(session.need('ItemData').rowId(row))}:name}`); setMode(null); }} />}
    {mode === 'table' && <Dialog title="挿入する文字列" onClose={() => setMode(null)}>
      <label className="field"><span>表</span><select value={table} onChange={e => { const name = e.target.value; setTable(name); const next = session.need(name); setField(next.fields.find(f => f.name !== 'voice' && next.stringOffsets().includes(f.offset))!.name); }}>{tables.map(r => <option key={`${r.archive}/${r.entry}`} value={r.table.name}>{r.table.name}</option>)}</select></label>
      <label className="field"><span>欄</span><select value={field} onChange={e => setField(e.target.value)}>{fields.map(f => <option key={f.name}>{f.name}</option>)}</select></label>
      <button onClick={() => setMode('row')}>一覧から選ぶ…</button>
    </Dialog>}
    {mode === 'row' && t && <GridPicker title={`${table}.${field} を挿入`} entries={Array.from({length: t.rows}, (_, row) => ({ id: row, name: session.plain(t, row, field), sub: hex8(t.rowId(row)), icon: null }))} current={-1} onClose={() => setMode(null)} onPick={row => insert(t.rowId(row))} />}
  </>;
}
