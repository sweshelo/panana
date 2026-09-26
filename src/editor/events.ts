// Event (EventObject row) UI: kind-specific fields in the inspector, links between switches and their
// targets, and a list of the dungeon's events.
import { EVENT_KINDS, KIND_SWITCH, SCRIPT_LINKS, SWITCH_PRESETS, kindName } from '../game/eventkinds';
import { LAYOUTS, P3, loadDoc, recCellPos, type MapDoc, type Rec } from '../game/sections';
import { mapShortTitle } from '../game/names';
import { u16, u32, w32 } from '../util/bytes';
import { bytesToHex, clear, h, hexToBytes } from './dom';
import type { EditorState } from './state';

/** EventObject row a record refers to (0 = none). */
export function eventRowOf(section: number, rec: Rec): number {
  if (section === 3) return P3.door(rec.raw);
  if (section === 4 || section === 5 || section === 8) return u32(rec.raw, 0);
  return 0;
}

/** Records of a map that use an event row. */
export function recordsOfRow(doc: MapDoc, row: number): { section: number; index: number; rec: Rec }[] {
  const out: { section: number; index: number; rec: Rec }[] = [];
  if (!row) return out;
  for (const section of [3, 4, 5, 8])
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

function field(label: string, input: HTMLElement | string): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
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

/** Inspector block for the EventObject row of a record. */
export function eventPanel(st: EditorState, row: number): HTMLElement {
  const ev = st.currentEvents!;
  const game = st.game;
  const box = h('div', { class: 'event-box' });
  const r = ev.table.row(row);
  const kind = ev.kind(row);
  const info = EVENT_KINDS[kind];
  const kindSel = h('select', {
    onchange: (e: Event) => st.editTables(() => (ev.table.row(row)[0x4d] = Number((e.target as HTMLSelectElement).value))),
  });
  const kinds = new Set([...Object.keys(EVENT_KINDS).map(Number), kind]);
  for (const k of [...kinds].sort((a, b) => a - b)) {
    if (k === KIND_SWITCH && !game.switchVersion && kind !== KIND_SWITCH) continue;
    kindSel.append(h('option', { value: k, selected: k === kind }, `0x${k.toString(16).toUpperCase().padStart(2, '0')} ${kindName(k)}`));
  }
  box.append(h('h3', {}, `イベント #${row}`), field('種類 (+0x4D)', kindSel));
  if (info?.note) box.append(h('div', { class: 'muted small' }, info.note));

  // messages
  for (const off of info?.messages ?? []) {
    const id = u32(r, off);
    const input = h('input', { type: 'number', min: 0, value: id });
    input.addEventListener('change', () => {
      const v = Math.trunc(Number(input.value));
      if (v >= 0) st.editTables(() => w32(ev.table.row(row), off, v));
    });
    box.append(field(`メッセージ (+0x${off.toString(16).toUpperCase()})`, input), h('div', { class: 'msg' }, id ? game.master.message(id) ?? '(見つからない ID)' : '(なし)'));
  }

  // generic switch
  if (kind === KIND_SWITCH) {
    if (!game.switchVersion) box.append(h('div', { class: 'error' }, '土台の MOD に汎用スイッチ (code.ips) がありません。ヘッダーの「土台の MOD」で elpulse の mod/out を読み込んでください。'));
    const candidates: number[] = [];
    const doc = st.current!;
    for (const s of [3, 5, 8]) for (const rec of doc.recs[s] ?? []) {
      const x = eventRowOf(s, rec);
      if (x && x !== row && ev.has(x) && !candidates.includes(x)) candidates.push(x);
    }
    for (const [i, off] of [[1, 0x08], [2, 0x0c]] as const) {
      const cur = u32(r, off);
      const sel = h('select', { onchange: (e: Event) => st.editTables(() => w32(ev.table.row(row), off, Number((e.target as HTMLSelectElement).value))) });
      sel.append(h('option', { value: 0, selected: cur === 0 }, '(なし)'));
      for (const c of candidates) sel.append(h('option', { value: c, selected: c === cur }, rowLabel(st, c)));
      if (cur && !candidates.includes(cur)) sel.append(h('option', { value: cur, selected: true }, rowLabel(st, cur)));
      box.append(field(`開ける対象 ${i} (+0x${off.toString(16).toUpperCase()})`, sel));
    }
    const presetSel = h('select', {
      onchange: (e: Event) => {
        const p = SWITCH_PRESETS[Number((e.target as HTMLSelectElement).value)];
        if (p) st.editTables(() => {
          const rr = ev.table.row(row);
          rr[0x10] = p.loadAnim;
          rr[0x11] = p.openAnim;
          rr[0x12] = p.sound;
        });
      },
    });
    const curPreset = SWITCH_PRESETS.findIndex((p) => p.loadAnim === (r[0x10] || 0x55) && p.openAnim === (r[0x11] || 0x53) && p.sound === (r[0x12] || 0x6f));
    SWITCH_PRESETS.forEach((p, i) => presetSel.append(h('option', { value: i, selected: i === curPreset }, p.label)));
    if (curPreset < 0) presetSel.append(h('option', { value: -1, selected: true }, `独自 (0x${r[0x10]!.toString(16)} / 0x${r[0x11]!.toString(16)} / 効果音 0x${r[0x12]!.toString(16)})`));
    box.append(field('対象の開き方 (+0x10 / +0x11 / +0x12)', presetSel),
      h('div', { class: 'muted small' }, '踏むと押されたままになり、対象を開けて通れるようにします (開けるだけで閉じません)。対象は同じマップに置いてください。'));
  }

  // hard-coded script pairs
  if (kind === 0x24) {
    const t = switchTargets(st, row);
    if (t.rows.length) box.append(h('div', { class: 'muted small' }, `この行のスクリプトが開ける行: ${t.rows.map((x) => rowLabel(st, x)).join('、')} (コードに書かれているので、行番号を変えるとつながりが切れます)`));
  }

  box.append(h('div', { class: 'muted small' }, `状態の枠 (+0x44) = ${ev.slot(row)}、モデル (+0x46) = ${u16(r, 0x46)}`));
  const raw = h('textarea', { class: 'raw', rows: 6, value: bytesToHex(r) });
  raw.addEventListener('change', () => {
    const b = hexToBytes(raw.value);
    if (!b || b.length !== r.length) {
      raw.classList.add('bad');
      return;
    }
    st.editTables(() => ev.table.row(row).set(b));
  });
  box.append(field('生データ (0x50 バイト)', raw));
  return box;
}

/** Every event row of the current dungeon, with the maps that use it. */
export function openEventList(st: EditorState, onPick: (map: number, section: number, index: number) => void): void {
  const ev = st.currentEvents;
  const doc = st.current;
  if (!ev || !doc) return;
  const game = st.game;
  const maps = game.editableMaps().filter((m) => m.dungeon === doc.dungeon);
  const uses = new Map<number, { map: number; section: number; index: number; label: string }[]>();
  for (const m of maps) {
    const d = st.docs.get(m.hash) ?? loadDoc(game.db, m);
    for (const section of [3, 4, 5, 8])
      (d.recs[section] ?? []).forEach((rec, index) => {
        const row = eventRowOf(section, rec);
        if (!row && section === 3) return;
        const [x, y] = recCellPos(rec, LAYOUTS[section]!);
        uses.set(row, [...(uses.get(row) ?? []), { map: m.hash, section, index, label: `${mapShortTitle(m, game.code.maps)} 区画${section} (${x.toFixed(1)}, ${y.toFixed(1)})` }]);
      });
  }
  const filter = h('select', {}, h('option', { value: '' }, 'すべての種類'), ...[...new Set(Array.from({ length: ev.rows }, (_, i) => ev.kind(i)))].sort((a, b) => a - b).map((k) => h('option', { value: k }, kindName(k))));
  const tbody = h('tbody');
  const render = (): void => {
    clear(tbody);
    const k = filter.value === '' ? -1 : Number(filter.value);
    for (let row = 0; row < ev.rows; row++) {
      if (k >= 0 && ev.kind(row) !== k) continue;
      const u = uses.get(row) ?? [];
      const targets = switchTargets(st, row).rows;
      tbody.append(h('tr', { class: u.length ? 'pick' : '', onclick: () => { if (u[0]) { onPick(u[0].map, u[0].section, u[0].index); dlg.close(); } } },
        h('td', { class: 'num' }, String(row)),
        h('td', {}, kindName(ev.kind(row))),
        h('td', { class: 'num muted' }, String(ev.slot(row))),
        h('td', {}, ...u.flatMap((x, i) => (i ? [h('br'), x.label] : [x.label]))),
        h('td', { class: 'muted' }, targets.length ? `→ 行 ${targets.join(', ')}` : '')));
    }
  };
  filter.addEventListener('change', render);
  const dlg = h('dialog', { class: 'picker wide' },
    h('div', { class: 'picker-head' }, h('h2', {}, `イベントの一覧 (${game.master.dungeonName(doc.dungeon)}: ${ev.rows} 行 / 枠 ${ev.capacity})`), h('button', { onclick: () => dlg.close() }, '閉じる')),
    h('div', {}, h('div', { class: 'row' }, filter, h('span', { class: 'muted small' }, 'クリックでその行を使うレコードへ移動')),
      h('div', { class: 'picker-list' }, h('table', { class: 'picker-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '行'), h('th', {}, '種類'), h('th', {}, '枠'), h('th', {}, '使っている場所'), h('th', {}, 'つながり'))), tbody))),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  document.body.append(dlg);
  dlg.showModal();
  render();
}

