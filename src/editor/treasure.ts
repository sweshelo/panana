// Chest contents UI: which treasureGroup row a chest uses (chosen in a <dialog> listing every row with its
// items) and the items of that row (filled slots only, "追加" picks an item from a <dialog> list).
import type { Master } from '../game/master';
import { clear, h } from './dom';
import type { EditorState } from './state';

const CATEGORY: Record<number, string> = { 1: '道具', 2: 'ゴールド', 3: '装備', 4: 'つりざお', 5: 'エサ' };
const CHEST_KIND = 0x0c;

type Slot = { item: number; weight: number };

export function itemLabel(master: Master, id: number): string {
  return master.itemName(id) || `アイテム ${id}`;
}

function filled(slots: Slot[]): Slot[] {
  return slots.filter((s) => s.item);
}

function summary(master: Master, slots: Slot[]): string {
  const f = filled(slots);
  const total = f.reduce((a, s) => a + s.weight, 0);
  if (!f.length) return '(空)';
  return f.map((s) => `${itemLabel(master, s.item)}${f.length > 1 && total ? ` ${Math.round((s.weight / total) * 100)}%` : ''}`).join('、');
}

/** Write the filled slots back packed at the front; empty slots are {0, 1} like the game's data. */
function writeSlots(master: Master, row: number, slots: Slot[]): void {
  const f = filled(slots);
  for (let i = 0; i < 10; i++) {
    const s = f[i];
    master.setTreasureSlot(row, i, s ? s.item : 0, s ? s.weight : 1);
  }
}

function openDialog(title: string, body: HTMLElement, wide = true): HTMLDialogElement {
  const dlg = h('dialog', { class: 'picker' + (wide ? ' wide' : '') },
    h('div', { class: 'picker-head' }, h('h2', {}, title), h('button', { onclick: () => dlg.close() }, '閉じる')),
    body,
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close(); // backdrop
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Pick an item from a searchable list. */
export function pickItem(master: Master, onPick: (id: number) => void): void {
  const search = h('input', { type: 'search', placeholder: '名前か ID で絞り込み', class: 'picker-search' });
  const cat = h('select', {}, h('option', { value: '' }, 'すべての分類'), ...Object.entries(CATEGORY).map(([v, l]) => h('option', { value: v }, l)));
  const tbody = h('tbody');
  const items: { id: number; name: string; cat: number; price: number }[] = [];
  for (let i = 1; i < master.itemData.rows; i++) {
    const name = master.itemName(i);
    if (!name) continue;
    const r = master.itemData.row(i);
    items.push({ id: i, name, cat: r[0x2c]! & 15, price: r[0]! | (r[1]! << 8) | (r[2]! << 16) });
  }
  const render = (): void => {
    clear(tbody);
    const q = search.value.trim();
    const c = cat.value ? Number(cat.value) : 0;
    for (const it of items) {
      if (c && it.cat !== c) continue;
      if (q && !it.name.includes(q) && String(it.id) !== q) continue;
      tbody.append(h('tr', { class: 'pick', onclick: () => { onPick(it.id); dlg.close(); } },
        h('td', { class: 'num' }, String(it.id)), h('td', {}, it.name), h('td', { class: 'muted' }, CATEGORY[it.cat] ?? ''), h('td', { class: 'num muted' }, it.price ? `${it.price}G` : '')));
    }
  };
  search.addEventListener('input', render);
  cat.addEventListener('change', render);
  const dlg = openDialog('アイテムを選ぶ', h('div', {},
    h('div', { class: 'row' }, search, cat),
    h('div', { class: 'picker-list' }, h('table', { class: 'picker-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, '名前'), h('th', {}, '分類'), h('th', {}, '買値'))), tbody)),
  ));
  render();
  search.focus();
}

/** How many chests (in the loaded dungeons) use each treasureGroup row. */
function usage(st: EditorState): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [d, t] of st.events)
    for (let i = 0; i < t.rows; i++)
      if (t.kind(i) === CHEST_KIND) {
        const row = t.treasureRow(i);
        out.set(row, [...(out.get(row) ?? []), `${st.game.master.dungeonName(d)} #${i}`]);
      }
  return out;
}

/** Pick a treasureGroup row (or make a new one) for a chest. */
export function pickTreasureRow(st: EditorState, current: number, onPick: (row: number) => void): void {
  const master = st.game.master;
  const used = usage(st);
  const search = h('input', { type: 'search', placeholder: 'アイテム名か行番号で絞り込み', class: 'picker-search' });
  const onlyFree = h('input', { type: 'checkbox' });
  const tbody = h('tbody');
  const render = (): void => {
    clear(tbody);
    const q = search.value.trim();
    for (let row = 0; row < master.treasureGroup.rows; row++) {
      const slots = master.treasureSlots(row);
      const text = summary(master, slots);
      const users = used.get(row) ?? [];
      if (onlyFree.checked && users.length) continue;
      if (q && String(row) !== q && !text.includes(q)) continue;
      tbody.append(h('tr', { class: 'pick' + (row === current ? ' current' : ''), onclick: () => { onPick(row); dlg.close(); } },
        h('td', { class: 'num' }, String(row)),
        h('td', {}, text),
        h('td', { class: 'muted', title: users.join('、') }, users.length ? `${users.length} 個` : '—')));
    }
  };
  search.addEventListener('input', render);
  onlyFree.addEventListener('change', render);
  const dlg = openDialog('宝箱の中身を選ぶ', h('div', {},
    h('div', { class: 'row' }, search,
      h('label', { class: 'layer' }, onlyFree, ' どの宝箱も使っていない行だけ'),
      h('button', {
        class: 'primary',
        onclick: () => {
          let row = -1;
          st.editTables(() => (row = master.addTreasureRow(master.treasureSlots(current))));
          onPick(row);
          dlg.close();
        },
      }, '今の中身を写して新しい行を作る')),
    h('p', { class: 'muted small' }, '「使っている宝箱」は、読み込んだダンジョンの宝箱のうちこの行を指す数。共有している行の中身を変えると、それらの宝箱も全部変わります。'),
    h('div', { class: 'picker-list' }, h('table', { class: 'picker-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '行'), h('th', {}, '中身'), h('th', {}, '使っている宝箱'))), tbody)),
  ));
  render();
  dlg.querySelector('tr.current')?.scrollIntoView({ block: 'center' });
  search.focus();
}

/** Right-pane editor of a chest's contents. */
export function treasureEditor(st: EditorState, evRow: number): HTMLElement {
  const master = st.game.master;
  const ev = st.currentEvents!;
  const row = ev.treasureRow(evRow);
  const box = h('div', { class: 'treasure' });
  const users = usage(st).get(row) ?? [];
  const valid = row >= 0 && row < master.treasureGroup.rows;
  box.append(
    h('h3', {}, '宝箱の中身'),
    h('div', { class: 'row' },
      h('span', { class: 'grow' }, `中身の表 #${row}`, users.length > 1 ? h('span', { class: 'badge', title: users.join('、') }, `${users.length} 個の宝箱で共有`) : ''),
      h('button', { onclick: () => pickTreasureRow(st, row, (v) => st.editTables(() => ev.setTreasureRow(evRow, v))) }, '変更…'),
    ),
  );
  if (!valid) {
    box.append(h('div', { class: 'error' }, `中身の表に行 ${row} がありません`));
    return box;
  }
  const slots = master.treasureSlots(row);
  const items = filled(slots);
  const total = items.reduce((a, s) => a + s.weight, 0);
  const list = h('div', { class: 'loot' });
  items.forEach((s, i) => {
    const update = (next: Slot | null): void => {
      const copy = items.map((x) => ({ ...x }));
      if (next) copy[i] = next;
      else copy.splice(i, 1);
      st.editTables(() => writeSlots(master, row, copy));
    };
    const weight = h('input', { type: 'number', min: 1, max: 65535, value: s.weight, title: '重み (出やすさ)' });
    weight.addEventListener('change', () => {
      const v = Math.trunc(Number(weight.value));
      if (v >= 1 && v <= 0xffff) update({ item: s.item, weight: v });
    });
    list.append(h('div', { class: 'loot-row' },
      h('button', { class: 'loot-item', title: 'クリックでアイテムを変える', onclick: () => pickItem(master, (id) => update({ item: id, weight: s.weight })) },
        h('span', { class: 'muted' }, `${s.item} `), itemLabel(master, s.item)),
      weight,
      h('span', { class: 'loot-pct' }, total ? `${Math.round((s.weight / total) * 100)}%` : ''),
      h('button', { class: 'danger', title: '外す', onclick: () => update(null) }, '×'),
    ));
  });
  if (!items.length) list.append(h('div', { class: 'muted' }, '空です (開けても何も出ません)。'));
  if (items.length < 10)
    list.append(h('button', {
      class: 'loot-add',
      onclick: () => pickItem(master, (id) => st.editTables(() => writeSlots(master, row, [...items, { item: id, weight: 1 }]))),
    }, '＋ 追加'));
  box.append(list, h('div', { class: 'muted small' },
    `開けると、並んだアイテムから重みに比例して 1 つ選ばれます (最大 10 個)。${users.length > 1 ? 'この中身を変えると共有している宝箱も変わります。別の中身にするには「変更…」で新しい行を作ってください。' : ''}${master.treasureRowChanged(row) ? ' 変更済み。' : ''}`));
  return box;
}
