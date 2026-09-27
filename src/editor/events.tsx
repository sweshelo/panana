// Event (EventObject row) UI: kind-specific fields in the inspector, links between switches and their
// targets, and a list of the dungeon's events.
import { useMemo, useState, type ReactNode } from 'react';
import { KIND_BOSS } from '../game/boss';
import { EVENT_KINDS, KIND_SWITCH, SCRIPT_LINKS, SWITCH_PRESETS, kindName } from '../game/eventkinds';
import { EVENT_SECTIONS, LAYOUTS, P3, loadDoc, recCellPos, recEventRow, type MapDoc, type Rec } from '../game/sections';
import { mapShortTitle } from '../game/names';
import { Dialog } from '../ui/Dialog';
import { MessageEditor } from '../ui/message';
import { u16, u32, w32 } from '../util/bytes';
import { Field, Num, RawBytes } from './fields';
import type { EditorState } from './state';
import { MESSAGE_HELP } from './message';

/** EventObject row a record refers to (0 = none). */
export function eventRowOf(section: number, rec: Rec): number {
  return recEventRow(section, rec.raw);
}

/** Records of a map that use an event row. */
export function recordsOfRow(doc: MapDoc, row: number): { section: number; index: number; rec: Rec }[] {
  const out: { section: number; index: number; rec: Rec }[] = [];
  if (!row) return out;
  for (const section of EVENT_SECTIONS)
    (doc.recs[section] ?? []).forEach((rec, index) => {
      if (eventRowOf(section, rec) === row) out.push({ section, index, rec });
    });
  return out;
}

/** Targets of a switch row: the generic switch's +0x08 / +0x0C, or the hard-coded script pairs. */
export function switchTargets(st: EditorState, row: number): { rows: number[]; generic: boolean } {
  const ev = st.currentEvents;
  if (!ev || !ev.has(row)) return { rows: [], generic: false };
  if (ev.kind(row) === KIND_SWITCH) {
    const r = ev.table.row(row);
    return { rows: [u32(r, 0x08), u32(r, 0x0c)].filter((x) => x && ev.has(x)), generic: true };
  }
  const d = st.current?.dungeon ?? -1;
  return { rows: SCRIPT_LINKS[d]?.[row] ?? [], generic: false };
}

/** Lines to draw: from a switch record to each target record of the current map (cell coordinates). */
export function eventLinks(st: EditorState): { from: [number, number]; to: [number, number]; generic: boolean; selected: boolean }[] {
  const doc = st.current;
  if (!doc) return [];
  const sel = st.selection;
  const out: ReturnType<typeof eventLinks> = [];
  for (const section of [5, 8, 3]) {
    (doc.recs[section] ?? []).forEach((rec, index) => {
      const row = eventRowOf(section, rec);
      const t = switchTargets(st, row);
      if (!t.rows.length) return;
      const from = recCellPos(rec, LAYOUTS[section]!);
      const selected = sel.type === 'rec' && sel.section === section && sel.index === index;
      for (const target of t.rows)
        for (const r of recordsOfRow(doc, target)) {
          const to = recCellPos(r.rec, LAYOUTS[r.section]!);
          out.push({ from: from as [number, number], to: to as [number, number], generic: t.generic, selected: selected || (sel.type === 'rec' && sel.section === r.section && sel.index === r.index) });
        }
    });
  }
  return out;
}

/** Label of an event row in the current map: "行 13: 動作なし (区画 3 (13, 10))". */
function rowLabel(st: EditorState, row: number): string {
  const ev = st.currentEvents!;
  const where = st.current ? recordsOfRow(st.current, row).map((r) => {
    const [x, y] = recCellPos(r.rec, LAYOUTS[r.section]!);
    return `区画 ${r.section} (${x.toFixed(1)}, ${y.toFixed(1)})`;
  }) : [];
  return `行 ${row}: ${kindName(ev.kind(row))}${where.length ? ` — ${where.join(', ')}` : ' (このマップにない)'}`;
}

const hex2 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;

/** Inspector block for the EventObject row of a record. */
export function EventPanel({ st, row }: { st: EditorState; row: number }): ReactNode {
  const ev = st.currentEvents!;
  const game = st.game;
  const r = ev.table.row(row);
  const kind = ev.kind(row);
  const info = EVENT_KINDS[kind];
  /** Message fields shown here (the boss battle has its own block with them). */
  const msgOffs = kind === KIND_BOSS ? [] : info?.messages ?? [];
  const apply = (f: () => void): void => st.editTables(f);
  const kinds = [...new Set([...Object.keys(EVENT_KINDS).map(Number), kind])]
    .sort((a, b) => a - b)
    .filter((k) => k !== KIND_SWITCH || game.switchVersion || kind === KIND_SWITCH);
  return (
    <div className="event-box">
      <h3>{`イベント #${row}`}</h3>
      <Field label="種類 (+0x4D)">
        <select value={kind} onChange={(e) => apply(() => (ev.table.row(row)[0x4d] = Number(e.target.value)))}>
          {kinds.map((k) => <option key={k} value={k}>{`${hex2(k)} ${kindName(k)}`}</option>)}
        </select>
      </Field>
      {info?.note && <div className="muted small">{info.note}</div>}
      {msgOffs.map((off) => {
        const id = u32(r, off);
        return (
          <div key={off}>
            <Field label={`メッセージ (+0x${off.toString(16).toUpperCase()})`}>
              <Num value={id} min={0} onChange={(v) => apply(() => w32(ev.table.row(row), off, v))} />
            </Field>
            <MessageEditor master={game.master} id={id} apply={apply} />
          </div>
        );
      })}
      {!!msgOffs.length && (
        <div className="muted small">{MESSAGE_HELP} <a href={`#/messages/${st.current!.dungeon}.${row}`}>メッセージの一覧で開く</a></div>
      )}
      {kind === KIND_SWITCH && <SwitchFields st={st} row={row} />}
      {kind === 0x24 && <ScriptTargets st={st} row={row} />}
      <div className="muted small">{`状態の枠 (+0x44) = ${ev.slot(row)}、モデル (+0x46) = ${u16(r, 0x46)}`}</div>
      <Field label="生データ (0x50 バイト)">
        <RawBytes bytes={r} rows={6} onChange={(b) => apply(() => ev.table.row(row).set(b))} />
      </Field>
    </div>
  );
}

/** The generic switch: the rows it opens (+0x08 / +0x0C) and how they open. */
function SwitchFields({ st, row }: { st: EditorState; row: number }): ReactNode {
  const ev = st.currentEvents!;
  const r = ev.table.row(row);
  const apply = (f: () => void): void => st.editTables(f);
  const candidates: number[] = [];
  const doc = st.current!;
  for (const s of [3, 5, 8]) for (const rec of doc.recs[s] ?? []) {
    const x = eventRowOf(s, rec);
    if (x && x !== row && ev.has(x) && !candidates.includes(x)) candidates.push(x);
  }
  const curPreset = SWITCH_PRESETS.findIndex((p) => p.loadAnim === (r[0x10] || 0x55) && p.openAnim === (r[0x11] || 0x53) && p.sound === (r[0x12] || 0x6f));
  return (
    <>
      {!st.game.switchVersion && <div className="error">土台の MOD に汎用スイッチ (code.ips) がありません。ヘッダーの「土台の MOD」で elpulse の mod/out を読み込んでください。</div>}
      {([[1, 0x08], [2, 0x0c]] as const).map(([i, off]) => {
        const cur = u32(r, off);
        return (
          <Field key={off} label={`開ける対象 ${i} (+0x${off.toString(16).toUpperCase()})`}>
            <select value={cur} onChange={(e) => apply(() => w32(ev.table.row(row), off, Number(e.target.value)))}>
              <option value={0}>(なし)</option>
              {candidates.map((c) => <option key={c} value={c}>{rowLabel(st, c)}</option>)}
              {!!cur && !candidates.includes(cur) && <option value={cur}>{rowLabel(st, cur)}</option>}
            </select>
          </Field>
        );
      })}
      <Field label="対象の開き方 (+0x10 / +0x11 / +0x12)">
        <select value={curPreset} onChange={(e) => {
          const p = SWITCH_PRESETS[Number(e.target.value)];
          if (p) apply(() => {
            const rr = ev.table.row(row);
            rr[0x10] = p.loadAnim;
            rr[0x11] = p.openAnim;
            rr[0x12] = p.sound;
          });
        }}>
          {SWITCH_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
          {curPreset < 0 && <option value={-1}>{`独自 (0x${r[0x10]!.toString(16)} / 0x${r[0x11]!.toString(16)} / 効果音 0x${r[0x12]!.toString(16)})`}</option>}
        </select>
      </Field>
      <div className="muted small">踏むと押されたままになり、対象を開けて通れるようにします (開けるだけで閉じません)。対象は同じマップに置いてください。</div>
    </>
  );
}

/** The rows a hard-coded script opens. */
function ScriptTargets({ st, row }: { st: EditorState; row: number }): ReactNode {
  const t = switchTargets(st, row);
  if (!t.rows.length) return null;
  return <div className="muted small">{`この行のスクリプトが開ける行: ${t.rows.map((x) => rowLabel(st, x)).join('、')} (コードに書かれているので、行番号を変えるとつながりが切れます)`}</div>;
}

/** Every event row of the current dungeon, with the maps that use it; clicking one goes to its first record. */
export function EventListDialog({ st, onPick, onClose }: {
  st: EditorState; onPick: (map: number, section: number, index: number) => void; onClose: () => void;
}): ReactNode {
  const ev = st.currentEvents!;
  const doc = st.current!;
  const game = st.game;
  const [kind, setKind] = useState(-1);
  const uses = useMemo(() => {
    const out = new Map<number, { map: number; section: number; index: number; label: string }[]>();
    for (const m of game.editableMaps().filter((m) => m.dungeon === doc.dungeon)) {
      const d = st.docs.get(m.hash) ?? loadDoc(game.db, m);
      for (const section of EVENT_SECTIONS)
        (d.recs[section] ?? []).forEach((rec, index) => {
          const row = eventRowOf(section, rec);
          if (!row && (section === 3 || section === 7)) return;
          const [x, y] = recCellPos(rec, LAYOUTS[section]!);
          out.set(row, [...(out.get(row) ?? []), { map: m.hash, section, index, label: `${mapShortTitle(m, game.code.maps)} 区画${section} (${x.toFixed(1)}, ${y.toFixed(1)})` }]);
        });
    }
    return out;
  }, [st, game, doc]);
  const kinds = [...new Set(Array.from({ length: ev.rows }, (_, i) => ev.kind(i)))].sort((a, b) => a - b);
  const rows = Array.from({ length: ev.rows }, (_, i) => i).filter((row) => kind < 0 || ev.kind(row) === kind);
  return (
    <Dialog title={`イベントの一覧 (${game.master.dungeonName(doc.dungeon)}: ${ev.rows} 行 / 枠 ${ev.capacity})`} onClose={onClose}>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(Number(e.target.value))}>
          <option value={-1}>すべての種類</option>
          {kinds.map((k) => <option key={k} value={k}>{kindName(k)}</option>)}
        </select>
        <span className="muted small">クリックでその行を使うレコードへ移動</span>
      </div>
      <div className="picker-list">
        <table className="picker-table">
          <thead><tr><th>行</th><th>種類</th><th>枠</th><th>使っている場所</th><th>つながり</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const u = uses.get(row) ?? [];
              const targets = switchTargets(st, row).rows;
              return (
                <tr key={row} className={u.length ? 'pick' : ''} onClick={() => u[0] && onPick(u[0].map, u[0].section, u[0].index)}>
                  <td className="num">{row}</td>
                  <td>{kindName(ev.kind(row))}</td>
                  <td className="num muted">{ev.slot(row)}</td>
                  <td>{u.map((x, i) => <div key={i}>{x.label}</div>)}</td>
                  <td className="muted">{targets.length ? `→ 行 ${targets.join(', ')}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
