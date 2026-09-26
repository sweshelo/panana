// Tile palette: (kind, letter) pairs of the current tileset that have a model, with thumbnails.
import type { ModelFactory } from '../cgfx/three';
import { letterByte, letterIndex } from '../game/sections';
import { clear, h } from './dom';
import { kindColor, kindName, ROT_ARROW } from './legend';
import type { EditorState } from './state';
import { renderThumb } from './thumbs';

export class Palette {
  readonly el = h('div', { class: 'palette' });
  private readonly list = h('div', { class: 'palette-list' });
  private readonly brushInfo = h('div', { class: 'brush-info' });
  private thumbs = new Map<string, string | null>();
  private factory: ModelFactory | null = null;

  constructor(private readonly st: EditorState) {
    this.el.append(h('h3', {}, 'タイル'), this.brushInfo, this.list);
  }

  setFactory(f: ModelFactory | null): void {
    this.factory = f;
    this.thumbs.clear();
    this.render();
  }

  render(): void {
    const st = this.st;
    const b = st.brush;
    clear(this.brushInfo);
    this.brushInfo.append(
      h('span', {}, `ブラシ: 種類 ${b.kind}${letterIndex(b.letter) ? String.fromCharCode(b.letter) : ''} `),
      h('button', { title: '左に回す (Shift+R)', onclick: () => this.rot(-1) }, '⟲'),
      h('span', { class: 'rot' }, ` ${ROT_ARROW[b.rot]} ${b.rot * 90}° `),
      h('button', { title: '右に回す (R)', onclick: () => this.rot(1) }, '⟳'),
    );
    clear(this.list);
    const pal = st.game.master.palette(st.tileset);
    for (const [kind, letters] of pal) {
      const row = h('div', { class: 'pal-kind' }, h('div', { class: 'pal-kind-name' }, `${kind} ${kindName(kind)}`));
      const items = h('div', { class: 'pal-items' });
      for (const l of letters) {
        const hash = st.game.master.partModel(kind, st.tileset, l);
        const active = b.kind === kind && letterIndex(b.letter) === l;
        const item = h('button', {
          class: 'pal-item' + (active ? ' active' : ''),
          title: `${kind}${l ? String.fromCharCode(0x60 + l) : ''} ${this.factory?.modelName(hash) ?? ''}`,
          onclick: () => {
            st.brush = { ...st.brush, kind, letter: letterByte(l) };
            st.setTool('paint');
          },
        });
        const key = `${st.tileset}/${hash}`;
        let url = this.thumbs.get(key);
        if (url === undefined && this.factory) {
          url = renderThumb(this.factory, hash);
          this.thumbs.set(key, url);
        }
        if (url) item.append(h('img', { src: url, alt: '' }));
        else item.append(h('div', { class: 'pal-swatch', style: `background:${kindColor(kind)}` }));
        item.append(h('span', { class: 'pal-label' }, l ? String.fromCharCode(0x60 + l) : '既定'));
        items.append(item);
      }
      row.append(items);
      this.list.append(row);
    }
  }

  private rot(d: 1 | -1): void {
    this.st.brush = { ...this.st.brush, rot: (this.st.brush.rot + d + 4) & 3 };
    this.st.emit('tool');
  }
}
