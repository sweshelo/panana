// Pointer / keyboard logic shared by the 2D and 3D views. Views convert the pointer to cell coordinates
// (floating point, cell (x, y) spans [x, x+1) x [y, y+1)) and call these handlers.
import { LAYOUTS, POINT_SECTIONS, letterByte, letterIndex, recCellPos, setRecCellPos, type MapDoc } from '../game/sections';
import { inGrid, removeTile, setTile, tileAt, type EditorState, type Selection } from './state';
import { duplicateRecord, placeStamp, type PlaceContext } from './place';

export interface Layers {
  tiles: boolean;
  sections: Record<number, boolean>;
  room: boolean;
}

export class Controller {
  hover: [number, number] | null = null;
  private drag:
    | null
    | { kind: 'rec'; section: number; index: number; dx: number; dy: number; moved: boolean }
    | { kind: 'paint'; last: string }
    | { kind: 'erase'; last: string }
    | { kind: 'rect'; x0: number; y0: number }
    | { kind: 'room'; on: boolean; last: string } = null;

  layers: Layers = { tiles: true, sections: { 1: true, 2: true, 3: true, 4: true, 5: true, 8: true, 9: false }, room: true };
  onHover: () => void = () => {};

  constructor(readonly st: EditorState) {}

  /** Record under a point (cell coords), searching the visible point layers. */
  hitRec(cx: number, cy: number, radius = 0.3): { section: number; index: number } | null {
    const doc = this.st.current;
    if (!doc) return null;
    let best: { section: number; index: number } | null = null;
    let bestD = radius;
    for (const k of POINT_SECTIONS) {
      if (!this.layers.sections[k]) continue;
      const L = LAYOUTS[k]!;
      (doc.recs[k] ?? []).forEach((r, i) => {
        const [px, py] = recCellPos(r, L);
        const d = Math.hypot(px - cx, py - cy);
        if (d < bestD) {
          bestD = d;
          best = { section: k, index: i };
        }
      });
    }
    return best;
  }

  down(cx: number, cy: number, e: { shiftKey: boolean; button: number }): void {
    const st = this.st;
    const doc = st.current;
    if (!doc || e.button !== 0) return;
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    switch (st.tool) {
      case 'select': {
        const hit = this.hitRec(cx, cy);
        if (hit) {
          const r = doc.recs[hit.section]![hit.index]!;
          const [px, py] = recCellPos(r, LAYOUTS[hit.section]!);
          st.select({ type: 'rec', ...hit });
          this.drag = { kind: 'rec', ...hit, dx: px - cx, dy: py - cy, moved: false };
          return;
        }
        if (this.layers.tiles && tileAt(doc, x, y)) {
          const cur = st.selection;
          if (e.shiftKey && cur.type === 'tiles') {
            const has = cur.cells.some(([a, b]) => a === x && b === y);
            st.select({ type: 'tiles', cells: has ? cur.cells.filter(([a, b]) => a !== x || b !== y) : [...cur.cells, [x, y]] });
          } else st.select({ type: 'tiles', cells: [[x, y]] });
        } else st.select({ type: 'none' });
        return;
      }
      case 'paint':
        if (!inGrid(x, y)) return;
        st.checkpoint();
        st.touch((d) => setTile(d, x, y, st.brush));
        this.drag = { kind: 'paint', last: `${x},${y}` };
        return;
      case 'erase':
        st.checkpoint();
        st.touch((d) => removeTile(d, x, y));
        this.drag = { kind: 'erase', last: `${x},${y}` };
        return;
      case 'rect':
        this.drag = { kind: 'rect', x0: x, y0: y };
        st.select({ type: 'rect', x0: x, y0: y, x1: x, y1: y });
        return;
      case 'place': {
        const stamp = st.stamp;
        if (!stamp || !inGrid(x, y)) return;
        let placed: [number, number] | null = null;
        try {
          st.edit((d) => (placed = placeStamp(this.placeContext(d), stamp, cx, cy)));
        } catch (err) {
          st.error = (err as Error).message;
          st.emit('tool');
          return;
        }
        if (placed) st.select({ type: 'rec', section: placed[0], index: placed[1] });
        return;
      }
      case 'room': {
        if (!inGrid(x, y)) return;
        const on = !doc.cells6.some((c) => c.x === x && c.y === y);
        st.checkpoint();
        st.touch((d) => toggleRoom(d, x, y, on));
        this.drag = { kind: 'room', on, last: `${x},${y}` };
        return;
      }
    }
  }

  move(cx: number, cy: number): void {
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    const prev = this.hover;
    this.hover = [x, y];
    if (!prev || prev[0] !== x || prev[1] !== y) this.onHover();
    const st = this.st;
    const d = this.drag;
    if (!d) return;
    const key = `${x},${y}`;
    switch (d.kind) {
      case 'rec': {
        const L = LAYOUTS[d.section]!;
        if (!d.moved) {
          st.checkpoint();
          d.moved = true;
        }
        st.touch((doc) => setRecCellPos(doc.recs[d.section]![d.index]!, L, cx + d.dx, cy + d.dy));
        return;
      }
      case 'paint':
        if (key === d.last || !inGrid(x, y)) return;
        d.last = key;
        st.touch((doc) => setTile(doc, x, y, st.brush));
        return;
      case 'erase':
        if (key === d.last) return;
        d.last = key;
        st.touch((doc) => removeTile(doc, x, y));
        return;
      case 'rect':
        st.select({ type: 'rect', x0: d.x0, y0: d.y0, x1: x, y1: y });
        return;
      case 'room':
        if (key === d.last || !inGrid(x, y)) return;
        d.last = key;
        st.touch((doc) => toggleRoom(doc, x, y, d.on));
        return;
    }
  }

  up(): void {
    this.drag = null;
  }

  leave(): void {
    this.hover = null;
    this.onHover();
  }

  // ---- commands (keyboard / toolbar)

  rotate(dir: 1 | -1): void {
    const st = this.st;
    const s = st.selection;
    if (s.type === 'tiles' && st.tool === 'select') {
      st.edit((doc) => {
        for (const [x, y] of s.cells) {
          const t = tileAt(doc, x, y);
          if (t) t.rot = (t.rot + dir + 4) & 3;
        }
      });
      return;
    }
    st.brush = { ...st.brush, rot: (st.brush.rot + dir + 4) & 3 };
    st.emit('tool');
  }

  cycleLetter(letters: number[], dir: 1 | -1): void {
    const st = this.st;
    const s = st.selection;
    const next = (cur: number): number => {
      const list = letters.length ? letters : [0];
      const i = list.indexOf(letterIndex(cur));
      return letterByte(list[(i + dir + list.length) % list.length]!);
    };
    if (s.type === 'tiles' && st.tool === 'select') {
      st.edit((doc) => {
        for (const [x, y] of s.cells) {
          const t = tileAt(doc, x, y);
          if (t) t.letter = next(t.letter);
        }
      });
      return;
    }
    st.brush = { ...st.brush, letter: next(st.brush.letter) };
    st.emit('tool');
  }

  deleteSelection(): void {
    const st = this.st;
    const s = st.selection;
    if (s.type === 'tiles') st.edit((doc) => s.cells.forEach(([x, y]) => removeTile(doc, x, y)));
    else if (s.type === 'rect') {
      const r = norm(s);
      st.edit((doc) => {
        doc.tiles = doc.tiles.filter((t) => t.x < r.x0 || t.x > r.x1 || t.y < r.y0 || t.y > r.y1);
      });
    } else if (s.type === 'rec') {
      st.edit((doc) => doc.recs[s.section]!.splice(s.index, 1));
      st.select({ type: 'none' });
      return;
    }
    st.emit('selection');
  }

  placeContext(doc: MapDoc): PlaceContext {
    const st = this.st;
    return { doc, docs: st.docs.values(), events: st.currentEvents, master: st.game.master };
  }

  duplicateRec(): void {
    const st = this.st;
    const s = st.selection;
    if (s.type !== 'rec') return;
    let idx = 0;
    try {
      st.edit((doc) => {
        const list = doc.recs[s.section]!;
        const r = list[s.index]!;
        const L = LAYOUTS[s.section]!;
        const copy = duplicateRecord(this.placeContext(doc), s.section, r);
      const [px, py] = recCellPos(r, L);
        setRecCellPos(copy, L, px + (L.unit === 'cell' ? 1 : 0.4), py);
        list.push(copy);
        idx = list.length - 1;
      });
    } catch (err) {
      st.error = (err as Error).message;
      st.emit('tool');
      return;
    }
    st.select({ type: 'rec', section: s.section, index: idx });
  }

  copy(): void {
    const st = this.st;
    const doc = st.current;
    if (!doc) return;
    const s = st.selection;
    let cells: [number, number][] = [];
    if (s.type === 'rect') {
      const r = norm(s);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) cells.push([x, y]);
    } else if (s.type === 'tiles') cells = s.cells;
    if (!cells.length) return;
    const minX = Math.min(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    const maxX = Math.max(...cells.map((c) => c[0]));
    const maxY = Math.max(...cells.map((c) => c[1]));
    const tiles = cells
      .map(([x, y]) => tileAt(doc, x, y))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ ...t, x: t.x - minX, y: t.y - minY }));
    st.clip = { w: maxX - minX + 1, h: maxY - minY + 1, tiles };
    st.emit('tool');
  }

  /** Paste at the hovered cell (top-left). */
  paste(): void {
    const st = this.st;
    const clip = st.clip;
    const at = this.hover ?? (st.selection.type === 'rect' ? [norm(st.selection).x0, norm(st.selection).y0] : null);
    if (!clip || !at) return;
    const [ox, oy] = at;
    st.edit((doc) => {
      for (const t of clip.tiles) {
        const x = t.x + ox;
        const y = t.y + oy;
        if (!inGrid(x, y)) continue;
        removeTile(doc, x, y);
        doc.tiles.push({ ...t, x, y });
      }
    });
    st.select({ type: 'rect', x0: ox, y0: oy, x1: ox + clip.w - 1, y1: oy + clip.h - 1 });
  }

  /** Move the selected record, or the tiles (with the points and room cells on them) of the rectangle. */
  shiftSelection(dx: number, dy: number): void {
    const st = this.st;
    const s = st.selection;
    if (s.type === 'rec') {
      // one unit of the record (a cell, or 1/5 cell for fine coordinates)
      st.edit((doc) => {
        const r = doc.recs[s.section]![s.index]!;
        r.x += dx;
        r.y += dy;
      });
      return;
    }
    if (s.type !== 'rect') return;
    const r = norm(s);
    st.edit((doc) => {
      const moving = doc.tiles.filter((t) => t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1);
      const rest = doc.tiles.filter((t) => !moving.includes(t));
      for (const t of moving) {
        t.x += dx;
        t.y += dy;
      }
      doc.tiles = rest.filter((t) => !moving.some((m) => m.x === t.x && m.y === t.y)).concat(moving);
      const inside = (x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      for (const k of POINT_SECTIONS) {
        const L = LAYOUTS[k]!;
        for (const p of doc.recs[k] ?? []) {
          const [px, py] = recCellPos(p, L);
          if (!inside(Math.floor(px), Math.floor(py))) continue;
          setRecCellPos(p, L, px + dx, py + dy);
        }
      }
      for (const c of doc.cells6) if (inside(c.x, c.y)) { c.x += dx; c.y += dy; }
    });
    st.select({ type: 'rect', x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy });
  }
}

export function norm(s: Extract<Selection, { type: 'rect' }>): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
}

function toggleRoom(doc: MapDoc, x: number, y: number, on: boolean): void {
  const i = doc.cells6.findIndex((c) => c.x === x && c.y === y);
  if (on && i < 0) {
    if (!doc.sec6Header.length) return; // the map has no section 6 header to extend
    doc.cells6.push({ value: 0, x, y });
  } else if (!on && i >= 0) doc.cells6.splice(i, 1);
}
