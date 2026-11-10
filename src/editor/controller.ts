// Pointer / keyboard logic shared by the 2D and 3D views of both games. Views convert the pointer to cell
// coordinates (floating point, cell (x, y) spans [x, x+1) x [y, y+1)) and call these handlers.
import { WORLD_SNAP, letterByte, letterIndex, recCellPos, setRecCellPos, type MapDoc } from '../game/sections';
import { inGrid, removeTile, setTile, tileAt, type MapEditState, type Selection } from './model';
import { autoTiles, cellKey, partOf, roomGroups, type AutoCell, type AutoProfile } from './autotile';
import { roomCenters, roomVariantLetters } from './autotile-variants';
import type { Tile } from '../game/sections';
import { placeRec, recPositions, snapPoint, snapsIn, snapValue, type SnapGuide, type SnapResult } from './snap';

/** What the views tell the controller with a pointer move: Alt (snapping off while held) and the alignment reach. */
export interface PointerInfo {
  altKey?: boolean;
  /** How near (in cells) another record's x / y must be to align with it (the 2D view: a few pixels). */
  tol?: number;
}

interface AutoStroke {
  doc: MapDoc;
  start: string;
  base: Tile[];
  cells: Set<string>;
  profile: AutoProfile;
  randomVariants: boolean;
  samples: Map<string, number>;
}

export interface Layers {
  tiles: boolean;
  sections: Record<number, boolean>;
  room: boolean;
}

export class Controller {
  hover: [number, number] | null = null;
  private drag:
    | null
    | {
        kind: 'rec';
        section: number;
        index: number;
        dx: number;
        dy: number;
        moved: boolean;
        /** Where the pointer went down: a click (no drag past a few pixels) leaves the record where it is. */
        x0: number;
        y0: number;
      }
    | { kind: 'paint'; last: string; auto?: AutoStroke }
    | { kind: 'erase'; last: string }
    | { kind: 'rect'; x0: number; y0: number }
    | { kind: 'room'; on: boolean; last: string } = null;

  /** Section 9 starts hidden (RPG2: unknown points; RPG3: plants and fishing spots, many per map). */
  layers: Layers;
  onHover: () => void = () => {};
  /** The alignment guides of the record being moved (or of the place tool's point), for the views to draw. */
  snapGuides: SnapGuide[] = [];
  /** Where the place tool would put a record (snapped), while hovering with it. */
  placePoint: [number, number] | null = null;
  /** A record is being dragged (the views show the snap grid). */
  get dragging(): boolean {
    return this.drag?.kind === 'rec' && this.drag.moved;
  }
  private tol = 0.15;
  private free = false;

  constructor(readonly st: MapEditState) {
    this.layers = { tiles: true, sections: Object.fromEntries(st.pointSections.map((k) => [k, k !== 9])), room: true };
  }

  /** Record under a point (cell coords), searching the visible point layers. */
  hitRec(cx: number, cy: number, radius = 0.3): { section: number; index: number } | null {
    const doc = this.st.current;
    if (!doc) return null;
    let best: { section: number; index: number } | null = null;
    let bestD = radius;
    for (const k of this.st.pointSections) {
      if (!this.layers.sections[k]) continue;
      const L = this.st.layouts[k]!;
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

  /**
   * Where the 3D view should look after a click at (cx, cy) in the 2D view: the record the select tool picked, else the
   * clicked cell when it selected tiles; null for the other tools and an empty click.
   */
  clickFocus(cx: number, cy: number): [number, number] | null {
    const st = this.st;
    const doc = st.current;
    if (!doc || st.tool !== 'select') return null;
    const s = st.selection;
    if (s.type === 'rec') {
      const r = doc.recs[s.section]?.[s.index];
      return r ? recCellPos(r, st.layouts[s.section]!) : null;
    }
    if (s.type === 'tiles') return [Math.floor(cx) + 0.5, Math.floor(cy) + 0.5];
    return null;
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
          const [px, py] = recCellPos(r, st.layouts[hit.section]!);
          st.select({ type: 'rec', ...hit });
          this.drag = { kind: 'rec', ...hit, dx: px - cx, dy: py - cy, moved: false, x0: cx, y0: cy };
          return;
        }
        if (this.layers.tiles && tileAt(doc, x, y)) {
          const cur = st.selection;
          if (e.shiftKey && cur.type === 'tiles') {
            const has = cur.cells.some(([a, b]) => a === x && b === y);
            st.select({
              type: 'tiles',
              cells: has ? cur.cells.filter(([a, b]) => a !== x || b !== y) : [...cur.cells, [x, y]],
            });
          } else st.select({ type: 'tiles', cells: [[x, y]] });
        } else st.select({ type: 'none' });
        return;
      }
      case 'paint':
        if (!inGrid(x, y)) return;
        if (st.brush.auto && !st.autoProfile) return;
        st.checkpoint();
        if (st.brush.auto && st.autoProfile) {
          const auto: AutoStroke = {
            doc,
            start: cellKey(x, y),
            base: doc.tiles.map((t) => ({ ...t })),
            cells: new Set([cellKey(x, y)]),
            profile: st.autoProfile,
            randomVariants: st.autoRandomVariants,
            samples: new Map(),
          };
          this.drag = { kind: 'paint', last: cellKey(x, y), auto };
          this.paintAuto(auto);
        } else {
          st.touch((d) => setTile(d, x, y, st.brush));
          this.drag = { kind: 'paint', last: cellKey(x, y) };
        }
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
        const at = this.snapAt(cx, cy);
        try {
          st.edit((d) => {
            const p = st.placeStamp(d, stamp, cx, cy);
            placed = p;
            const L = st.layouts[p[0]]!;
            // fractions of a cell: the snapped point (cell units keep the cell clicked)
            if (snapsIn(L)) placeRec(d.recs[p[0]]![p[1]]!, L, at.x, at.y);
          });
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
        st.touch((d) => toggleRoom(d, x, y, on, st.cell6Value));
        this.drag = { kind: 'room', on, last: `${x},${y}` };
        return;
      }
    }
  }

  /**
   * Snap a point for a record: the grid of the snap settings and the other records of the visible layers (Alt held:
   * neither). `except`: the record being moved.
   */
  snapAt(cx: number, cy: number, except?: { section: number; index: number }): SnapResult {
    const st = this.st;
    const doc = st.current;
    if (this.free || !doc) return { x: snapValue(cx, 0), y: snapValue(cy, 0), guides: [] };
    const sections = st.pointSections.filter((k) => this.layers.sections[k]);
    const others = st.snap.align ? recPositions(doc.recs, st.layouts, sections, except) : [];
    return snapPoint(cx, cy, st.snap, others, this.tol);
  }

  move(cx: number, cy: number, info: PointerInfo = {}): void {
    this.free = !!info.altKey;
    if (info.tol !== undefined) this.tol = info.tol;
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    const prev = this.hover;
    this.hover = [x, y];
    const st = this.st;
    const d = this.drag;
    if (st.tool === 'place' && !d && st.stamp) {
      const at = this.snapAt(cx, cy);
      const was = this.placePoint;
      this.placePoint = [at.x, at.y];
      this.snapGuides = at.guides;
      if (!was || was[0] !== at.x || was[1] !== at.y || !prev || prev[0] !== x || prev[1] !== y) this.onHover();
    } else if (this.placePoint) {
      this.placePoint = null;
      this.snapGuides = [];
      this.onHover();
    } else if (!prev || prev[0] !== x || prev[1] !== y) this.onHover();
    if (!d) return;
    const key = `${x},${y}`;
    switch (d.kind) {
      case 'rec': {
        const L = st.layouts[d.section]!;
        if (!d.moved) {
          // a click that wobbles a pixel or two does not move (and so snap) the record
          if (Math.hypot(cx - d.x0, cy - d.y0) < this.tol * 0.4) return;
          st.checkpoint();
          d.moved = true;
        }
        if (!snapsIn(L)) {
          st.touch((doc) => setRecCellPos(doc.recs[d.section]![d.index]!, L, cx + d.dx, cy + d.dy));
          return;
        }
        const at = this.snapAt(cx + d.dx, cy + d.dy, d);
        this.snapGuides = at.guides;
        st.touch((doc) => placeRec(doc.recs[d.section]![d.index]!, L, at.x, at.y));
        return;
      }
      case 'paint':
        if (key === d.last || !inGrid(x, y)) return;
        const [px, py] = d.last.split(',').map(Number) as [number, number];
        d.last = key;
        if (d.auto) {
          const steps = Math.max(Math.abs(x - px), Math.abs(y - py));
          for (let i = 1; i <= steps; i++)
            d.auto.cells.add(cellKey(Math.round(px + ((x - px) * i) / steps), Math.round(py + ((y - py) * i) / steps)));
          this.paintAuto(d.auto);
        } else st.touch((doc) => setTile(doc, x, y, st.brush));
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
        st.touch((doc) => toggleRoom(doc, x, y, d.on, st.cell6Value));
        return;
    }
  }

  private paintAuto(auto: AutoStroke): void {
    // Opening a map or undoing during a captured gesture must not replay an old stroke into it.
    if (this.st.current !== auto.doc) {
      this.drag = null;
      return;
    }
    this.st.touch((doc) => {
      const updates = autoTiles(auto.base, auto.cells, auto.profile, auto.start);
      const originals = new Map(auto.base.map((tile) => [cellKey(tile.x, tile.y), tile]));
      const resolved = new Map<string, AutoCell>(originals);
      for (const tile of updates) resolved.set(cellKey(tile.x, tile.y), tile);
      const terrain = [...resolved.values()];
      const groups = roomGroups(terrain, auto.profile);
      const changed = new Set(auto.cells);
      for (const tile of updates) {
        const key = cellKey(tile.x, tile.y),
          original = originals.get(key);
        if (!original || original.kind !== tile.kind || original.rot !== tile.rot) changed.add(key);
      }
      const touchedRooms = new Set([...changed].map((key) => groups.get(key)).filter((id) => id !== undefined));
      const updatedKeys = new Set(updates.map((tile) => cellKey(tile.x, tile.y)));
      const region = terrain.filter(
        (tile) => updatedKeys.has(cellKey(tile.x, tile.y)) || touchedRooms.has(groups.get(cellKey(tile.x, tile.y))!),
      );
      const centers = roomCenters(region, auto.profile),
        previousCenters = roomCenters(auto.base, auto.profile);
      const available = new Map<number, readonly number[]>();
      const variants = roomVariantLetters(
        region,
        auto.profile,
        (kind) => {
          if (!available.has(kind)) available.set(kind, this.st.autoVariantLetters(kind));
          return available.get(kind)!;
        },
        auto.randomVariants,
        (tile) => {
          const key = `${cellKey(tile.x, tile.y)}/${tile.kind}`;
          let sample = auto.samples.get(key);
          if (sample === undefined) {
            sample = Math.random();
            auto.samples.set(key, sample);
          }
          return sample;
        },
      );
      const encoded = new Map<string, number>();
      for (const tile of region) {
        const key = cellKey(tile.x, tile.y),
          original = originals.get(key);
        const part = partOf(tile, auto.profile),
          role = part?.variation;
        const roomTouched = touchedRooms.has(groups.get(key)!);
        if (!updatedKeys.has(key) && !(role === 'floor' && roomTouched)) continue;
        let preferred = letterByte(variants.get(key) ?? 0);
        if (original && !auto.cells.has(key)) {
          // Do not reroll unchanged decoration, nor alter unrelated existing manual variants.
          const keepFloor = role === 'floor' && centers.has(key) && previousCenters.has(key) && auto.randomVariants;
          const keepEdge = role && role !== 'floor' && !changed.has(key);
          const keepCorridor = !role && !(part?.wide && part.narrow);
          if (!roomTouched || keepFloor || keepEdge || keepCorridor) preferred = original.letter;
        }
        const codecKey = `${tile.kind}/${preferred}`;
        if (!encoded.has(codecKey)) encoded.set(codecKey, this.st.autoLetter(tile.kind, preferred));
        const letter = encoded.get(codecKey)!;
        setTile(doc, tile.x, tile.y, { ...tile, letter });
      }
    });
  }

  up(): void {
    const had = this.snapGuides.length > 0 || this.drag?.kind === 'rec';
    this.drag = null;
    this.snapGuides = [];
    if (had) this.onHover();
  }

  leave(): void {
    this.hover = null;
    this.placePoint = null;
    if (!this.drag) this.snapGuides = [];
    this.onHover();
  }

  // ---- commands (keyboard / toolbar)

  rotate(dir: 1 | -1): void {
    const st = this.st;
    const s = st.selection;
    if (s.type === 'rec' && st.canRotate(s.section)) {
      st.edit((doc) => {
        const r = doc.recs[s.section]?.[s.index];
        if (r) st.rotateRecord(r, s.section, dir);
      });
      return;
    }
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
      st.edit((doc) => {
        const [rec] = doc.recs[s.section]!.splice(s.index, 1);
        if (rec) st.recordRemoved(doc, s.section, rec);
      });
      st.select({ type: 'none' });
      return;
    }
    st.emit('selection');
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
        const L = st.layouts[s.section]!;
        const copy = st.duplicateRecord(doc, s.section, r);
        const [px, py] = recCellPos(r, L);
        // one cell to the right: the copy stays on every grid the original is on
        if (snapsIn(L)) placeRec(copy, L, px + 1, py);
        else setRecCellPos(copy, L, px + 1, py);
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
      const L = st.layouts[s.section]!;
      if (snapsIn(L)) {
        // one step of the snap grid (no grid: 1/50 cell), landing on the grid
        const step = st.snap.step || 0.02;
        st.edit((doc) => {
          const r = doc.recs[s.section]![s.index]!;
          const [px, py] = recCellPos(r, L);
          placeRec(
            r,
            L,
            dx ? snapValue(px + dx * step, st.snap.step) : px,
            dy ? snapValue(py + dy * step, st.snap.step) : py,
          );
        });
        return;
      }
      // one unit of the record (a cell; 50 for world coordinates)
      const step = L.unit === 'world' ? WORLD_SNAP : 1;
      st.edit((doc) => {
        const r = doc.recs[s.section]![s.index]!;
        r.x += dx * step;
        r.y += dy * step;
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
      for (const k of st.pointSections) {
        const L = st.layouts[k]!;
        for (const p of doc.recs[k] ?? []) {
          const [px, py] = recCellPos(p, L);
          if (!inside(Math.floor(px), Math.floor(py))) continue;
          setRecCellPos(p, L, px + dx, py + dy);
        }
      }
      for (const c of doc.cells6)
        if (inside(c.x, c.y)) {
          c.x += dx;
          c.y += dy;
        }
    });
    st.select({ type: 'rect', x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy });
  }
}

export function norm(s: Extract<Selection, { type: 'rect' }>): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
}

function toggleRoom(doc: MapDoc, x: number, y: number, on: boolean, value: number): void {
  const i = doc.cells6.findIndex((c) => c.x === x && c.y === y);
  if (on && i < 0) {
    if (!doc.sec6Header.length) return; // the map has no section 6 header to extend
    doc.cells6.push({ value, x, y });
  } else if (!on && i >= 0) doc.cells6.splice(i, 1);
}

/**
 * The editor's keyboard shortcuts (tools, undo, copy, rotate, letters, moving the selection). `letters`: the letter
 * indices of the brush's kind in the tileset ([ / ]). Returns whether the key was used.
 */
export function editorKey(e: KeyboardEvent, ctl: Controller, letters: () => number[]): boolean {
  const st = ctl.st;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return false;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z' && !e.shiftKey) st.undo();
  else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) st.redo();
  else if (mod && key === 'c') ctl.copy();
  else if (mod && key === 'v') ctl.paste();
  else if (mod && key === 'd') ctl.duplicateRec();
  else if (mod) return false;
  else if (e.key === 'Delete' || e.key === 'Backspace') ctl.deleteSelection();
  else if (e.key === 'r' || e.key === 'R') ctl.rotate(e.shiftKey ? -1 : 1);
  else if (e.key === '[') ctl.cycleLetter(letters(), -1);
  else if (e.key === ']') ctl.cycleLetter(letters(), 1);
  else if (e.key === 'v') st.setTool('select');
  else if (e.key === 'b') st.setTool('paint');
  else if (e.key === 'e') st.setTool('erase');
  else if (e.key === 'm') st.setTool('rect');
  else if (e.key === 'g') st.setTool('room');
  else if (e.key === 'Escape') {
    if (st.tool === 'place') st.setTool('select');
    else st.select({ type: 'none' });
  } else if (e.key.startsWith('Arrow') && (e.shiftKey || st.selection.type === 'rec')) {
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key] as [
      number,
      number,
    ];
    ctl.shiftSelection(d[0], d[1]);
  } else return false;
  return true;
}
