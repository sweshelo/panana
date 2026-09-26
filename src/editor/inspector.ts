// Inspector: properties of the selection (tile / point record / rectangle) or of the map.
import { LAYOUTS, LETTER_DEFAULT, P3, POINT_SECTIONS, letterByte, letterIndex, loadDoc, pointKindLabel, recCellPos, type MapDoc, type Rec } from '../game/sections';
import { hex8, u32, w32 } from '../util/bytes';
import type { Controller } from './controller';
import { norm } from './controller';
import { bytesToHex, clear, h, hexToBytes, parseHex } from './dom';
import { kindName, ROT_ARROW, SECTION_COLORS } from './legend';
import { tileAt, type EditorState } from './state';

export class Inspector {
  readonly el = h('div', { class: 'inspector' });

  constructor(
    private readonly st: EditorState,
    private readonly ctl: Controller,
  ) {}

  render(): void {
    clear(this.el);
    const doc = this.st.current;
    if (!doc) return;
    const s = this.st.selection;
    if (s.type === 'tiles') this.tiles(doc, s.cells);
    else if (s.type === 'rec') this.rec(doc, s.section, s.index);
    else if (s.type === 'rect') this.rect(s);
    else this.map(doc);
  }

  private field(label: string, input: HTMLElement): HTMLElement {
    return h('label', { class: 'field' }, h('span', {}, label), input);
  }

  private num(value: number, onchange: (v: number) => void, attrs: Record<string, number> = {}): HTMLInputElement {
    return h('input', {
      type: 'number',
      value,
      ...attrs,
      onchange: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onchange(Math.trunc(v));
      },
    });
  }

  private hexInput(value: number, onchange: (v: number) => void): HTMLInputElement {
    const inp = h('input', {
      type: 'text',
      class: 'hex',
      value: hex8(value),
      onchange: () => {
        const v = parseHex(inp.value);
        if (v === null) inp.classList.add('bad');
        else {
          inp.classList.remove('bad');
          onchange(v);
        }
      },
    });
    return inp;
  }

  private tiles(doc: MapDoc, cells: [number, number][]): void {
    const st = this.st;
    const tiles = cells.map(([x, y]) => tileAt(doc, x, y)).filter((t): t is NonNullable<typeof t> => !!t);
    this.el.append(h('h3', {}, cells.length === 1 ? `タイル (${cells[0]![0]}, ${cells[0]![1]})` : `タイル ${tiles.length} 枚`));
    const rotButtons = h(
      'div',
      { class: 'row' },
      h('button', { onclick: () => this.ctl.rotate(-1) }, '⟲ 左'),
      h('button', { onclick: () => this.ctl.rotate(1) }, '右 ⟳'),
      h('button', { class: 'danger', onclick: () => this.ctl.deleteSelection() }, '削除'),
    );
    if (tiles.length === 1) {
      const t = tiles[0]!;
      const pal = st.game.master.palette(st.tileset);
      const kindSel = h('select', {
        onchange: (e: Event) => {
          const k = Number((e.target as HTMLSelectElement).value);
          st.edit((d) => {
            const tt = tileAt(d, t.x, t.y);
            if (tt) tt.kind = k;
          });
        },
      });
      const kinds = new Set([...pal.keys(), t.kind]);
      for (const k of [...kinds].sort((a, b) => a - b))
        kindSel.append(h('option', { value: k, selected: k === t.kind }, `${k} ${kindName(k)}${pal.has(k) ? '' : ' (モデルなし)'}`));
      const letters = pal.get(t.kind) ?? [0];
      const letterSel = h('select', {
        onchange: (e: Event) => {
          const l = Number((e.target as HTMLSelectElement).value);
          st.edit((d) => {
            const tt = tileAt(d, t.x, t.y);
            if (tt) tt.letter = l === -1 ? t.letter : letterByte(l);
          });
        },
      });
      const li = letterIndex(t.letter);
      for (const l of new Set([...letters, li]))
        letterSel.append(h('option', { value: l, selected: l === li }, l ? String.fromCharCode(0x60 + l) : `既定 (${t.letter === LETTER_DEFAULT ? "'z'" : t.letter})`));
      const model = st.game.master.partModel(t.kind, st.tileset, li);
      this.el.append(
        this.field('種類', kindSel),
        this.field('文字', letterSel),
        this.field('向き', h('span', {}, `${ROT_ARROW[t.rot]} ${t.rot} (${t.rot * 90}°)`)),
        rotButtons,
        h('div', { class: 'muted' }, `モデル ${hex8(model)}`),
        h('button', {
          onclick: () => {
            st.brush = { kind: t.kind, letter: t.letter, rot: t.rot };
            st.setTool('paint');
          },
        }, 'このタイルでブラシを作る'),
      );
    } else this.el.append(rotButtons);
  }

  private rect(s: { x0: number; y0: number; x1: number; y1: number }): void {
    const r = norm({ type: 'rect', ...s });
    const c = this.ctl;
    this.el.append(
      h('h3', {}, `範囲 (${r.x0}, ${r.y0})〜(${r.x1}, ${r.y1})`),
      h('div', { class: 'row' },
        h('button', { onclick: () => c.copy() }, 'コピー (Ctrl+C)'),
        h('button', { onclick: () => c.paste(), disabled: !this.st.clip }, '貼り付け (Ctrl+V)'),
        h('button', { class: 'danger', onclick: () => c.deleteSelection() }, 'タイルを消す (Del)'),
      ),
      h('div', { class: 'row' },
        h('span', {}, '中身を動かす: '),
        h('button', { onclick: () => c.shiftSelection(0, -1) }, '↑'),
        h('button', { onclick: () => c.shiftSelection(0, 1) }, '↓'),
        h('button', { onclick: () => c.shiftSelection(-1, 0) }, '←'),
        h('button', { onclick: () => c.shiftSelection(1, 0) }, '→'),
      ),
      h('p', { class: 'muted' }, '移動では、範囲内のタイルと、その上の地点・宝箱・区画 6 のセルも一緒に動きます (Shift+矢印キー)。貼り付けはマウスのあるセルが左上になります。'),
    );
  }

  private rec(doc: MapDoc, k: number, i: number): void {
    const st = this.st;
    const L = LAYOUTS[k]!;
    const r = doc.recs[k]?.[i];
    if (!r) return;
    const [cx, cy] = recCellPos(r, L);
    const upd = (f: (rec: Rec) => void): void => st.edit((d) => f(d.recs[k]![i]!));
    const setU32 = (off: number) => (v: number) => upd((rec) => w32(rec.raw, off, v));
    this.el.append(
      h('h3', {}, h('span', { class: 'dot', style: `background:${SECTION_COLORS[k]}` }), ` ${L.label} #${i}`),
      this.field(L.unit === 'cell' ? 'x (セル)' : 'x (細かい単位)', this.num(r.x, (v) => upd((rec) => (rec.x = v)))),
      this.field(L.unit === 'cell' ? 'y (セル)' : 'y (細かい単位)', this.num(r.y, (v) => upd((rec) => (rec.y = v)))),
      h('div', { class: 'muted' }, `セル (${cx.toFixed(1)}, ${cy.toFixed(1)})` + (L.unit === 'fine' ? '  ワールド = 50 + 値 × 100 (0〜299)' : '')),
    );
    if (k === 3) this.point(r, setU32, upd);
    else if (k !== 1) this.el.append(this.field('ID (+0)', this.hexInput(u32(r.raw, 0), setU32(0))));
    // raw bytes (x / y are overwritten from the fields above)
    const raw = h('textarea', { class: 'raw', rows: 3, value: bytesToHex(r.raw) });
    raw.addEventListener('change', () => {
      const b = hexToBytes(raw.value);
      if (!b || b.length !== L.size) {
        raw.classList.add('bad');
        return;
      }
      upd((rec) => {
        rec.raw = b;
        rec.x = (b[L.xo]! | (b[L.xo + 1]! << 8)) << 16 >> 16;
        rec.y = (b[L.yo]! | (b[L.yo + 1]! << 8)) << 16 >> 16;
      });
    });
    this.el.append(
      this.field(`生データ (${L.size} バイト)`, raw),
      h('div', { class: 'row' },
        h('button', { onclick: () => this.ctl.duplicateRec() }, '複製'),
        h('button', { class: 'danger', onclick: () => this.ctl.deleteSelection() }, '削除 (Del)'),
      ),
    );
  }

  private point(r: Rec, setU32: (off: number) => (v: number) => void, upd: (f: (rec: Rec) => void) => void): void {
    const st = this.st;
    const game = st.game;
    const destMap = P3.destMap(r.raw);
    const mapSel = h('select', {
      onchange: (e: Event) => setU32(4)(Number((e.target as HTMLSelectElement).value) >>> 0),
    });
    mapSel.append(h('option', { value: 0, selected: destMap === 0 }, '(なし)'));
    for (const m of game.editableMaps()) mapSel.append(h('option', { value: m.hash, selected: m.hash === destMap }, m.name));
    if (destMap && !game.code.byHash(destMap)) mapSel.append(h('option', { value: destMap, selected: true }, hex8(destMap)));

    const destPoint = P3.destPoint(r.raw);
    let pointSel: HTMLElement;
    const destInfo = destMap ? game.code.byHash(destMap) : undefined;
    if (destInfo) {
      const dd = st.docs.get(destMap) ?? loadDoc(game.db, destInfo);
      const sel = h('select', { onchange: (e: Event) => setU32(8)(Number((e.target as HTMLSelectElement).value) >>> 0) });
      const ids = (dd.recs[3] ?? []).map((p) => ({ id: P3.id(p.raw), label: `${hex8(P3.id(p.raw))} ${pointKindLabel(P3.kind(p.raw))} (${p.x}, ${p.y})` }));
      if (!ids.some((p) => p.id === destPoint)) sel.append(h('option', { value: destPoint, selected: true }, `${hex8(destPoint)} (行き先にない)`));
      for (const p of ids) sel.append(h('option', { value: p.id, selected: p.id === destPoint }, p.label));
      pointSel = sel;
    } else pointSel = this.hexInput(destPoint, setU32(8));

    const kindInput = this.num(P3.kind(r.raw), (v) => upd((rec) => (rec.raw[0x14] = v & 0xff)), { min: 0, max: 255 });
    this.el.append(
      this.field('地点 ID (+0x00)', this.hexInput(P3.id(r.raw), setU32(0))),
      this.field('行き先マップ (+0x04)', mapSel),
      this.field('行き先の地点 (+0x08)', pointSel),
      this.field('扉の番号 (+0x0C)', this.num(P3.door(r.raw), (v) => setU32(0x0c)(v >>> 0))),
      this.field(`種類 (+0x14) ${pointKindLabel(P3.kind(r.raw))}`, kindInput),
      this.field('補助 (+0x15)', this.num(P3.aux(r.raw), (v) => upd((rec) => (rec.raw[0x15] = v & 0xff)), { min: 0, max: 255 })),
      this.field('フラグ (+0x18)', this.hexInput(P3.flags(r.raw), setU32(0x18))),
    );
  }

  private map(doc: MapDoc): void {
    const st = this.st;
    const game = st.game;
    const info = st.info!;
    const changed = st.changedSections(doc);
    const def = game.master.tileset(doc.dungeon);
    const tsSel = h('select', {
      onchange: (e: Event) => {
        st.tileset = Number((e.target as HTMLSelectElement).value);
        st.emit('map');
      },
    });
    for (let t = 0; t < 12; t++) tsSel.append(h('option', { value: t, selected: t === st.tileset }, `${t}${t === def ? ' (既定)' : ''}`));
    this.el.append(
      h('h3', {}, `${doc.name}`),
      h('div', {}, `${game.master.dungeonName(doc.dungeon)} (${info.dungeonCode})  ${doc.floor < 0 ? `地下${-doc.floor}階` : `${doc.floor}階`}`),
      h('div', { class: 'muted' }, `ハッシュ ${hex8(doc.hash)}`),
      this.field('タイルセット (表示のみ)', tsSel),
      h('table', { class: 'sections' },
        h('tr', {}, h('th', {}, '区画'), h('th', {}, '件数'), h('th', {}, '')),
        h('tr', {}, h('td', {}, '0 タイル'), h('td', {}, String(doc.tiles.length)), h('td', {}, changed.includes(0) ? '変更' : '')),
        ...POINT_SECTIONS.map((k) =>
          h('tr', {},
            h('td', {}, h('span', { class: 'dot', style: `background:${SECTION_COLORS[k]}` }), ` ${LAYOUTS[k]!.label}`),
            h('td', {}, String(doc.recs[k]?.length ?? 0)),
            h('td', {}, changed.includes(k) ? '変更' : ''),
          ),
        ),
        h('tr', {}, h('td', {}, '6 部屋のセル'), h('td', {}, String(doc.cells6.length)), h('td', {}, changed.includes(6) ? '変更' : '')),
        h('tr', {}, h('td', {}, '7 (未対応・保持)'), h('td', {}, `${doc.raw[7]?.length ?? 0} B`), h('td', {}, '')),
      ),
      changed.length
        ? h('button', { class: 'danger', onclick: () => confirm(`${doc.name} の変更をすべて取り消しますか?`) && st.revert(doc.hash) }, 'このマップの変更を元に戻す')
        : h('div', { class: 'muted' }, '変更なし'),
    );
  }
}
