// Event (EventObject row) UI: kind-specific fields in the inspector, links between switches and their
// targets, and a list of the dungeon's events.
import { useMemo, useState, type ReactNode } from 'react';
import { charaMonsterDesign, fixGroup, KIND_BOSS, readStages } from '../game/boss';
import type { MonsterBook } from '../game/monsters';
import { EVENT_KINDS, KIND_SWITCH, SCRIPT_LINKS, SWITCH_PRESETS, kindName } from '../game/eventkinds';
import { EVENT_SECTIONS, LAYOUTS, P3, loadDoc, recCellPos, recEventRow, type MapDoc, type Rec } from '../game/sections';
import { mapShortTitle } from '../game/names';
import { Dialog } from '../ui/Dialog';
import { MessageEditor } from '../ui/message';
import { u16, u32, w32 } from '../util/bytes';
import { Field, Num, RawBytes } from './fields';
import type { EventLink } from './model';
import type { EditorState } from './state';
import { MESSAGE_HELP } from './message';
import { useEditorState } from '../ui/useEditorState';
import { designModelRef, monsterModelRef, objectRef, PlacedPickButton, type PlacedChoice } from './objectpick';
import { isIndoor, recordObjectRow } from '../game/objects';

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
export function eventLinks(st: EditorState): EventLink[] {
  const doc = st.current;
  if (!doc) return [];
  const sel = st.selection;
  const out: EventLink[] = [];
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

/** Label of an event row in the current map: "イベント #13: 動作なし — 出入口 (13.5, 10.5)". */
function rowLabel(st: EditorState, row: number): string {
  const ev = st.currentEvents!;
  const where = st.current ? recordsOfRow(st.current, row).map((r) => {
    const [x, y] = recCellPos(r.rec, LAYOUTS[r.section]!);
    return `${LAYOUTS[r.section]!.label} (${x.toFixed(1)}, ${y.toFixed(1)})`;
  }) : [];
  return `イベント #${row}: ${kindName(ev.kind(row))}${where.length ? ` — ${where.join(', ')}` : ' (このマップにない)'}`;
}

/**
 * Event rows of the current map as picker choices: each with the model of its first record on the map and where that
 * record is.
 */
export function eventChoices(st: EditorState, rows: number[], book: MonsterBook | null): PlacedChoice[] {
  const ev = st.currentEvents!;
  const doc = st.current!;
  const indoor = isIndoor(doc);
  const master = st.game.master;
  return rows.map((row) => {
    const recs = recordsOfRow(doc, row);
    const first = recs[0];
    const [x, y] = first ? recCellPos(first.rec, LAYOUTS[first.section]!) : [0, 0];
    const obj = first ? recordObjectRow(first.section, first.rec, { master, events: ev, indoor }) : 0;
    // A boss battle shows its first enemy; a character showing a monster (the boss placed with it) shows that monster.
    let model = objectRef(st.game, obj);
    if (!model && ev.kind(row) === KIND_BOSS) {
      const monster = fixGroup(master, readStages(ev.table.row(row)).find((s) => s.fix)?.fix ?? 0)?.slots[0]?.monster ?? 0;
      model = monsterModelRef(st.game, book, monster);
    }
    if (!model && first?.section === 5 && first.rec.raw[8] === 0) {
      const design = charaMonsterDesign(master, ev.model(row));
      if (design !== null) model = designModelRef(st.game, book, design);
    }
    return {
      value: row,
      name: `イベント #${row} ${kindName(ev.kind(row))}`,
      sub: first ? `${LAYOUTS[first.section]!.label}  セル (${x.toFixed(1)}, ${y.toFixed(1)})${recs.length > 1 ? ` ほか ${recs.length - 1} か所` : ''}` : 'このマップにない',
      model,
      badge: ev.kind(row) === KIND_BOSS ? '⚔' : first?.section === 8 ? '▷' : first?.section === 5 ? '☺' : '◇',
      where: first ? { doc, x, y } : undefined,
      category: first ? LAYOUTS[first.section]!.label : 'このマップにない',
      keywords: String(row),
    };
  });
}

const hex2 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;

/** Inspector block for the EventObject row of a record. */
export function EventPanel({ st, row, book = null }: { st: EditorState; row: number; book?: MonsterBook | null }): ReactNode {
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
            <MessageEditor texts={game.master.texts} id={id} apply={apply} />
          </div>
        );
      })}
      {!!msgOffs.length && (
        <div className="muted small">{MESSAGE_HELP} <a href={`#/messages/${st.current!.dungeon}.${row}`}>メッセージの一覧で開く</a></div>
      )}
      {kind === KIND_SWITCH && <SwitchFields st={st} row={row} book={book} />}
      {kind === 0x24 && <ScriptTargets st={st} row={row} />}
      <div className="muted small">{`状態の枠 (+0x44) = ${ev.slot(row)}、モデル (+0x46) = ${u16(r, 0x46)}`}</div>
      <Field label="生データ (0x50 バイト)">
        <RawBytes bytes={r} rows={6} onChange={(b) => apply(() => ev.table.row(row).set(b))} />
      </Field>
    </div>
  );
}

/** The generic switch: the rows it opens (+0x08 / +0x0C) and how they open. */
function SwitchFields({ st, row, book }: { st: EditorState; row: number; book: MonsterBook | null }): ReactNode {
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
            <PlacedPickButton title={`スイッチが開ける対象 ${i} を選ぶ`} value={cur}
              choices={eventChoices(st, !!cur && !candidates.includes(cur) && ev.has(cur) ? [...candidates, cur] : candidates, book)}
              extra={[{ value: 0, label: '(なし)' }]} missing={(v) => `イベント #${v} (表にない)`}
              onChange={(v) => apply(() => w32(ev.table.row(row), off, v))} />
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
  return <div className="muted small">{`このイベントのスクリプトが開けるもの: ${t.rows.map((x) => rowLabel(st, x)).join('、')} (コードに書かれているので、イベント番号を変えるとつながりが切れます)`}</div>;
}

/** "空き" in the kind filter of the event list. */
const FREE = -2;

/** Choosing the event row of a record from the event list (instead of going to the records). */
export interface EventChoice {
  current: number;
  /** Whether 0 (= none) can be chosen (doors and exits). */
  allowNone: boolean;
  onChoose: (row: number) => void;
}

/**
 * Every event row of the current dungeon, with the maps that use it (or 空き). Clicking one goes to its first record,
 * or, with `choose`, picks it for a record (rows other objects use cannot be picked, so two objects do not share one).
 * The trash button deletes an event nothing uses, so its number is free again.
 */
export function EventListDialog({ st, onPick, onClose, choose }: {
  st: EditorState; onPick?: (map: number, section: number, index: number) => void; onClose: () => void; choose?: EventChoice;
}): ReactNode {
  useEditorState(st);
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
    // st.revision: records change in place
  }, [st, game, doc, st.revision]);
  const { live, free: freeList } = useMemo(() => st.eventRowUse(doc.dungeon), [st, doc, st.revision]);
  const free = new Set(freeList);
  const kinds = [...new Set(Array.from({ length: ev.rows }, (_, i) => ev.kind(i)))].sort((a, b) => a - b);
  const rows = Array.from({ length: ev.rows }, (_, i) => i).filter((row) => row > 0 && (kind === FREE ? free.has(row) : kind < 0 || (!free.has(row) && ev.kind(row) === kind)));
  const added = ev.originalRows;
  const remove = (row: number): void => {
    const game0 = row < added ? '\nゲームにもともとある番号です。ゲームのマップは使っていませんが、ゲームのプログラムが番号で使っているかもしれません。' : '';
    if (!confirm(`イベント #${row} (${kindName(ev.kind(row))}) を削除して空きにしますか?${game0}`)) return;
    try {
      st.deleteEventRow(doc.dungeon, row);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };
  /** Why a row cannot be deleted, or '' when it can. */
  const keep = (row: number, u: unknown[]): string =>
    u.length ? '置いてある物が使っています。先にその物を削除してください'
      : live.has(row) ? 'ほかのイベント (スイッチの対象・スクリプト・演出のデータ) が使っています'
      : '';
  return (
    <Dialog title={`${choose ? 'イベント番号を選ぶ' : 'イベントの一覧'} (${game.master.dungeonName(doc.dungeon)}: ${ev.rows - 1 - free.size} 個を使用、空き ${free.size} 個 / 上限 ${ev.capacity - 1} 個)`} onClose={onClose}>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(Number(e.target.value))}>
          <option value={-1}>すべての種類</option>
          {free.size > 0 && <option value={FREE}>空き</option>}
          {kinds.map((k) => <option key={k} value={k}>{kindName(k)}</option>)}
        </select>
        {choose?.allowNone && <button onClick={() => choose.onChoose(0)}>なし (0) にする</button>}
        <span className="muted small">
          {choose
            ? 'クリックでこの物のイベント番号にします。ほかの物が使っている番号は選べません。空きを選ぶと中身のないイベントになるので、種類や欄を右ペインで設定してください。'
            : 'クリックでそのイベントを使う物へ移動。宝箱やギミックを削除して、ほかに使う物がなくなった番号は「空き」になり、次に置く物が使います。'}
          {' 🗑 は、置いてある物がないのに残っているイベント (置いていない宝箱など) を削除して空きにします。'}
        </span>
      </div>
      <div className="picker-list">
        <table className="picker-table">
          <thead><tr><th>番号</th><th>種類</th><th>枠</th><th>使っている場所</th><th>つながり</th><th /></tr></thead>
          <tbody>
            {rows.map((row) => {
              const u = uses.get(row) ?? [];
              const isCurrent = choose?.current === row;
              if (free.has(row)) return (
                <tr key={row} className={`muted${choose ? ' pick' : ''}${isCurrent ? ' current' : ''}`} onClick={() => choose?.onChoose(row)}>
                  <td className="num">{row}</td>
                  <td>空き</td>
                  <td />
                  <td>{choose ? '選ぶとこの物が使います' : '次に置く宝箱やギミックが使います'}</td>
                  <td />
                  <td />
                </tr>
              );
              const targets = switchTargets(st, row).rows;
              const taken = !!choose && !isCurrent && u.length > 0;
              const pickable = choose ? !taken : u.length > 0;
              const why = keep(row, u);
              return (
                <tr key={row} className={`${pickable ? 'pick' : ''}${isCurrent ? ' current' : ''}${taken ? ' muted' : ''}`} title={taken ? 'ほかの物が使っている番号です' : ''}
                  onClick={() => {
                    if (choose) { if (!taken) choose.onChoose(row); }
                    else if (u[0]) onPick?.(u[0].map, u[0].section, u[0].index);
                  }}>
                  <td className="num">{row}</td>
                  <td>{kindName(ev.kind(row))}</td>
                  <td className="num muted">{ev.slot(row)}</td>
                  <td>{u.length ? u.map((x, i) => <div key={i}>{x.label}</div>) : <span className="muted">{live.has(row) ? 'ほかのイベントから使われている' : '置いてある物なし'}</span>}</td>
                  <td className="muted">{targets.length ? `→ イベント #${targets.join(', #')}` : ''}</td>
                  <td>
                    <button className="small danger" disabled={!!why} title={why || 'このイベントを削除して空きにする'} aria-label={`イベント #${row} を削除`}
                      onClick={(e) => { e.stopPropagation(); remove(row); }}>🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/**
 * The event number of a record: what it is now, and a button that opens the event list to choose another (so the
 * number is one the table has, and not one another object uses).
 */
export function EventRowField({ st, label, value, allowNone, onChange }: {
  st: EditorState; label: string; value: number; allowNone: boolean; onChange: (row: number) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const ev = st.currentEvents;
  const text = !value ? 'なし' : !ev ? `イベント #${value}` : ev.has(value) ? `イベント #${value}: ${kindName(ev.kind(value))}` : `イベント #${value} (表にない番号)`;
  return (
    <Field label={label}>
      <div className="row">
        <span className={ev && value && !ev.has(value) ? 'error' : ''}>{text}</span>
        <button className="small" disabled={!ev} onClick={() => setOpen(true)}>選ぶ…</button>
      </div>
      {open && ev && (
        <EventListDialog st={st} onClose={() => setOpen(false)} choose={{ current: value, allowNone, onChoose: (row) => { setOpen(false); onChange(row); } }} />
      )}
    </Field>
  );
}
